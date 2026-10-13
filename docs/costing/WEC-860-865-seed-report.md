# Costing seed from the kitchen Excel — dry-run + write report

WEC-860 (seed costing data from the Excel) and WEC-865 (link dish lines to components).
Source: «Appendix_B_Updated.xlsx». Run on **DEV only** (`jrxxsixhxgawucorfyjt`) on 2026-10-12. Production has not been touched.

## How it runs

| Step | File | What it does |
|---|---|---|
| 1 | `scripts/costing-seed/parse_excel.py` | Reads the 7 sheets → one JSON file (no DB). |
| 2 | `scripts/costing-seed/make_chunks.py` | JSON → 11 SQL chunks, each carrying the md5 of its payload. |
| 3 | `scripts/costing-seed/01_staging.sql` | Schema `costing_seed` (dev tooling, like `devsync`) and `costing_seed.load()`. A chunk whose text changed in transit is refused. |
| 4 | `scripts/costing-seed/02_match.sql` | `costing_seed.run_match()`: Fitpal dish → Excel dish, then dish line → Excel component name. Writes only to `costing_seed.*`. |
| 5 | `scripts/costing-seed/03_seed.sql` | `costing_seed.seed(date)`: the write run into `public.cost_*`. Idempotent. |
| 6 | — | `select public.cost_rebuild_all();` builds the ledger (8 s on dev). |

Neither the database nor the container can reach the other directly, so the data went in as checksummed chunks through the Supabase tool. All 11 loaded, and every checksum passed.

## 1. What the Excel contains (dry run)

| Sheet | Rows | Findings |
|---|---|---|
| Src Costs | 403 | 401 unique names. **2 duplicate names**: «Πάστα ελιάς» (rows 171/269, same €7.56) and «Μουστάρδα wholegrain» (rows 315/329, **€4.10 vs €4.56**). The first row wins. No missing prices, no #REF. |
| Src Packaging | **30** (not 519; the earlier count included empty rows) | 3 rows without a usable piece price, so they are seeded **unpriced**: row 11 «ΧΑΡΤΙΝΟ ΜΠΛΟΛ ΣΑΛΑΤΑΣ ΚΡΑΦΤ 750CC 50ΑΔΑ» (no price), rows 24/25 (sold by the kilo, no piece count). Rows 26–29 have a piece price only, which is fine. |
| New Index Υλικών | 451 | 450 unique («Γάλα καρύδας» appears twice; the first row wins). Every raw name exists in Src Costs, every row has a yield, no #REF/Infinity. |
| Group Υλικών | 230 | Static values only (no recipe). No errors. No name clashes with New Index. |
| Dish sheets | 321 dishes / 1,552 variant rows | Κυρίως 174, Πρωινά 110, Σαλάτες 37. 498 distinct component names. **3 names exist in no sheet**: «Sugar free lemon poppy seeds cake», «Κοκκινιστός αρακάς με φρέσκια ντομάτα, άνηθο, καρότο και πατάτα», «Σπιτικά κρουτόν». |

Two facts about the Excel model, confirmed by the numbers:

- **«Prod Cost» is food cost only.** Packaging is the separate «Pack cost» column. Our product cost is food + packaging, so compare our *food* cost with «Prod Cost».
- Cost per cooked 100 g = cost per raw 100 g × 100 ÷ «Γρ μετα απο μαγείρεμα» (for example onion 0.13 × 100 / 70 = 0.1857).

## 2. What was written (dev)

| Table | Rows | Notes |
|---|---|---|
| `cost_items` food | 401 | `standard_cost_per_unit` = price per kg ÷ 1000 per g, so they are **estimated**. No fake purchases. Unit g, VAT 13%, `source_ref = excel:SrcCosts:<row>`. |
| `cost_items` packaging | 30 | Unit pcs, VAT 24%, pack = pieces per pack. 3 unpriced (see above). |
| `cost_components` simple | 450 | One published version, **effective 2026-10-12**: 100 g of the raw item, yield % = cooked g per 100 g. |
| `cost_components` composite | 230 | One published version, `yield_mode = fixed`, cost per g = Excel «Κόστος /100γρ Μαγ» ÷ 100, so they are **estimated**. ⚠ This was **your open decision**. I seeded it on dev so the screens have data, and it is reversible (all rows are tagged `excel:Group:*`). |
| `cost_dish_line_links` | 1,002 | `source = auto_excel`, `confirmed = false`. Each `match_note` says which Excel dish and row it came from and how sure the match is. |
| `cost_ingredient_default_links` | 121 | Only where at least 2 auto-links for the same display ingredient all agree on one component. |
| `cost_dish_packaging` | 809 rows on 238 dishes | Copied from the matched Excel dish's packaging list (qty = number of times it appears). |

**Re-run check:** running `seed()` again created 0 new rows. It re-applies the same standard costs and nothing else.

## 3. Matching Fitpal dishes to the Excel (WEC-865)

The match uses two signals: the dish title (accent- and spelling-insensitive, e.g. «Γλυκόξυνο» = «Γλυκόξινο») and the gram signature of each variant.

| Dish match | Count | Meaning |
|---|---|---|
| matched | 174 | Title and grams agree. |
| title_only | 77 | Title agrees; the recipe changed since the Excel. |
| ambiguous | 27 | Two Excel dishes score about the same. |
| weak | 39 | Low title overlap; mostly the newer bowls and salads that are not in the Excel. |
| none | 5 | No candidate at all. |

| Dish lines (grams > 0) | Count |
|---|---|
| total | 1,360 |
| linked explicitly (auto_excel) | 1,002 (74%) |
| costed through a default link | 138 |
| **unlinked, need review** | **220** |

Link rule: a line is linked when the Excel name and its grams both agree («exact») in any matched dish, or on grams or name alone inside a dish where title and grams both agree.

**Known limit:** when two lines swap grams between variants (chicken 120 / rice 180 vs chicken 180 / rice 120), variant alignment can pick the wrong row. That lowers the score, so the line is left unlinked rather than linked wrongly.

⚠ **Weak/ambiguous dishes:** 200 «exact» lines in them were linked. They are generic components (rice, chicken, vegetables) that matched on both name and grams, but please glance at them on the review screen. The note on each says «πιάτο weak».

## 4. Spot checks

- **All 450 simple components**: our cost per cooked 100 g equals the Excel «Κόστος /100γρ Μαγ» to within €0.0001 (e.g. Ελαιόλαδο 0.948889 vs 0.9488888889; Κρεμμύδι ωμό 0.185714 vs 0.1857142857).
- **897 variants in 194 dishes** could be aligned to an Excel row line by line:
  - 865 (96%) have food cost within 1 cent of «Prod Cost». Dish 117: 1.665 / 1.727 / 1.789 vs 1.67 / 1.73 / 1.79.
  - Every variant that is more than 5 cents off has an **unlinked line** (so those differences are explained, not wrong).
  - Packaging is within 1 cent on 834; the rest have no packaging because their dish match was weak.

## 5. Dishes not matched or uncertain (review list)

See the list in `/admin/costing/links` (it filters to exactly these). The 5 with no match: 15 Yogurt Bowl…, 276, 289, 290 (salads), 318 Iced Tea.

## Production

Nothing has run on production. To seed production after approval: apply the costing migrations, then load the same chunks, run `run_match()`, `seed(<date>)` and `cost_rebuild_all()`.
