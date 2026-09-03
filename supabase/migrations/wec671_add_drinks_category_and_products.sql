-- WEC-671 · applied 2026-09-01
--
-- The 7 products in the "Νερό / Αναψυκτικά" category of sheet
-- "Menu Fitpal New" (codes 331-337) were never imported, and the category
-- itself did not exist. This was the entire dish-level gap between the
-- spreadsheet (323 codes) and the DB (316 dishes).
--
-- Prices from column J (retail, incl. VAT): €1.90 each, water €0.50.
-- The source has no images and no Υλικά for these, so image_url and
-- desc_el/desc_en stay NULL -- deliberately NOT repeating the product name
-- into the description, which is the pattern that already affects 64 other
-- dishes and is tracked in WEC-660.
--
-- preview_* set to 1 rather than the column default of 3, so a bottle of
-- water does not render three-of-five dots on every macro.
--
-- NOTE: creating these does NOT put them on the customer menu. They still
-- need assigning to a weekly menu via menu_day_dishes (menu builder).
--
-- NOTE: sort_order 9 puts drinks last. The category reorder requested in
-- WEC-659 lists seven categories and does not mention drinks -- their final
-- position is still an open question there.

insert into categories (id, name_el, name_en, sort_order, active)
values ('drinks', 'Νερό / Αναψυκτικά', 'Water / Soft Drinks', 9, true)
on conflict (id) do nothing;

insert into dishes (id, category_id, name_el, name_en, external_id,
                    preview_cal, preview_pro, preview_carb, preview_fat, active)
values
 ('331','drinks','Coca cola 330ml',       'Coca cola 330ml',       '331',1,1,1,1,true),
 ('332','drinks','Coca cola light 330ml', 'Coca cola light 330ml', '332',1,1,1,1,true),
 ('333','drinks','Coca cola zero 330ml',  'Coca cola zero 330ml',  '333',1,1,1,1,true),
 ('334','drinks','Fanta πορτοκάλι 330ml', 'Fanta orange 330ml',    '334',1,1,1,1,true),
 ('335','drinks','Fanta λεμόνι 330ml',    'Fanta lemon 330ml',     '335',1,1,1,1,true),
 ('336','drinks','Sprite zero 330ml',     'Sprite zero 330ml',     '336',1,1,1,1,true),
 ('337','drinks','Νερό ΑΥΡΑ 500ml',       'AVRA water 500ml',      '337',1,1,1,1,true)
on conflict (id) do nothing;

insert into dish_variants (id, dish_id, label_el, label_en, price,
                           calories, protein, carbs, fat, sort_order, is_default, external_id)
values
 ('331','331','Coca cola 330ml',       'Coca cola 330ml',       190,0,0,0,0,1,true,'331'),
 ('332','332','Coca cola light 330ml', 'Coca cola light 330ml', 190,0,0,0,0,1,true,'332'),
 ('333','333','Coca cola zero 330ml',  'Coca cola zero 330ml',  190,0,0,0,0,1,true,'333'),
 ('334','334','Fanta πορτοκάλι 330ml', 'Fanta orange 330ml',    190,0,0,0,0,1,true,'334'),
 ('335','335','Fanta λεμόνι 330ml',    'Fanta lemon 330ml',     190,0,0,0,0,1,true,'335'),
 ('336','336','Sprite zero 330ml',     'Sprite zero 330ml',     190,0,0,0,0,1,true,'336'),
 ('337','337','Νερό ΑΥΡΑ 500ml',       'AVRA water 500ml',       50,0,0,0,0,1,true,'337')
on conflict (id) do nothing;

-- Verification: category totals must equal the sheet's --
-- Νερό / Αναψυκτικά -> 7 variants, 1190 cents, 0/0/0/0 macros.
