-- WEC-907 backfill: stamp historical order-linked wallet movements with the plan
-- that was active (most recently activated) when they happened.
-- Touches wallet_transactions ONLY (no triggers on that table besides the new
-- BEFORE INSERT one) — orders / airtable_dirty / updated_at are untouched.
update public.wallet_transactions t
   set wallet_plan_id = public.wallet_plan_at(t.wallet_id, t.created_at)
 where t.order_id is not null
   and t.wallet_plan_id is null;
