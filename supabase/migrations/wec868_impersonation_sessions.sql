-- WEC-868 (client mode in its own tab — one identity per tab for admins and
-- dietitians). One row per "act as client" session. An operator (admin or
-- dietitian) has at most ONE open session: starting a new one ends the old
-- one ('replaced'). submit-order only attributes an order to an operator when
-- the X-Client-Session-Id header names an open, unexpired, recently-seen
-- session for the very customer whose JWT placed it.
create table if not exists public.impersonation_sessions (
  id               uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references auth.users(id) on delete cascade,
  operator_role    text not null check (operator_role in ('admin','partner')),
  client_user_id   uuid not null references auth.users(id) on delete cascade,
  partner_id       uuid references public.partners(id) on delete set null,
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '2 hours',
  last_seen_at     timestamptz not null default now(),
  ended_at         timestamptz,
  end_reason       text check (end_reason in ('closed','replaced','expired','tab_gone','signed_out'))
);
create unique index if not exists impersonation_sessions_one_open
  on public.impersonation_sessions (operator_user_id) where ended_at is null;
create index if not exists impersonation_sessions_client
  on public.impersonation_sessions (client_user_id, started_at desc);
alter table public.impersonation_sessions enable row level security;
-- No policies: service role only (Netlify functions).
revoke all on public.impersonation_sessions from anon, authenticated;
