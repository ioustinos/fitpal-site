-- WEC-910 (part 1 of 2, own transaction): add the delivery-note document type.
-- Postgres won't let a newly added enum value be used in the transaction that
-- adds it, so the backfill lives in wec910b.
alter type public.invoice_type add value if not exists 'delivery_note';
