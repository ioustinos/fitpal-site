-- ============================================================================
-- WEC-674 / WEC-648 — prefill dish_variants.reseller_price from the retail price
-- Applied to rhwetztxwjxfstffalwl on 2026-09-06.
--
-- Ioustinos, 2026-09-06: "just use the same price as the current retails price
-- to prefill all fields." The admin then edits DOWN from a sane starting point
-- instead of facing 1,371 empty fields. This is a one-time prefill, NOT a
-- runtime fallback — the read path (WEC-714) reads reseller_price, full stop.
--
-- Invisible to customers: `reseller_available` is false on all 1,371 variants,
-- so no reseller price is reachable from any storefront until an admin opts a
-- variant in.
--
-- Idempotent: only fills NULLs, so re-running never overwrites a negotiated
-- price someone has since typed in.
--
-- ROLLBACK: there is no safe automatic rollback once an admin starts editing
-- prices. To undo immediately after applying, and only then:
--   update public.dish_variants set reseller_price = null where reseller_price = price;
-- ============================================================================

update public.dish_variants
set reseller_price = price
where reseller_price is null;

-- Verification (expected 2026-09-06: 1371 / 1371 / 0):
--   select count(*), count(reseller_price), count(*) filter (where reseller_available)
--   from public.dish_variants;
