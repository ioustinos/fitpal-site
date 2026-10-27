-- WEC-882: source-of-truth view for the DB -> Airtable Menu Reference sync.
-- One row per dish_variant, keyed by external_id (= Airtable {Κωδικός}):
--   ingredients  = kitchen "Κρυμμένο Πεδίο" string, reproduced from the recipe
--                  (only ingredients with effective grams > 0, ordered by
--                  sort_order, grams formatted with a Greek decimal comma).
--   calories / protein / carbs / fat = the variant's macros.
-- Read-only; consumed by netlify/lib/airtable/syncMenuReference.ts.
-- security_invoker so RLS of the querying role applies (service role bypasses
-- RLS anyway; recipe tables are public-read regardless).

create or replace view public.v_menu_reference_sync
with (security_invoker = true) as
with ing as (
  select dv.id as vid,
    string_agg(
      i.name_el || ' (' ||
      case when g = floor(g) then floor(g)::int::text
           else replace(rtrim(rtrim(g::text, '0'), '.'), '.', ',') end
      || 'γρ)', ', ' order by di.sort_order
    ) as ingredients
  from dish_variants dv
  join dish_ingredients di on di.dish_id = dv.dish_id
  join ingredients i on i.id = di.ingredient_id
  left join dish_variant_ingredient_amounts a
    on a.variant_id = dv.id and a.ingredient_id = di.ingredient_id
  cross join lateral (
    select coalesce(case when di.is_variant then a.grams else di.fixed_grams end, 0)::numeric as g
  ) gg
  where g > 0
  group by dv.id
)
select
  dv.external_id                      as code,
  dv.dish_id,
  coalesce(ing.ingredients, '')       as ingredients,
  dv.calories,
  dv.protein,
  dv.carbs,
  dv.fat,
  d.name_el                           as title,
  coalesce(d.desc_el, '')             as description,
  c.name_el                           as category,
  (dv.price / 100.0)                  as price_incvat,              -- real selling price (€)
  (round(dv.price / 1.13)::int / 100.0) as price_exvat             -- ex-VAT at 13% (food rate)
from dish_variants dv
join dishes d on d.id = dv.dish_id
left join categories c on c.id = d.category_id
left join ing on ing.vid = dv.id;

comment on view public.v_menu_reference_sync is
  'WEC-882: DB source of truth for the Airtable Menu Reference sync (Κρυμμένο Πεδίο + macros per variant).';
