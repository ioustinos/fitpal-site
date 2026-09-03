-- WEC-671 items 3-6 · applied 2026-09-01
--
-- Closes the remaining gaps between the live catalogue and sheet
-- "Menu Fitpal New" of 2.Meals Management.xlsx (docs/catalogue-2026-09/).
-- After this migration every category total -- count, price, kcal, carbs,
-- protein, fat -- matches the spreadsheet exactly.
--
-- Idempotent: safe to re-run.

-- 3 · dish 135 "Ψαρονέφρι με άγριο ρύζι και σάλτσα σόγια-μέλι-τζίντζερ"
--     had 7 of its 12 variants. The 5 missing ones are the 180g and 210g
--     protein steps. Their combined price (6550c) was exactly the
--     catalogue-wide price gap found in the diff -- no other dish was off.
insert into dish_variants (id, dish_id, label_el, label_en, price,
                           calories, protein, carbs, fat, sort_order, is_default, external_id)
values
 ('135-8', '135','Ψαρονέφρι (180γρ), Άγριο ρύζι (180γρ)','Pork tenderloin (180g), Wild rice (180g)',1240,699,58,55,28, 7,false,'135-8'),
 ('135-9', '135','Ψαρονέφρι (180γρ), Άγριο ρύζι (240γρ)','Pork tenderloin (180g), Wild rice (240g)',1290,777,60,67,31, 8,false,'135-9'),
 ('135-10','135','Ψαρονέφρι (210γρ), Άγριο ρύζι (120γρ)','Pork tenderloin (210g), Wild rice (120g)',1290,673,63,44,27, 9,false,'135-10'),
 ('135-11','135','Ψαρονέφρι (210γρ), Άγριο ρύζι (180γρ)','Pork tenderloin (210g), Wild rice (180g)',1340,751,66,55,30,10,false,'135-11'),
 ('135-12','135','Ψαρονέφρι (210γρ), Άγριο ρύζι (240γρ)','Pork tenderloin (210g), Wild rice (240g)',1390,829,68,67,33,11,false,'135-12')
on conflict (id) do nothing;

-- 4 · three bowls were filed under Σαλάτες; the sheet has them as Bowls.
--     This was the whole Bowls -5 / Σαλάτες +5 delta.
--       69  Buddha bowl με τόφου
--       94  Salmon bowl με ψητό σολομό, μάυρο ρύζι και κινόα  (3 variants)
--       227 Buddha bowl με φιλέτο κοτόπουλο και γλυκοπατάτα
update dishes set category_id = 'healthy_bowls', updated_at = now()
 where external_id in ('69','94','227') and category_id <> 'healthy_bowls';

-- 5 · macro drift on two dishes -- the sheet was edited after the July 2026
--     catalogue import, so the sheet wins. Prices were already correct.
update dish_variants v set calories = s.cal, carbs = s.carb, protein = s.pro,
                           fat = s.fat
  from (values
   ('110-1',445,60,18,16),('110-2',527,73,21,18),('110-3',615,87,24,21),('110-4',703,101,28,23),
   ('232-1',366,35,21,16),('232-2',439,41,25,20),('232-3',512,48,29,23),('232-4',585,55,34,27)
  ) as s(ext,cal,carb,pro,fat)
 where v.external_id = s.ext;

-- 6 · strip literal newlines out of dish names (297, 306, 310). They break
--     the menu card layout and any single-line rendering.
update dishes
   set name_el = btrim(regexp_replace(name_el, '\s+', ' ', 'g')),
       name_en = btrim(regexp_replace(name_en, '\s+', ' ', 'g')),
       updated_at = now()
 where name_el ~ '[\n\r]' or name_en ~ '[\n\r]';

-- NOT done here: the 4 truncated bowl titles (299, 300, 302, 303 carry the
-- bare English name while the other ten carry the full descriptive title).
-- That is customer-facing copy in two languages and belongs to Ioustinos's
-- title review, per the team's own note.
--
-- Verification -- these must equal the spreadsheet, category for category:
-- select c.name_el, count(*), sum(v.price), sum(v.calories), sum(v.carbs),
--        sum(v.protein), sum(v.fat)
--   from dish_variants v
--   join dishes d on d.id = v.dish_id
--   join categories c on c.id = d.category_id
--  group by rollup (c.name_el);
-- Expected total: 1371 variants · 1498790c · 737001 kcal · 61794 carb
--                 · 46937 protein · 34047 fat
