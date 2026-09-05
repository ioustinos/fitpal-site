-- WEC-703 (part b): record the voucher applied to a subscription purchase on
-- the wallet_plans row itself, so the success page + confirmation email can
-- show the code + € off, and refunds know how much to release. `voucher_id`
-- links the applied voucher; `voucher_amount_cents` is the discount taken off
-- the charge (NOT the wallet credit — decision 2a: credit received is
-- unchanged). Both null for every plan bought without a voucher.
--
-- The authoritative redemption record still lives in voucher_uses
-- (wallet_plan_id + amount, via redeem_voucher_for_plan) — these two columns
-- are the denormalised copy the customer-facing surfaces read.
alter table public.wallet_plans
  add column if not exists voucher_id uuid references public.vouchers(id),
  add column if not exists voucher_amount_cents integer;

comment on column public.wallet_plans.voucher_id is
  'WEC-703: voucher applied at purchase (null = none). Redemption of record is voucher_uses.';
comment on column public.wallet_plans.voucher_amount_cents is
  'WEC-703: € (cents) discount taken off the charge by the voucher. Not deducted from wallet credit.';
