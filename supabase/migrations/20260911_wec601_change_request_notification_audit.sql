-- WEC-601: make "did the admins actually get the email?" answerable with a
-- query instead of a browser session in Brevo. The notification is fail-soft by
-- design, so without this the only trace of a failure was a console line in a
-- Netlify function log nobody reads. Applied 2026-09-11.
alter table public.order_change_requests
  add column if not exists admin_notified_at    timestamptz,
  add column if not exists customer_notified_at timestamptz,
  add column if not exists notify_error         text;

comment on column public.order_change_requests.admin_notified_at is
  'WEC-601: when the staff notification was accepted by Brevo. NULL = never delivered.';
comment on column public.order_change_requests.customer_notified_at is
  'WEC-601: when the customer acknowledgement was accepted by Brevo.';
comment on column public.order_change_requests.notify_error is
  'WEC-601: last notification failure reason, verbatim. NULL = no failure.';
