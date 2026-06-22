-- WEC-473: orders.submitted_at — the moment the user actually submitted/promoted
-- the order (distinct from created_at, which is the draft/placement time).
-- Mirrored to Airtable as "Submitted at (GO)". Stamped in submit-order.ts.

alter table public.orders add column if not exists submitted_at timestamptz;

-- Backfill existing non-draft orders with created_at as a best-effort submit time.
update public.orders set submitted_at = created_at where status <> 'draft' and submitted_at is null;
