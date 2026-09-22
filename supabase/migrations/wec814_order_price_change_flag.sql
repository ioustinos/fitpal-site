-- WEC-814 · flag orders whose price moved after the customer agreed to it.
--
-- Why: an order's total can change long after submit — an admin edits a
-- quantity, swaps a variant, cancels a day, applies a manual discount
-- (WEC-803), or a voucher lands late. Nothing ever told anyone. When money was
-- already collected the difference is real money: either the customer owes
-- more, or Fitpal owes them a refund or a voucher. Until now that was only
-- found by accident, one order at a time.
--
-- Design note: the flag is DERIVED, not stored. A boolean the application
-- maintains drifts the first time a code path forgets to set it — that is how
-- the Airtable dirty-flag loop (WEC-789) and the hardcoded reconcile audit
-- value both happened. A generated column cannot disagree with the money it
-- describes.

alter table public.orders
  add column if not exists original_total    int,
  add column if not exists price_review_at   timestamptz,
  add column if not exists price_review_by   text,
  add column if not exists price_review_note text;

comment on column public.orders.original_total is
  'WEC-814: orders.total at the moment of submit — the price the customer agreed to. Written once by submit-order and never again. NULL only for pre-WEC-814 rows the backfill could not reconstruct.';
comment on column public.orders.price_review_at is
  'WEC-814: when an admin cleared the price-change flag. NULL together with price_changed = still in the review queue.';
comment on column public.orders.price_review_by is
  'WEC-814: admin email that cleared the flag.';
comment on column public.orders.price_review_note is
  'WEC-814: optional free text — what the admin did about the difference (charged, refunded, voucher, accepted).';

-- Derived from the two numbers themselves, so it can never be stale.
alter table public.orders
  add column if not exists price_changed boolean
  generated always as (original_total is not null and total is distinct from original_total) stored;

comment on column public.orders.price_changed is
  'WEC-814: derived — the total differs from the submitted price. Deliberately not writable.';

-- The admin filter only ever asks for the open queue, so index exactly that
-- rather than the whole column.
create index if not exists idx_orders_price_needs_review
  on public.orders (updated_at desc)
  where price_changed and price_review_at is null;

-- ── Freezing the submitted price ───────────────────────────────────────────
--
-- Done in the DB, not in submit-order.ts, on purpose. There are three ways an
-- order reaches 'pending': the legacy INSERT in submit-order, the
-- promote_draft_atomic RPC (the main customer path), and an admin creating one
-- directly. The RPC updates an explicit whitelist of columns, so a field added
-- to the TypeScript record would have been silently dropped on exactly the
-- busiest path — shipped-looking and broken, the WEC-553/557/580 pattern.
--
-- A BEFORE trigger catches all three and any path added later. The `is null`
-- guard makes it write-once: once frozen, nothing re-freezes it, so an edit
-- can never quietly redefine what the customer originally agreed to.
create or replace function public.freeze_original_total()
returns trigger
language plpgsql
as $$
begin
  if new.original_total is null and new.status <> 'draft' then
    new.original_total := new.total;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_freeze_original_total on public.orders;
create trigger trg_orders_freeze_original_total
  before insert or update on public.orders
  for each row execute function public.freeze_original_total();

-- If the price moves AGAIN after a review, that review is stale: the admin
-- signed off on a number that no longer applies. Re-open it, rather than let a
-- second change hide behind the first sign-off.
--
-- The `price_review_at is not distinct from old.price_review_at` guard means
-- an admin who reviews and edits in the same statement is not immediately
-- undone — only a total change that arrives WITHOUT a fresh review re-opens it.
create or replace function public.reopen_price_review()
returns trigger
language plpgsql
as $$
begin
  if new.total is distinct from old.total
     and new.price_review_at is not distinct from old.price_review_at then
    new.price_review_at   := null;
    new.price_review_by   := null;
    new.price_review_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_reopen_price_review on public.orders;
create trigger trg_orders_reopen_price_review
  before update on public.orders
  for each row execute function public.reopen_price_review();

-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- admin_change_log records every total change with its old value, so the
-- EARLIEST such row for an order carries the price it was submitted at. An
-- order with no recorded total change never moved, so its current total IS its
-- original.
--
-- Limitation, stated plainly: this only sees changes made through the admin UI
-- (everything routed via writeChangeLog). A total changed by a direct DB write
-- leaves no trace and will read here as "never changed". 30 orders currently
-- have a logged total change.
--
-- The `~ '^-?[0-9]+$'` guard skips any malformed old_value rather than failing
-- the whole statement on one bad row.
--
-- ⚠ Both BEFORE UPDATE triggers on `orders` must be off for this statement:
--
--   trg_orders_flag_airtable_dirty — sets airtable_dirty := true on ANY update
--     to an already-synced order. Left on, this backfill would re-flag all ~282
--     orders and the reconcile would re-push the entire order history to
--     Airtable, 50 per run, churning Updated At on every record for hours.
--
--   set_updated_at — stamps updated_at = now() unconditionally, which would
--     make every order look edited today and reshuffle any recency ordering.
--
-- Neither has anything to do with a backfilled historical column. This whole
-- migration runs in one transaction, so a failure rolls the disables back with
-- everything else — the triggers cannot be left off.
alter table public.orders disable trigger trg_orders_flag_airtable_dirty;
alter table public.orders disable trigger set_updated_at;

update public.orders o
   set original_total = coalesce(
     (select acl.old_value::int
        from public.admin_change_log acl
       where acl.order_id   = o.id
         and acl.table_name = 'orders'
         and acl.field_name = 'total'
         and acl.old_value ~ '^-?[0-9]+$'
       order by acl.created_at asc
       limit 1),
     o.total)
 where o.original_total is null
   -- Drafts are not submitted, so they have no agreed price yet. Leave them
   -- NULL and let freeze_original_total() set it when they promote.
   and o.status <> 'draft';

alter table public.orders enable trigger trg_orders_flag_airtable_dirty;
alter table public.orders enable trigger set_updated_at;
