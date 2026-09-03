-- WEC-659 (category order) + WEC-671 tail (last 4 titles) · applied 2026-09-02
--
-- After this migration the catalogue matches the «Menu Fitpal New» sheet of
-- 2.Meals Management (export of 2026-09-02) EXACTLY -- verified by comparing
-- an md5 over every dish's variant count, price, kcal, carbs, protein, fat and
-- normalised title on both sides:
--
--   sheet md5 = 48069b2056dd728d1e99138d2fa5148d
--   db    md5 = 48069b2056dd728d1e99138d2fa5148d
--
-- Idempotent: both statements are guarded with IS DISTINCT FROM.

-- ── 1 · Category display order ──────────────────────────────────────────
--
-- Requested in the Fitpal team PDF, p.6:
--   «Να αλλαχθεί η σειρά που είναι οι κατηγορίες γευμάτων και να γίνει:
--    Πρωινά - Smoothies - Μεσημεριανό - Healthy Bowls - Σαλάτα -
--    Ατομική Σαλάτα - Snacks»
--
-- «Μεσημεριανό» is NOT a category we have. Ioustinos confirmed 2026-09-02
-- that it stands for Μαγειρευτά first, Ψητές Επιλογές second. So nothing is
-- merged, renamed or deactivated -- `grilled` keeps all 542 variants and
-- simply sits at position 4. This is purely sort_order.
--
-- Νερό / Αναψυκτικά stays last: the team's list predates that category
-- existing (created in wec671_add_drinks_category_and_products).
--
-- Category NAMES are unchanged. The team wrote «Σαλάτα» / «Ατομική Σαλάτα»
-- in the singular; treated as how the list was jotted down, not a rename.
--
-- NB: public.categories has no updated_at column.

update categories set sort_order = v.o
  from (values ('breakfast',1),('smoothies',2),('cooked',3),('grilled',4),
               ('healthy_bowls',5),('salads',6),('individual_salads',7),
               ('snacks',8),('drinks',9)) as v(id,o)
 where categories.id = v.id
   and categories.sort_order is distinct from v.o;

-- ── 2 · The last four dish titles ───────────────────────────────────────
--
-- 299, 300, 302 and 303 had been truncated to the bare English name while
-- the other ten Healthy Bowls carried the full descriptive title. They were
-- the ONLY remaining difference between the database and the spreadsheet.
--
-- Held back from wec671 deliberately: titles are customer-facing copy and
-- the team's own note said «DISHES: Να γίνει ένα τσεκ από Ιουστίνο σχετικά
-- με τους τίτλους». Released on his instruction 2026-09-02.

update dishes set name_el = v.t, updated_at = now()
  from (values
    ('299','Mediterranean Chicken Bowl με καστανό ρύζι, κοτόπουλο σχάρας, πράσινη σαλάτα, ελιές φιλέτο, χούμους, αγγούρι, ντοματίνια, φέτα light και olive oil lemon dressing'),
    ('300','Teriyaki Salmon Bowl με καστανό ρύζι, σολομός σχάρας, guacamole, αγγούρι, καλαμπόκι, σουσάμι και sesame-teriyaki dressing'),
    ('302','Steak Protein Bowl με ρύζι basmati, μοσχάρι σχάρας, πράσινη σαλάτα, χούμους, ντοματίνια, broccoli coleslaw, κόκκινο λάχανο πίκλα και dressing βαλσάμικο'),
    ('303','Steakhouse Bowl με καστανό ρύζι, μοσχάρι σχάρας, πράσινη σαλάτα, feta chili cream, αγγούρι, crispy onion και garlic aioli dressing')
  ) as v(code,t)
 where dishes.external_id = v.code
   and dishes.name_el is distinct from v.t;

-- ⚠️ name_en for these four is still the short English form. There is no
-- English source in the spreadsheet, so it was left rather than invented.

-- Verification --
-- select string_agg(name_el, ' → ' order by sort_order) from categories where active;
--   → Πρωινά → Smoothies → Μαγειρευτά → Ψητές Επιλογές → Healthy Bowls
--     → Σαλάτες → Ατομικές Σαλάτες → Snacks → Νερό / Αναψυκτικά
