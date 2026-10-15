-- WEC-874: wallet_plan_refund floored balance / base_balance / bonus_balance
-- independently, so a refund base-share larger than the wallet's current
-- base_balance was dropped instead of pulled from bonus_balance, breaking the
-- WEC-208 invariant balance = base_balance + bonus_balance. Deduct a combined
-- amount across both component columns (base-share first, shortfall carried to
-- bonus, capped so bonus can always cover the remainder), flooring only the
-- combined total — mirrors wallet_debit_for_order's cross-column handling.
CREATE OR REPLACE FUNCTION public.wallet_plan_refund(p_plan_id uuid, p_amount_cents integer, p_admin_user_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_wallet_id uuid;
  v_new_refund integer;
  v_is_full boolean;
  v_base_share integer;
  v_bonus_share integer;
  v_bal0 integer;
  v_base0 integer;
  v_bonus0 integer;
  v_total_removed integer;
  v_from_base integer;
  v_from_bonus integer;
begin
  select * into v_plan
  from public.wallet_plans
  where id = p_plan_id
  for update;

  if v_plan is null then
    raise exception 'wallet_plan % not found', p_plan_id;
  end if;

  if v_plan.payment_status not in ('paid', 'refunded')
     and v_plan.activated_at is null then
    raise exception 'wallet_plan % is not paid or activated (status=%)',
      p_plan_id, v_plan.payment_status;
  end if;

  v_wallet_id := v_plan.wallet_id;
  v_new_refund := coalesce(v_plan.refund_amount_cents, 0) + p_amount_cents;
  v_is_full := v_new_refund >= v_plan.amount_to_pay_cents;

  if v_plan.wallet_credit_cents > 0 then
    v_base_share := round(p_amount_cents::numeric * v_plan.amount_to_pay_cents / v_plan.wallet_credit_cents)::int;
    v_bonus_share := p_amount_cents - v_base_share;
  else
    v_base_share := p_amount_cents;
    v_bonus_share := 0;
  end if;

  update public.wallet_plans
  set refund_amount_cents = v_new_refund,
      payment_status = case when v_is_full then 'refunded'::payment_status else payment_status end
  where id = p_plan_id;

  -- WEC-874: cross-column deduction preserving balance = base_balance + bonus_balance
  select coalesce(balance, 0), coalesce(base_balance, 0), coalesce(bonus_balance, 0)
    into v_bal0, v_base0, v_bonus0
  from public.wallets
  where id = v_wallet_id
  for update;

  v_total_removed := v_bal0 - greatest(0, v_bal0 - p_amount_cents);            -- least(balance, refund)
  v_from_base := least(v_base0, v_total_removed, greatest(v_base_share, v_total_removed - v_bonus0));
  v_from_bonus := v_total_removed - v_from_base;

  update public.wallets
  set balance       = v_bal0   - v_total_removed,
      base_balance  = v_base0  - v_from_base,
      bonus_balance = v_bonus0 - v_from_bonus,
      updated_at = now()
  where id = v_wallet_id;

  insert into public.wallet_transactions
    (wallet_id, wallet_plan_id, type, amount, description_el, description_en)
  values (v_wallet_id, p_plan_id, 'refund', -p_amount_cents,
          'Επιστροφή χρημάτων από το πλάνο', 'Wallet plan refund');

  insert into public.admin_change_log
    (order_id, table_name, field_name, old_value, new_value, label, admin_user)
  values (
    null, 'wallet_plans', 'refund_amount_cents',
    coalesce(v_plan.refund_amount_cents, 0)::text, v_new_refund::text,
    'Refund €' || (p_amount_cents::numeric / 100)::text || ' — ' || p_reason,
    p_admin_user_id::text
  );
end;
$function$;
