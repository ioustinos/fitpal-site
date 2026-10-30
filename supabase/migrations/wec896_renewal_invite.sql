-- WEC-896: renewal invitation (email 3 days before expiry + prefilled wizard).
-- Applied to dev (jrxxsixhxgawucorfyjt) + prod (rhwetztxwjxfstffalwl) 2026-10-30.

-- Idempotency stamp — the invite fires ONCE per plan, visible in the DB (not
-- only in Klaviyo's dedupe).
alter table public.wallet_plans
  add column if not exists renewal_invite_sent_at timestamptz;

-- Candidates for the nightly renewal invite. SECURITY DEFINER so the scheduled
-- function (service role) gets a stable, cheap read. Rules (Ioustinos):
--  • active + paid plan, expiring in exactly p_days days, not yet invited;
--  • SKIP if the customer already has a NEWER active+paid plan (already renewed).
create or replace function public.subscription_renewal_candidates(p_days int, p_limit int default 200)
returns table (
  id uuid, wallet_id uuid, user_id uuid, plan_length text, days_per_week int,
  goal text, meal_breakfast bool, meal_lunch bool, meal_dinner bool, meal_snack bool,
  daily_kcal smallint, active_until date
)
language sql stable security definer set search_path = public as $$
  select wp.id, wp.wallet_id, w.user_id, wp.plan_length, wp.days_per_week,
         wp.goal, wp.meal_breakfast, wp.meal_lunch, wp.meal_dinner, wp.meal_snack,
         wp.daily_kcal, wp.active_until
  from public.wallet_plans wp
  join public.wallets w on w.id = wp.wallet_id
  where wp.status = 'active'
    and wp.payment_status = 'paid'
    and wp.renewal_invite_sent_at is null
    and wp.active_until = (current_date + p_days)
    and not exists (
      select 1 from public.wallet_plans nwp
      where nwp.wallet_id = wp.wallet_id
        and nwp.id <> wp.id
        and nwp.status = 'active'
        and nwp.payment_status = 'paid'
        and nwp.created_at > wp.created_at
    )
  order by wp.active_until
  limit greatest(1, least(p_limit, 500));
$$;
grant execute on function public.subscription_renewal_candidates(int, int) to service_role;
