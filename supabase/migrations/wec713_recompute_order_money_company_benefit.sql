-- ============================================================================
-- WEC-713 (B2B-5: Company Benefit, per delivery day)
-- Applied to rhwetztxwjxfstffalwl on 2026-09-06.
--
-- `recompute_order_money` is the ONE place admin edits re-derive an order's
-- money (item edits, day cancel, day restore all route through it). The
-- company benefit has to live here too, or an admin edit would silently drop
-- it — and the company would be invoiced for a benefit the customer never got.
--
-- Rules encoded here:
--   * benefit is PER DELIVERY DAY, read from store_settings.company_benefit
--     (cents) for the order's store; absent -> 0, so retail is unaffected
--   * a cancelled day accrues nothing (cancel Wednesday -> benefit drops)
--   * a day's benefit never exceeds that day's own subtotal
--   * child_orders.company_benefit_amount rows are the SOURCE OF TRUTH for
--     invoicing, so they are never scaled down to make the arithmetic fit;
--     if voucher + benefit would exceed the subtotal it is the VOUCHER that
--     gets squeezed, not the company's contribution
--   * orders.discount_amount is NEVER touched by the benefit — the two are
--     separate amounts because the company reimburses one of them
--
-- The RETURNS TABLE signature is unchanged (callers read those six columns);
-- new_total now accounts for the benefit.
--
-- ROLLBACK: re-create the previous definition (WEC-605/608 era) — the same
-- body without the v_benefit block.
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
  v_benefit int;
  v_benefit_per_day int;
  v_old_subtotal int; v_old_discount int; v_old_total int;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'recompute_order_money: admin only';
  end if;

  select coalesce(o.subtotal,0), coalesce(o.discount_amount,0), coalesce(o.total,0)
    into v_old_subtotal, v_old_discount, v_old_total
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

  v_discount := least(greatest(v_discount,0), v_subtotal);

  -- WEC-713: per-delivery-day company benefit.
  -- store_settings.company_benefit is jsonb; #>> '{}' unwraps a bare number.
  select coalesce(nullif(ss.value #>> '{}', '')::int, 0)
    into v_benefit_per_day
    from orders o
    left join store_settings ss
      on ss.store_id = o.store_id and ss.key = 'company_benefit'
   where o.id = p_order_id;
  v_benefit_per_day := coalesce(v_benefit_per_day, 0);

  update child_orders co
     set company_benefit_amount = case
       when co.cancelled_at is not null then 0
       else least(
         v_benefit_per_day,
         coalesce((select sum(oi.total_price) from order_items oi where oi.child_order_id = co.id), 0)
       )
     end
   where co.order_id = p_order_id;

  select coalesce(sum(company_benefit_amount),0) into v_benefit
    from child_orders where order_id = p_order_id and cancelled_at is null;

  if v_discount + v_benefit > v_subtotal then
    v_discount := greatest(0, v_subtotal - v_benefit);
  end if;

  update orders set
    subtotal = v_subtotal,
    discount_amount = v_discount,
    total = greatest(0, v_subtotal - v_discount - v_benefit),
    updated_at = now()
   where id = p_order_id;

  return query select v_old_subtotal, v_old_discount, v_old_total,
                      v_subtotal, v_discount, greatest(0, v_subtotal - v_discount - v_benefit);
end $function$;
