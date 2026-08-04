-- WEC-594: admins can't see existing payment links.
--
-- public.payment_links was created by the Viva migration (wec171_viva_payment_flow)
-- AFTER the WEC-113..119 admin_rls_policies_and_zone_min_order migration, so it
-- never received an admin_all_* policy. Its only policy is the self-scoped
-- "Users read own payment links". Admin surfaces read this table through the
-- direct Supabase client (adminOrders.ts) under admin RLS, so any order whose
-- customer is not the logged-in admin returns no rows -> the order drawer shows
-- "No payment link generated" and offers to generate a duplicate.
--
-- Fix: mirror the admin_all_* pattern used on every other admin-read table,
-- gated on the SECURITY DEFINER helper public.is_admin().

create policy admin_all_payment_links on public.payment_links
  for all using (public.is_admin()) with check (public.is_admin());
