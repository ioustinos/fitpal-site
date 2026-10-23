-- Dev branch catch-up (run once in the DEV branch SQL editor).
-- The four functions below are byte-for-byte copies of production, and the
-- constraint matches production's (>= 0 instead of May's > 0).
-- Harmless on production too: every statement is identical to what is
-- already there, so running it on the wrong project changes nothing.

begin;

alter table public.dish_ingredients drop constraint if exists dish_ingredients_fixed_grams_check;
alter table public.dish_ingredients add constraint dish_ingredients_fixed_grams_check
  CHECK (((fixed_grams IS NULL) OR (fixed_grams >= (0)::numeric)));

CREATE OR REPLACE FUNCTION public.promote_draft_atomic(p_order_id uuid, p_order_patch jsonb, p_children jsonb)
 RETURNS TABLE(promoted_order_id uuid, was_already_promoted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_child_record jsonb;
  v_item_record  jsonb;
  v_new_child_id uuid;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'draft_not_found' using errcode = 'P0002'; end if;
  if v_status <> 'draft' then
    promoted_order_id := p_order_id; was_already_promoted := true; return next; return;
  end if;

  delete from public.child_orders where public.child_orders.order_id = p_order_id;

  for v_child_record in select * from jsonb_array_elements(p_children) loop
    insert into public.child_orders (
      order_id, delivery_date, time_from, time_to,
      address_street, address_area, address_zip, address_floor,
      address_doorbell, address_notes,
      fulfillment_type, pickup_location_id,
      company_benefit_amount
    ) values (
      p_order_id,
      (v_child_record->>'delivery_date')::date,
      nullif(v_child_record->>'time_from', '')::time,
      nullif(v_child_record->>'time_to', '')::time,
      v_child_record->>'address_street',
      v_child_record->>'address_area',
      v_child_record->>'address_zip',
      v_child_record->>'address_floor',
      v_child_record->>'address_doorbell',
      v_child_record->>'address_notes',
      coalesce(v_child_record->>'fulfillment_type', 'delivery'),
      nullif(v_child_record->>'pickup_location_id',''),   -- text; was ::uuid (broken)
      -- WEC-713: per-delivery-day company benefit, cents. Absent → 0.
      coalesce(nullif(v_child_record->>'company_benefit_amount','')::int, 0)
    ) returning id into v_new_child_id;

    for v_item_record in select * from jsonb_array_elements(v_child_record->'items') loop
      insert into public.order_items (
        child_order_id, dish_id, variant_id,
        name_el, name_en, variant_label_el, variant_label_en,
        quantity, unit_price, total_price,
        calories, protein, carbs, fat, comment
      ) values (
        v_new_child_id,
        v_item_record->>'dish_id',
        nullif(v_item_record->>'variant_id','')::text,
        v_item_record->>'name_el',
        v_item_record->>'name_en',
        v_item_record->>'variant_label_el',
        v_item_record->>'variant_label_en',
        (v_item_record->>'quantity')::int,
        (v_item_record->>'unit_price')::int,
        (v_item_record->>'total_price')::int,
        nullif(v_item_record->>'calories','')::int,
        nullif(v_item_record->>'protein','')::int,
        nullif(v_item_record->>'carbs','')::int,
        nullif(v_item_record->>'fat','')::int,
        v_item_record->>'comment'
      );
    end loop;
  end loop;

  update public.orders set
    status         = 'pending'::order_status,
    order_number   = p_order_patch->>'order_number',
    payment_status = 'pending'::payment_status,
    user_id        = nullif(p_order_patch->>'user_id','')::uuid,
    customer_name  = p_order_patch->>'customer_name',
    customer_email = p_order_patch->>'customer_email',
    customer_phone = p_order_patch->>'customer_phone',
    subtotal       = (p_order_patch->>'subtotal')::int,
    discount_amount= (p_order_patch->>'discount_amount')::int,
    total          = (p_order_patch->>'total')::int,
    payment_method = (p_order_patch->>'payment_method')::payment_method,
    cutlery        = (p_order_patch->>'cutlery')::boolean,
    invoice_type   = coalesce((p_order_patch->>'invoice_type')::invoice_type, 'none'::invoice_type),
    invoice_name   = p_order_patch->>'invoice_name',
    invoice_vat    = p_order_patch->>'invoice_vat',
    notes          = p_order_patch->>'notes',
    admin_order_id = nullif(p_order_patch->>'admin_order_id','')::uuid,
    -- WEC-712: the storefront this order was placed on. A patch without
    -- store_id leaves the existing value alone rather than nulling it.
    store_id       = coalesce(nullif(p_order_patch->>'store_id','')::uuid, public.orders.store_id),
    updated_at     = now()
  where id = p_order_id;

  promoted_order_id := p_order_id; was_already_promoted := false; return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_draft_tree(p_order_id uuid, p_days jsonb, p_cart_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day jsonb;
  v_item jsonb;
  v_child_id uuid;
  v_is_pickup boolean;
begin
  delete from public.child_orders where order_id = p_order_id;

  for v_day in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) loop
    v_is_pickup := (v_day->>'fulfillment_type') = 'pickup';

    insert into public.child_orders (
      order_id, delivery_date, time_from, time_to,
      address_street, address_area, address_zip, address_floor,
      fulfillment_type, pickup_location_id
    ) values (
      p_order_id,
      (v_day->>'delivery_date')::date,
      nullif(v_day->>'time_from','')::time,
      nullif(v_day->>'time_to','')::time,
      case when v_is_pickup then null else v_day->>'address_street' end,
      case when v_is_pickup then null else v_day->>'address_area' end,
      case when v_is_pickup then null else v_day->>'address_zip' end,
      case when v_is_pickup then null else v_day->>'address_floor' end,
      coalesce(v_day->>'fulfillment_type','delivery'),
      case when v_is_pickup then nullif(v_day->>'pickup_location_id','') else null end
    ) returning id into v_child_id;

    for v_item in select * from jsonb_array_elements(coalesce(v_day->'items','[]'::jsonb)) loop
      -- Drafts carry zero prices (WEC-416): promote re-resolves real prices.
      -- name_el falls back to the dish id slug if the dish row is gone.
      insert into public.order_items (
        child_order_id, dish_id, variant_id, name_el, name_en,
        quantity, unit_price, total_price, comment
      )
      select
        v_child_id,
        v_item->>'dish_id',
        nullif(v_item->>'variant_id',''),
        coalesce(d.name_el, v_item->>'dish_id'),
        d.name_en,
        (v_item->>'quantity')::int,
        0, 0,
        v_item->>'comment'
      from (select 1) as one
      left join public.dishes d on d.id = v_item->>'dish_id';
    end loop;
  end loop;

  update public.orders
  set draft_cart_hash = p_cart_hash, updated_at = now()
  where id = p_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unredeem_voucher_for_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_use record;
BEGIN
  -- Find the voucher_uses row for this order (if any).
  SELECT voucher_id, amount
    INTO v_use
    FROM public.voucher_uses
    WHERE order_id = p_order_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- no voucher was applied, nothing to undo
  END IF;

  -- Reverse the voucher counter changes.
  UPDATE public.vouchers
     SET uses_count = GREATEST(0, uses_count - 1),
         remaining  = CASE
                        WHEN type = 'credit'
                          THEN COALESCE(remaining, 0) + v_use.amount
                        ELSE remaining
                      END
   WHERE id = v_use.voucher_id;

  -- Delete the use row last so the counter reversal references it.
  DELETE FROM public.voucher_uses WHERE order_id = p_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unredeem_voucher_for_plan(p_wallet_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_use record;
begin
  select voucher_id, amount into v_use
    from public.voucher_uses where wallet_plan_id = p_wallet_plan_id for update;
  if not found then return; end if;
  update public.vouchers
     set uses_count = greatest(0, uses_count - 1),
         remaining  = case when type = 'credit'
                           then coalesce(remaining, 0) + v_use.amount
                           else remaining end
   where id = v_use.voucher_id;
  delete from public.voucher_uses where wallet_plan_id = p_wallet_plan_id;
end;
$function$;

revoke all on function public.promote_draft_atomic(uuid,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.promote_draft_atomic(uuid,jsonb,jsonb) to anon, authenticated, service_role;
revoke all on function public.save_draft_tree(uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.save_draft_tree(uuid,jsonb,text) to anon, authenticated, service_role;
revoke all on function public.unredeem_voucher_for_order(uuid) from public, anon, authenticated, service_role;
grant execute on function public.unredeem_voucher_for_order(uuid) to service_role;
revoke all on function public.unredeem_voucher_for_plan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.unredeem_voucher_for_plan(uuid) to public, anon, authenticated, service_role;

commit;

select 'dev catch-up done' as result;
