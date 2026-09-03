-- ⛔ DEAD SCRIPT — DO NOT RUN (WEC-660, superseded 2026-09-03)
--
-- This script populated dishes.ingredients_el / ingredients_en. That approach
-- was superseded: the DECISION is that the DESCRIPTION *is* the Υλικά string.
-- Live state: desc_el/desc_en hold the ingredient list (316 dishes), the old
-- prose is archived in desc_legacy_el/_en, and the separate ingredients_el/_en
-- columns are intentionally left NULL so the DishCard/DishModal fallback
-- (`ingredients_el ?? desc_el`) renders the description.
--
-- Running the original INSERT/UPDATE would put the SAME string into two
-- unsynced columns. It has been neutralised to a no-op. Do not restore it.

DO $$ BEGIN RAISE NOTICE 'wec660_ingredients_populate.sql is a dead no-op (superseded). Nothing was changed.'; END $$;
