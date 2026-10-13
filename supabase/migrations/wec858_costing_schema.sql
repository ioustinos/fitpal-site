-- ============================================================================
-- WEC-858 — Costing 1: schema + admin RLS (epic WEC-857)
--
-- Applied to the DEV branch (jrxxsixhxgawucorfyjt) on 2026-10-11 overnight.
-- NOT yet applied to production rhwetztxwjxfstffalwl — needs Ioustinos's OK
-- (CLAUDE.md: every DB change goes dev first, test, then prod).
--
-- ADDITIVE ONLY: new tables, new functions, new triggers. No DROP. The only
-- touch on existing tables is two AFTER triggers (dish_ingredients,
-- dish_variant_ingredient_amounts) that WRITE A HISTORY ROW and never change
-- or block the original write.
--
-- Model (🟢 = Ioustinos decided in chat «FITPAL - Ingredients Management»):
--   🟢 two catalogues — `ingredients` stays the customer-facing display layer
--      and is untouched; costing lives in cost_* tables.
--   🟢 all costing quantities are raw / as purchased; a component's output
--      used one level up counts as a raw input of that level.
--   🟢 component versions with an admin-set effective date; published
--      versions are immutable.
--   🟢 purchases = invoice with many lines; net price stored, VAT rate copied
--      onto each line (gross derived); per-line «exclude from costing».
--   🟢 optional manual standard cost on a cost item (= «estimated»).
--   🟢 packaging is a cost item (kind='packaging'), set PER DISH.
--   🟢 dish gram changes are logged automatically.
--
-- Money: costing uses NUMERIC EUROS (not cents like the order tables) because
-- per-gram costs need sub-cent precision (e.g. €0.00085 per g of onion).
-- ============================================================================

-- ── suppliers ───────────────────────────────────────────────────────────────
create table if not exists public.cost_suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  vat_number  text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists cost_suppliers_name_uq on public.cost_suppliers (lower(name));

