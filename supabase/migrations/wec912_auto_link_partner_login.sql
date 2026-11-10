-- WEC-912: a dietitian's portal login is linked automatically from the email on
-- their dietitian profile (partners.email), instead of relying on the separate
-- «Portal logins → Link login» admin step that was easy to miss.
--  * admin side: admin_link_partner_login(partner) — called after saving a dietitian
--  * signup side: trigger on profiles insert — a dietitian who signs up AFTER
--    Fitpal created their profile is linked on their first sign-in
-- Matching is trim + case-insensitive. Never steals an account that already
-- belongs to a dietitian (partner_users.user_id is unique) and never adds a
-- second login automatically.

create or replace function public.partner_login_try_link(p_partner uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from partner_users where partner_id = p_partner) then return 'already_has_login'; end if;
  if exists (select 1 from partner_users where user_id = p_user) then return 'account_taken'; end if;
  insert into partner_users (partner_id, user_id, role) values (p_partner, p_user, 'owner');
  return 'linked';
end $$;
revoke execute on function public.partner_login_try_link(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_link_partner_login(p_partner uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text; v_user uuid;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  select lower(trim(email)) into v_email from partners where id = p_partner;
  if v_email is null or v_email = '' then return 'no_email'; end if;
  if exists (select 1 from partner_users where partner_id = p_partner) then return 'already_has_login'; end if;
  select id into v_user from profiles where lower(trim(email)) = v_email limit 1;
  if v_user is null then return 'no_account'; end if;
  return public.partner_login_try_link(p_partner, v_user);
end $$;
revoke execute on function public.admin_link_partner_login(uuid) from public, anon;
grant execute on function public.admin_link_partner_login(uuid) to authenticated;

create or replace function public.trg_profile_link_partner_login()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_partner uuid;
begin
  if new.email is null then return new; end if;
  select p.id into v_partner from partners p
   where p.active and lower(trim(p.email)) = lower(trim(new.email))
     and not exists (select 1 from partner_users pu where pu.partner_id = p.id)
   limit 1;
  if v_partner is not null then
    perform public.partner_login_try_link(v_partner, new.id);
  end if;
  return new;
exception when others then
  -- never block a signup because of this convenience
  return new;
end $$;

drop trigger if exists trg_profiles_link_partner_login on public.profiles;
create trigger trg_profiles_link_partner_login
  after insert on public.profiles
  for each row execute function public.trg_profile_link_partner_login();
