-- WEC-693: τιμολόγιο on a plan purchase was collected + VAT-validated, then discarded.
-- wallet_plans had no invoice columns; mirror the orders shape so accounting has a record.
alter table public.wallet_plans
  add column if not exists invoice_type text,   -- 'receipt' (απόδειξη) | 'invoice' (τιμολόγιο)
  add column if not exists invoice_name text,   -- επωνυμία
  add column if not exists invoice_vat  text;   -- ΑΦΜ (9-digit Greek VAT)

comment on column public.wallet_plans.invoice_type is 'WEC-693: receipt|invoice — whether the customer requested a τιμολόγιο';
comment on column public.wallet_plans.invoice_name is 'WEC-693: επωνυμία for the invoice (null for a plain receipt)';
comment on column public.wallet_plans.invoice_vat  is 'WEC-693: ΑΦΜ for the invoice (null for a plain receipt)';
