-- WEC-758 — activate a subscription at purchase for cash (αντικαταβολή) and
-- bank transfer, while the payment itself stays 'pending'.
--
-- Context: wallet_plan_mark_paid did TWO jobs in one transaction — it flipped
-- payment_status to 'paid' AND credited the wallet — and its only idempotency
-- guard was `if payment_status = 'paid' then return`. Crediting a plan while
-- leaving it 'pending' would therefore let a later admin "mark paid" credit the
-- SAME plan a second time: double credits, duplicate topup/bonus rows, real
-- money. This migration splits the two jobs and gives activation its own guard.
--
-- ⚠️ dev and prod share ONE Supabase project. Everything here is live on apply.

-- ── 1. The activation marker ────────────────────────────────────────────────
alter table public.wallet_plans
  add column if not exists activated_at timestamptz;

comment on column public.wallet_plans.activated_at is
  'WEC-758: when the wallet was credited for this plan. Independent of '
  'payment_status — a cash/transfer plan is activated at purchase but stays '
  'pending until the money arrives. Guards against double-crediting.';

-- Backfill: every paid/refunded plan was already credited by the old
-- wallet_plan_mark_paid. Without this, the new guard would read them as
-- "never activated" and credit them again on any re-run.
update public.wallet_plans
set activated_at = coalesce(confirmed_at, created_at)
where payment_status in ('paid', 'refunded')
  and activated_at is null;

