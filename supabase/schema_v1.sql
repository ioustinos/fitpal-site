-- ============================================================
-- Fitpal Ordering Platform — Database Schema v1
-- Supabase (Postgres) — Project: rhwetztxwjxfstffalwl
-- ============================================================
--
-- Hierarchy: Order → ChildOrder (per day) → OrderItem
-- Auth: Supabase Auth (auth.users) extended by public.profiles
-- All timestamps in UTC, dates as DATE type
-- Bilingual: _el / _en suffix columns
-- Money: integer cents (€12.50 = 1250) to avoid float rounding
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy text search (future)


-- ────────────────────────────────────────────────────────────
-- 1. ENUM TYPES
-- ────────────────────────────────────────────────────────────

create type payment_method as enum (
  'cash',          -- Αντικαταβολή
  'card',          -- Viva card payment
  'bank_transfer', -- Τραπεζική μεταφορά
  'payment_link',  -- Viva payment link sent later
  'wallet'         -- Deduct from Fitpal wallet
);

create type payment_status as enum (
  'pending',
  'completed',
  'failed',
  'refunded'
);

create type order_status as enum (
  'draft',         -- Cart submitted but not confirmed (future use)
  'placed',        -- Order placed, awaiting processing
  'confirmed',     -- Admin confirmed
  'preparing',     -- Kitchen preparing
  'out_for_delivery',
  'delivered',
  'cancelled'
);

create type invoice_type as enum (
  'receipt',       -- Απόδειξη
  'invoice'        -- Τιμολόγιο
);

create type voucher_type as enum (
  'percentage',    -- e.g. 10% off
  'fixed'          -- e.g. €5 off
);

create type wallet_tx_type as enum (
  'credit',        -- Money in (top-up, bonus, refund)
  'debit'          -- Money out (order payment)
);

create type dish_temp as enum (
  'hot',           -- Ζεστή
  'cold',          -- Κρύα
  'ambient'        -- Μόνο Πάσο / room temp
);

create type payment_link_status as enum (
  'pending',
  'success',
  'failure'
);


-- ────────────────────────────────────────────────────────────
-- 2. PROFILES (extends auth.users)
-- ────────────────────────────────────────────────────────────

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null default '',
  phone         text,
  lang          text not null default 'el' check (lang in ('el', 'en')),

  -- Nutritional goals
  goal_calories integer,       -- kcal target
  goal_protein  integer,       -- grams
  goal_carbs    integer,       -- grams
  goal_fat      integer,       -- grams

  -- Preferences
  pref_vegetarian   boolean not null default false,
  pref_gluten_free  boolean not null default false,
  pref_low_carb     boolean not null default false,
  pref_payment      payment_method,                   -- default payment method
  pref_cutlery      boolean not null default false,
  pref_invoice      boolean not null default false,
  pref_newsletter   boolean not null default true,

  -- Preferred time slots per weekday (1=Mon .. 5=Fri), nullable
  pref_slot_mon     text,
  pref_slot_tue     text,
  pref_slot_wed     text,
  pref_slot_thu     text,
  pref_slot_fri     text,

  -- Preferred address ID per weekday
  pref_addr_mon     uuid,
  pref_addr_tue     uuid,
  pref_addr_wed     uuid,
  pref_addr_thu     uuid,
  pref_addr_fri     uuid,

  -- Dietician & dietary notes (from Airtable Customers)
  dietician         text,           -- e.g. 'Νένα', 'Φαίδρα', 'Μαρία'
  dietary_notes     text,           -- Διατροφικά Σχόλια
  orders_notes      text,           -- Admin notes about ordering patterns

  -- Airtable sync
  airtable_customer_id  text,       -- Airtable record ID for sync

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table profiles is 'User profiles extending Supabase Auth. One row per registered user.';


-- ────────────────────────────────────────────────────────────
-- 3. ADDRESSES
-- ────────────────────────────────────────────────────────────

create table addresses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  label_el      text not null default '',    -- e.g. 'Σπίτι', 'Γραφείο'
  label_en      text not null default '',    -- e.g. 'Home', 'Office'
  street        text not null,
  area          text not null,               -- City/area (used for zone matching)
  zip           text,
  floor         text,
  doorbell      text,
  notes         text,
  is_default    boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_addresses_user on addresses(user_id);

