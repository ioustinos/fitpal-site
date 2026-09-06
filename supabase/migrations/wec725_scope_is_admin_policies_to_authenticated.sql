-- ============================================================================
-- WEC-725 — scope the remaining is_admin() policies to the `authenticated` role
-- Applied to rhwetztxwjxfstffalwl on 2026-09-06.
--
-- The mechanism (found in WEC-709, fixed there for the four B2B tables):
-- RLS OR-combines permissive policies. A public-read policy of `using (true)`
-- is constant-folded and the others are never evaluated — which is why most
-- tables work for anon. A policy like `auth.uid() = owner` is NOT foldable, so
-- the planner ALSO evaluates the admin policy, calls `public.is_admin()`, and
-- anon dies with `401 permission denied for function is_admin` — a hard
-- failure of the whole read, not an empty result.
--
-- `payment_links` and `profile_avoided_ingredients` both carry that shape.
-- Neither was broken (nothing anonymous reads them — verified: the only client
-- read of payment_links is adminOrders.ts, and every server path uses the
-- service role, which bypasses RLS). This closes the trap before something
-- anonymous ever touches them.
--
-- Capability is unchanged in every direction:
--   * admins are always authenticated, so they keep full access
--   * anon gains nothing — the owner policies already exclude it via auth.uid()
--   * the service role bypasses RLS entirely and is unaffected
--
-- Verified after applying: both tables return `200 []` to an anonymous
-- PostgREST read instead of 401.
--
-- ROLLBACK: re-create each policy without the `to authenticated` clause.
-- ============================================================================

drop policy if exists admin_all_payment_links on public.payment_links;
create policy admin_all_payment_links on public.payment_links
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists profile_avoided_ingredients_admin_select on public.profile_avoided_ingredients;
create policy profile_avoided_ingredients_admin_select on public.profile_avoided_ingredients
  for select to authenticated
  using (public.is_admin());
