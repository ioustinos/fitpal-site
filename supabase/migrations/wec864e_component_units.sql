-- ============================================================================
-- WEC-864 (components & recipes) — components get a unit, like cost items.
-- 🟢 Ioustinos (10/11): «the components should not always be per gram … some
-- might be per piece (pita bread = 1)» … «as per the ingredients».
--
-- cost_components.base_unit  g | ml | pcs   (default g — every existing row stays per gram)
-- cost_components.grams_per_unit           grams of one piece (pcs only, optional)
--
-- Meaning of the engine's 'cost_per_g' key is now «cost per base unit» of the
-- component (€/g, €/ml or €/piece). The key name is kept so the ledger and the
-- nightly check stay compatible.
--  * recipe line pointing to a per-piece child: qty is in pieces.
--  * yield 'pct' on a per-piece component: output pieces = Σ piece lines × pct.
--    'output_weight' on a per-piece component = number of pieces the batch makes.
--  * dish line (catalogue always gives grams) linked to a per-piece component:
--    pieces = grams ÷ grams_per_unit. Without grams_per_unit the line costs €0
--    and is flagged 'no_piece_weight' (counted as unpriced).
-- Applied to DEV 2026-11-10.
-- ============================================================================
alter table public.cost_components
  add column if not exists base_unit text not null default 'g',
  add column if not exists grams_per_unit numeric;