-- ── 2. Activation on its own — does NOT touch payment_status ────────────────
create or replace function public.wallet_plan_activate(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_wallet_id uuid;
  v_dietician_managed boolean;
begin
  select * into v_plan
  from public.wallet_plans
  where id = p_plan_id
  for update;

  if v_plan is null then
    raise exception 'wallet_plan % not found', p_plan_id;
  end if;

  -- Idempotent: the wallet is credited exactly once per plan, whichever path
  -- got here first (purchase-time activation, Viva webhook, admin mark-paid).
  if v_plan.activated_at is not null then
    return;
  end if;

  -- Never hand out credit for a plan that failed or has been refunded.
  if v_plan.payment_status in ('failed', 'refunded') then
    raise exception 'wallet_plan % cannot be activated (status=%)',
      p_plan_id, v_plan.payment_status;
  end if;

  v_wallet_id := v_plan.wallet_id;
  v_dietician_managed := coalesce((v_plan.services->>'dieticianManaged')::boolean, false);

  update public.wallet_plans
  set activated_at = now()
  where id = p_plan_id;

  update public.wallets
  set balance        = coalesce(balance, 0)       + v_plan.wallet_credit_cents,
      base_balance   = coalesce(base_balance, 0)  + v_plan.amount_to_pay_cents,
      bonus_balance  = coalesce(bonus_balance, 0) + v_plan.bonus_credits_cents,
      active_plan_id = p_plan_id,
      active         = true,
      admin_managed  = v_dietician_managed,
      updated_at     = now()
  where id = v_wallet_id;

  insert into public.wallet_transactions
    (wallet_id, wallet_plan_id, type, amount, description_el, description_en)
  values (v_wallet_id, p_plan_id, 'topup', v_plan.amount_to_pay_cents,
          'Αγορά πλάνου wallet', 'Wallet plan purchase');

  if v_plan.bonus_credits_cents > 0 then
    insert into public.wallet_transactions
      (wallet_id, wallet_plan_id, type, amount, description_el, description_en)
    values (v_wallet_id, p_plan_id, 'bonus', v_plan.bonus_credits_cents,
            'Bonus credits από αγορά πλάνου', 'Bonus credits from plan purchase');
  end if;
end;
$function$;

-- ── 3. mark_paid keeps its job, but delegates crediting to the guard ────────
create or replace function public.wallet_plan_mark_paid(
  p_plan_id uuid, p_transaction_id text, p_amount_cents integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_wallet_id uuid;
  v_dietician_managed boolean;
begin
  select * into v_plan
  from public.wallet_plans
  where id = p_plan_id
  for update;

  if v_plan is null then
    raise exception 'wallet_plan % not found', p_plan_id;
  end if;

  -- Duplicate Viva webhook / double admin click: nothing left to do.
  if v_plan.payment_status = 'paid' then
    return;
  end if;

  v_wallet_id := v_plan.wallet_id;
  v_dietician_managed := coalesce((v_plan.services->>'dieticianManaged')::boolean, false);

  -- (a) The payment half — always runs.
  update public.wallet_plans
  set payment_status = 'paid',
      viva_transaction_id = coalesce(viva_transaction_id, p_transaction_id),
      confirmed_at = now()
  where id = p_plan_id;

  -- (b) The crediting half — ONLY if nobody credited this plan already.
  -- WEC-758: a cash/transfer plan is activated at purchase, so by the time an
  -- admin marks it paid the wallet has had its credit for days. Without this
  -- guard the customer would be credited twice.
  if v_plan.activated_at is null then
    update public.wallet_plans
    set activated_at = now()
    where id = p_plan_id;

    update public.wallets
    set balance        = coalesce(balance, 0)       + v_plan.wallet_credit_cents,
        base_balance   = coalesce(base_balance, 0)  + v_plan.amount_to_pay_cents,
        bonus_balance  = coalesce(bonus_balance, 0) + v_plan.bonus_credits_cents,
        active_plan_id = p_plan_id,
        active         = true,
        admin_managed  = v_dietician_managed,
        updated_at     = now()
    where id = v_wallet_id;

    insert into public.wallet_transactions
      (wallet_id, wallet_plan_id, type, amount, description_el, description_en)
    values (v_wallet_id, p_plan_id, 'topup', v_plan.amount_to_pay_cents,
            'Αγορά πλάνου wallet', 'Wallet plan purchase');

    if v_plan.bonus_credits_cents > 0 then
      insert into public.wallet_transactions
        (wallet_id, wallet_plan_id, type, amount, description_el, description_en)
      values (v_wallet_id, p_plan_id, 'bonus', v_plan.bonus_credits_cents,
              'Bonus credits από αγορά πλάνου', 'Bonus credits from plan purchase');
    end if;
  end if;
end;
$function$;

-- ── 4. Refunds must work on an activated-but-unpaid plan ────────────────────
-- The old guard demanded payment_status in ('paid','refunded'), which would
-- make every cash/transfer subscription un-refundable for as long as it sat
-- pending — i.e. exactly the window this change creates. If credit was handed
-- out, ops must be able to take it back.
create or replace function public.wallet_plan_refund(
  p_plan_id uuid, p_amount_cents integer, p_admin_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_wallet_id uuid;
  v_new_refund integer;
  v_is_full boolean;
  v_base_share integer;
  v_bonus_share integer;
begin
  select * into v_plan
  from public.wallet_plans
  where id = p_plan_id
  for update;

  if v_plan is null then
    raise exception 'wallet_plan % not found', p_plan_id;
  end if;

  -- WEC-758: activated-but-pending (cash / transfer) is refundable too.
  if v_plan.payment_status not in ('paid', 'refunded')
     and v_plan.activated_at is null then
    raise exception 'wallet_plan % is not paid or activated (status=%)',
      p_plan_id, v_plan.payment_status;
  end if;

  v_wallet_id := v_plan.wallet_id;
  v_new_refund := coalesce(v_plan.refund_amount_cents, 0) + p_amount_cents;
  v_is_full := v_new_refund >= v_plan.amount_to_pay_cents;

  -- Apportion the refund between base/bonus pro-rata to the original split.
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

  update public.wallets
  set balance       = greatest(0, coalesce(balance, 0)       - p_amount_cents),
      base_balance  = greatest(0, coalesce(base_balance, 0)  - v_base_share),
      bonus_balance = greatest(0, coalesce(bonus_balance, 0) - v_bonus_share),
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

grant execute on function public.wallet_plan_activate(uuid) to service_role;
