-- ============================================================================
-- WEC-864 (components & recipes) — two more processing methods.
-- 🟢 Ioustinos (12/11): «add some processing/cooking options: Μίξη, Καθάρισμα»
-- and «change "cooked" to "processed" as a label» (UI only; columns keep their names).
-- Applied to DEV 2026-11-12.
-- ============================================================================
alter table public.cost_components drop constraint if exists cost_components_cooking_method_ck;
alter table public.cost_components add constraint cost_components_cooking_method_ck check (
  cooking_method is null or cooking_method in
    ('raw', 'boiled', 'steamed', 'sauteed', 'roasted', 'baked', 'pot', 'fried', 'cooked', 'mixed', 'cleaned', 'other'));
