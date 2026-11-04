-- WEC-901: admin-only per-delivery-day comment on child orders.
-- Distinct from child_orders.address_notes (the customer's "Address Comment").
-- Nullable, no default -> no backfill needed. The existing
-- trg_child_orders_flag_airtable_dirty marks the parent order dirty on update,
-- so an edited comment reaches Airtable on the next reconcile cycle.
alter table public.child_orders add column if not exists delivery_comment text;
comment on column public.child_orders.delivery_comment is
  'WEC-901: admin-only delivery comment for this delivery day. Never shown to the customer. Distinct from address_notes (customer address comment).';
