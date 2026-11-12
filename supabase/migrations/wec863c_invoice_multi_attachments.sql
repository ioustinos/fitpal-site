-- ============================================================================
-- WEC-863 (purchases) — an invoice can carry several files (one per page).
-- 🟢 Ioustinos (12/11): «the purchase can accept more than one file (possibly an
-- invoice in many pages). Add a drag and drop feature».
--
-- attachment_paths text[] holds every file in page order. attachment_path stays and
-- always mirrors the first file, so the invoice list's paper-clip keeps working.
-- Applied to DEV 2026-11-12.
-- ============================================================================
alter table public.cost_purchase_invoices
  add column if not exists attachment_paths text[] not null default '{}';

update public.cost_purchase_invoices
   set attachment_paths = array[attachment_path]
 where attachment_path is not null and cardinality(attachment_paths) = 0;
