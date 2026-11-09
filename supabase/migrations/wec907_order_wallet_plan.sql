-- WEC-907: every wallet-paid order carries the subscription (wallet_plan) it was paid from.
--
-- Source of truth is the money movement: wallet_transactions.wallet_plan_id
-- (column already existed, but no debit/refund row ever filled it).
-- No column on orders on purpose — backfilling one would fire the orders
-- airtable_dirty trigger on every wallet order and flood the Airtable push queue.

-- Rule: the wallet's most recently ACTIVATED plan at a point in time.
create or replace function public.wallet_plan_at(p_wallet_id uuid, p_at timestamptz)
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select wp.id
  from public.wallet_plans wp
  where wp.wallet_id = p_wallet_id
    and wp.activated_at is not null
    and wp.activated_at <= p_at
  order by wp.activated_at desc
  limit 1
$$;

-- Stamp every order-linked wallet movement (submit debit, admin extra charge,
-- admin refund, any future writer) unless the caller set the plan itself.
create or replace function public.stamp_wallet_tx_plan()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.order_id is not null and new.wallet_plan_id is null then
    new.wallet_plan_id := public.wallet_plan_at(new.wallet_id, coalesce(new.created_at, now()));
  end if;
  return new;
end
$$;

drop trigger if exists trg_wallet_tx_stamp_plan on public.wallet_transactions;
create trigger trg_wallet_tx_stamp_plan
  before insert on public.wallet_transactions
  for each row execute function public.stamp_wallet_tx_plan();

-- An order's subscription = the plan on its FIRST debit.
-- security INVOKER: callers only see plans of wallet movements their RLS lets them read.
create or replace function public.order_wallet_plan_id(p_order_id uuid)
returns uuid
language sql stable security invoker set search_path to 'public'
as $$
  select t.wallet_plan_id
  from public.wallet_transactions t
  where t.order_id = p_order_id and t.type = 'debit' and t.wallet_plan_id is not null
  order by t.created_at asc
  limit 1
$$;
grant execute on function public.order_wallet_plan_id(uuid) to authenticated, service_role;

create index if not exists wallet_transactions_order_id_idx on public.wallet_transactions(order_id);

-- Internal helpers are not part of the public API.
revoke execute on function public.wallet_plan_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.stamp_wallet_tx_plan() from public, anon, authenticated;
grant execute on function public.wallet_plan_at(uuid, timestamptz) to service_role;
