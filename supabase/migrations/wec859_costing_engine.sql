-- ============================================================================
-- WEC-859 — Costing 2: cost history engine (epic WEC-857)
--
-- Applied to the DEV branch (jrxxsixhxgawucorfyjt) on 2026-10-11 overnight.
-- NOT yet on production — needs Ioustinos's OK.
--
-- Two layers:
--
--  1. PURE functions that compute a cost on any date straight from the source
--     tables. These are the single source of truth:
--        cost_item_cost_at(item, date)        → € per base unit (net)
--        cost_component_cost_at(comp, date)   → € per cooked gram (+ breakdown)
--        cost_variant_cost_at(variant, date)  → food + packaging = product cost
--
--  2. A LEDGER (cost_history) that materialises those values by date so reads
--     are one indexed lookup (cost_at). Rows are written only when a source
--     changes (purchase line, component version, dish grams, link, packaging),
--     only for the entities affected, and only from the change date forward.
--     A late-entered purchase with an earlier date rebuilds forward from its
--     date. The nightly check (WEC-861) recomputes everything with layer 1 and
--     compares — so a ledger bug is visible the next morning.
--
-- Rules (🟢 Ioustinos):
--   🟢 cost item price at D = last purchase line with invoice_date ≤ D and not
--      excluded (net unit cost); else standard cost («estimated»); else 0
--      («unpriced»).
--   🟢 component = version in force at D (latest published effective_from ≤ D).
--   🟢 dish variant = plated grams in force at D × linked component cost/g,
--      plus packaging set per dish.
--
-- Links (dish line → component) and per-dish packaging are CURRENT mappings
-- applied to all dates (a link fix is a correction, not an event). Packaging
-- ITEM prices still move by date through purchases. (Claude's design choice —
-- flagged in the morning review.)
-- ============================================================================

-- ── ledger ──────────────────────────────────────────────────────────────────
create table if not exists public.cost_history (
  id              bigserial primary key,
  entity_type     text not null check (entity_type in ('item','component','variant')),
  entity_id       text not null,
  effective_from  date not null,
  -- item: € per base unit · component: € per cooked g · variant: product cost € per portion
  unit_cost       numeric(18,8) not null,
  food_cost       numeric(14,6),          -- variant only
  packaging_cost  numeric(14,6),          -- variant only
  flags           jsonb not null default '{}'::jsonb,
  breakdown       jsonb not null default '{}'::jsonb,
  cause           text,
  created_at      timestamptz not null default now(),
  -- rows are never deleted: a rebuild marks the rows it replaces as superseded
  -- (audit trail of every value the ledger ever held; also the MCP refuses
  -- DELETE inside function bodies)
  superseded_at   timestamptz
);
create unique index if not exists cost_history_live_uq
  on public.cost_history (entity_type, entity_id, effective_from) where superseded_at is null;
create index if not exists cost_history_lookup_idx
  on public.cost_history (entity_type, entity_id, effective_from desc) where superseded_at is null;

