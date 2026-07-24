-- WEC-563 — DB backstop for the one-menu-per-week rule.
--
-- Incident 2026-07-24: a weekly_menus row ended up with from_date 07-20 →
-- to_date 07-31 (12 days), and the customer day strip rendered two weeks side
-- by side. The builder-side guard (adminMenus.createWeeklyMenu + Menus.tsx
-- banners) is the primary fix; this CHECK constraint is defence in depth so a
-- bad range can never be written again from any path (admin edit, script, SQL).
--
-- ⚠️ NOT AUTO-APPLIED. Run the pre-check FIRST — the constraint will fail to
--    add if any existing row violates it. Fix offenders before adding.
--
-- Pre-check (must return 0 rows before adding the constraint):
--   select id, name, from_date, to_date, (to_date - from_date) as span_days
--   from public.weekly_menus
--   where (to_date - from_date) > 6 or (to_date - from_date) < 0;

alter table public.weekly_menus
  add constraint weekly_menus_span_max_one_week
  check (to_date - from_date between 0 and 6);

-- Rollback:
--   alter table public.weekly_menus drop constraint weekly_menus_span_max_one_week;
