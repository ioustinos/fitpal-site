-- WEC-811: admin-controlled subscription lifecycle status on wallet_plans.
-- Independent of payment_status — a Pending (unpaid) plan is still 'active'
-- until an admin cancels it. Cancelling also deactivates the owning wallet
-- (wallets.active=false) WITHOUT any refund or balance change. active_plan_id
-- is intentionally kept so a cancelled plan stays visible and reversible in
-- /admin/users. The WEC-810 dirty trigger re-flags on this update, so the
-- status change re-syncs to Airtable automatically.
alter table public.wallet_plans
  add column if not exists status text not null default 'active'
    check (status in ('active','cancelled'));
