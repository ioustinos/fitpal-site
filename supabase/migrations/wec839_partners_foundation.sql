-- ============================================================================
-- WEC-839 — Dietitian Partners: DB foundation (epic WEC-838)
-- Applied to rhwetztxwjxfstffalwl on 2026-10-09 (overnight, authorised by
-- Ioustinos 2026-10-09 01:38: «push dev + apply additive migrations»).
--
-- Applied via execute_sql in chunks (apply_migration kept returning
-- «cancelled» on statements containing DROP). No DROP statements at all.
-- ADDITIVE ONLY. New tables, new nullable/defaulted columns, new functions.
-- The two CREATE OR REPLACE functions (promote_draft_atomic,
-- recompute_order_money) are in wec845_partner_discount_money.sql.
--
-- Model (🟢 = Ioustinos / Fitpal spec):
--   🟢 agent model — Fitpal sells, client gets a discount, dietitian earns
--      commission. Default commission 12% (docx: «βασικό commission (default
--      12%)»), split per client by Fitpal (e.g. 6% discount + 6% commission).
--   🟢 commission only when payment happens. It is DERIVED, never written by
--      payment code: base = money actually collected for the order excluding
--      wallet debits (payment_links success + manual_paid_amount) minus
--      refunds. Wallet-paid orders therefore earn nothing; the commission was
--      earned when the plan (wallet top-up) was paid. See
--      partner_commission_lines() in wec846_partner_commissions.sql.
--   🟢 no "pending welcome" status. A link is active immediately when the
--      dietitian creates a NEW account. Linking an EXISTING Fitpal customer
--      is 'pending' until the client confirms AND Fitpal approves.
-- ============================================================================

