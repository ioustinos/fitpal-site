-- WEC-910 (part 2 of 2): every non-draft order carries an explicit document type.
--   retail (cash/card/link/transfer) none/null → receipt
--   wallet (any)                               → delivery_note (+ clear invoice name/VAT)
--
-- ZERO AIRTABLE CHURN: Ioustinos has already hand-set «Δελτίο Αποστολής» on every
-- wallet order in Airtable. This backfill must not flag a single order
-- airtable_dirty (WEC-886 failure mode), so trg_orders_flag_airtable_dirty is
-- disabled for the duration. set_updated_at is disabled too, so updated_at keeps
-- meaning "last real change". Drafts are left alone (they get an explicit value
-- at submit). Gate: `select count(*) from orders where airtable_dirty` must be
-- identical before and after.
alter table public.orders disable trigger trg_orders_flag_airtable_dirty;
alter table public.orders disable trigger set_updated_at;

update public.orders
   set invoice_type = 'receipt'
 where status <> 'draft'
   and payment_method in ('cash','card','link','transfer')
   and (invoice_type = 'none' or invoice_type is null);

update public.orders
   set invoice_type = 'delivery_note', invoice_name = null, invoice_vat = null
 where status <> 'draft'
   and payment_method = 'wallet';

alter table public.orders enable trigger set_updated_at;
alter table public.orders enable trigger trg_orders_flag_airtable_dirty;
