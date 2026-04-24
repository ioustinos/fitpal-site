-- WEC-177 — Atomic wallet debit for an order. Closes WEC-145.
--
-- submit-order.ts calls this after inserting the order. It locks the wallet
-- row, verifies balance, inserts a debit transaction, decrements balance,
-- and flips orders.payment_status to 'paid' — all in one transaction.
--
-- Raises:
--   SQLSTATE P0001 'wallet_not_found'     — user has no wallet row
--   SQLSTATE P0002 'insufficient_balance' — balance < amount
--
-- Applied: 2026-04-24

create or replace function public.wallet_debit_for_order(
  p_order_id uuid,
  p_user_id uuid,
  p_amount_cents int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_balance   int;
begin
  if p_amount_cents <= 0 then
    raise exception 'amount must be positive';
  end if;

  select id, balance into v_wallet_id, v_balance
  from wallets
  where user_id = p_user_id
  for update;

  if v_wallet_id is null then
    raise exception 'wallet_not_found' using errcode = 'P0001';
  end if;

  if v_balance < p_amount_cents then
    raise exception 'insufficient_balance' using errcode = 'P0002';
  end if;

  update wallets
     set balance    = balance - p_amount_cents,
         updated_at = now()
   where id = v_wallet_id;

  insert into wallet_transactions (wallet_id, type, amount, description_el, description_en, order_id)
  values (v_wallet_id, 'debit', p_amount_cents, 'Πληρωμή παραγγελίας', 'Order payment', p_order_id);

  update orders
     set payment_status = 'paid',
         updated_at     = now()
   where id = p_order_id
     and payment_status = 'pending';
end;
$$;

revoke all on function public.wallet_debit_for_order(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.wallet_debit_for_order(uuid, uuid, int) to service_role;

comment on function public.wallet_debit_for_order(uuid, uuid, int) is
  'WEC-177: atomic wallet debit + flip payment_status to paid. Raises insufficient_balance or wallet_not_found.';
