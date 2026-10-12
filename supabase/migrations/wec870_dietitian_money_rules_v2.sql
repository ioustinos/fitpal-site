-- ============================================================================
-- WEC-870 — Dietitian money rules v2 (Christos 13/10, epic WEC-838)
--
-- 🟢 Ioustinos: «Fitpal sets the total commission and the dietitian decides
--    if they want to give a discount. 12% is the default, Fitpal defines per
--    dietitian and the dietitian then splits per client.»
-- 🟢 Christos: a voucher does NOT stack with the dietitian discount
--    (6% + 15% → 15%, not 21%) and does NOT affect the dietitian's commission.
-- Proposed to Christos, not yet confirmed (Q1/Q2), built as the default:
--    • the customer gets the LARGER of voucher / dietitian discount;
--    • commission base = items value BEFORE any discount, counted once paid.
--
-- 1. partners.envelope_bps — the total % Fitpal gives the dietitian (default
--    12%). For every non-internal partner: commission = envelope − discount,
--    enforced by triggers on partners (defaults) and partner_clients (per
--    client), whoever writes the row (admin, portal, referral, create-client).
-- 2. Changing a partner's envelope re-derives all its non-ended client links.
-- 3. partner_set_client_discount(p_client, p_discount_bps) — the dietitian
--    sets a client's discount within the envelope (future orders; rates are
--    frozen on each order at submit).
-- 4. partner_commission_lines: base = subtotal × paid share (was: money
--    collected, i.e. after the voucher).
-- 5. partner_orders.commissionExpected on the subtotal.
-- 6. recompute_order_money: a voucher on the order means no dietitian
--    discount (submit-order already picked the larger one).
-- 7. my_partner() returns envelope_bps.
-- ============================================================================

-- 1 ───────────────────────────────────────────────────────────────────────
alter table public.partners add column if not exists envelope_bps int not null default 1200;
do $$ begin
  alter table public.partners add constraint partners_envelope_bps_chk check (envelope_bps between 0 and 5000);
exception when duplicate_object then null; end $$;

-- Backfill: today's defaults already describe the envelope (600 + 600 = 12%).
update public.partners
   set envelope_bps = least(5000, coalesce(default_commission_bps,0) + coalesce(default_discount_bps,0))
 where not is_internal and coalesce(default_commission_bps,0) + coalesce(default_discount_bps,0) > 0;

create or replace function public.trg_partners_envelope()
 returns trigger language plpgsql set search_path to 'public' as $$
begin
  if not new.is_internal then
    new.default_discount_bps := least(greatest(coalesce(new.default_discount_bps,0),0), new.envelope_bps);
    new.default_commission_bps := new.envelope_bps - new.default_discount_bps;
  end if;
  return new;
end $$;
create or replace trigger partners_envelope before insert or update on public.partners
  for each row execute function public.trg_partners_envelope();

create or replace function public.trg_partner_clients_split()
 returns trigger language plpgsql set search_path to 'public' as $$
declare v_env int; v_internal boolean;
begin
  select envelope_bps, is_internal into v_env, v_internal from partners where id = new.partner_id;
  if v_env is not null and not coalesce(v_internal,false) then
    new.discount_bps := least(greatest(coalesce(new.discount_bps,0),0), v_env);
    new.commission_bps := v_env - new.discount_bps;
  end if;
  return new;
end $$;
create or replace trigger partner_clients_split before insert or update of discount_bps, commission_bps, partner_id on public.partner_clients
  for each row execute function public.trg_partner_clients_split();

-- 2 ───────────────────────────────────────────────────────────────────────
create or replace function public.trg_partners_envelope_cascade()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.envelope_bps is distinct from old.envelope_bps then
    update partner_clients set discount_bps = discount_bps
     where partner_id = new.id and status <> 'inactive';
  end if;
  return null;
end $$;
create or replace trigger partners_envelope_cascade after update of envelope_bps on public.partners
  for each row execute function public.trg_partners_envelope_cascade();

-- Normalise existing links to the invariant (no-op where already equal).
update public.partner_clients pc set discount_bps = pc.discount_bps
  from public.partners p
 where p.id = pc.partner_id and not p.is_internal and pc.status <> 'inactive'
   and pc.discount_bps + pc.commission_bps <> p.envelope_bps;