do $$ begin
  alter table public.cost_components add constraint cost_components_base_unit_ck
    check (base_unit in ('g', 'ml', 'pcs'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cost_components add constraint cost_components_gpu_ck
    check (grams_per_unit is null or grams_per_unit > 0);
exception when duplicate_object then null; end $$;

-- unit change → recost the component and everything above it
create or replace function public.trg_cost_component_unit_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  if NEW.base_unit is distinct from OLD.base_unit or NEW.grams_per_unit is distinct from OLD.grams_per_unit then
    perform public.cost_enqueue('component', NEW.id::text, date '1900-01-01', 'component_unit:' || NEW.id);
  end if;
  return null;
end $$;
drop trigger if exists cost_components_unit_changed on public.cost_components;
create trigger cost_components_unit_changed after update of base_unit, grams_per_unit on public.cost_components
  for each row execute function public.trg_cost_component_unit_changed();
drop trigger if exists cost_zq_cost_components_upd on public.cost_components;
create trigger cost_zq_cost_components_upd after update on public.cost_components
  for each statement execute function public.trg_cost_process_queue();

-- ── component cost (per base unit) ───────────────────────────────────────────
create or replace function public.cost_component_cost_at(p_component uuid, p_date date, p_depth integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v record; ln record; c jsonb;
  v_total numeric := 0; v_raw_g numeric := 0; v_raw_pcs numeric := 0; v_out_g numeric;
  v_lines jsonb := '[]'::jsonb; v_est boolean := false; v_unp int := 0; v_now boolean := false;
  v_line_cost numeric; v_unit numeric;
begin
  if p_depth > 12 then
    return jsonb_build_object('cost_per_g', 0, 'flags', jsonb_build_object('cycle', true), 'lines', '[]'::jsonb);
  end if;
  select cv.*, cc.name as component_name, cc.base_unit as comp_unit, cc.grams_per_unit as comp_gpu into v
  from cost_component_versions cv join cost_components cc on cc.id = cv.component_id
  where cv.id = public.cost_component_version_at(p_component, p_date);
  if not found then
    return jsonb_build_object('cost_per_g', 0, 'flags', jsonb_build_object('no_version', true), 'lines', '[]'::jsonb,
      'unit', (select base_unit from cost_components where id = p_component),
      'grams_per_unit', (select grams_per_unit from cost_components where id = p_component));
  end if;
  if v.yield_mode = 'fixed' then
    return jsonb_build_object(
      'cost_per_g', v.fixed_cost_per_g, 'unit', v.comp_unit, 'grams_per_unit', v.comp_gpu,
      'version_id', v.id, 'version_no', v.version_no,
      'effective_from', v.effective_from, 'yield_mode', 'fixed',
      'flags', jsonb_build_object('estimated', true), 'lines', '[]'::jsonb);
  end if;
  for ln in
    select l.*, i.name as item_name, i.base_unit, i.grams_per_unit,
           cc.name as child_name, cc.base_unit as child_unit, cc.grams_per_unit as child_gpu
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
      if ln.base_unit = 'pcs' then v_raw_pcs := v_raw_pcs + ln.qty; end if;
      if ln.base_unit = 'g' then v_raw_g := v_raw_g + ln.qty;
      elsif ln.grams_per_unit is not null then v_raw_g := v_raw_g + ln.qty * ln.grams_per_unit;
      elsif ln.base_unit = 'ml' then v_raw_g := v_raw_g + ln.qty;
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
      if ln.child_unit = 'pcs' then
        v_raw_pcs := v_raw_pcs + ln.qty;
        if ln.child_gpu is not null then v_raw_g := v_raw_g + ln.qty * ln.child_gpu; else v_now := true; end if;
      else
        v_raw_g := v_raw_g + ln.qty;
      end if;
      v_lines := v_lines || jsonb_build_object(
        'kind', 'component', 'id', ln.child_component_id, 'name', ln.child_name, 'qty', ln.qty,
        'unit', coalesce(ln.child_unit, 'g'), 'unit_cost', v_unit, 'line_cost', v_line_cost, 'flags', c->'flags');
    end if;
    v_total := v_total + v_line_cost;
  end loop;
  v_out_g := case
    when v.yield_mode = 'pct' and v.comp_unit = 'pcs' then v_raw_pcs * v.yield_pct / 100
    when v.yield_mode = 'pct' then v_raw_g * v.yield_pct / 100
    else v.output_weight_g end;
  return jsonb_build_object(
    'cost_per_g', case when coalesce(v_out_g, 0) > 0 then v_total / v_out_g else 0 end,
    'unit', v.comp_unit, 'grams_per_unit', v.comp_gpu,
    'total_cost', v_total, 'raw_weight_g', v_raw_g, 'raw_pieces', v_raw_pcs, 'output_g', v_out_g,
    'version_id', v.id, 'version_no', v.version_no, 'effective_from', v.effective_from,
    'yield_mode', v.yield_mode, 'yield_pct', v.yield_pct, 'output_weight_g', v.output_weight_g,
    'flags', jsonb_strip_nulls(jsonb_build_object(
        'estimated', case when v_est then true end,
        'unpriced',  case when v_unp > 0 then v_unp end,
        'no_weight', case when v_now and v.yield_mode = 'pct' and v.comp_unit <> 'pcs' then true end,
        'zero_output', case when coalesce(v_out_g,0) <= 0 then true end)),
    'lines', v_lines);
end $$;

-- ── dish variant cost: grams on the plate → qty in the component's unit ──────
create or replace function public.cost_variant_cost_at(p_variant text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_dish text; v_price int;
  ln record; c jsonb; pk record;
  v_food numeric := 0; v_pack numeric := 0;
  v_lines jsonb := '[]'::jsonb; v_packs jsonb := '[]'::jsonb;
  v_unlinked int := 0; v_unp int := 0; v_est boolean := false;
  v_cost numeric; v_cpg numeric; v_qty numeric; v_flags jsonb;
begin
  select dish_id, price into v_dish, v_price from dish_variants where id = p_variant;
  if v_dish is null then return null; end if;
  for ln in
    select g.ingredient_id, g.grams, ing.name_el, lc.component_id, lc.link_source, cc.name as component_name,
           cc.base_unit as comp_unit, cc.grams_per_unit as comp_gpu
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
    v_flags := coalesce(c->'flags', '{}'::jsonb);
    if ln.comp_unit = 'pcs' then
      v_qty := case when ln.comp_gpu > 0 then ln.grams / ln.comp_gpu end;
      if v_qty is null then v_flags := v_flags || jsonb_build_object('no_piece_weight', true); end if;
    else
      v_qty := ln.grams;
    end if;
    v_cost := coalesce(v_qty, 0) * v_cpg;
    v_food := v_food + v_cost;
    if coalesce((v_flags->>'estimated')::boolean, false) then v_est := true; end if;
    v_unp := v_unp + coalesce((v_flags->>'unpriced')::int, 0)
                   + case when coalesce((v_flags->>'no_version')::boolean, false) then 1 else 0 end
                   + case when coalesce((v_flags->>'no_piece_weight')::boolean, false) then 1 else 0 end;
    v_lines := v_lines || jsonb_build_object('ingredient_id', ln.ingredient_id, 'ingredient', ln.name_el,
                 'grams', ln.grams, 'qty', v_qty, 'unit', coalesce(ln.comp_unit, 'g'),
                 'component_id', ln.component_id, 'component', ln.component_name,
                 'link_source', ln.link_source, 'cost_per_g', v_cpg, 'line_cost', v_cost, 'flags', v_flags);
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

-- ── recipe tree: p_grams is now «qty in the component's unit» ───────────────
create or replace function public.cost_explode(p_component uuid, p_grams numeric, p_date date, p_depth integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb; ln jsonb; kids jsonb := '[]'::jsonb; v_scale numeric; v_out numeric; v_name text; v_cpg numeric; v_u text;
begin
  select name, base_unit into v_name, v_u from cost_components where id = p_component;
  if p_depth > 12 then
    return jsonb_build_object('kind', 'component', 'id', p_component, 'name', v_name, 'grams', p_grams,
                              'qty', p_grams, 'unit', v_u,
                              'cost', 0, 'leaf', true, 'flags', jsonb_build_object('cycle', true), 'children', '[]'::jsonb);
  end if;
  c := public.cost_component_cost_at(p_component, p_date);
  v_cpg := coalesce((c->>'cost_per_g')::numeric, 0);
  v_out := (c->>'output_g')::numeric;
  v_scale := case when coalesce(v_out, 0) > 0 then p_grams / v_out end;
  if v_scale is not null and coalesce(c->>'yield_mode', '') <> 'fixed' then
    for ln in select * from jsonb_array_elements(coalesce(c->'lines', '[]'::jsonb)) loop
      if ln->>'kind' = 'item' then
        kids := kids || jsonb_build_object(
          'kind', 'item', 'id', ln->>'id', 'name', ln->>'name', 'unit', ln->>'unit',
          'qty', (ln->>'qty')::numeric * v_scale,
          'unit_cost', (ln->>'unit_cost')::numeric, 'source', ln->>'source', 'price_date', ln->>'price_date',
          'cost', (ln->>'line_cost')::numeric * v_scale);
      else
        kids := kids || public.cost_explode((ln->>'id')::uuid, (ln->>'qty')::numeric * v_scale, p_date, p_depth + 1);
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'kind', 'component', 'id', p_component, 'name', v_name, 'grams', p_grams, 'qty', p_grams, 'unit', v_u,
    'cost_per_g', v_cpg, 'cost', p_grams * v_cpg,
    'yield_mode', c->>'yield_mode', 'yield_pct', c->'yield_pct', 'output_weight_g', c->'output_weight_g',
    'raw_weight_g', c->'raw_weight_g', 'output_g', c->'output_g',
    'version_no', c->'version_no', 'effective_from', c->'effective_from',
    'leaf', jsonb_array_length(kids) = 0,
    'flags', coalesce(c->'flags', '{}'::jsonb),
    'children', kids);
end $$;

create or replace function public.admin_cost_variant_tree(p_variant text, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, public.cost_today());
  b jsonb; ln jsonb; lines jsonb := '[]'::jsonb; v_tree jsonb;
begin
  perform public.cost_assert_admin();
  b := public.cost_variant_cost_at(p_variant, v_date);
  if b is null then return null; end if;
  for ln in select * from jsonb_array_elements(coalesce(b->'lines', '[]'::jsonb)) loop
    v_tree := case when ln->>'component_id' is not null
                   then public.cost_explode((ln->>'component_id')::uuid,
                                            coalesce((ln->>'qty')::numeric, 0), v_date) end;
    lines := lines || jsonb_build_object(
      'ingredient_id', ln->'ingredient_id', 'ingredient', ln->'ingredient', 'grams', ln->'grams',
      'qty', ln->'qty', 'unit', ln->'unit',
      'link_source', ln->'link_source', 'unlinked', coalesce((ln->>'unlinked')::boolean, false),
      'line_cost', ln->'line_cost', 'flags', ln->'flags', 'tree', v_tree);
  end loop;
  return jsonb_build_object(
    'variant_id', p_variant, 'date', v_date,
    'food_cost', b->'food_cost', 'packaging_cost', b->'packaging_cost', 'product_cost', b->'product_cost',
    'lines', lines,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'qty', qty, 'cost', cost,
                                          'unit_cost', unit_cost, 'source', source, 'price_date', price_date)
                       order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, min(x->>'unit') unit,
               sum((x->>'qty')::numeric) qty, sum((x->>'cost')::numeric) cost,
               max((x->>'unit_cost')::numeric) unit_cost, min(x->>'source') source, max(x->>'price_date') price_date
        from jsonb_path_query(lines, 'strict $[*].tree.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'item'
        group by x->>'id'
      ) s), '[]'::jsonb),
    'leaf_components', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grams', grams, 'unit', unit, 'cost', cost,
                                          'yield_mode', yield_mode, 'flags', flags) order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, sum((x->>'qty')::numeric) grams, min(x->>'unit') unit,
               sum((x->>'cost')::numeric) cost, min(x->>'yield_mode') yield_mode, (array_agg(x->'flags'))[1] flags
        from jsonb_path_query(lines, 'strict $[*].tree.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'component' and (x->>'leaf')::boolean
        group by x->>'id'
      ) s), '[]'::jsonb));
