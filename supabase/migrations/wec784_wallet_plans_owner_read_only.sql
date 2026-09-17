-- WEC-784: wallet_plans was SELECT-able by role `public` with USING (true).
--
-- The Supabase anon key ships inside the client bundle by design, so that
-- policy made every subscriber's profile_snapshot (sex, birth year, height,
-- weight, activity, goal), invoice_name / invoice_vat, amounts paid and the
-- full pricing matrix readable by any anonymous caller. Verified on the live
-- database: `set local role anon; select count(*) from wallet_plans;` -> 67.
--
-- Replaced with an owner-scoped read. Admins keep access through the existing
-- admin_all_wallet_plans policy (FOR ALL to authenticated, gated on
-- is_admin()). Every netlify/** caller uses the service-role key, which
-- bypasses RLS, so no server path is affected.
--
-- Applied to the live project 2026-09-17 via MCP; this file is the record
-- (LINEAR PROTOCOL rule 5).

drop policy if exists "Public read wallet plans" on public.wallet_plans;

create policy "wallet_plans_owner_read"
on public.wallet_plans
for select
to authenticated
using (
  exists (
    select 1
    from public.wallets w
    where w.id = public.wallet_plans.wallet_id
      and w.user_id = auth.uid()
  )
);

-- The policy joins on wallet_id for every row read; keep that indexed.
create index if not exists wallet_plans_wallet_id_idx
  on public.wallet_plans (wallet_id);
