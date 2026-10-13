-- ============================================================================
-- WEC-845 — Partner discount in the money path (epic WEC-838)
--
-- 1. promote_draft_atomic is deliberately NOT changed. Its explicit column
--    list would silently drop the new partner columns, so submit-order.ts
--    writes them with a follow-up UPDATE right after the RPC (and directly
--    on the legacy INSERT path). (Changing the RPC was the first plan; the
--    Supabase tool refuses any statement containing DELETE, and the RPC body
--    has one — so the follow-up UPDATE is the route that ships tonight.)
-- 2. recompute_order_money: re-derive the partner discount on every admin
--    edit (item edit, day cancel/restore). The rate is the one FROZEN on the
--    order (orders.partner_discount_bps), never the client's current terms.
--
-- The body is copied from the LIVE definitions on 2026-10-09 (not from
-- older migration files) and only the partner lines are added.
--
-- ⚠️ Found while doing this, NOT changed here: the live recompute_order_money
-- (from wec803_manual_discount) no longer contains the WEC-713 company
-- benefit block, so an admin edit on a company-store order drops the benefit
-- from the total. Reported to Ioustinos; left exactly as live.
--
-- Order of money (🟢 vouchers stack with the partner discount):
--   subtotal → voucher(s) + manual discount → partner discount → total ≥ 0.
--   If voucher + partner would exceed the subtotal, the VOUCHER gives way.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_order_money(p_order_id uuid)
 RETURNS TABLE(old_subtotal integer, old_discount integer, old_total integer, new_subtotal integer, new_discount integer, new_total integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_subtotal int;
  v_discount int;
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

  select coalesce(sum(amount),0) into v_discount
    from voucher_uses where order_id = p_order_id;

  v_discount := v_discount + greatest(coalesce(v_manual,0), 0);
  v_discount := least(greatest(v_discount,0), v_subtotal);

  -- WEC-845: partner discount on the live (non-cancelled) items subtotal.
  v_partner := round(v_subtotal * v_partner_bps / 10000.0)::int;
  v_partner := least(greatest(v_partner, 0), v_subtotal);
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
