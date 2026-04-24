-- WEC-174b — Audit log for the viva-reconcile scheduled function.
--
-- One row per run. Lets us see ops history in /admin + alert when
-- reconcile is actively rescuing orders (a canary for webhook failure).
-- In steady state, `paid` and `failed` should both be 0 every run.
--
-- Applied: 2026-04-25

create table if not exists public.reconcile_runs (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'viva',
  run_at            timestamptz not null default now(),
  checked           int not null default 0,
  paid              int not null default 0,
  failed            int not null default 0,
  still_pending     int not null default 0,
  cancelled_timeout int not null default 0,
  errors            int not null default 0,
  duration_ms       int,
  notes             text
);

create index if not exists idx_reconcile_runs_run_at_desc
  on public.reconcile_runs (provider, run_at desc);

comment on table public.reconcile_runs is
  'Per-run audit log for viva-reconcile. Read by /admin dashboard + future alerting.';

-- service_role (Netlify Functions) bypasses RLS, so no write policy needed.
-- Admin reads the most recent rows for the /admin dashboard health widget.
alter table public.reconcile_runs enable row level security;

create policy reconcile_runs_admin_read on public.reconcile_runs
  for select
  to authenticated
  using (public.is_admin());