create table if not exists public.cost_rebuild_queue (
  id           bigserial primary key,
  entity_type  text not null,       -- 'item' | 'component' | 'dish' | 'variant'
  entity_id    text not null,
  from_date    date not null,
  cause        text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists cost_rebuild_queue_pending_idx on public.cost_rebuild_queue (id) where processed_at is null;

-- ── layer 1: pure computations ─────────────────────────────────────────────
create or replace function public.cost_item_cost_at(p_item uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; v_std numeric;
begin
  select l.id, l.unit_cost, i.invoice_date into r
  from cost_purchase_lines l
  join cost_purchase_invoices i on i.id = l.invoice_id
  where l.cost_item_id = p_item and not l.exclude_from_costing and i.invoice_date <= p_date
  order by i.invoice_date desc, l.created_at desc, l.id desc
  limit 1;
  if found then
    return jsonb_build_object('unit_cost', r.unit_cost, 'source', 'purchase',
                              'price_date', r.invoice_date, 'purchase_line_id', r.id);
  end if;
  select standard_cost_per_unit into v_std from cost_items where id = p_item;
  if v_std is not null then
    return jsonb_build_object('unit_cost', v_std, 'source', 'standard');
  end if;
  return jsonb_build_object('unit_cost', 0, 'source', 'unpriced');
end $$;

-- Version in force on a date.
create or replace function public.cost_component_version_at(p_component uuid, p_date date)
returns uuid language sql stable security definer set search_path = public as $$
  select v.id from cost_component_versions v
  where v.component_id = p_component and v.status = 'published' and v.effective_from <= p_date
  order by v.effective_from desc, v.version_no desc
  limit 1
$$;

create or replace function public.cost_component_cost_at(p_component uuid, p_date date, p_depth int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v       record;
  ln      record;
  c       jsonb;
  v_total numeric := 0;
  v_raw_g numeric := 0;
  v_out_g numeric;
  v_lines jsonb := '[]'::jsonb;
  v_est   boolean := false;
  v_unp   int := 0;
  v_now   boolean := false;     -- a pcs/ml line without grams_per_unit in a % yield
  v_line_cost numeric;
  v_unit numeric;
begin
  if p_depth > 12 then
    return jsonb_build_object('cost_per_g', 0, 'flags', jsonb_build_object('cycle', true), 'lines', '[]'::jsonb);
  end if;
  select cv.*, cc.name as component_name into v
  from cost_component_versions cv join cost_components cc on cc.id = cv.component_id
  where cv.id = public.cost_component_version_at(p_component, p_date);
  if not found then
    return jsonb_build_object('cost_per_g', 0, 'flags', jsonb_build_object('no_version', true), 'lines', '[]'::jsonb);
  end if;

  if v.yield_mode = 'fixed' then
    return jsonb_build_object(
      'cost_per_g', v.fixed_cost_per_g, 'version_id', v.id, 'version_no', v.version_no,
      'effective_from', v.effective_from, 'yield_mode', 'fixed',
      'flags', jsonb_build_object('estimated', true), 'lines', '[]'::jsonb);
  end if;

  for ln in
    select l.*, i.name as item_name, i.base_unit, i.grams_per_unit, cc.name as child_name
    from cost_component_version_lines l
    left join cost_items i on i.id = l.cost_item_id
    left join cost_components cc on cc.id = l.child_component_id
    where l.version_id = v.id
    order by l.sort_order, l.id
  loop
    if ln.cost_item_id is not null then
      c := public.cost_item_cost_at(ln.cost_item_id, p_date);
      v_unit := (c->>'unit_cost')::numeric;
      v_line_cost := ln.qty * v_unit;
      if c->>'source' = 'standard' then v_est := true; end if;
      if c->>'source' = 'unpriced' then v_unp := v_unp + 1; end if;
      if ln.base_unit = 'g' then v_raw_g := v_raw_g + ln.qty;
      elsif ln.grams_per_unit is not null then v_raw_g := v_raw_g + ln.qty * ln.grams_per_unit;
      elsif ln.base_unit = 'ml' then v_raw_g := v_raw_g + ln.qty;    -- ~1 g/ml
      else v_now := true;
      end if;
      v_lines := v_lines || jsonb_build_object(
        'kind', 'item', 'id', ln.cost_item_id, 'name', ln.item_name, 'qty', ln.qty, 'unit', ln.base_unit,
        'unit_cost', v_unit, 'source', c->>'source', 'price_date', c->>'price_date', 'line_cost', v_line_cost);
    else
      c := public.cost_component_cost_at(ln.child_component_id, p_date, p_depth + 1);
      v_unit := (c->>'cost_per_g')::numeric;
      v_line_cost := ln.qty * v_unit;
      if coalesce((c->'flags'->>'estimated')::boolean, false) then v_est := true; end if;
      v_unp := v_unp + coalesce((c->'flags'->>'unpriced')::int, 0)
                     + case when coalesce((c->'flags'->>'no_version')::boolean, false) then 1 else 0 end;
      v_raw_g := v_raw_g + ln.qty;
      v_lines := v_lines || jsonb_build_object(
        'kind', 'component', 'id', ln.child_component_id, 'name', ln.child_name, 'qty', ln.qty, 'unit', 'g',
        'unit_cost', v_unit, 'line_cost', v_line_cost,
        'flags', c->'flags');
    end if;
    v_total := v_total + v_line_cost;
  end loop;

  v_out_g := case v.yield_mode when 'pct' then v_raw_g * v.yield_pct / 100 else v.output_weight_g end;

  return jsonb_build_object(
    'cost_per_g', case when coalesce(v_out_g, 0) > 0 then v_total / v_out_g else 0 end,
    'total_cost', v_total, 'raw_weight_g', v_raw_g, 'output_g', v_out_g,
    'version_id', v.id, 'version_no', v.version_no, 'effective_from', v.effective_from,
    'yield_mode', v.yield_mode, 'yield_pct', v.yield_pct, 'output_weight_g', v.output_weight_g,
    'flags', jsonb_strip_nulls(jsonb_build_object(
        'estimated', case when v_est then true end,
        'unpriced',  case when v_unp > 0 then v_unp end,
        'no_weight', case when v_now and v.yield_mode = 'pct' then true end,
        'zero_output', case when coalesce(v_out_g,0) <= 0 then true end)),
    'lines', v_lines);
end $$;

-- Component a dish line costs as: explicit per-dish link, else the display
-- ingredient's default link.
create or replace function public.cost_line_component(p_dish text, p_ingredient uuid)
returns table (component_id uuid, link_source text)
language sql stable security definer set search_path = public as $$
  select coalesce(l.component_id, d.component_id),
         case when l.component_id is not null then l.source
              when d.component_id is not null then 'default' end
  from (select 1) x
  left join cost_dish_line_links l on l.dish_id = p_dish and l.ingredient_id = p_ingredient
  left join cost_ingredient_default_links d on d.ingredient_id = p_ingredient
$$;

create or replace function public.cost_variant_cost_at(p_variant text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_dish text; v_price int;
  ln record; c jsonb; pk record;
  v_food numeric := 0; v_pack numeric := 0;
  v_lines jsonb := '[]'::jsonb; v_packs jsonb := '[]'::jsonb;
  v_unlinked int := 0; v_unp int := 0; v_est boolean := false;
  v_cost numeric; v_cpg numeric;
begin
  select dish_id, price into v_dish, v_price from dish_variants where id = p_variant;
  if v_dish is null then return null; end if;

  for ln in
    select g.ingredient_id, g.grams, ing.name_el, lc.component_id, lc.link_source, cc.name as component_name
    from (
      select distinct on (h.ingredient_id) h.ingredient_id, h.grams
      from cost_dish_gram_history h
      where h.variant_id = p_variant and h.effective_from <= p_date
      order by h.ingredient_id, h.effective_from desc, h.id desc
    ) g
    join ingredients ing on ing.id = g.ingredient_id
    left join lateral public.cost_line_component(v_dish, g.ingredient_id) lc on true
    left join cost_components cc on cc.id = lc.component_id
    where g.grams > 0
    order by g.grams desc
  loop
    if ln.component_id is null then
      v_unlinked := v_unlinked + 1;
      v_lines := v_lines || jsonb_build_object('ingredient_id', ln.ingredient_id, 'ingredient', ln.name_el,
                   'grams', ln.grams, 'component_id', null, 'line_cost', 0, 'unlinked', true);
      continue;
    end if;
    c := public.cost_component_cost_at(ln.component_id, p_date);
    v_cpg := (c->>'cost_per_g')::numeric;
    v_cost := ln.grams * v_cpg;
    v_food := v_food + v_cost;
    if coalesce((c->'flags'->>'estimated')::boolean, false) then v_est := true; end if;
    v_unp := v_unp + coalesce((c->'flags'->>'unpriced')::int, 0)
                   + case when coalesce((c->'flags'->>'no_version')::boolean, false) then 1 else 0 end;
    v_lines := v_lines || jsonb_build_object('ingredient_id', ln.ingredient_id, 'ingredient', ln.name_el,
                 'grams', ln.grams, 'component_id', ln.component_id, 'component', ln.component_name,
                 'link_source', ln.link_source, 'cost_per_g', v_cpg, 'line_cost', v_cost, 'flags', c->'flags');
  end loop;

  for pk in
    select p.cost_item_id, p.qty_per_portion, i.name
    from cost_dish_packaging p join cost_items i on i.id = p.cost_item_id
    where p.dish_id = v_dish order by i.name
  loop
    c := public.cost_item_cost_at(pk.cost_item_id, p_date);
    v_cost := pk.qty_per_portion * (c->>'unit_cost')::numeric;
    v_pack := v_pack + v_cost;
    if c->>'source' = 'standard' then v_est := true; end if;
    if c->>'source' = 'unpriced' then v_unp := v_unp + 1; end if;
    v_packs := v_packs || jsonb_build_object('cost_item_id', pk.cost_item_id, 'name', pk.name,
                 'qty', pk.qty_per_portion, 'unit_cost', c->'unit_cost', 'source', c->>'source', 'line_cost', v_cost);
  end loop;

  return jsonb_build_object(
    'variant_id', p_variant, 'dish_id', v_dish, 'date', p_date,
    'price', round(v_price / 100.0, 2),
    'food_cost', v_food, 'packaging_cost', v_pack, 'product_cost', v_food + v_pack,
    'flags', jsonb_strip_nulls(jsonb_build_object(
        'unlinked', case when v_unlinked > 0 then v_unlinked end,
        'unpriced', case when v_unp > 0 then v_unp end,
        'estimated', case when v_est then true end,
        'no_packaging', case when jsonb_array_length(v_packs) = 0 then true end)),
    'lines', v_lines, 'packaging', v_packs);
end $$;

-- ── closure helpers ─────────────────────────────────────────────────────────
-- Every component reachable below p_component through ANY published version
-- (superset across time is fine: extra dates only produce de-duplicated rows).
create or replace function public.cost_component_closure(p_component uuid)
returns table (component_id uuid) language sql stable security definer set search_path = public as $$
  with recursive t(cid) as (
    select p_component
    union
    select l.child_component_id
    from t
    join cost_component_versions v on v.component_id = t.cid and v.status = 'published'
    join cost_component_version_lines l on l.version_id = v.id and l.child_component_id is not null
  )
  select cid from t
$$;

-- Dates on which the value of an entity can change (≥ p_from).
create or replace function public.cost_change_dates(p_type text, p_id text, p_from date)
returns setof date language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'item' then
    return query
      select distinct i.invoice_date from cost_purchase_lines l
      join cost_purchase_invoices i on i.id = l.invoice_id
      where l.cost_item_id = p_id::uuid and i.invoice_date >= p_from;
  elsif p_type = 'component' then
    return query
      with comps as (select component_id from public.cost_component_closure(p_id::uuid)),
      items as (
        select distinct l.cost_item_id from comps
        join cost_component_versions v on v.component_id = comps.component_id and v.status = 'published'
        join cost_component_version_lines l on l.version_id = v.id and l.cost_item_id is not null)
      select distinct d from (
        select v.effective_from as d from cost_component_versions v
          join comps on comps.component_id = v.component_id where v.status = 'published'
        union
        select i.invoice_date from cost_purchase_lines l
          join cost_purchase_invoices i on i.id = l.invoice_id
          join items on items.cost_item_id = l.cost_item_id
      ) x where d >= p_from;
  elsif p_type = 'variant' then
    return query
      with v as (select dish_id from dish_variants where id = p_id),
      ings as (select distinct h.ingredient_id from cost_dish_gram_history h where h.variant_id = p_id),
      lcs as (
        select lc.component_id from ings, v, lateral public.cost_line_component(v.dish_id, ings.ingredient_id) lc
        where lc.component_id is not null),
      comps as (
        select distinct cl.component_id from lcs, lateral public.cost_component_closure(lcs.component_id) cl),
      items as (
        select distinct l.cost_item_id from comps
        join cost_component_versions cv on cv.component_id = comps.component_id and cv.status = 'published'
        join cost_component_version_lines l on l.version_id = cv.id and l.cost_item_id is not null
        union
        select p.cost_item_id from cost_dish_packaging p, v where p.dish_id = v.dish_id)
      select distinct d from (
        select h.effective_from as d from cost_dish_gram_history h where h.variant_id = p_id
        union
        select cv.effective_from from cost_component_versions cv
          join comps on comps.component_id = cv.component_id where cv.status = 'published'
        union
        select i.invoice_date from cost_purchase_lines l
          join cost_purchase_invoices i on i.id = l.invoice_id
          join items on items.cost_item_id = l.cost_item_id
      ) x where d >= p_from;
  end if;
end $$;

-- ── layer 2: ledger maintenance ────────────────────────────────────────────
create or replace function public.cost_compute(p_type text, p_id text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'item' then return public.cost_item_cost_at(p_id::uuid, p_date);
  elsif p_type = 'component' then return public.cost_component_cost_at(p_id::uuid, p_date);
  else return public.cost_variant_cost_at(p_id, p_date);
  end if;
end $$;

create or replace function public.cost_rebuild_entity(p_type text, p_id text, p_from date, p_cause text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  d date; r jsonb; v_cost numeric; v_food numeric; v_pack numeric; v_flags jsonb;
  prev record; v_n int := 0;
begin
  update cost_history set superseded_at = now()
   where entity_type = p_type and entity_id = p_id and effective_from >= p_from and superseded_at is null;
  for d in
    select x from (select p_from as x union select public.cost_change_dates(p_type, p_id, p_from)) s order by x
  loop
    r := public.cost_compute(p_type, p_id, d);
    if r is null then continue; end if;
    if p_type = 'item' then
      v_cost := (r->>'unit_cost')::numeric; v_food := null; v_pack := null;
      v_flags := jsonb_strip_nulls(jsonb_build_object(
        'estimated', case when r->>'source' = 'standard' then true end,
        'unpriced',  case when r->>'source' = 'unpriced' then true end));
    elsif p_type = 'component' then
      v_cost := (r->>'cost_per_g')::numeric; v_food := null; v_pack := null; v_flags := coalesce(r->'flags', '{}');
    else
      v_cost := (r->>'product_cost')::numeric; v_food := (r->>'food_cost')::numeric;
      v_pack := (r->>'packaging_cost')::numeric; v_flags := coalesce(r->'flags', '{}');
    end if;
    select unit_cost, food_cost, packaging_cost, flags into prev
    from cost_history where entity_type = p_type and entity_id = p_id and effective_from < d
      and superseded_at is null
    order by effective_from desc limit 1;
    if found and round(prev.unit_cost, 8) = round(v_cost, 8)
       and prev.food_cost is not distinct from round(v_food, 6)
       and prev.packaging_cost is not distinct from round(v_pack, 6)
       and prev.flags = v_flags then
      continue;   -- unchanged: the earlier row still holds
    end if;
    insert into cost_history (entity_type, entity_id, effective_from, unit_cost, food_cost, packaging_cost, flags, breakdown, cause)
    values (p_type, p_id, d, round(v_cost, 8), round(v_food, 6), round(v_pack, 6), v_flags, r, p_cause);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Entities whose cost depends on the given one (not including itself).
create or replace function public.cost_dependents(p_type text, p_id text)
returns table (entity_type text, entity_id text)
language sql stable security definer set search_path = public as $$
  with recursive
  seed_comps(cid) as (
    -- components that use the item directly
    select distinct v.component_id from cost_component_version_lines l
      join cost_component_versions v on v.id = l.version_id and v.status = 'published'
      where p_type = 'item' and l.cost_item_id::text = p_id
    union
    select c.id from cost_components c where p_type = 'component' and c.id::text = p_id
  ),
  up(cid) as (
    select cid from seed_comps
    union
    select v.component_id from up
      join cost_component_version_lines l on l.child_component_id = up.cid
      join cost_component_versions v on v.id = l.version_id and v.status = 'published'
  ),
  dishes as (
    select distinct l.dish_id from cost_dish_line_links l join up on up.cid = l.component_id
    union
    select distinct di.dish_id from cost_ingredient_default_links dl
      join up on up.cid = dl.component_id
      join dish_ingredients di on di.ingredient_id = dl.ingredient_id
      left join cost_dish_line_links x on x.dish_id = di.dish_id and x.ingredient_id = di.ingredient_id
      where x.dish_id is null
    union
    select distinct p.dish_id from cost_dish_packaging p where p_type = 'item' and p.cost_item_id::text = p_id
    union
    select p_id where p_type = 'dish'
  )
  select 'component', cid::text from up where not (p_type = 'component' and cid::text = p_id)
  union all
  select 'variant', dv.id from dish_variants dv join dishes d on d.dish_id = dv.dish_id
$$;

create or replace function public.cost_enqueue(p_type text, p_id text, p_from date, p_cause text default null)
returns void language sql security definer set search_path = public as $$
  insert into cost_rebuild_queue (entity_type, entity_id, from_date, cause) values (p_type, p_id, p_from, p_cause);
$$;

create or replace function public.cost_enqueue_dish(p_dish_id text, p_from date)
returns void language sql security definer set search_path = public as $$
  select public.cost_enqueue('dish', p_dish_id, p_from, 'grams:' || p_dish_id);
$$;

-- Drain the queue: expand each queued entity to itself + dependents, keep the
-- earliest from-date per entity, rebuild each once.
create or replace function public.cost_process_queue()
returns int language plpgsql security definer set search_path = public as $$
declare q record; v_n int := 0;
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return 0; end if;
  for q in
    with claimed as (update cost_rebuild_queue set processed_at = now() where processed_at is null
                     returning entity_type, entity_id, from_date, cause),
    expanded as (
      select case when c.entity_type = 'dish' then null else c.entity_type end as et,
             c.entity_id as eid, c.from_date, c.cause
        from claimed c
      union all
      select d.entity_type, d.entity_id, c.from_date, c.cause
        from claimed c, lateral public.cost_dependents(c.entity_type, c.entity_id) d
    )
    select et, eid, min(from_date) as from_date, min(cause) as cause
    from expanded where et is not null
    group by et, eid
    order by case et when 'item' then 1 when 'component' then 2 else 3 end
  loop
    v_n := v_n + public.cost_rebuild_entity(q.et, q.eid, q.from_date, q.cause);
  end loop;
  return v_n;
end $$;

-- ── triggers on the source tables ──────────────────────────────────────────
create or replace function public.trg_cost_purchase_line_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old date; v_new date;
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  if TG_OP in ('UPDATE','DELETE') then
    select invoice_date into v_old from cost_purchase_invoices where id = OLD.invoice_id;
    if v_old is not null then perform public.cost_enqueue('item', OLD.cost_item_id::text, v_old, 'purchase:' || OLD.id); end if;
  end if;
  if TG_OP in ('INSERT','UPDATE') then
    select invoice_date into v_new from cost_purchase_invoices where id = NEW.invoice_id;
    perform public.cost_enqueue('item', NEW.cost_item_id::text, v_new, 'purchase:' || NEW.id);
  end if;
  return null;
end $$;

create or replace function public.trg_cost_invoice_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  if NEW.invoice_date is distinct from OLD.invoice_date then
    insert into cost_rebuild_queue (entity_type, entity_id, from_date, cause)
    select 'item', l.cost_item_id::text, least(OLD.invoice_date, NEW.invoice_date), 'invoice:' || NEW.id
    from cost_purchase_lines l where l.invoice_id = NEW.id;
  end if;
  return null;
end $$;

create or replace function public.trg_cost_item_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  -- standard cost / unit weight have no date → retroactive
  if NEW.standard_cost_per_unit is distinct from OLD.standard_cost_per_unit
     or NEW.grams_per_unit is distinct from OLD.grams_per_unit
     or NEW.base_unit is distinct from OLD.base_unit then
    perform public.cost_enqueue('item', NEW.id::text, date '1900-01-01', 'item:' || NEW.id);
  end if;
  return null;
end $$;

create or replace function public.trg_cost_version_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  if NEW.status = 'published' and (TG_OP = 'INSERT' or OLD.status is distinct from 'published') then
    perform public.cost_enqueue('component', NEW.component_id::text, NEW.effective_from, 'version:' || NEW.id);
  end if;
  return null;
end $$;

create or replace function public.trg_cost_mapping_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  if TG_TABLE_NAME in ('cost_dish_line_links','cost_dish_packaging') then
    perform public.cost_enqueue('dish', coalesce(NEW.dish_id, OLD.dish_id), date '1900-01-01',
                                TG_TABLE_NAME || ':' || coalesce(NEW.dish_id, OLD.dish_id));
  else -- cost_ingredient_default_links: every dish using the ingredient without its own link
    for r in
      select distinct di.dish_id from dish_ingredients di
      left join cost_dish_line_links x on x.dish_id = di.dish_id and x.ingredient_id = di.ingredient_id
      where di.ingredient_id = coalesce(NEW.ingredient_id, OLD.ingredient_id) and x.dish_id is null
    loop
      perform public.cost_enqueue('dish', r.dish_id, date '1900-01-01', 'default_link');
    end loop;
  end if;
  return null;
end $$;

create or replace function public.trg_cost_process_queue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.cost_process_queue();
  return null;
end $$;

create or replace trigger cost_purchase_lines_changed after insert or update or delete on public.cost_purchase_lines
  for each row execute function public.trg_cost_purchase_line_changed();
create or replace trigger cost_purchase_invoices_changed after update on public.cost_purchase_invoices
  for each row execute function public.trg_cost_invoice_changed();
create or replace trigger cost_items_changed after update on public.cost_items
  for each row execute function public.trg_cost_item_changed();
create or replace trigger cost_component_versions_changed after insert or update on public.cost_component_versions
  for each row execute function public.trg_cost_version_changed();
create or replace trigger cost_dish_line_links_changed after insert or update or delete on public.cost_dish_line_links
  for each row execute function public.trg_cost_mapping_changed();
create or replace trigger cost_dish_packaging_changed after insert or update or delete on public.cost_dish_packaging
  for each row execute function public.trg_cost_mapping_changed();
create or replace trigger cost_ingredient_default_links_changed after insert or update or delete on public.cost_ingredient_default_links
  for each row execute function public.trg_cost_mapping_changed();

-- statement-level: drain once per statement (a 10-line invoice insert = one rebuild)
do $$
declare t text;
begin
  foreach t in array array['cost_purchase_lines','cost_purchase_invoices','cost_items','cost_component_versions',
                           'cost_dish_line_links','cost_dish_packaging','cost_ingredient_default_links',
                           'dish_ingredients','dish_variant_ingredient_amounts'] loop
    execute format('create or replace trigger %I after insert or update or delete on public.%I
                    for each statement execute function public.trg_cost_process_queue()',
                   'cost_zq_' || t, t);
  end loop;
end $$;

-- A published version's lines are written right after the version row; the
-- version trigger has already rebuilt by then. Re-enqueue on line writes too.
create or replace function public.trg_cost_version_line_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  select component_id, effective_from, status into v from cost_component_versions
   where id = coalesce(NEW.version_id, OLD.version_id);
  if v.status = 'published' then
    perform public.cost_enqueue('component', v.component_id::text, v.effective_from, 'version_lines');
  end if;
  return null;
end $$;
create or replace trigger cost_cvl_changed after insert or update or delete on public.cost_component_version_lines
  for each row execute function public.trg_cost_version_line_changed();
create or replace trigger cost_zq_cost_component_version_lines after insert or update or delete on public.cost_component_version_lines
  for each statement execute function public.trg_cost_process_queue();

-- ── reads ───────────────────────────────────────────────────────────────────
create or replace function public.cost_at(p_type text, p_id text, p_date date default null)
returns public.cost_history language sql stable security definer set search_path = public as $$
  select * from cost_history
  where entity_type = p_type and entity_id = p_id and superseded_at is null
    and effective_from <= coalesce(p_date, (now() at time zone 'Europe/Athens')::date)
  order by effective_from desc limit 1
$$;

-- Full rebuild (seed, recovery). Admin-only.
create or replace function public.cost_rebuild_all(p_from date default date '1900-01-01')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n_i int := 0; n_c int := 0; n_v int := 0;
begin
  if not (public.is_admin() or current_user in ('postgres','service_role') or auth.role() = 'service_role') then
    raise exception 'admin only';
  end if;
  update cost_rebuild_queue set processed_at = now() where processed_at is null;
  for r in select id from cost_items loop
    n_i := n_i + public.cost_rebuild_entity('item', r.id::text, p_from, 'rebuild_all'); end loop;
  for r in select id from cost_components loop
    n_c := n_c + public.cost_rebuild_entity('component', r.id::text, p_from, 'rebuild_all'); end loop;
  for r in select id from dish_variants loop
    n_v := n_v + public.cost_rebuild_entity('variant', r.id, p_from, 'rebuild_all'); end loop;
  return jsonb_build_object('item_rows', n_i, 'component_rows', n_c, 'variant_rows', n_v);
end $$;

-- ── RLS / grants ────────────────────────────────────────────────────────────
alter table public.cost_history enable row level security;
alter table public.cost_rebuild_queue enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename='cost_history' and policyname='admin_read_cost_history') then
    create policy admin_read_cost_history on public.cost_history for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename='cost_rebuild_queue' and policyname='admin_read_cost_rebuild_queue') then
    create policy admin_read_cost_rebuild_queue on public.cost_rebuild_queue for select to authenticated using (public.is_admin());
  end if;
end $$;
grant select on public.cost_history, public.cost_rebuild_queue to authenticated;
grant all on public.cost_history, public.cost_rebuild_queue to service_role;

-- compute functions are SECURITY DEFINER (they read across admin tables from
-- triggers); expose them to authenticated only and gate on is_admin() where
-- they are called directly from the UI.
-- Every cost_* / trg_cost_* function is internal: SECURITY DEFINER bypasses
-- RLS, so nobody but the service role (and the definer, via triggers) may call
-- them. The UI goes through the is_admin()-gated RPCs in wec862_costing_api.sql.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'cost\_%' or p.proname like 'trg\_cost\_%')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
