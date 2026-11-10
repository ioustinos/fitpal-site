-- WEC-908: Fitpal approval ALONE activates a dietitian ↔ client link.
-- 🟢 Ioustinos 09/11, option (a): on approval the link becomes `active` —
-- orders/financials visible to the dietitian, the dietitian discount applies,
-- commission accrues, ordering-for-client allowed — without the client's email
-- confirmation. Body data stays gated on `consent_at` (unchanged).
--
-- 🟢 Ioustinos 09/11: commission ALSO counts on the client's orders placed
-- SINCE THE DIETITIAN ADDED THEM (partner_clients.created_at) — not on older
-- history. Commission is computed from orders.partner_id/partner_commission_bps
-- (stamped at submit), so on activation we stamp the orders (and subscriptions)
-- placed between the add date and now that carry no partner yet. The discount
-- is NOT applied retroactively (those orders were already priced and paid).

create or replace function public.partner_stamp_since_link(p_link uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v partner_clients; n_o int; n_w int;
begin
  select * into v from partner_clients where id = p_link and status = 'active';
  if v.id is null then return 0; end if;
  update orders o
     set partner_id = v.partner_id, partner_commission_bps = v.commission_bps
   where o.user_id = v.client_user_id
     and o.partner_id is null
     and o.status <> 'draft'
     and coalesce(o.submitted_at, o.created_at) >= v.created_at;
  get diagnostics n_o = row_count;
  update wallet_plans wp
     set partner_id = v.partner_id, partner_commission_bps = v.commission_bps
    from wallets w
   where w.id = wp.wallet_id and w.user_id = v.client_user_id
     and wp.partner_id is null
     and wp.created_at >= v.created_at;
  get diagnostics n_w = row_count;
  return n_o + n_w;
end $$;
revoke execute on function public.partner_stamp_since_link(uuid) from public, anon, authenticated;

create or replace function public.admin_approve_partner_link(p_link uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v partner_clients;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  update partner_clients set approved_by = auth.uid(), approved_at = now() where id = p_link returning * into v;
  if v.id is null then raise exception 'link not found' using errcode = 'P0002'; end if;
  if v.status = 'pending' then
    begin
      update partner_clients set status = 'active' where id = p_link;
    exception when unique_violation then
      raise exception 'Ο πελάτης έχει ήδη ενεργή σύνδεση με άλλον διαιτολόγο — απενεργοποιήστε εκείνη πρώτα.' using errcode = '23505';
    end;
    perform public.partner_stamp_since_link(p_link);
    return 'active';
  end if;
  return v.status;
end $$;

-- Backfill: links Fitpal already approved but that were waiting on the
-- client's email confirmation → active, and stamp their orders since the add date.
do $$
declare r record;
begin
  for r in select pc.id from public.partner_clients pc
            where pc.status = 'pending' and pc.approved_at is not null
              and not exists (select 1 from public.partner_clients o
                               where o.client_user_id = pc.client_user_id and o.status = 'active' and o.id <> pc.id)
  loop
    update public.partner_clients set status = 'active' where id = r.id;
    perform public.partner_stamp_since_link(r.id);
  end loop;
end $$;
