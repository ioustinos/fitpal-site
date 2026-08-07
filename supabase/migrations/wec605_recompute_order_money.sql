-- WEC-605: % voucher discounts were frozen at order-time value on admin edits.
-- recomputeOrderTotals carried orders.discount_amount forward unchanged, so a
-- 5% voucher on a basket that grew 75.80 → 85.70 stayed at 3.79 (should be 4.29),
-- and a voucher could outlive its min_order after removals.
--
-- Fix: recompute the money atomically in ONE function (implicit transaction) so
-- orders + voucher_uses can never diverge. pct vouchers re-derive from the (scope-
-- aware) eligible base; fixed vouchers stay absolute (capped to subtotal); credit
-- vouchers keep their applied amount. Every voucher is dropped to 0 while the
-- order subtotal is below its min_order, and re-applies automatically when the
-- basket climbs back (pct/fixed re-derive; credit restores only if still recorded).
--
-- SECURITY DEFINER + is_admin() guard: this bypasses RLS to touch orders +
-- voucher_uses, so it must only run for an admin caller.

create or replace function public.recompute_order_money(p_order_id uuid)
returns table(old_subtotal int, old_discount int, old_total int,
              new_subtotal int, new_discount int, new_total int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_subtotal int;
  v_discount int;
  v_old_subtotal int; v_old_discount int; v_old_total int;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'recompute_order_money: admin only';
  end if;

  select coalesce(o.subtotal,0), coalesce(o.discount_amount,0), coalesce(o.total,0)
    into v_old_subtotal, v_old_discount, v_old_total
    from orders o where o.id = p_order_id;

  -- Full subtotal = active (non-cancelled) child orders' items.
  select coalesce(sum(oi.total_price),0) into v_subtotal
    from order_items oi
    join child_orders co on co.id = oi.child_order_id
    where co.order_id = p_order_id and co.cancelled_at is null;

  -- Re-derive every applied voucher's amount against its own eligible base.
  -- Eligible base = full subtotal for unscoped vouchers, or the sum of items whose
  -- dish category is in applicable_category_ids for scoped ones (mirrors the
  -- customer's eligibleSubtotal, WEC-262). min_order gates on the full subtotal.
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
        else vu2.amount   -- credit: keep the recorded absolute amount
      end as new_amount
    from voucher_uses vu2
    join vouchers v on v.id = vu2.voucher_id
    where vu2.order_id = p_order_id
  ) sub
  where vu.id = sub.vu_id;

  select coalesce(sum(amount),0) into v_discount
    from voucher_uses where order_id = p_order_id;

  -- Guards: discount never exceeds subtotal; total never below zero.
  v_discount := least(greatest(v_discount,0), v_subtotal);

  update orders set
    subtotal = v_subtotal,
    discount_amount = v_discount,
    total = greatest(0, v_subtotal - v_discount),
    updated_at = now()
   where id = p_order_id;

  return query select v_old_subtotal, v_old_discount, v_old_total,
                      v_subtotal, v_discount, greatest(0, v_subtotal - v_discount);
end $$;

grant execute on function public.recompute_order_money(uuid) to authenticated;