-- 3 ───────────────────────────────────────────────────────────────────────
create or replace function public.partner_set_client_discount(p_client uuid, p_discount_bps int)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pid uuid := public.current_partner_id(); v_p partners; v_link partner_clients;
begin
  if v_pid is null then raise exception 'not a partner' using errcode = '42501'; end if;
  select * into v_p from partners where id = v_pid;
  if v_p.is_internal then
    raise exception 'Η έκπτωση ορίζεται μόνο από διαιτολόγους-συνεργάτες.' using errcode = '22023';
  end if;
  if p_discount_bps is null or p_discount_bps < 0 or p_discount_bps > v_p.envelope_bps then
    raise exception using errcode = '22023',
      message = 'Η έκπτωση πρέπει να είναι από 0% έως ' || trim_scale(v_p.envelope_bps / 100.0) || '%.';
  end if;
  update partner_clients set discount_bps = p_discount_bps
   where partner_id = v_pid and client_user_id = p_client and status in ('active','pending')
   returning * into v_link;
  if v_link.id is null then raise exception 'no access to this client' using errcode = '42501'; end if;
  return jsonb_build_object('discountBps', v_link.discount_bps, 'commissionBps', v_link.commission_bps,
                            'envelopeBps', v_p.envelope_bps);
end $$;
revoke execute on function public.partner_set_client_discount(uuid, int) from public, anon;
grant execute on function public.partner_set_client_discount(uuid, int) to authenticated;

-- 4 ───────────────────────────────────────────────────────────────────────
create or replace function public.partner_commission_lines(p_partner uuid, p_from date, p_to date)
 returns table(source_type text, source_id uuid, client_user_id uuid, client_name text, ref text, occurred_at timestamp with time zone, gross integer, base integer, rate_bps integer, commission integer, paid_out integer, outstanding integer, payment_method text, payment_status text, order_status text)
 language sql stable security definer set search_path to 'public'
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
  -- WEC-870: base = items value BEFORE any discount (voucher or dietitian),
  -- in proportion to what was actually paid (refunds reduce it). Wallet
  -- orders earn nothing (the commission was earned on the plan).
  o as (
    select id, user_id, cname, order_number, at, total,
           (case
              when pm = 'wallet' then 0
              when total <= 0 then case when os <> 'cancelled' and ps = 'paid' then subtotal else 0 end
              else round(subtotal * least(1.0, paid_net::numeric / total))
            end)::int as base,
           bps, pm, ps, os
      from o1
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
$function$;
revoke execute on function public.partner_commission_lines(uuid, date, date) from public, anon, authenticated;

-- 5 ───────────────────────────────────────────────────────────────────────
create or replace function public.partner_orders(p_client uuid default null::uuid, p_from date default null::date, p_to date default null::date)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_pid uuid := public.current_partner_id(); v_internal boolean;
begin
  if v_pid is null then raise exception 'not a partner' using errcode = '42501'; end if;
  select is_internal into v_internal from partners where id = v_pid;
  if p_client is not null and not public.partner_can_access(p_client) then
    raise exception 'no access to this client' using errcode = '42501';
  end if;
  if p_client is null and v_internal then
    raise exception 'pick a client' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(ord order by ord->>'firstDate' desc, ord->>'orderNumber' desc) from (
      select jsonb_build_object(
        'id', o.id, 'orderNumber', o.order_number, 'userId', o.user_id,
        'clientName', coalesce(pr.name, o.customer_name), 'status', o.status, 'paymentMethod', o.payment_method,
        'paymentStatus', o.payment_status, 'subtotal', o.subtotal, 'total', o.total,
        'partnerDiscount', o.partner_discount_amount, 'placedBy', o.placed_by_role,
        'commissionExpected', case
            when coalesce(v_internal, false) or o.partner_id is distinct from v_pid then null
            when o.payment_method = 'wallet' or o.status = 'cancelled' then 0
            else round(coalesce(o.subtotal, 0) * coalesce(o.partner_commission_bps, 0) / 10000.0)::int end,
        'commissionBps', case when o.partner_id = v_pid and not coalesce(v_internal, false) then o.partner_commission_bps end,
        'firstDate', (select min(delivery_date) from child_orders where order_id = o.id),
        'target', (select jsonb_build_object('kcal', t.kcal, 'protein', t.protein, 'carbs', t.carbs, 'fat', t.fat)
                     from client_targets t where t.user_id = o.user_id),
        'days', (select jsonb_agg(jsonb_build_object(
                    'date', co.delivery_date, 'cancelled', co.cancelled_at is not null,
                    'fulfillment', co.fulfillment_type, 'pickupLocationId', co.pickup_location_id,
                    'area', co.address_area, 'zip', co.address_zip, 'street', co.address_street,
                    'timeFrom', co.time_from, 'timeTo', co.time_to,
                    'zoneName', (select dz.name_el from delivery_zones dz where co.address_zip = any(dz.postcodes) limit 1),
                    'amount', (select coalesce(sum(oi.total_price), 0) from order_items oi where oi.child_order_id = co.id),
                    'totals', (select jsonb_build_object(
                                 'kcal', coalesce(sum(oi.calories * oi.quantity),0),
                                 'protein', coalesce(sum(oi.protein * oi.quantity),0),
                                 'carbs', coalesce(sum(oi.carbs * oi.quantity),0),
                                 'fat', coalesce(sum(oi.fat * oi.quantity),0))
                               from order_items oi where oi.child_order_id = co.id),
                    'items', (select jsonb_agg(jsonb_build_object('name', oi.name_el, 'variant', oi.variant_label_el,
                                 'qty', oi.quantity, 'kcal', oi.calories, 'protein', oi.protein, 'carbs', oi.carbs,
                                 'fat', oi.fat, 'comment', oi.comment, 'price', oi.total_price,
                                 'desc', (select d.desc_el from dishes d where d.id = oi.dish_id)))
                              from order_items oi where oi.child_order_id = co.id)
                  ) order by co.delivery_date)
                  from child_orders co where co.order_id = o.id)
      ) ord
      from orders o
      left join profiles pr on pr.id = o.user_id
     where o.status <> 'draft'
       and o.user_id is not null
       and (case when p_client is not null then o.user_id = p_client
                 else o.user_id in (select client_user_id from partner_clients where partner_id = v_pid and status = 'active') end)
       and (p_from is null or exists (select 1 from child_orders c2 where c2.order_id = o.id and c2.delivery_date >= p_from))
       and (p_to   is null or exists (select 1 from child_orders c3 where c3.order_id = o.id and c3.delivery_date <= p_to))
     limit 300
    ) s
  ), '[]'::jsonb);
