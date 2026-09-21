-- WEC-810: mirror subscriptions (wallet_plans) into Airtable.
-- Applied live 2026-09-21 via MCP; this file is the record (LINEAR PROTOCOL 5).

alter table public.wallet_plans
  add column if not exists airtable_dirty boolean not null default false,
  add column if not exists airtable_synced_at timestamptz;

comment on column public.wallet_plans.airtable_dirty is
  'WEC-810: needs a push to Airtable. Set by any writer that changes plan state; cleared by airtable-reconcile once pushed (or once it establishes the plan can never be mirrored).';
comment on column public.wallet_plans.airtable_synced_at is
  'WEC-810: last successful Airtable push. NULL means never mirrored.';

create index if not exists wallet_plans_airtable_dirty_idx
  on public.wallet_plans (airtable_dirty) where airtable_dirty;

-- Re-flag on any meaningful update. This is the CORRECTED shape of the orders
-- trigger (WEC-789b): an explicit true -> false is honoured and returns early.
-- The original fought the reconcile's own clear — it saw a non-null synced_at
-- and set the flag straight back to true, so ineligible rows looped every five
-- minutes from 10 to 18 September with errors:0 the whole time. Do not
-- "simplify" this back.
create or replace function public.flag_wallet_plan_airtable_dirty()
returns trigger
language plpgsql
as $$
begin
  if old.airtable_dirty is true and new.airtable_dirty is false then
    return new;
  end if;
  if new.airtable_synced_at is distinct from old.airtable_synced_at then
    return new;
  end if;
  if old.airtable_synced_at is not null then
    new.airtable_dirty := true;
  end if;
  return new;
end
$$;

drop trigger if exists trg_wallet_plans_flag_airtable_dirty on public.wallet_plans;
create trigger trg_wallet_plans_flag_airtable_dirty
  before update on public.wallet_plans
  for each row execute function public.flag_wallet_plan_airtable_dirty();

-- Queue every NEW plan. The UPDATE trigger only re-flags rows already mirrored
-- once, so without this a fresh purchase starts dirty=false / synced_at=null
-- and nothing could ever queue it — the exact hole that left orders invisible.
-- In the database, so every insert path is covered including future ones.
create or replace function public.queue_wallet_plan_airtable_on_insert()
returns trigger
language plpgsql
as $$
begin
  if new.payment_status is distinct from 'failed' then
    new.airtable_dirty := true;
  end if;
  return new;
end
$$;

drop trigger if exists trg_wallet_plans_queue_airtable_insert on public.wallet_plans;
create trigger trg_wallet_plans_queue_airtable_insert
  before insert on public.wallet_plans
  for each row execute function public.queue_wallet_plan_airtable_on_insert();

-- Backfill: every existing eligible plan queued once.
update public.wallet_plans
   set airtable_dirty = true
 where payment_status <> 'failed'
   and airtable_synced_at is null;
