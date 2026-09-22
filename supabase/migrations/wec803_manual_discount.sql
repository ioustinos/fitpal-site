-- WEC-803: admin can add a MANUAL discount to an order, including after it has
-- been confirmed. Stacks on top of any voucher discount and survives the
-- recompute that runs on every admin item edit (voucher discounts are derived,
-- so a manual amount could never live in discount_amount before this).

alter table public.orders
  add column if not exists manual_discount int not null default 0,   -- cents, admin-added
  add column if not exists manual_discount_note text;                -- optional reason (goodwill, complaint…)

-- recompute_order_money: identical to WEC-605 except the manual discount is
-- folded in on top of the voucher total, before the ≤ subtotal cap.
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
  v_manual int;
  v_old_subtotal int; v_old_discount int; v_old_total int;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'recompute_order_money: admin only';
  end if;

  select coalesce(o.subtotal,0), coalesce(o.discount_amount,0), coalesce(o.total,0), coalesce(o.manual_discount,0)
    into v_old_subtotal, v_old_discount, v_old_total, v_manual
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

  -- WEC-803: manual admin discount stacks on top of voucher discounts.
  v_discount := v_discount + greatest(coalesce(v_manual,0), 0);

  -- Guards: total discount never exceeds subtotal; total never below zero.
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
