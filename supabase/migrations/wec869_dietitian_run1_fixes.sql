-- WEC-869 (dietitian test run 1 — fixes and decisions).

-- 3.3 + 7.2 — referral claim.
--  • Staff (admins, dietitian logins) never become clients through a referral
--    link: the +diet login became a client of its own dietitian in the test.
--  • «Existing customer» = the account existed before the visitor opened the
--    link (p_clicked_at), not «has orders». Existing → pending until Fitpal
--    approves (the visitor's own click counts as their acceptance). Without a
--    click time (old client), an account older than 1 hour counts as existing.
create or replace function public.claim_partner_referral(p_code text, p_clicked_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p partners; v_created timestamptz; v_existing boolean;
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  if coalesce(public.is_admin(), false)
     or exists (select 1 from partner_users where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'staff');
  end if;
  select * into v_p from partners
   where lower(referral_code) = lower(trim(p_code)) and active and coalesce((features->>'referral')::boolean,false);
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if exists (select 1 from partner_clients where client_user_id = auth.uid() and status <> 'inactive') then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;
  select created_at into v_created from auth.users where id = auth.uid();
  v_existing := exists (select 1 from orders where user_id = auth.uid() and status <> 'draft')
             or v_created < coalesce(least(p_clicked_at, now()), now() - interval '1 hour') - interval '1 minute';
  if v_existing then
    insert into partner_clients (partner_id, client_user_id, status, discount_bps, commission_bps, created_via, created_by, client_confirmed_at)
    values (v_p.id, auth.uid(), 'pending', v_p.default_discount_bps, v_p.default_commission_bps, 'referral', auth.uid(), now());
    return jsonb_build_object('ok', true, 'partnerName', v_p.name, 'status', 'pending');
  end if;
  insert into partner_clients (partner_id, client_user_id, status, discount_bps, commission_bps, created_via, created_by, client_confirmed_at, approved_at)
  values (v_p.id, auth.uid(), 'active', v_p.default_discount_bps, v_p.default_commission_bps, 'referral', auth.uid(), now(), now());
  return jsonb_build_object('ok', true, 'partnerName', v_p.name, 'status', 'active');
end $$;
revoke execute on function public.claim_partner_referral(text, timestamptz) from public, anon;
grant execute on function public.claim_partner_referral(text, timestamptz) to authenticated;
-- The old one-argument form (pages still open from before this deploy) runs
-- the same rules, with no click time.
create or replace function public.claim_partner_referral(p_code text)
returns jsonb language sql security definer set search_path = public as $$
  select public.claim_partner_referral(p_code, null::timestamptz)
$$;

-- 6.4 — tell the dietitian, while typing, that an email already has an
-- account. Yes/no only: never any of that customer's details.
create or replace function public.partner_email_exists(p_email text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_partner_id() is null then raise exception 'not a partner' using errcode = '42501'; end if;
  return exists (select 1 from profiles where lower(email) = lower(trim(p_email)));
end $$;
revoke execute on function public.partner_email_exists(text) from public, anon;
grant execute on function public.partner_email_exists(text) to authenticated;

-- 9.1 — a payout always carries a reference.
create or replace function public.admin_partner_mark_paid(p_partner uuid, p_lines jsonb, p_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_payout uuid; v_total int := 0; r record;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_reference, '')), '') is null then
    raise exception 'Η αναφορά πληρωμής είναι υποχρεωτική. · A payment reference is required.' using errcode = '22023';
  end if;
  insert into partner_payouts (partner_id, amount, reference, note, created_by)
  values (p_partner, 0, trim(p_reference), p_note, auth.uid()) returning id into v_payout;
  for r in
    select l.source_type, l.source_id, l.outstanding
      from public.partner_commission_lines(p_partner, null, null) l
      join jsonb_to_recordset(p_lines) as x(source_type text, source_id uuid)
        on x.source_type = l.source_type and x.source_id = l.source_id
     where l.outstanding <> 0
  loop
    insert into partner_payout_items (payout_id, source_type, source_id, amount)
    values (v_payout, r.source_type, r.source_id, r.outstanding);
    v_total := v_total + r.outstanding;
  end loop;
  if v_total = 0 and not exists (select 1 from partner_payout_items where payout_id = v_payout) then
    raise exception 'nothing outstanding on the selected lines' using errcode = '22023';
  end if;
  update partner_payouts set amount = v_total where id = v_payout;
  return v_payout;
end $$;

-- 3.7 / 3.8 / 5.5 — orders: price per dish and per day, dish description,
-- expected commission per order (own orders of a non-internal partner;
-- wallet-paid = 0, the commission was earned on the plan).
create or replace function public.partner_orders(p_client uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
            else round(o.total * coalesce(o.partner_commission_bps, 0) / 10000.0)::int end,
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
end $$;