end $function$;

-- 6 ───────────────────────────────────────────────────────────────────────
create or replace function public.recompute_order_money(p_order_id uuid)
 returns table(old_subtotal integer, old_discount integer, old_total integer, new_subtotal integer, new_discount integer, new_total integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_subtotal int;
  v_discount int;
  v_voucher int;
  v_manual int;
  v_partner_bps int;
  v_partner int;
  v_old_subtotal int; v_old_discount int; v_old_total int;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'recompute_order_money: admin only';
  end if;

  select coalesce(o.subtotal,0), coalesce(o.discount_amount,0), coalesce(o.total,0), coalesce(o.manual_discount,0),
         coalesce(o.partner_discount_bps,0)
    into v_old_subtotal, v_old_discount, v_old_total, v_manual, v_partner_bps
    from orders o where o.id = p_order_id;

  select coalesce(sum(oi.total_price),0) into v_subtotal
    from order_items oi
    join child_orders co on co.id = oi.child_order_id
    where co.order_id = p_order_id and co.cancelled_at is null;

  update voucher_uses vu
     set amount = sub.new_amount
  from (
    select vu2.id as vu_id,
      case
        when v.min_order is not null and v_subtotal < v.min_order then 0
        when v.type = 'pct' then round((
            select coalesce(sum(oi.total_price),0)
            from order_items oi
            join child_orders co on co.id = oi.child_order_id
            left join dishes d on d.id = oi.dish_id
            where co.order_id = p_order_id and co.cancelled_at is null
              and (v.applicable_category_ids is null
                   or array_length(v.applicable_category_ids,1) is null
                   or d.category_id = any(v.applicable_category_ids))
          ) * v.value / 100.0)::int
        when v.type = 'fixed' then least(v.value, v_subtotal)::int
        else vu2.amount
      end as new_amount
    from voucher_uses vu2
    join vouchers v on v.id = vu2.voucher_id
    where vu2.order_id = p_order_id
  ) sub
  where vu.id = sub.vu_id;

  select coalesce(sum(amount),0) into v_voucher
    from voucher_uses where order_id = p_order_id;

  v_discount := v_voucher + greatest(coalesce(v_manual,0), 0);
  v_discount := least(greatest(v_discount,0), v_subtotal);

  -- WEC-870: voucher and dietitian discount never stack. submit-order kept
  -- only the larger; a voucher still on the order means the voucher won.
  if v_voucher > 0 then
    v_partner := 0;
  else
    v_partner := round(v_subtotal * v_partner_bps / 10000.0)::int;
    v_partner := least(greatest(v_partner, 0), v_subtotal);
  end if;
  if v_discount + v_partner > v_subtotal then
    v_discount := greatest(0, v_subtotal - v_partner);
  end if;

  update orders set
    subtotal = v_subtotal,
    discount_amount = v_discount,
    partner_discount_amount = v_partner,
    total = greatest(0, v_subtotal - v_discount - v_partner),
    updated_at = now()
   where id = p_order_id;

  return query select v_old_subtotal, v_old_discount, v_old_total,
                      v_subtotal, v_discount, greatest(0, v_subtotal - v_discount - v_partner);
end $function$;

-- 7 ───────────────────────────────────────────────────────────────────────
create or replace function public.my_partner()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select to_jsonb(x) from (
    select p.id, p.name, p.is_internal, p.features, p.default_commission_bps, p.default_discount_bps, p.envelope_bps,
           case when coalesce((p.features->>'referral')::boolean,false) then p.referral_code end as referral_code
      from partners p where p.id = public.current_partner_id()
  ) x
$function$;
