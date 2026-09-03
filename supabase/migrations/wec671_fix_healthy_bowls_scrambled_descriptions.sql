-- WEC-671 · applied 2026-09-01
--
-- Healthy Bowls 301-310 were each carrying a DIFFERENT dish's description,
-- in both desc_el and desc_en. Live, customer-facing, and a dietary/allergen
-- misrepresentation rather than a typo: "Falafel Vegan Bowl" showed chicken,
-- "Vegan Power Bowl" showed salmon, "Steak Protein Bowl" showed tuna.
--
-- Found by diffing the live catalogue against sheet "Menu Fitpal New" of
-- 2.Meals Management.xlsx (copy kept at docs/catalogue-2026-09/).
--
-- The permutation is a clean 10-cycle: every correct string already existed
-- in the table, just attached to the wrong dish. This rotates them back --
-- it does NOT author new copy. Each source is consumed exactly once, so the
-- statement is lossless. 297-300 were already correct and are untouched.
--
-- NOT idempotent by design: re-running rotates the cycle again. Verify with
-- the query at the bottom rather than re-applying.

with src as (
  select external_id, desc_el, desc_en
  from dishes
  where external_id in ('301','302','303','304','305','306','307','308','309','310')
),
m(target, source) as (
  values ('301','306'),('302','307'),('303','301'),('304','302'),('305','308'),
         ('306','303'),('307','309'),('308','304'),('309','310'),('310','305')
)
update dishes d
   set desc_el = s.desc_el,
       desc_en = s.desc_en,
       updated_at = now()
  from m
  join src s on s.external_id = m.source
 where d.external_id = m.target;

-- Verification -- each name must be consistent with its own description:
--   301 Mango Salmon      -> σολομός
--   302 Steak Protein     -> μοσχάρι
--   303 Steakhouse        -> μοσχάρι, καστανό ρύζι
--   304 Tuna Mediterranean-> τόνος
--   305 Falafel Vegan     -> falafel, τόφου       (no meat/fish)
--   306 Vegan Power       -> ψητά λαχανικά        (no meat/fish)
--   307 Sweet Potato Chic.-> κοτόπουλο, γλυκοπατάτα
--   308 Avocado Chicken   -> κοτόπουλο, guacamole
--   309 Protein Mix       -> κοτόπουλο + τόνος
--   310 Green Fitness     -> φαγόπυρο, κινόα
--
-- select external_id, left(name_el,34), left(desc_el,58)
--   from dishes where external_id::int between 301 and 310
--  order by external_id::int;
