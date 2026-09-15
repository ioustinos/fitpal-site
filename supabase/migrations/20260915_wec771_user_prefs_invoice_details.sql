-- WEC-771: remember a customer's invoice details on their account.
--
-- Until now Επωνυμία + ΑΦΜ lived ONLY on each order (orders.invoice_name /
-- invoice_vat), so every single order re-asked for them. Maria has to type a
-- company name and a 9-digit VAT number by hand, over the phone, every time
-- the same customer orders.
--
-- One row per user already exists in user_prefs (and `invoice` boolean already
-- lives here), so this is the natural home — no new table, no new RLS.
--
-- Additive and nullable: existing rows and every existing query are unaffected.
alter table public.user_prefs
  add column if not exists invoice_name text,
  add column if not exists invoice_vat  text;

comment on column public.user_prefs.invoice_name is
  'WEC-771: remembered invoice company name (Επωνυμία). Prefills checkout; the order still stores its own copy so historic orders never change retroactively.';
comment on column public.user_prefs.invoice_vat is
  'WEC-771: remembered invoice VAT number (ΑΦΜ), 9 digits.';
