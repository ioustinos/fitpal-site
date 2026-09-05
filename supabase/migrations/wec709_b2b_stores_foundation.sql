-- ============================================================================
-- WEC-709 (B2B-1: DB foundation — stores + per-store tables)
-- Epic WEC-649 (Company Portals & Reseller Portals — multi-store platform)
-- Applied to rhwetztxwjxfstffalwl on 2026-09-06.
--
-- ADDITIVE ONLY. New tables, new nullable/defaulted columns, new indexes,
-- new RLS policies. No DROP, no ALTER COLUMN TYPE, no NOT NULL on an existing
-- table without a default, no destructive backfill.
-- No application code reads any of this yet — invisible to retail.
--
-- ROLLBACK — run in this order:
--   alter table public.orders       alter column store_id drop default;
--   alter table public.weekly_menus alter column store_id drop default;
--   alter table public.vouchers     alter column store_id drop default;
--   alter table public.orders       drop column if exists store_id;
--   alter table public.weekly_menus drop column if exists store_id;
--   alter table public.vouchers     drop column if exists store_id;
--   alter table public.child_orders drop column if exists company_benefit_amount;
--   drop table if exists public.category_discounts;
--   drop table if exists public.store_members;
--   drop table if exists public.store_settings;
--   drop table if exists public.stores;
-- ============================================================================

-- ---------------------------------------------------------------- stores ---
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  type text not null check (type in ('main','company','reseller')),
  name_el text not null,
  name_en text not null,
  logo_url text,
  accent_color text,
  banner_1_el text, banner_1_en text,
  banner_2_el text, banner_2_en text,
  -- ONE locked delivery address per store (Ioustinos 2026-09-06:
  -- "each company has ONE address where food can be delivered").
  -- Columns, not a child table, so one-ness is enforced by the schema.
  -- Same shape child_orders already uses.
  address_street text,
  address_area text,
  address_zip text,
  address_floor text,
  address_doorbell text,
  address_notes text,
  -- Airtable ops tagging. Retail keeps the existing hardcoded 9999
  -- (netlify/lib/airtable/env.ts RETAIL_STORE_ID); B2B stores get their own.
  -- Nothing reads this column yet — wired up in WEC-719.
  airtable_store_id int,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Store slugs share the URL namespace with app routes (path-based routing,
  -- orders.fitpal.gr/<slug>), so a store called "admin" would shadow the admin
  -- panel. Rollback: alter table public.stores drop constraint stores_slug_safe;
  constraint stores_slug_safe check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'
    and slug not in (
      'admin','account','api','assets','auth','callback','cart','checkout',
      'login','logout','menu','order','orders','pay','payment','profile',
      'signup','static','subscription','wallet'
    )
  )
);

-- Exactly one default store.
create unique index if not exists stores_one_default_idx
  on public.stores (is_default) where is_default;

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.update_updated_at();

-- -------------------------------------------------------- store_settings ---
-- Mirrors the global public.settings shape (key/value jsonb), per store.
create table if not exists public.store_settings (
  store_id uuid not null references public.stores(id) on delete cascade,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, key)
);

drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at
  before update on public.store_settings
  for each row execute function public.update_updated_at();

-- --------------------------------------------------------- store_members ---
-- Reseller allowlist. Companies are open-access; only reseller stores gate.
create table if not exists public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index if not exists store_members_user_idx on public.store_members (user_id);

-- ---------------------------------------------------- category_discounts ---
-- store_id null = the RETAIL site's own category discounts.
create table if not exists public.category_discounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  category_id text not null references public.categories(id) on delete cascade,
  discount_pct numeric(5,2) not null check (discount_pct >= 0 and discount_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, category_id)
);

-- The UNIQUE above does NOT constrain the retail rows: in Postgres two NULL
-- store_id values never collide, so retail could hold two discounts for the
-- same category and one would win at random. This partial index closes it.
create unique index if not exists category_discounts_retail_uniq
  on public.category_discounts (category_id) where store_id is null;

drop trigger if exists category_discounts_set_updated_at on public.category_discounts;
create trigger category_discounts_set_updated_at
  before update on public.category_discounts
  for each row execute function public.update_updated_at();

