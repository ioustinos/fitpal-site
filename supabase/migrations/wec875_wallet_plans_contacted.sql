-- WEC-875: admin "Contacted" yes/no flag on wallet purchases.
alter table public.wallet_plans
  add column if not exists contacted boolean not null default false;
