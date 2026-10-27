-- WEC-885 (part 2) · partner_orders.commissionExpected on the NET amount
--
-- partner_commission_lines (the money that actually gets paid out) moved to a
-- net base in wec885. This is the figure the dietitian sees per order in the
-- portal; if it stayed gross the portal would promise ~11.5% more than the
-- payout statement delivers — exactly the mismatch a partner notices first.
-- Only the commissionExpected expression changed; the rest of the body is
-- reproduced verbatim from the live definition. Applied via MCP 27/10/2026.

CREATE OR REPLACE FUNCTION public.partner_orders(p_client uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- WEC-885: net of VAT, matching partner_commission_lines.
        'commissionExpected', case
            when coalesce(v_internal, false) or o.partner_id is distinct from v_pid then null
            when o.payment_method = 'wallet' or o.status = 'cancelled' then 0
            else round(public.net_of_vat(coalesce(o.subtotal, 0)) * coalesce(o.partner_commission_bps, 0) / 10000.0)::int end,
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
end $function$
;