-- ------------------------------------- new columns on existing tables ------
alter table public.orders       add column if not exists store_id uuid references public.stores(id);
alter table public.weekly_menus add column if not exists store_id uuid references public.stores(id);
alter table public.vouchers     add column if not exists store_id uuid references public.stores(id);

-- Company Benefit lives on the CHILD order because the basis is per delivery
-- day; day cancellation then reverses that day's accrual through the existing
-- cancelChildOrder flow. Cents. Never folded into orders.discount_amount —
-- the company reimburses Fitpal for this and must be invoiceable separately.
alter table public.child_orders
  add column if not exists company_benefit_amount int not null default 0;

create index if not exists orders_store_id_idx       on public.orders (store_id);
create index if not exists weekly_menus_store_id_idx on public.weekly_menus (store_id);
create index if not exists vouchers_store_id_idx     on public.vouchers (store_id);

-- ------------------------------------------------- seed the main store -----
insert into public.stores (slug, type, name_el, name_en, airtable_store_id, is_default, active)
values ('main', 'main', 'Fitpal', 'Fitpal', 9999, true, true)
on conflict (slug) do nothing;

-- ------------------------------------------------------------ backfill -----
update public.orders       set store_id = (select id from public.stores where slug='main') where store_id is null;
update public.weekly_menus set store_id = (select id from public.stores where slug='main') where store_id is null;
update public.vouchers     set store_id = (select id from public.stores where slug='main') where store_id is null;

-- Copy the global settings into store_settings for main, so main is a real
-- store rather than a special case. public.settings stays the source of truth
-- until a later ticket moves the read path.
insert into public.store_settings (store_id, key, value)
select (select id from public.stores where slug='main'), s.key, s.value
from public.settings s
on conflict (store_id, key) do nothing;

-- Existing checkout code does not set store_id, so without a default the
-- backfilled invariant would break on the very next order. Defaulting the
-- three columns to main keeps retail tagging itself until WEC-712 sets it
-- explicitly per store.
do $$
declare v_main uuid;
begin
  select id into v_main from public.stores where slug = 'main';
  execute format('alter table public.orders       alter column store_id set default %L', v_main);
  execute format('alter table public.weekly_menus alter column store_id set default %L', v_main);
  execute format('alter table public.vouchers     alter column store_id set default %L', v_main);
end $$;

-- ----------------------------------------------------------------- RLS -----
alter table public.stores             enable row level security;
alter table public.store_settings     enable row level security;
alter table public.store_members      enable row level security;
alter table public.category_discounts enable row level security;

drop policy if exists "Public read active stores" on public.stores;
create policy "Public read active stores" on public.stores
  for select using (active = true);

drop policy if exists admin_all_stores on public.stores;
create policy admin_all_stores on public.stores
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Public read store_settings" on public.store_settings;
create policy "Public read store_settings" on public.store_settings
  for select using (true);

drop policy if exists admin_all_store_settings on public.store_settings;
create policy admin_all_store_settings on public.store_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Public read category_discounts" on public.category_discounts;
create policy "Public read category_discounts" on public.category_discounts
  for select using (true);

drop policy if exists admin_all_category_discounts on public.category_discounts;
create policy admin_all_category_discounts on public.category_discounts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Users read own store_members" on public.store_members;
create policy "Users read own store_members" on public.store_members
  for select using (auth.uid() = user_id);

drop policy if exists admin_all_store_members on public.store_members;
create policy admin_all_store_members on public.store_members
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------- grants -----
grant select on public.stores, public.store_settings, public.category_discounts to anon, authenticated;
grant select on public.store_members to authenticated;
grant insert, update, delete on public.stores, public.store_settings, public.category_discounts, public.store_members to authenticated;

comment on table public.stores is 'WEC-709 — one row per storefront (main | company | reseller). Holds the single locked delivery address; a store''s "own menu" is only its own weekly_menus rows, the dish catalogue stays global.';
comment on column public.child_orders.company_benefit_amount is 'WEC-709/WEC-713 — company-funded deduction in cents, PER DELIVERY DAY. Company reimburses Fitpal, so never folded into orders.discount_amount.';
