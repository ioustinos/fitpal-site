-- WEC-905 backfill (applied to dev + prod 2026-11-07 via MCP): recompute
-- active_until for ACTIVE plans as the Nth working day (Mon-Fri) from start_date,
-- N = round(plan_length_weeks * days_per_week). Only rows still on the OLD calendar
-- formula (start + round(weeks*7)) are touched, so hand-set end dates are preserved.
-- Each change is logged to admin_change_log (admin_user = 'system_wec905').
-- Result: prod 52 plans corrected (11 hand-set skipped); dev 4.
with c as (
  select id, start_date, active_until,
         round(plan_length_weeks * days_per_week)::int as n,
         (start_date + round(plan_length_weeks * 7)::int) as old_calc
  from public.wallet_plans
  where status = 'active' and payment_status <> 'failed'
    and start_date is not null and plan_length_weeks is not null and days_per_week is not null
), nd as (
  select c.*, (
    select d::date from generate_series(c.start_date::timestamp, (c.start_date + c.n*2 + 14)::timestamp, interval '1 day') d
    where extract(isodow from d) between 1 and 5
    order by d offset c.n - 1 limit 1) as new_end
  from c where c.n > 0
), upd as (
  update public.wallet_plans wp set active_until = nd.new_end
  from nd
  where wp.id = nd.id and nd.active_until = nd.old_calc
    and nd.new_end is not null and nd.active_until <> nd.new_end
  returning wp.id, nd.active_until as old_end, nd.new_end
)
insert into public.admin_change_log (wallet_plan_id, table_name, field_name, old_value, new_value, label, admin_user)
select id, 'wallet_plans', 'active_until', old_end::text, new_end::text,
       'WEC-905 backfill: end date recalculated on working days (Mon-Fri)', 'system_wec905'
from upd;