end $$;

-- ── save RPC: base_unit / grams_per_unit ─────────────────────────────────────
create or replace function public.admin_cost_component_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid := nullif(p->>'component_id', '')::uuid;
  v_draft uuid := nullif(p->>'draft_id', '')::uuid;
  v_ver uuid; v_no int; ln jsonb; v_child uuid; v_i int := 0;
  v_method text := nullif(p->>'cooking_method', '');
  v_other text := nullif(btrim(p->>'cooking_method_other'), '');
  v_bu text := coalesce(nullif(p->>'base_unit', ''), 'g');
  v_gpu numeric := nullif(p->>'grams_per_unit', '')::numeric;
begin
  perform public.cost_assert_admin();
  if v_method = 'other' and v_other is null then
    raise exception 'Γράψτε τον τρόπο μαγειρέματος («Άλλο»)';
  end if;
  if v_method is distinct from 'other' then v_other := null; end if;
  if v_bu not in ('g', 'ml', 'pcs') then raise exception 'Μη έγκυρη μονάδα «%»', v_bu; end if;
  if v_bu <> 'pcs' then v_gpu := null; end if;
  if v_gpu is not null and v_gpu <= 0 then raise exception 'Τα γραμμάρια ανά τεμάχιο πρέπει να είναι > 0'; end if;
  if v_comp is null then
    if coalesce(btrim(p->>'name'), '') = '' then raise exception 'Το όνομα είναι υποχρεωτικό'; end if;
    insert into cost_components (name, category, notes, cooking_method, cooking_method_other, base_unit, grams_per_unit)
    values (btrim(p->>'name'), nullif(btrim(p->>'category'), ''), nullif(p->>'notes', ''), v_method, v_other, v_bu, v_gpu)
    returning id into v_comp;
  elsif p ? 'name' then
    update cost_components set name = coalesce(nullif(btrim(p->>'name'), ''), name),
      category = nullif(btrim(p->>'category'), ''), notes = nullif(p->>'notes', ''),
      cooking_method = case when p ? 'cooking_method' then v_method else cooking_method end,
      cooking_method_other = case when p ? 'cooking_method' then v_other else cooking_method_other end,
      base_unit = case when p ? 'base_unit' then v_bu else base_unit end,
      grams_per_unit = case when p ? 'base_unit' then v_gpu else grams_per_unit end
    where id = v_comp;
  end if;

  -- loop guard: no child may (directly or indirectly) contain this component
  for ln in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_child := nullif(ln->>'child_component_id', '')::uuid;
    if v_child is not null and (v_child = v_comp
        or exists (select 1 from public.cost_component_closure(v_child) x where x.component_id = v_comp)) then
      raise exception 'Κύκλος: το «%» περιέχει ήδη (άμεσα ή έμμεσα) αυτό το συστατικό',
        (select name from cost_components where id = v_child);
    end if;
  end loop;

  if v_draft is not null then
    if not exists (select 1 from cost_component_versions where id = v_draft and component_id = v_comp and status = 'draft') then
      raise exception 'Η πρόχειρη έκδοση δεν βρέθηκε ή έχει ήδη δημοσιευτεί';
    end if;
    v_ver := v_draft;
    update cost_component_versions set
      effective_from = coalesce((p->>'effective_from')::date, public.cost_today()),
      yield_mode = p->>'yield_mode', yield_pct = (p->>'yield_pct')::numeric,
      output_weight_g = (p->>'output_weight_g')::numeric, fixed_cost_per_g = (p->>'fixed_cost_per_g')::numeric,
      notes = nullif(p->>'version_notes', '')
    where id = v_ver;
    if exists (select 1 from cost_component_version_lines where version_id = v_ver) then
      raise exception 'Η πρόχειρη έκδοση έχει ακόμα γραμμές — ανανεώστε τη σελίδα';
    end if;
  else
    select coalesce(max(version_no), 0) + 1 into v_no from cost_component_versions where component_id = v_comp;
    insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, yield_pct,
                                         output_weight_g, fixed_cost_per_g, notes)
    values (v_comp, v_no, coalesce((p->>'effective_from')::date, public.cost_today()), p->>'yield_mode',
            (p->>'yield_pct')::numeric, (p->>'output_weight_g')::numeric, (p->>'fixed_cost_per_g')::numeric,
            nullif(p->>'version_notes', ''))
    returning id into v_ver;
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into cost_component_version_lines (version_id, cost_item_id, child_component_id, qty, sort_order, note)
    values (v_ver, nullif(ln->>'cost_item_id', '')::uuid, nullif(ln->>'child_component_id', '')::uuid,
            (ln->>'qty')::numeric, v_i, nullif(ln->>'note', ''));
  end loop;

  if coalesce((p->>'publish')::boolean, false) then
    update cost_component_versions set status = 'published', published_at = now() where id = v_ver;
  end if;
  return jsonb_build_object('component_id', v_comp, 'version_id', v_ver);
