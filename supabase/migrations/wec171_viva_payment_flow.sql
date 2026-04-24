-- WEC-171 — Viva Payments: extend payment_links, add orders.refund_amount,
-- add webhook_events dedupe table.
--
-- Applied: 2026-04-24
-- Part of WEC-125 epic (Viva Payments integration).

-- ── payment_links: new columns for the Viva order lifecycle ────────────────
-- viva_ref_code (bigint) is kept for historical rows. viva_order_code is the
-- new canonical identifier; Viva returns it as a 16-digit string.

alter table payment_links
  add column if not exists viva_order_code   text,
  add column if not exists transaction_id    text,
  add column if not exists status_id         text,
  add column if not exists last_verified_at  timestamptz;

create index if not exists idx_payment_links_viva_order_code
  on payment_links (viva_order_code)
  where viva_order_code is not null;

create index if not exists idx_payment_links_transaction_id
  on payment_links (transaction_id)
  where transaction_id is not null;

comment on column payment_links.viva_order_code is
  'Viva orderCode (16 digits). Returned by POST /checkout/v2/orders.';
comment on column payment_links.transaction_id is
  'Viva transactionId. Populated after payment completes.';
comment on column payment_links.status_id is
  'Last observed Viva statusId: F=finalized, E=error, A=authorised, X=cancelled.';
comment on column payment_links.last_verified_at is
  'Timestamp of the last Retrieve Transaction call against Viva for this row.';

-- ── orders.refund_amount ───────────────────────────────────────────────────

alter table orders
  add column if not exists refund_amount int not null default 0;

comment on column orders.refund_amount is
  'Cumulative refund amount in cents. payment_status flips to refunded when refund_amount >= total.';

-- ── webhook_events: provider-agnostic dedupe log ───────────────────────────

create table if not exists webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  message_id    text not null,
  event_type_id int,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  payload       jsonb,
  unique (provider, message_id)
);

create index if not exists idx_webhook_events_provider_received
  on webhook_events (provider, received_at desc);

comment on table webhook_events is
  'Dedupe log for provider webhooks (Viva now, future providers later). Unique (provider, message_id).';

-- RLS: webhook_events is server-role only. Enable RLS with no policies so
-- anon / authenticated clients cannot read or write.
alter table webhook_events enable row level security;
