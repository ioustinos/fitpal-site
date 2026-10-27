-- WEC-884 · recover the submit time that RLS silently dropped · 27/10/2026
--
-- submit-order.ts stamps orders.submitted_at with the USER's supabase client.
-- The only UPDATE policy on public.orders is admin_all_orders (is_admin()), so
-- for a signed-in non-admin customer the UPDATE matched zero rows. Supabase
-- treats a zero-row UPDATE as success, so the surrounding try/catch never fired
-- and the failure was completely silent. 355 of 403 signed-in customer orders
-- (88%) had submitted_at = NULL; guest and admin orders (service-role client)
-- were at 0%.
--
-- Recovery source: child_orders are INSERTed during submit, never at draft
-- creation. Validated against the 685 orders that DO have submitted_at --
-- mean deviation from min(child_orders.created_at) was 1.0 second and 100%
-- were within 10 seconds. So this is an exact reconstruction, not an estimate.
--
-- trg_orders_flag_airtable_dirty marks any touched row for re-push; left on it
-- would re-send 355 orders to Airtable for a column Airtable only uses as a
-- display fallback. Disabled for the statement, same as the WEC-814 backfill.
--
-- Applied via MCP 27/10/2026. Result: 0 rows left with submitted_at NULL,
-- 0 rows where submitted_at < created_at, airtable_dirty unchanged at 2.

alter table public.orders disable trigger trg_orders_flag_airtable_dirty;

update public.orders o
   set submitted_at = c.first_child
  from (
    select order_id, min(created_at) as first_child
      from public.child_orders
     group by order_id
  ) c
 where c.order_id = o.id
   and o.submitted_at is null
   and o.status <> 'draft'
   and o.order_number is not null;

alter table public.orders enable trigger trg_orders_flag_airtable_dirty;
