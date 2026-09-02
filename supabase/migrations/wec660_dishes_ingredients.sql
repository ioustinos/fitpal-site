-- WEC-660: add recipe-ingredients fields to dishes.
-- The menu card + dish modal render ingredients_el in place of desc_el when it
-- is non-null (desc_el/desc_en remain the fallback). Admin edits both fields
-- independently. Populated from column F (Υλικά) of the 2026-09 catalogue CSV,
-- keyed on external_id.
alter table public.dishes
  add column if not exists ingredients_el text,
  add column if not exists ingredients_en text;

comment on column public.dishes.ingredients_el is 'WEC-660: recipe ingredients (Greek). Shown on the menu card + dish modal in place of desc_el when non-null; desc_el is the fallback.';
comment on column public.dishes.ingredients_en is 'WEC-660: recipe ingredients (English), optional; desc_en fallback.';
