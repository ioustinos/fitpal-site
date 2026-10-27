-- WEC-885 · dietitian commission is earned on the NET amount · 27/10/2026
--
-- Decision (Ioustinos, 27/10): commission is calculated on the ex-VAT value.
-- A 10.00 € order has a commission base of 8.85 € (10 / 1.13), not 10.00 €.
-- Applies to BOTH food orders and subscription plans.
--
-- Size of the change: the base drops by 11.50%, NOT 13%. Net is 88.5% of gross
-- (1 / 1.13 = 0.885). Easy to misquote when talking to partners.
--
-- Safe to apply retroactively: as of today ZERO orders and ZERO wallet_plans
-- carry partner_commission_bps > 0, there is one (test) partner_clients link,
-- and no real partner has an active client. Nothing has ever been paid on the
-- old basis, so there is no recalculation to do.
--
-- Rate: 13% across the whole catalogue, drinks and water included
-- (Ioustinos, 27/10 — do NOT assume 24% for soft drinks). The same divisor is
-- already used by v_menu_reference_sync (price_exvat = price / 1.13).
--
-- Applied via MCP 27/10/2026. Verified: net_of_vat(1000) = 885,
-- 12% commission on a 10 € order = 1.06 € (was 1.20 €), reduction 11.50%.

create or replace function public.net_of_vat(p_gross_cents integer)
returns integer
language sql
immutable
as $$
  select round(coalesce(p_gross_cents, 0) / 1.13)::int
$$;

comment on function public.net_of_vat(integer) is
  'WEC-885: strip 13% VAT from a gross cents amount. 13% covers the entire Fitpal catalogue, drinks included. Single source of truth for the rate.';

grant execute on function public.net_of_vat(integer) to authenticated, service_role;

create or replace function public.partner_commission_lines(p_partner uuid, p_from date, p_to date)
 returns table(source_type text, source_id uuid, client_user_id uuid, client_name text, ref text,
               occurred_at timestamp with time zone, gross integer, base integer, rate_bps integer,
               commission integer, paid_out integer, outstanding integer,
               payment_method text, payment_status text, order_status text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with o0 as (
    select o.id, o.user_id, coalesce(o.customer_name, pr.name, o.customer_email) as cname,
           o.order_number, coalesce(o.submitted_at, o.created_at) as at, o.total,
           coalesce(o.subtotal,0) as subtotal,
           coalesce((select sum(pl.amount) from payment_links pl where pl.order_id = o.id and pl.status = 'success'),0)
             + coalesce(o.manual_paid_amount,0) as collected,
           coalesce(o.refund_amount,0) as refunded,
           coalesce(o.partner_commission_bps,0) as bps,
           o.payment_method::text pm, o.payment_status::text ps, o.status::text os
      from orders o left join profiles pr on pr.id = o.user_id
     where o.partner_id = p_partner and o.status <> 'draft'
  ),
  o1 as (
    select *,
           greatest(0,
             (case when collected = 0 and ps = 'paid' and pm <> 'wallet' and os <> 'cancelled'
                   then total else collected end) - refunded)::int as paid_net
      from o0
  ),
  o as (
    -- WEC-885: base is now NET of VAT. `gross` below still reports the
    -- VAT-inclusive figure so the portal can show both.
    select id, user_id, cname, order_number, at, total,
           (case
              when pm = 'wallet' then 0
              when total <= 0 then case when os <> 'cancelled' and ps = 'paid' then public.net_of_vat(subtotal) else 0 end
              else public.net_of_vat(round(subtotal * least(1.0, paid_net::numeric / total))::int)
            end)::int as base,
           bps, pm, ps, os
      from o1
  ),
  w as (
    select wp.id, wl.user_id, coalesce(pr.name, pr.email) as cname,
           'Πλάνο ' || coalesce(wp.plan_length::text,'') as ref, coalesce(wp.confirmed_at, wp.created_at) as at,
           coalesce(wp.amount_to_pay_cents,0) as total,
           case when wp.payment_status = 'paid'
                then public.net_of_vat(greatest(0, coalesce(wp.amount_to_pay_cents,0) - coalesce(wp.refund_amount_cents,0))::int)
                else 0 end::int as base,
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
$function$;

revoke execute on function public.partner_commission_lines(uuid, date, date) from public, anon, authenticated;
grant execute on function public.partner_commission_lines(uuid, date, date) to service_role;
