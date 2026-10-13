-- Dev branch (jrxxsixhxgawucorfyjt) — table/sequence/function grants, applied 2026-10-11.
--
-- Newer Supabase databases (incl. branches created after the Data API grant
-- change) no longer give anon/authenticated/service_role SELECT/INSERT/UPDATE/
-- DELETE on public tables by default — only Dxtm. Production has full
-- arwdDxtm on every table and relies on RLS for security. Without these grants
-- every PostgREST call returns 403 «permission denied»: the menu would not load
-- and every Netlify function (service_role) failed on orders/reconcile_runs.
--
-- These lines make dev match production exactly (verified against prod's
-- pg_class.relacl and pg_default_acl). Additive only; RLS still applies.

grant all on all tables in schema public to anon, authenticated, service_role;
grant usage, select, update on all sequences in schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;

-- Dev-only convenience (2026-10-11): Ioustinos's first sign-up on dev becomes
-- admin owner + owner of the TEST dietitian. Lives in schema devsync, not public.
create or replace function devsync.bootstrap_owner() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if lower(new.email) = 'ioustinos.sarris@gmail.com' then
    insert into public.admin_users (user_id, role) values (new.id, 'owner') on conflict (user_id) do nothing;
    insert into public.partner_users (partner_id, user_id, role)
    values ('b8317e66-336c-4591-a5dd-ba158f94a4b2', new.id, 'owner') on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new;
end $f$;
create or replace trigger devsync_bootstrap_owner after insert on auth.users
  for each row execute function devsync.bootstrap_owner();
