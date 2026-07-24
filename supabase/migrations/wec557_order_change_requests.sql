-- WEC-557 — «Αίτημα αλλαγής» (order change request)
--
-- Customer submits a change request against one of their orders (still
-- actionable: pending/confirmed). Lands as a row for ops in the admin panel.
-- No email leg for now (decided by Ioustinos).
--
-- ⚠️ NOT AUTO-APPLIED — review, then apply via Supabase (needs Ioustinos' OK).

-- 1. Reason enum
do $$ begin
  create type public.order_change_reason as enum (
    'cancel',          -- Ακύρωση παραγγελίας
    'address_or_time', -- Αλλαγή διεύθυνσης ή ώρας
    'dish',            -- Αλλαγή / Προσθήκη / Αφαίρεση πιάτου
    'other'            -- Άλλο
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_change_status as enum ('new', 'handled');
exception when duplicate_object then null; end $$;

-- 2. Table
create table if not exists public.order_change_requests (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  reason      public.order_change_reason not null,
  message     text,
  status      public.order_change_status not null default 'new',
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references auth.users(id) on delete set null
);

create index if not exists order_change_requests_order_idx  on public.order_change_requests (order_id);
create index if not exists order_change_requests_status_idx on public.order_change_requests (status) where status = 'new';

-- 3. RLS
alter table public.order_change_requests enable row level security;

-- Customer: insert a request for their OWN order; read their own requests.
create policy "own insert order change requests"
  on public.order_change_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

create policy "own read order change requests"
  on public.order_change_requests for select to authenticated
  using (user_id = auth.uid());

-- Admin: full access (uses the WEC-110 helper).
create policy "admin all order change requests"
  on public.order_change_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Rollback:
--   drop table if exists public.order_change_requests;
--   drop type if exists public.order_change_status;
--   drop type if exists public.order_change_reason;
