-- WEC-596: derived variant dimensions shown as customer choices.
--
-- Some is_variant ingredients are DERIVED — their grams are a pure function of
-- another dimension the kitchen scales automatically (e.g. dish 185's white-wine
-- sauce follows the linguine: 210->85, 240->100, 300->130). Today DropdownsPicker
-- renders one <select> per is_variant ingredient with no notion of dependency, so
-- a derived quantity becomes a misleading customer control.
--
-- Fix (Option A): an explicit, admin-visible flag. An ingredient is a customer
-- CHOICE only when customer_selectable = true. Derived ingredients keep their
-- per-variant grams (recipe panel + macros stay correct) but render read-only,
-- with no dropdown.
--
-- DEFAULT true => this migration changes NOTHING on its own. Every ingredient
-- stays selectable exactly as today. Admins flip the few derived dimensions off
-- by hand via the dish-editor toggle (Ioustinos' explicit call: do not
-- auto-detect / bulk-write — too easy to mis-flag a genuinely independent dim,
-- especially on low-variant dishes where everything trivially correlates).

alter table public.dish_ingredients
  add column customer_selectable boolean not null default true;

comment on column public.dish_ingredients.customer_selectable is
  'WEC-596: is this is_variant ingredient a customer-facing dropdown choice (true) '
  'or a derived amount the kitchen scales from another dimension (false, read-only)? '
  'Default true. Only meaningful when is_variant = true.';
