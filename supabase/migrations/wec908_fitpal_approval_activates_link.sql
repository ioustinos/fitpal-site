-- WEC-908: Fitpal approval ALONE activates a dietitian ↔ client link.
-- 🟢 Ioustinos 09/11, option (a): on approval the link becomes `active` —
-- orders/financials visible to the dietitian, the dietitian discount applies,
-- commission accrues on NEW orders, ordering-for-client allowed — without the
-- client's email confirmation. Body data stays gated on `consent_at` (unchanged).
-- Commission is not retroactive: it is stamped on orders at submit time
-- (orders.partner_id / partner_commission_bps), so activating a link does not
-- create commission on past orders.

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
    return 'active';
  end if;
  return v.status;
end $$;

-- Backfill: links Fitpal already approved but that were waiting on the
-- client's email confirmation. Skip any client that already has another
-- active link (one active dietitian per client).
update public.partner_clients pc
   set status = 'active'
 where pc.status = 'pending'
   and pc.approved_at is not null
   and not exists (select 1 from public.partner_clients o
                    where o.client_user_id = pc.client_user_id and o.status = 'active' and o.id <> pc.id);