end $$;

-- ── list: unit ───────────────────────────────────────────────────────────────
create or replace function public.admin_cost_components_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.cost_today();
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'category', c.category, 'active', c.active, 'source_ref', c.source_ref,
      'cooking_method', c.cooking_method, 'cooking_method_other', c.cooking_method_other,
      'base_unit', c.base_unit, 'grams_per_unit', c.grams_per_unit,
      'type', case when h.breakdown->>'yield_mode' <> 'fixed'
                    and jsonb_array_length(coalesce(h.breakdown->'lines', '[]'::jsonb)) = 1
                    and h.breakdown->'lines'->0->>'kind' = 'item' then 'single' else 'multi' end,
      'lines', jsonb_array_length(coalesce(h.breakdown->'lines', '[]'::jsonb)),
      'cost_per_g', h.unit_cost, 'flags', h.flags,
      'cost_per_g_30d', (public.cost_at('component', c.id::text, v_today - 30)).unit_cost,
      'yield_mode', h.breakdown->>'yield_mode', 'yield_pct', h.breakdown->'yield_pct',
      'output_weight_g', h.breakdown->'output_weight_g', 'version_no', h.breakdown->'version_no',
      'versions', (select count(*) from cost_component_versions v where v.component_id = c.id),
      'drafts', (select count(*) from cost_component_versions v where v.component_id = c.id and v.status = 'draft'),
      'used_in_dishes', (select count(distinct dish_id) from cost_dish_line_links k where k.component_id = c.id),
      'used_in_components', (select count(distinct v.component_id) from cost_component_version_lines l
                             join cost_component_versions v on v.id = l.version_id where l.child_component_id = c.id)
    ) order by c.name)
    from cost_components c
    left join lateral (select * from public.cost_at('component', c.id::text, v_today)) h on true), '[]'::jsonb);
end $$;
