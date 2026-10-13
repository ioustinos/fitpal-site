-- WEC-846 (commission ledger) + WEC-851 (progress tracking) fixes, found in
-- the 2026-10-12 test pass. Applied to dev first, then production.
--
-- 1. Commission base. It counted only successful payment links + the amount
--    staff typed as collected. Cash/transfer orders marked «paid» with no
--    amount typed (17 of 99 paid cash and 6 of 51 paid transfer orders in
--    production's last 30 days) therefore earned 0 commission. Now: when an
--    order is paid, not by wallet, and nothing was recorded as collected, the
--    order total counts as collected. Refunds still come off. Wallet orders
--    stay at 0 (the commission was earned on the plan).
--
-- 2. partner_add_measurement accepted measurements for a client who had not
--    given consent (the portal hid the card, the server did not check). Now
--    it requires consent, like the body fields; in-house partners exempt.

create or replace function public.partner_commission_lines(p_partner uuid, p_from date, p_to date)
returns table(
  source_type text, source_id uuid, client_user_id uuid, client_name text, ref text,
  occurred_at timestamptz, gross int, base int, rate_bps int, commission int,
  paid_out int, outstanding int, payment_method text, payment_status text, order_status text
)
language sql stable security definer set search_path = public as $$
  with o0 as (
    select o.id, o.user_id, coalesce(o.customer_name, pr.name, o.customer_email) as cname,
           o.order_number, coalesce(o.submitted_at, o.created_at) as at, o.total,
           coalesce((select sum(pl.amount) from payment_links pl where pl.order_id = o.id and pl.status = 'success'),0)
             + coalesce(o.manual_paid_amount,0) as collected,
           coalesce(o.refund_amount,0) as refunded,
           coalesce(o.partner_commission_bps,0) as bps,
           o.payment_method::text pm, o.payment_status::text ps, o.status::text os
      from orders o left join profiles pr on pr.id = o.user_id
     where o.partner_id = p_partner and o.status <> 'draft'
  ),
  o as (
    select id, user_id, cname, order_number, at, total,
           greatest(0,
             (case when collected = 0 and ps = 'paid' and pm <> 'wallet' and os <> 'cancelled'
                   then total else collected end) - refunded)::int as base,
           bps, pm, ps, os
      from o0
  ),
  w as (
    select wp.id, wl.user_id, coalesce(pr.name, pr.email) as cname,
           'Πλάνο ' || coalesce(wp.plan_length::text,'') as ref, coalesce(wp.confirmed_at, wp.created_at) as at,
           coalesce(wp.amount_to_pay_cents,0) as total,
           case when wp.payment_status = 'paid'
                then greatest(0, coalesce(wp.amount_to_pay_cents,0) - coalesce(wp.refund_amount_cents,0)) else 0 end::int as base,
           coalesce(wp.partner_commission_bps,0) as bps,
           wp.payment_method::text pm, wp.payment_status::text ps, wp.status os
      from wallet_plans wp join wallets wl on wl.id = wp.wallet_id left join profiles pr on pr.id = wl.user_id
     where wp.partner_id = p_partner
  ),
  lines as (
    select 'order'::text st, id, user_id, cname, order_number ref, at, total, base, bps, pm, ps, os from o
    union all
    select 'wallet_plan', id, user_id, cname, ref, at, total, base, bps, pm, ps, os from w
  )
  select l.st, l.id, l.user_id, l.cname, l.ref, l.at, l.total, l.base, l.bps,
         round(l.base * l.bps / 10000.0)::int as commission,
         coalesce(p.paid,0)::int as paid_out,
         (round(l.base * l.bps / 10000.0)::int - coalesce(p.paid,0))::int as outstanding,
         l.pm, l.ps, l.os
    from lines l
    left join (select source_type, source_id, sum(amount) paid from partner_payout_items group by 1,2) p
      on p.source_type = l.st and p.source_id = l.id
   where (p_from is null or (l.at at time zone 'Europe/Athens')::date >= p_from)
     and (p_to   is null or (l.at at time zone 'Europe/Athens')::date <= p_to)
   order by l.at desc
$$;
revoke execute on function public.partner_commission_lines(uuid, date, date) from public, anon, authenticated;

create or replace function public.partner_add_measurement(p_client uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pid uuid := public.current_partner_id(); v_ok boolean; v_internal boolean; v_consent boolean; v_id uuid;
begin
  if v_pid is null or not public.partner_can_access(p_client) then
    raise exception 'no access to this client' using errcode = '42501';
  end if;
  select is_internal, is_internal or coalesce((features->>'progress_tracking')::boolean,false)
    into v_internal, v_ok from partners where id = v_pid;
  if not v_ok then raise exception 'progress tracking is not enabled for this partner' using errcode = '42501'; end if;
  if not v_internal then
    select consent_at is not null into v_consent
      from partner_clients where client_user_id = p_client and partner_id = v_pid and status = 'active' limit 1;
    if not coalesce(v_consent, false) then
      raise exception 'Ο πελάτης δεν έχει δώσει συγκατάθεση για σωματικά στοιχεία. · The client has not consented to share body data.'
        using errcode = '42501';
    end if;
  end if;
  insert into body_measurements (user_id, measured_on, weight_kg, body_fat_pct, waist_cm, extra, notes, created_by)
  values (p_client, coalesce(nullif(p->>'measuredOn','')::date, current_date),
          nullif(p->>'weightKg','')::numeric, nullif(p->>'bodyFatPct','')::numeric, nullif(p->>'waistCm','')::numeric,
          coalesce(p->'extra','{}'::jsonb), nullif(p->>'notes',''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
