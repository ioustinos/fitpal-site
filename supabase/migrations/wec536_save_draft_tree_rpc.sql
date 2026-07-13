-- WEC-536: atomic draft-tree save. Replaces save-draft.ts's sequential
-- delete + N inserts (non-transactional — a mid-flight failure left partial
-- drafts, and overlapping trigger-B/C saves could interleave). One RPC =
-- one transaction + one network round trip. Dish name snapshot resolved
-- in-query (drops the separate dishes SELECT). Hash stamped in the same
-- transaction: on any failure NOTHING changes and the stale hash forces the
-- next save to rebuild — self-healing, per the WEC-536 design.
-- Applied to live dev DB 2026-07-13 via MCP.

create or replace function public.save_draft_tree(
  p_order_id uuid,
  p_days jsonb,
  p_cart_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.save_draft_tree(uuid, jsonb, text) from public;
grant execute on function public.save_draft_tree(uuid, jsonb, text) to service_role;