-- ── partners ────────────────────────────────────────────────────────────────
create table if not exists public.partners (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null default 'dietitian' check (kind in ('dietitian')),
  name                   text not null,
  legal_name             text,
  vat_number             text,           -- ΑΦΜ
  tax_office             text,           -- ΔΟΥ
  address                text,
  email                  text,
  phone                  text,
  iban                   text,
  -- basis points: 1200 = 12%
  default_commission_bps int  not null default 1200 check (default_commission_bps between 0 and 10000),
  default_discount_bps   int  not null default 0    check (default_discount_bps between 0 and 10000),
  -- 🟢 in-house dietitians (Nena's team): 0%, see every client, keep admin
  is_internal            boolean not null default false,
  active                 boolean not null default true,
  -- 🟢 hidden paid add-ons, toggled ONLY by Fitpal admin:
  --    { "progress_tracking": bool, "referral": bool, "notifications": bool }
  features               jsonb not null default '{}'::jsonb,
  referral_code          text unique,
  agreement_date         date,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── partner_users: which login belongs to which partner ─────────────────────
-- One row per user (a person works for one partner). Several users per
-- partner = clinics (WEC-854, backlog) — the shape already allows it.
create table if not exists public.partner_users (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);
create index if not exists partner_users_partner_idx on public.partner_users(partner_id);

-- ── partner_clients: dietitian ↔ client, with the per-client terms ──────────
create table if not exists public.partner_clients (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid not null references public.partners(id) on delete cascade,
  client_user_id      uuid not null references auth.users(id) on delete cascade,
  status              text not null default 'active' check (status in ('active','pending','inactive')),
  discount_bps        int  not null default 0    check (discount_bps between 0 and 10000),
  commission_bps      int  not null default 1200 check (commission_bps between 0 and 10000),
  created_via         text not null default 'partner_new'
                        check (created_via in ('partner_new','partner_existing','admin','referral')),
  created_by          uuid,
  -- existing customers: client confirms + Fitpal approves → active
  client_confirmed_at timestamptz,
  approved_by         uuid,
  approved_at         timestamptz,
  -- 🟢 health-data consent (share body data / targets with the dietitian)
  consent_at          timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- A client has at most ONE live (active or pending) dietitian.
create unique index if not exists partner_clients_one_live_link
  on public.partner_clients(client_user_id) where status <> 'inactive';
create index if not exists partner_clients_partner_idx on public.partner_clients(partner_id);

-- ── terms history (who changed the split, when) ─────────────────────────────
create table if not exists public.partner_client_terms_history (
  id                uuid primary key default gen_random_uuid(),
  partner_client_id uuid not null references public.partner_clients(id) on delete cascade,
  discount_bps      int not null,
  commission_bps    int not null,
  status            text not null,
  changed_by        uuid,
  changed_at        timestamptz not null default now()
);

create or replace function public.trg_partner_client_terms_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.discount_bps   is distinct from old.discount_bps
     or new.commission_bps is distinct from old.commission_bps
     or new.status         is distinct from old.status then
    insert into public.partner_client_terms_history
      (partner_client_id, discount_bps, commission_bps, status, changed_by)
    values (new.id, new.discount_bps, new.commission_bps, new.status, auth.uid());
  end if;
  return null;
end $$;
create or replace function public.trg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create or replace trigger partner_clients_touch before update on public.partner_clients
  for each row execute function public.trg_touch_updated_at();
create or replace trigger partners_touch before update on public.partners
  for each row execute function public.trg_touch_updated_at();
-- AFTER for the history row (needs new.id on insert).
create or replace trigger partner_client_terms_history
  after insert or update on public.partner_clients
  for each row execute function public.trg_partner_client_terms_history();

-- ── client targets (🟢 same every day; daily total + per meal) ──────────────
create table if not exists public.client_targets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  kcal       int,
  protein    int,
  carbs      int,
  fat        int,
  -- { "breakfast": {"kcal":..,"protein":..,"carbs":..,"fat":..}, "lunch": {...}, "dinner": {...}, "snack": {...} }
  meals      jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ── body measurements (WEC-851 hidden add-on: progress tracking) ────────────
create table if not exists public.body_measurements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  measured_on  date not null default current_date,
  weight_kg    numeric(5,1),
  body_fat_pct numeric(4,1),
  waist_cm     numeric(5,1),
  extra        jsonb not null default '{}'::jsonb,   -- any further measurement, free keys
  notes        text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists body_measurements_user_idx on public.body_measurements(user_id, measured_on);

-- ── payouts (Fitpal marks what it paid each dietitian) ──────────────────────
create table if not exists public.partner_payouts (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  amount     int  not null,                 -- cents
  paid_at    timestamptz not null default now(),
  reference  text,
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.partner_payout_items (
  id          uuid primary key default gen_random_uuid(),
  payout_id   uuid not null references public.partner_payouts(id) on delete cascade,
  source_type text not null check (source_type in ('order','wallet_plan')),
  source_id   uuid not null,
  amount      int  not null                 -- cents; negative = clawback settled
);
create index if not exists partner_payout_items_source_idx on public.partner_payout_items(source_type, source_id);

-- ── order snapshot + provenance ─────────────────────────────────────────────
alter table public.orders
  add column if not exists partner_id              uuid references public.partners(id),
  add column if not exists partner_discount_bps    int,
  add column if not exists partner_commission_bps  int,
  add column if not exists partner_discount_amount int not null default 0,
  -- 🟢 «placed by» on every order: 'customer' | 'admin' | 'partner'
  add column if not exists placed_by_role          text,
  add column if not exists placed_by_user          uuid;
create index if not exists orders_partner_idx on public.orders(partner_id) where partner_id is not null;

-- ── wallet plan snapshot (commission on plan purchase, WEC-849) ─────────────
alter table public.wallet_plans
  add column if not exists partner_id             uuid references public.partners(id),
  add column if not exists partner_commission_bps int;

-- Stamp the buying client's dietitian onto a new plan. A trigger (not code in
-- wallet-plan-purchase) so every path — wizard, admin, impersonated — gets it.
create or replace function public.trg_wallet_plan_stamp_partner()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_bps int;
begin
  if new.partner_id is null then
    select pc.partner_id, pc.commission_bps into v_pid, v_bps
      from public.wallets w
      join public.partner_clients pc on pc.client_user_id = w.user_id and pc.status = 'active'
      join public.partners p on p.id = pc.partner_id and p.active
     where w.id = new.wallet_id
     limit 1;
    if v_pid is not null then
      new.partner_id := v_pid;
      new.partner_commission_bps := v_bps;
    end if;
  end if;
  return new;
end $$;
create or replace trigger wallet_plan_stamp_partner
  before insert on public.wallet_plans
  for each row execute function public.trg_wallet_plan_stamp_partner();

-- 🟢 interim (2026-10-09): no partner discount on plans until Fitpal answers.
insert into public.settings (key, value, description)
values ('partner_plan_discount_mode', '"none"'::jsonb,
        'WEC-849: how a dietitian client''s discount combines with plan discounts. "none" = commission only (interim, awaiting Fitpal).')
on conflict (key) do nothing;

-- ── RLS: lock everything; admins full access; partners/clients go through
--    SECURITY DEFINER RPCs that check access explicitly. ─────────────────────
alter table public.partners                     enable row level security;
alter table public.partner_users                enable row level security;
alter table public.partner_clients              enable row level security;
alter table public.partner_client_terms_history enable row level security;
alter table public.client_targets               enable row level security;
alter table public.body_measurements            enable row level security;
alter table public.partner_payouts              enable row level security;
alter table public.partner_payout_items         enable row level security;

-- `to authenticated` — WEC-725 lesson: an unscoped admin policy makes anon
-- evaluate is_admin() and 401.
do $$
declare t text;
begin
  foreach t in array array['partners','partner_users','partner_clients','partner_client_terms_history',
                           'client_targets','body_measurements','partner_payouts','partner_payout_items'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='admin_all_'||t) then
      execute format('create policy admin_all_%1$s on public.%1$s for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop;
end $$;

-- A customer may read their own targets (the menu/goal UI can use them).
do $$ begin
  if not exists (select 1 from pg_policies where policyname='own_read_client_targets') then
    create policy own_read_client_targets on public.client_targets for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where policyname='own_read_body_measurements') then
    create policy own_read_body_measurements on public.body_measurements for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ── access helpers ──────────────────────────────────────────────────────────
create or replace function public.current_partner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select pu.partner_id
    from public.partner_users pu
    join public.partners p on p.id = pu.partner_id and p.active
   where pu.user_id = auth.uid()
   limit 1
$$;

-- Can the calling partner act for this client? Internal partners: anyone.
-- Others: an ACTIVE link only (pending links show in the list, nothing more).
create or replace function public.partner_can_access(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.partners p
     where p.id = public.current_partner_id()
       and (p.is_internal
            or exists (select 1 from public.partner_clients pc
                        where pc.partner_id = p.id and pc.client_user_id = p_client and pc.status = 'active'))
  )
$$;

revoke execute on function public.current_partner_id() from public, anon;
revoke execute on function public.partner_can_access(uuid) from public, anon;
grant execute on function public.current_partner_id() to authenticated;
grant execute on function public.partner_can_access(uuid) to authenticated;
