-- ============================================================================
-- WEC-711 — fix: anonymous visitors could not read public.stores at all.
-- Applied to rhwetztxwjxfstffalwl on 2026-09-06.
--
-- SYMPTOM: GET /rest/v1/stores as anon → 401 "permission denied for function
-- is_admin", so /api/menu-meta could not resolve the main store, fell open
-- (by design) and served EVERY store's weekly menus to the retail site.
--
-- CAUSE: RLS OR-combines permissive policies. On tables whose public-read
-- policy is `using (true)` — settings, dishes, … — Postgres folds the
-- constant and never calls `is_admin()`, which is why those have always
-- worked for anon. `stores` has `using (active = true)`, which cannot be
-- folded, so the planner also evaluates `admin_all_stores` → `is_admin()`,
-- and EXECUTE on that function is granted to `authenticated`, not `anon`.
--
-- FIX: scope the admin policies to the `authenticated` role, so an anonymous
-- request never evaluates `is_admin()`. Preferred over granting EXECUTE to
-- anon, which would widen the surface of a SECURITY DEFINER function for
-- every table at once.
--
-- NOTE — the same shape exists on `payment_links` and
-- `profile_avoided_ingredients` (non-constant public-read policy alongside an
-- is_admin policy). Neither is read anonymously today, so neither is broken;
-- left alone deliberately rather than touching live policies out of scope.
--
-- Additive: policies are replaced with role-scoped equivalents; admin
-- capability is unchanged (admins are always authenticated).
--
-- ROLLBACK: re-create each policy without the `to authenticated` clause.
-- ============================================================================

drop policy if exists admin_all_stores on public.stores;
create policy admin_all_stores on public.stores
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all_store_settings on public.store_settings;
create policy admin_all_store_settings on public.store_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all_category_discounts on public.category_discounts;
create policy admin_all_category_discounts on public.category_discounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all_store_members on public.store_members;
create policy admin_all_store_members on public.store_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Users read own store_members" on public.store_members;
create policy "Users read own store_members" on public.store_members
  for select to authenticated using (auth.uid() = user_id);
