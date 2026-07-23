# Catalogue Migration — July 2026

**Status: ✅ EXECUTED 2026-07-23** (green light from Ioustinos). Backup: `backup_20260717` schema (19 tables).

## Execution record (2026-07-23)
1. Cleanup: 192 orders + dependents deleted (wallet history kept, order_id nulled), 15 weekly menus + 1,407 assignments deleted, 54 test dishes + 123 test variants purged.
2. Import via admin Import-menu page (transformed `upload-menu.csv`: categories normalized for the parser, Image col = Supabase URL for keepers / Drive col-AA for 38): 316 dishes, 1,364 variants, 3,915 recipe rows.
3. Post-pass SQL: desc restore from backup, external_id backfill, obsolete variant `296` deleted, categories `smoothies` + `individual_salads` created, 33 dishes recategorized, is_default guaranteed 1/dish.
4. Ingredients: 268 active col-D catalogue (name_el authoritative, allergies rebuilt — 176 links), 267 recipe-only components kept inactive (needed by grams recipes), orphans deleted. Allergen overlay: 2,301 zero-gram `dish_ingredients` rows (constraint relaxed via migration `catalogue_migration_allow_zero_gram_display_rows`; UI hides grams≤0).
5. English: 159 dish name_en, 20 new desc_el/en, 102 variant label_en, all ingredient name_en filled.
6. Images: 38/39 imported to Storage (315/316 dishes have Supabase-hosted images).
7. Verification: variant checksums (count, Σprice, Σcal, Σpro, Σcarb, Σfat) match CSV v5 EXACTLY; 1 default/dish; 0 orphan variants; allergens spot-checked (dish 64 → Fish/Gluten/Milk); admin Dishes page renders 316/316 with EN + images.

## Open items
- **Dish 289 image**: CSV link is a Drive FOLDER, not a file (same reason it failed in May). Fix the link in the sheet → import via admin → Dish images.
- **Weekly menu**: menus were wiped — build the new week in admin → Menu builder before the site shows dishes.
- **Linear ticket**: Linear MCP was disconnected during execution — file "[WEC] Catalogue migration July 2026" when reconnected, referencing this doc.
- EN translations were auto-generated — review at leisure (all listed in `changes-titles.csv` scope + new dishes).

---
*(Pre-flight report below, kept for reference.)*

**Date:** 2026-07-21 · Backup `backup_20260717` schema, 19 tables.
**Sources (corrected files):** `2.Meals Management - Menu Fitpal New (4).csv` (1,364 rows) + `Υλικά απο Menu, column D (1).csv` (268 rows)
**Matching key:** external id (Κωδικός, column G in the new layout) ↔ `dishes.external_id` / `dish_variants.external_id`
**Column mapping (new layout):** B Λιανική = default-variant flag · C Τίτλος · D Ποσότητα → variant label · E Υλικά → ingredients+allergies · F Κρυμμένο Πεδίο → grams for smart dropdowns · I Price (ΦΠΑ) → price · W-Z macros · **AA Image (kept, per Ioustinos)** · AB Image (ignored)

**Decisions confirmed (2026-07-17, still applied):**
1. Price (ΦΠΑ) is the customer price — decreases intentional.
2. Keep smart per-ingredient dropdowns (Κρυμμένο Πεδίο → grams).
3. Cleanup: delete ALL orders + weekly menus + test/seed dishes (backed up).

---

## 1. Headline numbers (v2 — changed vs the first file)

| | Current DB | New CSV v4 | Change |
|---|---|---|---|
| Dishes | 350 (297 real + 53 test) | **316** | +20 new (311–330), **0 real removed**, −54 test purged |
| Variants | 1,400 | 1,364 | +88 new, −124 removed (1 real: `296` → replaced by `296-1..12`; 123 test) |
| Ingredients | 384 | **268** | +138 new, −254 deleted, 130 kept |
| Categories | 6 | **8** | +`smoothies`, +`individual_salads` (Ατομικές Σαλάτες); Bowls stay (`healthy_bowls`) |

Big difference vs v1 file: **the 14 Healthy Bowls + dishes 290–295 are NOT removed anymore** — they stay, several with reshuffled codes/content (see §5).

## 2. Prices — 743 of 1,276 matched variants change

**222 up, 521 down.** Full list: `changes-prices.csv`.

## 3. Ποσότητα — 14 label changes (was 0 in v1)

