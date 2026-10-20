-- WEC-876: customer-level "Pays Monthly" billing flag.
alter table public.profiles
  add column if not exists pays_monthly boolean not null default false;