comment on table addresses is 'Saved delivery addresses per user.';


-- ────────────────────────────────────────────────────────────
-- 4. ALLERGIES
-- ────────────────────────────────────────────────────────────

create table allergies (
  id            uuid primary key default gen_random_uuid(),
  name_el       text not null,
  name_en       text not null default '',
  description   text
);

create table profile_allergies (
  profile_id    uuid not null references profiles(id) on delete cascade,
  allergy_id    uuid not null references allergies(id) on delete cascade,
  primary key (profile_id, allergy_id)
);


-- ────────────────────────────────────────────────────────────
-- 5. CATEGORIES
-- ────────────────────────────────────────────────────────────

create table categories (
  id            text primary key,            -- e.g. 'breakfast', 'cooked', 'grilled'
  name_el       text not null,
  name_en       text not null,
  sort_order    integer not null default 0,
  active        boolean not null default true,

  created_at    timestamptz not null default now()
);

comment on table categories is 'Dish categories: Πρωινά, Μαγειρευτά, Ψητές, Σαλάτες, Snacks.';


-- ────────────────────────────────────────────────────────────
-- 6. DISHES
-- ────────────────────────────────────────────────────────────

create table dishes (
  id            text primary key,            -- e.g. 'a01', 'b05' (matches Airtable Κωδικός)
  category_id   text not null references categories(id),
  name_el       text not null,
  name_en       text not null default '',
  desc_el       text,
  desc_en       text,
  image_url     text,                         -- Primary image
  emoji         text,                         -- Fallback emoji
  tags          text[] not null default '{}',  -- e.g. {'hot','popular','veg','lc','hp','sale'}
  temp          dish_temp,                     -- Κρύα / Ζεστή
  discount_pct  integer not null default 0,    -- percentage discount (0-100)
  ingredients_desc text,                       -- Full ingredients description (from Airtable)
  active        boolean not null default true,

  -- Airtable sync
  airtable_item_id  text,                     -- Airtable record ID

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_dishes_category on dishes(category_id);

comment on table dishes is 'Master dish catalog. Each dish has 1+ variants.';


-- ────────────────────────────────────────────────────────────
-- 7. DISH VARIANTS
-- ────────────────────────────────────────────────────────────

create table dish_variants (
  id            text primary key,             -- e.g. 'a01-v1', 'a01-v2'
  dish_id       text not null references dishes(id) on delete cascade,
  label_el      text not null,                -- e.g. 'Κοτόπουλο 150g / Ρύζι 200g'
  label_en      text not null default '',
  price         integer not null,             -- cents, e.g. 850 = €8.50
  calories      integer,                      -- kcal
  protein       integer,                      -- grams
  carbs         integer,                      -- grams
  fat           integer,                      -- grams
  sort_order    integer not null default 0,
  active        boolean not null default true,

  created_at    timestamptz not null default now()
);

create index idx_variants_dish on dish_variants(dish_id);

comment on table dish_variants is 'Size/protein/side variants per dish. Each has its own price and macros.';


-- ────────────────────────────────────────────────────────────
-- 8. WEEKLY MENUS
-- ────────────────────────────────────────────────────────────

create table weekly_menus (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                -- e.g. 'Εβδομάδα 14-18 Απρ'
  from_date     date not null,
  to_date       date not null,
  active        boolean not null default true,

  created_at    timestamptz not null default now(),

  constraint chk_date_range check (to_date >= from_date)
);

comment on table weekly_menus is 'Weekly menu definitions. Each spans Mon-Fri.';


-- ────────────────────────────────────────────────────────────
-- 9. MENU DAY DISHES (junction: which dishes on which day)
-- ────────────────────────────────────────────────────────────

create table menu_day_dishes (
  id            uuid primary key default gen_random_uuid(),
  menu_id       uuid not null references weekly_menus(id) on delete cascade,
  date          date not null,                -- the specific day
  dish_id       text not null references dishes(id) on delete cascade,
  sort_order    integer not null default 0,

  unique (menu_id, date, dish_id)
);

create index idx_menu_day_dishes_menu_date on menu_day_dishes(menu_id, date);
create index idx_menu_day_dishes_dish on menu_day_dishes(dish_id);

comment on table menu_day_dishes is 'Which dishes are available on which day of a weekly menu.';


-- ────────────────────────────────────────────────────────────
-- 10. DELIVERY ZONES
-- ────────────────────────────────────────────────────────────

create table delivery_zones (
  id            uuid primary key default gen_random_uuid(),
  name_el       text not null,                -- e.g. 'Γλυφάδα', 'Μαρούσι'
  name_en       text not null default '',
  postcodes     text[] not null default '{}',  -- valid postcodes for this zone (optional)
  active        boolean not null default true,

  created_at    timestamptz not null default now()
);

comment on table delivery_zones is 'Allowed delivery zones/areas. Used for address validation at checkout.';


-- ────────────────────────────────────────────────────────────
-- 11. ORDERS (parent)
-- ────────────────────────────────────────────────────────────

create table orders (
  id            uuid primary key default gen_random_uuid(),
  order_number  text not null unique,          -- Human-readable: FP-000001
  user_id       uuid references profiles(id) on delete set null,  -- null = guest order

  -- Guest info (used when user_id is null, or as snapshot)
  customer_name   text,
  customer_email  text,
  customer_phone  text,

  -- Money (all in cents)
  subtotal        integer not null default 0,  -- Sum of all items before discount
  discount_amount integer not null default 0,  -- Total discount applied
  total           integer not null default 0,  -- Final amount to pay

  -- Payment
  payment_method  payment_method,
  payment_status  payment_status not null default 'pending',

  -- Voucher
  voucher_code    text,
  voucher_discount integer not null default 0, -- cents saved via voucher

  -- Status
  status          order_status not null default 'placed',

  -- Extras
  cutlery         boolean not null default false,
  invoice_type    invoice_type not null default 'receipt',
  invoice_name    text,                         -- Company name for τιμολόγιο
  invoice_vat     text,                         -- ΑΦΜ
  notes           text,                         -- Order-level comments

  -- Admin fields (from Airtable)
  admin_order_id  text,                         -- Airtable Order Id / Admin ID
  admin_notes     text,
  paid_check      boolean not null default false, -- PAID - Fitpal Check
  paid_amount     integer,                       -- cents

  -- Airtable sync
  airtable_record_id    text,                  -- Airtable record ID
  gonnaorder_id         text,                  -- Legacy GonnaOrder ID

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_orders_user on orders(user_id);
create index idx_orders_status on orders(status);
create index idx_orders_created on orders(created_at desc);
create index idx_orders_number on orders(order_number);

comment on table orders is 'Parent order. Contains payment, voucher, totals. Has 1+ child_orders (one per delivery day).';


-- ────────────────────────────────────────────────────────────
-- 12. CHILD ORDERS (one per delivery day)
-- ────────────────────────────────────────────────────────────

create table child_orders (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  delivery_date   date not null,               -- The day this food is for

  -- Time window
  time_slot       text not null,               -- e.g. '09:00-11:00'

  -- Address snapshot (denormalized — frozen at order time)
  address_street  text not null,
  address_area    text not null,
  address_zip     text,
  address_floor   text,
  address_doorbell text,
  address_notes   text,

  -- Subtotal for this day (cents)
  day_subtotal    integer not null default 0,

  -- Logistics (admin / driver assignment)
  driver          text,                         -- Driver name
  pickup_time     text,
  stop_number     integer,
  eta             text,
  cash_on_delivery integer,                     -- Αντικαταβολή amount (cents)

  -- Airtable sync
  airtable_record_id text,

  created_at      timestamptz not null default now()
);

create index idx_child_orders_order on child_orders(order_id);
create index idx_child_orders_date on child_orders(delivery_date);

comment on table child_orders is 'One child order per delivery day within a parent order. Holds address + time slot snapshot.';


-- ────────────────────────────────────────────────────────────
-- 13. ORDER ITEMS
-- ────────────────────────────────────────────────────────────

create table order_items (
  id              uuid primary key default gen_random_uuid(),
  child_order_id  uuid not null references child_orders(id) on delete cascade,

  -- References (kept for joins, but snapshots below are the source of truth)
  dish_id         text references dishes(id) on delete set null,
  variant_id      text references dish_variants(id) on delete set null,

  -- Snapshot at order time (immune to future dish edits)
  name_el         text not null,
  name_en         text not null default '',
  variant_label_el text not null,
  variant_label_en text not null default '',
  category        text,

  quantity        integer not null default 1 check (quantity > 0),
  unit_price      integer not null,            -- cents per unit (after dish discount, before voucher)
  total_price     integer not null,            -- unit_price × quantity

  -- Macro snapshot
  calories        integer,
  protein         integer,
  carbs           integer,
  fat             integer,

  comment         text,                         -- Item-level note from customer

  -- Airtable sync
  airtable_record_id text,

  created_at      timestamptz not null default now()
);

create index idx_order_items_child on order_items(child_order_id);
create index idx_order_items_dish on order_items(dish_id);

comment on table order_items is 'Individual dish+variant in a child order. All values snapshotted at order time.';


-- ────────────────────────────────────────────────────────────
-- 14. WALLET PLANS
-- ────────────────────────────────────────────────────────────

create table wallet_plans (
  id            text primary key,              -- e.g. 'basic', 'plus', 'premium'
  name_el       text not null,
  name_en       text not null,
  price         integer not null,              -- cents (what user pays)
  credits       integer not null,              -- cents (what user gets including bonus)
  bonus_pct     integer not null default 0,    -- e.g. 7, 10, 12
  discount_pct  integer not null default 0,    -- meal discount while active, e.g. 5, 10
  active        boolean not null default true,

  created_at    timestamptz not null default now()
);

comment on table wallet_plans is 'Wallet subscription tiers: Basic, Plus, Premium.';


-- ────────────────────────────────────────────────────────────
-- 15. WALLETS
-- ────────────────────────────────────────────────────────────

create table wallets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references profiles(id) on delete cascade,
  plan_id       text references wallet_plans(id),
  balance       integer not null default 0,     -- total available (cents)
  base_balance  integer not null default 0,     -- from payments
  bonus_balance integer not null default 0,     -- from bonus credits
  discount_pct  integer not null default 0,     -- current meal discount
  auto_renew    boolean not null default false,
  next_renewal  date,
  active        boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table wallets is 'One wallet per user. Tracks balance, plan, renewal.';


-- ────────────────────────────────────────────────────────────
-- 16. WALLET TRANSACTIONS
-- ────────────────────────────────────────────────────────────

create table wallet_transactions (
  id            uuid primary key default gen_random_uuid(),
  wallet_id     uuid not null references wallets(id) on delete cascade,
  type          wallet_tx_type not null,
  amount        integer not null,              -- always positive; type determines direction
  description_el text not null default '',
  description_en text not null default '',
  order_id      uuid references orders(id) on delete set null,  -- if debit for order

  created_at    timestamptz not null default now()
);

create index idx_wallet_tx_wallet on wallet_transactions(wallet_id);
create index idx_wallet_tx_created on wallet_transactions(created_at desc);

comment on table wallet_transactions is 'Credit/debit log for wallet balance changes.';


-- ────────────────────────────────────────────────────────────
-- 17. VOUCHERS
-- ────────────────────────────────────────────────────────────

create table vouchers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,           -- e.g. 'FITPAL10', 'WELCOME5'
  type          voucher_type not null,
  value         integer not null,               -- pct: 10 = 10%, fixed: 500 = €5.00
  min_order     integer not null default 0,     -- minimum order (cents) to apply
  max_uses      integer,                        -- null = unlimited
  uses_count    integer not null default 0,
  per_user_limit integer not null default 1,    -- max uses per user
  expires_at    timestamptz,
  active        boolean not null default true,

  created_at    timestamptz not null default now()
);

comment on table vouchers is 'Promo/voucher codes. Percentage or fixed amount discount.';


-- ────────────────────────────────────────────────────────────
-- 18. VOUCHER USES (track per-user usage)
-- ────────────────────────────────────────────────────────────

create table voucher_uses (
  id            uuid primary key default gen_random_uuid(),
  voucher_id    uuid not null references vouchers(id) on delete cascade,
  user_id       uuid references profiles(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,
  used_at       timestamptz not null default now()
);

create index idx_voucher_uses_voucher on voucher_uses(voucher_id);
create index idx_voucher_uses_user on voucher_uses(user_id);


-- ────────────────────────────────────────────────────────────
-- 19. PAYMENT LINKS (Viva Payments)
-- ────────────────────────────────────────────────────────────

create table payment_links (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  viva_ref_code   bigint,                      -- Viva referenceCode
  payment_url     text,
  status          payment_link_status not null default 'pending',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_payment_links_order on payment_links(order_id);

comment on table payment_links is 'Viva Payments payment links/orders. One order may have multiple attempts.';


-- ────────────────────────────────────────────────────────────
-- 20. ADMIN CHANGE LOG
-- ────────────────────────────────────────────────────────────

create table admin_change_log (
  id              bigint primary key generated always as identity,
  order_id        uuid references orders(id) on delete set null,
  child_order_id  uuid references child_orders(id) on delete set null,
  order_item_id   uuid references order_items(id) on delete set null,
  table_name      text not null,
  record_id       text,
  field_name      text not null,
  old_value       text,
  new_value       text,
  label           text,                        -- human-readable description
  admin_user      text,                        -- who made the change

  created_at      timestamptz not null default now()
);

create index idx_change_log_order on admin_change_log(order_id);
create index idx_change_log_created on admin_change_log(created_at desc);

comment on table admin_change_log is 'Audit trail for admin edits to orders, child orders, and items.';


-- ────────────────────────────────────────────────────────────
-- 21. SETTINGS (key-value global config)
-- ────────────────────────────────────────────────────────────

create table settings (
  key           text primary key,
  value         jsonb not null,
  description   text,

  updated_at    timestamptz not null default now()
);

comment on table settings is 'Global key-value config: cutoff time, min order, time slots, etc.';

-- Seed essential settings
insert into settings (key, value, description) values
  ('min_order_cents',      '1500',                                  'Minimum order per day in cents (€15.00)'),
  ('cutoff_hour',          '18',                                    'Order cutoff hour (18 = 6 PM previous day)'),
  ('time_slots',           '["09:00-11:00","10:00-12:00","11:00-13:00","12:00-14:00","13:00-15:00"]', 'Available delivery time slots'),
  ('order_number_prefix',  '"FP"',                                  'Prefix for generated order numbers'),
  ('order_number_next',    '1',                                     'Next order number sequence value');


-- ────────────────────────────────────────────────────────────
-- 22. ORDER NUMBER SEQUENCE
-- ────────────────────────────────────────────────────────────

create sequence order_number_seq start with 1 increment by 1;

-- Helper function: generate FP-000001 style order numbers
create or replace function generate_order_number()
returns text as $$
declare
  seq_val bigint;
  prefix text;
begin
  seq_val := nextval('order_number_seq');
  select (value #>> '{}')::text into prefix from settings where key = 'order_number_prefix';
  prefix := coalesce(prefix, 'FP');
  return prefix || '-' || lpad(seq_val::text, 6, '0');
end;
$$ language plpgsql;


-- ────────────────────────────────────────────────────────────
-- 23. AUTO-SET order_number ON INSERT
-- ────────────────────────────────────────────────────────────

create or replace function set_order_number()
returns trigger as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := generate_order_number();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_orders_set_number
  before insert on orders
  for each row execute function set_order_number();


-- ────────────────────────────────────────────────────────────
-- 24. AUTO-UPDATE updated_at TIMESTAMPS
-- ────────────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated   before update on profiles      for each row execute function update_updated_at();
create trigger trg_addresses_updated  before update on addresses     for each row execute function update_updated_at();
create trigger trg_dishes_updated     before update on dishes        for each row execute function update_updated_at();
create trigger trg_orders_updated     before update on orders        for each row execute function update_updated_at();
create trigger trg_wallets_updated    before update on wallets       for each row execute function update_updated_at();
create trigger trg_pay_links_updated  before update on payment_links for each row execute function update_updated_at();
create trigger trg_settings_updated   before update on settings      for each row execute function update_updated_at();


-- ────────────────────────────────────────────────────────────
-- 25. ROW LEVEL SECURITY (RLS)
-- ────────────────────────────────────────────────────────────

-- Enable RLS on all tables
alter table profiles           enable row level security;
alter table addresses          enable row level security;
alter table allergies          enable row level security;
alter table profile_allergies  enable row level security;
alter table categories         enable row level security;
alter table dishes             enable row level security;
alter table dish_variants      enable row level security;
alter table weekly_menus       enable row level security;
alter table menu_day_dishes    enable row level security;
alter table delivery_zones     enable row level security;
alter table orders             enable row level security;
alter table child_orders       enable row level security;
alter table order_items        enable row level security;
alter table wallet_plans       enable row level security;
alter table wallets            enable row level security;
alter table wallet_transactions enable row level security;
alter table vouchers           enable row level security;
alter table voucher_uses       enable row level security;
alter table payment_links      enable row level security;
alter table admin_change_log   enable row level security;
alter table settings           enable row level security;

-- ── Profiles ──
create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- ── Addresses ──
create policy "Users can view own addresses"
  on addresses for select using (auth.uid() = user_id);
create policy "Users can insert own addresses"
  on addresses for insert with check (auth.uid() = user_id);
create policy "Users can update own addresses"
  on addresses for update using (auth.uid() = user_id);
create policy "Users can delete own addresses"
  on addresses for delete using (auth.uid() = user_id);

-- ── Allergies (public read) ──
create policy "Anyone can view allergies"
  on allergies for select using (true);

-- ── Profile Allergies ──
create policy "Users can manage own allergies"
  on profile_allergies for all using (auth.uid() = profile_id);

-- ── Categories, Dishes, Variants, Menus (public read) ──
create policy "Anyone can view categories"
  on categories for select using (true);
create policy "Anyone can view dishes"
  on dishes for select using (true);
create policy "Anyone can view variants"
  on dish_variants for select using (true);
create policy "Anyone can view weekly menus"
  on weekly_menus for select using (true);
create policy "Anyone can view menu day dishes"
  on menu_day_dishes for select using (true);

-- ── Delivery Zones (public read) ──
create policy "Anyone can view delivery zones"
  on delivery_zones for select using (true);

-- ── Orders ──
create policy "Users can view own orders"
  on orders for select using (auth.uid() = user_id);
create policy "Server can insert orders"
  on orders for insert with check (true);  -- Netlify Function uses service role key

-- ── Child Orders ──
create policy "Users can view own child orders"
  on child_orders for select using (
    exists (select 1 from orders where orders.id = child_orders.order_id and orders.user_id = auth.uid())
  );

-- ── Order Items ──
create policy "Users can view own order items"
  on order_items for select using (
    exists (
      select 1 from child_orders co
      join orders o on o.id = co.order_id
      where co.id = order_items.child_order_id and o.user_id = auth.uid()
    )
  );

-- ── Wallet Plans (public read) ──
create policy "Anyone can view wallet plans"
  on wallet_plans for select using (true);

-- ── Wallets ──
create policy "Users can view own wallet"
  on wallets for select using (auth.uid() = user_id);

-- ── Wallet Transactions ──
create policy "Users can view own transactions"
  on wallet_transactions for select using (
    exists (select 1 from wallets where wallets.id = wallet_transactions.wallet_id and wallets.user_id = auth.uid())
  );

-- ── Vouchers (public read for active vouchers — code validation) ──
create policy "Anyone can view active vouchers"
  on vouchers for select using (active = true);

-- ── Voucher Uses ──
create policy "Users can view own voucher uses"
  on voucher_uses for select using (auth.uid() = user_id);

-- ── Payment Links ──
create policy "Users can view own payment links"
  on payment_links for select using (
    exists (select 1 from orders where orders.id = payment_links.order_id and orders.user_id = auth.uid())
  );

-- ── Admin Change Log (admin only — no public access) ──
-- Access via service role key from Netlify Functions

-- ── Settings (public read) ──
create policy "Anyone can view settings"
  on settings for select using (true);


-- ────────────────────────────────────────────────────────────
-- 26. HELPER: AUTO-CREATE PROFILE ON SIGNUP
-- ────────────────────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ────────────────────────────────────────────────────────────
-- DONE. Tables: 20 | Enums: 8 | Functions: 4 | Triggers: 9
-- ────────────────────────────────────────────────────────────