All 14 are Bowls (297–310) — portion updates (e.g. Κοτόπουλο 120γρ→90γρ) and content swaps from the code reshuffle. List: `changes-labels.csv`.
Variant adds: `272-1` (missing small size) and `296-1..12` (Μοσχαράκι λεμονάτο goes from 1 to 12 variants; old single code `296` deleted). List: `changes-variants.csv`.

## 4. Titles — 139 dishes renamed

Mostly enrichment; but note the Bowls: codes 301/305/306/307 etc. now carry DIFFERENT dishes than the DB (e.g. `301` DB "Steakhouse Bowl" → CSV "Mango Salmon Bowl..."). Matching stays by external id, so these dishes get fully overwritten — intended, per the sheet. Full list: `changes-titles.csv`.
`name_en` is not in the CSV — renamed + new dishes get auto-translated English names for review.

## 5. Λιανική (column B) — IGNORED for this migration

Per Ioustinos (2026-07-23): ΝΑΙ marks dishes/variants sold on other retail channels (Wolt/efood etc.). Not used by the ordering platform — all 1,364 variants import normally. `is_default` keeps its current behavior (existing dishes keep their default; new dishes default to first variant).

## 6. Categories — 2 new, 20 dishes recategorized

New: `smoothies` (8 dishes), `individual_salads` (Ατομικές Σαλάτες — 74, 75, 101, 102, 103, 268). Bowls map to existing `healthy_bowls` (5 dishes move in from salads: 69, 94, 97, 98, 227). Full list: `changes-categories.csv`.

## 7. Ingredients — column E (Υλικά) → catalogue + allergies

268 ingredients; allergies from **column D of the ingredients file (IOUSTINOS COLUMN)**. 130 kept, 138 new, 254 deleted, **37 allergy-mapping corrections** (`allergy-changes.csv`). Vocab maps cleanly (Soy→Soybeans, Sesame→Sesame seeds, Shellfish→Crustaceans, Sulfites→Sulphites typo).

**RESOLVED (2026-07-23):** corrected exports received (`Menu Fitpal New (5).csv` + `Υλικά... (2).csv`). Only change: dish 291's Υλικά fixed. Menu ↔ ingredients file now match 100% (268/268, 0 missing, 0 unused). These are the import source files.

## 8. Images — column AA

Every one of the 316 dishes now has a Drive link in AA. Where AA ≠ AB (96 rows), AA is the corrected photo. Import plan (`images-to-reimport.csv`, 38 dishes):
- 20 new dishes (311–330), and
- **18 existing dishes whose photo changed**: 272, 290, 294–296, 298–310 (the reshuffled Bowls would otherwise show the wrong photo under the new title).
The other 278 keep their current Supabase-hosted images. Non-shared Drive links will surface as per-dish failures in the import run and get reported.

## 9. Cleanup scope (unchanged)

Delete: 192 orders / 171 child / 434 items (+ payment_links 19, voucher_uses 19; wallet_transactions.order_id nulled on 13 rows), 15 weekly menus / 1,407 assignments, 54 test dishes + 123 test variants. All backed up.

## 10. Migration steps (on green light)

1. ~~Backup~~ ✅ done (`backup_20260717`).
2. Delete orders tree + weekly menus + test/seed dishes.
3. Upsert dishes by external_id (139 title updates, 20 category moves, 20 inserts; image_url preserved except §8 list).
4. Upsert variants by external_id: 743 price / 955 macro / 14 label updates, 88 inserts, 1 delete (`296`), set `is_default` from Λιανική.
5. Rebuild ingredients (268) + `ingredient_allergies` (37 corrections) + `dish_ingredients` from Υλικά.
6. Rebuild grams recipes (`dish_variant_ingredient_amounts`) from Κρυμμένο Πεδίο.
7. Categories: add `smoothies` + `individual_salads`, apply 20 moves.
8. English fields: auto-generate for new/renamed, flag for review.
9. Images: server-side import for the 38 dishes in `images-to-reimport.csv`; report non-shared links.
10. Verification: row counts, 10-dish spot check on dev, allergen filter + default-variant render smoke test.

## Files in this folder

`changes-prices.csv` (743) · `changes-titles.csv` (139) · `changes-labels.csv` (14) · `changes-variants.csv` · `changes-categories.csv` (20) · `new-dishes.csv` (20) · `removed-dishes.csv` (54 test) · `ingredients-new.csv` (138) · `ingredients-deleted.csv` (254) · `allergy-changes.csv` (37) · `images-to-reimport.csv` (38) · `db-snapshot-json/` (pre-migration DB export)
