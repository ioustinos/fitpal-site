-- ============================================================================
-- WEC-710 (B2B-2: store resolution from the URL path)
-- Applied to rhwetztxwjxfstffalwl on 2026-09-06.
--
-- 1. Extend the reserved-slug guard with the two public legal routes that
--    WEC-709 missed (`/privacy`, `/terms` are real routes in App.tsx).
-- 2. Seed two throwaway stores so the resolver's three outcomes can be tested
--    on dev: an active company store, and an inactive one.
--
-- Additive: the constraint is replaced with a strictly stricter version on a
-- table holding one row ('main'), and two new rows are inserted. No existing
-- data is touched.
--
-- ROLLBACK:
--   delete from public.stores where slug in ('acme','acme-closed');
--   alter table public.stores drop constraint stores_slug_safe;
--   -- (then re-add the WEC-709 version if you need the old list back)
-- ============================================================================

alter table public.stores drop constraint if exists stores_slug_safe;

alter table public.stores add constraint stores_slug_safe check (
  slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'
  and slug not in (
    'admin','account','api','assets','auth','callback','cart','checkout',
    'login','logout','menu','order','orders','pay','payment','privacy',
    'profile','signup','static','subscription','terms','wallet'
  )
);

-- Throwaway test stores (WEC-710 guardrail: "seed a throwaway acme store by
-- SQL for testing; do not build admin UI here"). Delete once WEC-715 ships
-- real store CRUD.
insert into public.stores (
  slug, type, name_el, name_en, active, airtable_store_id,
  address_street, address_area, address_zip, address_floor, address_doorbell
) values
  ('acme', 'company', 'Acme Α.Ε.', 'Acme Ltd', true, 9001,
   'Λεωφ. Κηφισίας 100', 'Μαρούσι', '15125', '3ος', 'Reception'),
  ('acme-closed', 'company', 'Acme (κλειστό)', 'Acme (closed)', false, 9002,
   null, null, null, null, null)
on conflict (slug) do nothing;
