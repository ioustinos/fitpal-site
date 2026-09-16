-- WEC-783: subscription dates that actually exist.
--
-- The wizard asked the customer when they wanted to start, kept the answer in
-- localStorage, and dropped it at purchase — buildInput() never sent it and
-- there was no column to put it in. Meanwhile the UI displayed
-- wallet_plans.created_at under the label «Ημερομηνία έναρξης», so the end date
-- and the «days left» countdown both ran from the PAYMENT, not the first
-- delivery.
--
-- meal_services was the table originally meant to hold this (it has its own
-- start_date/end_date) but it has never had a single row, so the plan owns
-- these dates instead.
--
-- ⚠️ ALL THREE ARE INFORMATIONAL. Ioustinos, 17/09: «αν θελήσει ο πελάτης να
-- φάει νωρίτερα δεν θα πρέπει να υπάρχει blocker». Nothing reads these to allow
-- or deny anything — wallet_debit_for_order still checks only that the wallet
-- exists and the balance covers the amount.
alter table public.wallet_plans
  add column if not exists start_date   date,
  add column if not exists active_until date,
  add column if not exists admin_note   text;

comment on column public.wallet_plans.start_date is
  'WEC-783: the date the CUSTOMER chose to start, from the wizard. Null on plans bought before this existed, and on purchases where no date was picked. Display only — never gates ordering.';
comment on column public.wallet_plans.active_until is
  'WEC-783: ops-facing «Ενεργή έως». Seeded at purchase from start_date + plan_length_weeks, then freely editable by an admin (e.g. to record a pause). Display only.';
comment on column public.wallet_plans.admin_note is
  'WEC-783: free-text ops note, e.g. «παύση 12–19/10, παράταση 1 εβδομάδα». Never shown to the customer.';