-- ── cost items: what we buy (food + packaging) ─────────────────────────────
create table if not exists public.cost_items (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  kind                        text not null default 'food' check (kind in ('food','packaging')),
  category                    text,
  -- unit every quantity and unit cost of this item is expressed in
  base_unit                   text not null default 'g' check (base_unit in ('g','ml','pcs')),
  -- grams per base unit, used only to turn line quantities into raw WEIGHT for
  -- a component whose yield is a % (1 for g, ~1 for ml, e.g. 55 for one egg).
  grams_per_unit              numeric(12,4),
  default_pack_label          text,              -- «κιλό», «κιβώτιο 50τμχ»
  default_base_qty_per_pack   numeric(14,4) not null default 1000 check (default_base_qty_per_pack > 0),
  default_vat_rate            numeric(5,4) not null default 0.13 check (default_vat_rate >= 0 and default_vat_rate < 1),
  -- € per base unit, NET. Used only when no purchase exists on/before the date.
  standard_cost_per_unit      numeric(14,6) check (standard_cost_per_unit is null or standard_cost_per_unit >= 0),
  active                      boolean not null default true,
  notes                       text,
  source_ref                  text,             -- seed provenance, e.g. 'excel:SrcCosts:12'
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists cost_items_kind_idx on public.cost_items (kind, active);
create unique index if not exists cost_items_source_ref_uq on public.cost_items (source_ref) where source_ref is not null;

-- ── purchase invoices + lines ──────────────────────────────────────────────
create table if not exists public.cost_purchase_invoices (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid references public.cost_suppliers(id) on delete restrict,
  invoice_date     date not null,
  invoice_number   text,
  attachment_path  text,                         -- storage path in bucket cost-invoices
  notes            text,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists cost_purchase_invoices_date_idx on public.cost_purchase_invoices (invoice_date desc);
create index if not exists cost_purchase_invoices_supplier_idx on public.cost_purchase_invoices (supplier_id);

create table if not exists public.cost_purchase_lines (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.cost_purchase_invoices(id) on delete cascade,
  cost_item_id          uuid not null references public.cost_items(id) on delete restrict,
  qty_packs             numeric(14,4) not null check (qty_packs > 0),
  pack_label            text,
  base_qty_per_pack     numeric(14,4) not null check (base_qty_per_pack > 0),
  net_price_per_pack    numeric(14,4) not null check (net_price_per_pack >= 0),
  vat_rate              numeric(5,4) not null default 0.13 check (vat_rate >= 0 and vat_rate < 1),
  exclude_from_costing  boolean not null default false,
  -- € per base unit, net. THE number costing reads.
  unit_cost             numeric(16,8) generated always as (net_price_per_pack / base_qty_per_pack) stored,
  line_net              numeric(14,4) generated always as (qty_packs * net_price_per_pack) stored,
  sort_order            int not null default 0,
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists cost_purchase_lines_item_idx on public.cost_purchase_lines (cost_item_id);
create index if not exists cost_purchase_lines_invoice_idx on public.cost_purchase_lines (invoice_id);

-- ── components (anything on a plate, costed per COOKED gram) ───────────────
create table if not exists public.cost_components (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,
  active      boolean not null default true,
  notes       text,
  source_ref  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists cost_components_source_ref_uq on public.cost_components (source_ref) where source_ref is not null;

create table if not exists public.cost_component_versions (
  id                uuid primary key default gen_random_uuid(),
  component_id      uuid not null references public.cost_components(id) on delete cascade,
  version_no        int not null,
  effective_from    date not null default ((now() at time zone 'Europe/Athens')::date),
  -- 'pct'           : cooked grams = raw weight of the lines × yield_pct / 100
  -- 'output_weight' : cooked grams of the batch entered directly
  -- 'fixed'         : no lines; fixed_cost_per_g is used (Excel-seeded composites, «estimated»)
  yield_mode        text not null default 'pct' check (yield_mode in ('pct','output_weight','fixed')),
  yield_pct         numeric(8,3) check (yield_pct is null or yield_pct > 0),
  output_weight_g   numeric(14,3) check (output_weight_g is null or output_weight_g > 0),
  fixed_cost_per_g  numeric(16,8) check (fixed_cost_per_g is null or fixed_cost_per_g >= 0),
  status            text not null default 'draft' check (status in ('draft','published')),
  notes             text,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  published_at      timestamptz,
  constraint cost_component_versions_no_uq unique (component_id, version_no),
  constraint cost_component_versions_yield_ck check (
       (yield_mode = 'pct'           and yield_pct is not null)
    or (yield_mode = 'output_weight' and output_weight_g is not null)
    or (yield_mode = 'fixed'         and fixed_cost_per_g is not null)
  )
);
create index if not exists cost_component_versions_eff_idx
  on public.cost_component_versions (component_id, effective_from desc) where status = 'published';

create table if not exists public.cost_component_version_lines (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references public.cost_component_versions(id) on delete cascade,
  cost_item_id        uuid references public.cost_items(id) on delete restrict,
  child_component_id  uuid references public.cost_components(id) on delete restrict,
  -- in the cost item's base unit; grams (cooked) for a child component
  qty                 numeric(14,4) not null check (qty > 0),
  sort_order          int not null default 0,
  note                text,
  constraint cost_cvl_one_ref_ck check ((cost_item_id is null) <> (child_component_id is null))
);
create index if not exists cost_cvl_version_idx on public.cost_component_version_lines (version_id);
create index if not exists cost_cvl_item_idx on public.cost_component_version_lines (cost_item_id) where cost_item_id is not null;
create index if not exists cost_cvl_child_idx on public.cost_component_version_lines (child_component_id) where child_component_id is not null;

-- ── links from the display layer to components ─────────────────────────────
-- default per display ingredient (used to pre-fill new dish lines)
create table if not exists public.cost_ingredient_default_links (
  ingredient_id  uuid primary key references public.ingredients(id) on delete cascade,
  component_id   uuid not null references public.cost_components(id) on delete cascade,
  updated_at     timestamptz not null default now()
);

-- per dish line (= dish_id + ingredient_id, mirrors dish_ingredients' key)
create table if not exists public.cost_dish_line_links (
  dish_id        text not null references public.dishes(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id) on delete cascade,
  component_id   uuid not null references public.cost_components(id) on delete cascade,
  source         text not null default 'manual' check (source in ('auto_excel','default','manual')),
  confirmed      boolean not null default false,
  match_note     text,
  updated_at     timestamptz not null default now(),
  primary key (dish_id, ingredient_id)
);
create index if not exists cost_dish_line_links_component_idx on public.cost_dish_line_links (component_id);

-- ── packaging per dish ─────────────────────────────────────────────────────
create table if not exists public.cost_dish_packaging (
  dish_id          text not null references public.dishes(id) on delete cascade,
  cost_item_id     uuid not null references public.cost_items(id) on delete restrict,
  qty_per_portion  numeric(10,3) not null default 1 check (qty_per_portion > 0),
  updated_at       timestamptz not null default now(),
  primary key (dish_id, cost_item_id)
);
create index if not exists cost_dish_packaging_item_idx on public.cost_dish_packaging (cost_item_id);

-- ── dish gram history (resolved plated grams per variant + ingredient) ─────
create table if not exists public.cost_dish_gram_history (
  id              bigserial primary key,
  dish_id         text not null,
  variant_id      text not null,
  ingredient_id   uuid not null,
  grams           numeric(10,2) not null,       -- 0 = line removed / descriptive only
  effective_from  date not null,
  recorded_at     timestamptz not null default now(),
  changed_by      uuid default auth.uid()
);
create index if not exists cost_dgh_lookup_idx
  on public.cost_dish_gram_history (variant_id, ingredient_id, effective_from desc, id desc);
create index if not exists cost_dgh_dish_idx on public.cost_dish_gram_history (dish_id);

-- Current resolved grams of one variant (same rule the customer dish modal uses:
-- is_variant → per-variant amount, else fixed_grams).
create or replace function public.cost_variant_current_grams(p_variant_id text)
returns table (dish_id text, ingredient_id uuid, grams numeric)
language sql stable security definer set search_path = public as $$
  select v.dish_id, di.ingredient_id,
         coalesce(case when di.is_variant then a.grams else di.fixed_grams end, 0)::numeric
  from dish_variants v
  join dish_ingredients di on di.dish_id = v.dish_id
  left join dish_variant_ingredient_amounts a on a.variant_id = v.id and a.ingredient_id = di.ingredient_id
  where v.id = p_variant_id
$$;

-- Write a history row for each (variant, ingredient) of the dish whose resolved
-- grams differ from the latest recorded value. Never raises.
create or replace function public.cost_snapshot_dish_grams(p_dish_id text, p_effective date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_eff date := coalesce(p_effective, (now() at time zone 'Europe/Athens')::date);
  v_n int := 0;
begin
  with cur as (
    select v.id as variant_id, g.ingredient_id, g.grams
    from dish_variants v, lateral public.cost_variant_current_grams(v.id) g
    where v.dish_id = p_dish_id
  ),
  prev as (
    select distinct on (h.variant_id, h.ingredient_id) h.variant_id, h.ingredient_id, h.grams
    from cost_dish_gram_history h
    where h.dish_id = p_dish_id
    order by h.variant_id, h.ingredient_id, h.effective_from desc, h.id desc
  ),
  diff as (
    -- changed or new lines
    select c.variant_id, c.ingredient_id, c.grams from cur c
    left join prev p using (variant_id, ingredient_id)
    where p.grams is distinct from c.grams
    union all
    -- removed lines → 0
    select p.variant_id, p.ingredient_id, 0 from prev p
    left join cur c using (variant_id, ingredient_id)
    where c.variant_id is null and p.grams <> 0
  ),
  ins as (
    insert into cost_dish_gram_history (dish_id, variant_id, ingredient_id, grams, effective_from)
    select p_dish_id, variant_id, ingredient_id, grams, v_eff from diff
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

create or replace function public.trg_cost_dish_grams_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dish text;
begin
  if TG_TABLE_NAME = 'dish_ingredients' then
    v_dish := coalesce(NEW.dish_id, OLD.dish_id);
  else
    select dish_id into v_dish from dish_variants where id = coalesce(NEW.variant_id, OLD.variant_id);
  end if;
  if v_dish is not null and coalesce(current_setting('costing.skip_triggers', true), '') <> 'on' then
    begin
      perform public.cost_snapshot_dish_grams(v_dish);
      perform public.cost_enqueue_dish(v_dish, (now() at time zone 'Europe/Athens')::date);
    exception when others then
      -- costing must NEVER break the dish editor
      raise warning 'costing gram snapshot failed for dish %: %', v_dish, sqlerrm;
    end;
  end if;
  return null;
end $$;

-- placeholder so the trigger function compiles before the engine migration;
-- replaced by WEC-859 (wec859_costing_engine.sql).
create or replace function public.cost_enqueue_dish(p_dish_id text, p_from date)
returns void language sql as $$ select null::void $$;

create or replace trigger cost_dish_ingredients_grams
  after insert or update or delete on public.dish_ingredients
  for each row execute function public.trg_cost_dish_grams_changed();
create or replace trigger cost_dvia_grams
  after insert or update or delete on public.dish_variant_ingredient_amounts
  for each row execute function public.trg_cost_dish_grams_changed();

-- Backfill: today's grams, dated 1900-01-01 = «in force since before we
-- started recording». Without it every past dish cost would be €0.
do $$
declare d record;
begin
  if not exists (select 1 from public.cost_dish_gram_history) then
    for d in select id from public.dishes loop
      perform public.cost_snapshot_dish_grams(d.id, date '1900-01-01');
    end loop;
  end if;
end $$;

-- ── published versions are immutable ───────────────────────────────────────
create or replace function public.trg_cost_version_guard()
returns trigger language plpgsql as $$
begin
  if OLD.status = 'published' then
    if TG_OP = 'DELETE' then
      raise exception 'Published component versions cannot be deleted — create a new version instead';
    end if;
    if NEW.status <> 'published'
       or NEW.effective_from is distinct from OLD.effective_from
       or NEW.yield_mode is distinct from OLD.yield_mode
       or NEW.yield_pct is distinct from OLD.yield_pct
       or NEW.output_weight_g is distinct from OLD.output_weight_g
       or NEW.fixed_cost_per_g is distinct from OLD.fixed_cost_per_g then
      raise exception 'Published component versions are read-only — create a new version instead';
    end if;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  if NEW.status = 'published' and NEW.published_at is null then NEW.published_at := now(); end if;
  return NEW;
end $$;
create or replace trigger cost_component_versions_guard
  before update or delete on public.cost_component_versions
  for each row execute function public.trg_cost_version_guard();

create or replace function public.trg_cost_version_lines_guard()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.cost_component_versions
   where id = coalesce(NEW.version_id, OLD.version_id);
  if v_status = 'published' and current_setting('costing.allow_published_line_write', true) is distinct from 'on' then
    raise exception 'Lines of a published version are read-only — create a new version instead';
  end if;
  return coalesce(NEW, OLD);
end $$;
create or replace trigger cost_component_version_lines_guard
  before insert or update or delete on public.cost_component_version_lines
  for each row execute function public.trg_cost_version_lines_guard();

-- updated_at
create or replace trigger cost_suppliers_touch before update on public.cost_suppliers
  for each row execute function public.update_updated_at();
create or replace trigger cost_items_touch before update on public.cost_items
  for each row execute function public.update_updated_at();
create or replace trigger cost_purchase_invoices_touch before update on public.cost_purchase_invoices
  for each row execute function public.update_updated_at();
create or replace trigger cost_purchase_lines_touch before update on public.cost_purchase_lines
  for each row execute function public.update_updated_at();
create or replace trigger cost_components_touch before update on public.cost_components
  for each row execute function public.update_updated_at();

-- ── RLS: admin only, scoped to authenticated (WEC-725 lesson) ──────────────
do $$
declare t text;
begin
  foreach t in array array[
    'cost_suppliers','cost_items','cost_purchase_invoices','cost_purchase_lines',
    'cost_components','cost_component_versions','cost_component_version_lines',
    'cost_ingredient_default_links','cost_dish_line_links','cost_dish_packaging',
    'cost_dish_gram_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='admin_all_'||t) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        'admin_all_'||t, t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.cost_dish_gram_history_id_seq to authenticated, service_role;

-- ── storage bucket for invoice photos / PDFs (private, admin only) ─────────
insert into storage.buckets (id, name, public)
values ('cost-invoices', 'cost-invoices', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cost_invoices_admin_all') then
    create policy cost_invoices_admin_all on storage.objects for all to authenticated
      using (bucket_id = 'cost-invoices' and public.is_admin())
      with check (bucket_id = 'cost-invoices' and public.is_admin());
  end if;
end $$;
