-- WEC-489 follow-up: pickup_location_id is `text` (slug like 'fitpal-spot'),
-- not uuid. The old ::uuid cast in promote_draft_atomic was silently broken
-- since WEC-429 #2 (May) — only surfaced once WEC-489 unblocked the submit
-- button on pickup days. First real pickup promote attempt failed with
-- `invalid input syntax for type uuid: "fitpal-spot"`. Same body, one cast
-- removed.
--
-- Applied to dev DB 2026-06-23 via the Supabase MCP.

CREATE OR REPLACE FUNCTION public.promote_draft_atomic(p_order_id uuid, p_order_patch jsonb, p_children jsonb)
RETURNS TABLE(promoted_order_id uuid, was_already_promoted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
      fulfillment_type, pickup_location_id
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
      nullif(v_child_record->>'pickup_location_id','')   -- text; was ::uuid (broken)
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
    updated_at     = now()
  where id = p_order_id;

  promoted_order_id := p_order_id; was_already_promoted := false; return next;
end;
$function$;
