-- WEC-595: variant dropdowns render with empty titles for 187 dishes.
--
-- The scale-driving recipe components created by the July catalogue migration
-- are ingredients.active = false. ingredients' only anon-read policy is
-- `ingredients_public_read USING (active)`, so the public dish-recipe endpoint
-- (anon key) gets NULL for those names -> nameEl "" -> nameless <select>.
--
-- `active` is an admin *catalogue-visibility* flag; it was never meant to hide
-- the name of an ingredient that a dish's own recipe depends on. So: allow anon
-- to read an ingredient's row iff it is referenced by at least one
-- dish_ingredients row (i.e. it is part of some recipe). This is narrower than
-- flipping active=true (which would flood the admin ingredient catalogue) and
-- far narrower than handing the public endpoint the service-role key (full RLS
-- bypass on a cacheable public function). dish_ingredients is already
-- anon-readable (`dish_ingredients_public_read USING (true)`), so the EXISTS
-- subquery resolves for anon with no RLS recursion.
--
-- This ORs with the existing active-based policy: a row is anon-readable if it
-- is active OR referenced by a recipe. Fixes the endpoint AND the WEC-245
-- recipe panel wherever these ingredients would be listed.

create policy ingredients_recipe_read on public.ingredients
  for select
  using (
    exists (select 1 from public.dish_ingredients di where di.ingredient_id = ingredients.id)
  );
