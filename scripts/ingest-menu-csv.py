#!/usr/bin/env python3
"""
Ingest menu CSV into the Fitpal Supabase schema.

Reusable for pilots and bulk imports. Generates idempotent-ish SQL that:
  - Upserts ingredients into the catalog (lookup-or-create by search_key)
  - Inserts dishes (one per unique Κωδικός prefix)
  - Inserts dish_variants (one per row, label_el = Ποσότητα)
  - Classifies each ingredient per dish:
      same grams across all variants → fixed (dish_ingredients with fixed_grams)
      different grams                → variant (dish_ingredients.is_variant=true
                                                 + dish_variant_ingredient_amounts row per variant)

Usage:
  python3 scripts/ingest-menu-csv.py --csv path/to/file.csv --pilot          # 2 dishes/category
  python3 scripts/ingest-menu-csv.py --csv path/to/file.csv --limit 10
  python3 scripts/ingest-menu-csv.py --csv path/to/file.csv                  # full
  python3 scripts/ingest-menu-csv.py --csv path/to/file.csv --emit json      # JSON, no SQL

Output: SQL on stdout (default) or JSON dump (--emit json).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

# ─── Constants ───────────────────────────────────────────────────────────────

CATEGORY_NAME_TO_ID = {
    'πρωινά':         'breakfast',
    'μαγειρευτά':     'cooked',
    'ψητές επιλογές': 'grilled',
    'σαλάτες':        'salads',
    'snacks':         'snacks',
}

# Match `<name> (<grams>γρ)` where grams may have decimal comma or dot
# Greek "γρ" or "γραμμάρια" suffix. The (Xγρ) parens are the boundary.
INGREDIENT_RE = re.compile(r'\(\s*(\d+(?:[.,]\d+)?)\s*γρ\.?\s*\)', re.UNICODE)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def search_key(name: str) -> str:
    """Canonical lookup form: lowercase + tonos/accents stripped + whitespace normalised."""
    s = unicodedata.normalize('NFD', name)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')  # strip combining marks
    s = s.lower()
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def parse_grams(s: str) -> float:
    """Parse grams string with Greek decimal-comma. '2,5' → 2.5 ; '60' → 60.0"""
    return float(s.replace(',', '.'))


def parse_ingredient_list(raw: str) -> list[tuple[str, float]]:
    """
    Parse a Κρυμμένο-Πεδίο string into [(name, grams), ...].

    Algorithm: find every (Xγρ) match — those are the boundaries between
    ingredients. Walk the string, taking text from (prev end + 1) up to each
    match's open-paren as the ingredient name. Strip leading commas/whitespace.

    Tolerates ingredient names containing commas (e.g.
    "Ομελέτα με βασιλομανίταρα, portobello, champignon, … (185γρ)" is one
    ingredient because the (Xγρ) only appears once).
    """
    if not raw or not raw.strip():
        return []

    out: list[tuple[str, float]] = []
    cursor = 0
    for m in INGREDIENT_RE.finditer(raw):
        name = raw[cursor:m.start()]
        # Strip leading separators (",", " ", tabs)
        name = name.lstrip(', \t').rstrip()
        # Drop trailing "," accidentally left
        name = name.rstrip(',').strip()
        if name:
            out.append((name, parse_grams(m.group(1))))
        cursor = m.end()
    return out


def cents(price_str: str) -> int:
    """Parse '5,90' or '5.90' → 590 cents."""
    return round(float(price_str.replace(',', '.')) * 100)


def int_or_none(s: str) -> Optional[int]:
    s = s.strip()
    if not s:
        return None
    try:
        return int(s.replace(',', '.').split('.')[0])
    except ValueError:
        return None


def category_id(name_el: str) -> Optional[str]:
    return CATEGORY_NAME_TO_ID.get(name_el.strip().lower())


def split_code(code: str) -> tuple[str, int]:
    """
    'Κωδικός' → (dish_id, variant_sort_order).

    '1'    → ('1',  1)
    '5-1'  → ('5',  1)
    '5-2'  → ('5',  2)
    '99-3' → ('99', 3)
    """
    parts = code.strip().split('-', 1)
    dish_id = parts[0]
    if len(parts) == 1:
        return dish_id, 1
    try:
        return dish_id, int(parts[1])
    except ValueError:
        return dish_id, 1


def sql_lit(v) -> str:
    """Render a value for inline SQL. Strings are escaped, NULL passed through."""
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


# ─── Data classes ────────────────────────────────────────────────────────────

@dataclass
class Variant:
    code: str               # '5-1'
    sort_order: int         # 1
    label_el: str           # Ποσότητα
    desc_el: str            # Περιγραφή (per-row, but we hoist to dish below)
    image_url: str
    price_cents: int
    calories: Optional[int]
    protein: Optional[int]
    carbs: Optional[int]
    fat: Optional[int]
    ingredients: list[tuple[str, float]]  # parsed (name, grams) from Κρυμμένο


@dataclass
class Dish:
    id: str                 # '5'
    category: str           # 'breakfast'
    name_el: str
    desc_el: str
    image_url: str
    variants: list[Variant] = field(default_factory=list)


# ─── Parser ──────────────────────────────────────────────────────────────────

def parse_csv(path: str) -> dict[str, Dish]:
    dishes: dict[str, Dish] = {}

    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row['Κωδικός'].strip()
            if not code:
                continue
            dish_id, sort_order = split_code(code)
            cat_id = category_id(row['Κατηγορία'])
            if cat_id is None:
                print(f'WARN: row {code} unknown category "{row["Κατηγορία"]}"', file=sys.stderr)
                continue

            ingredients = parse_ingredient_list(row.get('Κρυμμένο Πεδίο', ''))

            v = Variant(
                code=code,
                sort_order=sort_order,
                label_el=row['Ποσότητα'].strip(),
                desc_el=row['Περιγραφή'].strip(),
                image_url=row['Image'].strip(),
                price_cents=cents(row['Price (ΦΠΑ)']),
                calories=int_or_none(row['Θερμίδες']),
                protein=int_or_none(row['Πρωτεϊνη']),
                carbs=int_or_none(row['Υδατάνθρακες']),
                fat=int_or_none(row['Λιπαρά']),
                ingredients=ingredients,
            )

            if dish_id not in dishes:
                dishes[dish_id] = Dish(
                    id=dish_id,
                    category=cat_id,
                    name_el=row['Τίτλος'].strip(),
                    desc_el=v.desc_el,
                    image_url=v.image_url,
                    variants=[],
                )
            dishes[dish_id].variants.append(v)

    # Sort variants by sort_order within each dish
    for d in dishes.values():
        d.variants.sort(key=lambda v: v.sort_order)
    return dishes


def pilot_filter(dishes: dict[str, Dish], per_category: int = 2) -> dict[str, Dish]:
    """Pick the first N dishes per category (preserves CSV order)."""
    seen: dict[str, int] = defaultdict(int)
    out: dict[str, Dish] = {}
    for d in dishes.values():
        if seen[d.category] >= per_category:
            continue
        out[d.id] = d
        seen[d.category] += 1
    return out


# ─── Classifier ──────────────────────────────────────────────────────────────

@dataclass
class IngredientUsage:
    """How a single ingredient is used across one dish's variants."""
    name_el: str
    sk: str
    # variant_sort_order → grams
    per_variant: dict[int, float] = field(default_factory=dict)


def classify_dish(dish: Dish) -> dict[str, IngredientUsage]:
    """
    For each unique ingredient (by search_key) used by any variant of this dish,
    collect grams per variant. Caller decides fixed vs variant by checking
    `set(per_variant.values())`.
    """
    usage: dict[str, IngredientUsage] = {}
    for v in dish.variants:
        for name, grams in v.ingredients:
            sk = search_key(name)
            if sk not in usage:
                usage[sk] = IngredientUsage(name_el=name, sk=sk)
            # If multiple appearances in same variant, sum (rare — prevents data loss)
            usage[sk].per_variant[v.sort_order] = (
                usage[sk].per_variant.get(v.sort_order, 0) + grams
            )
    return usage


# ─── SQL emit ────────────────────────────────────────────────────────────────

def emit_sql(dishes: dict[str, Dish]) -> str:
    """
    Generate a SQL transaction that inserts everything cleanly. Idempotent
    where reasonable: ingredients use ON CONFLICT(search_key) DO NOTHING;
    dishes/variants/recipe rows are plain inserts (assume fresh import or
    pre-cleared rows).
    """
    # 1. Collect all unique ingredient names across pilot/full set
    all_ings: dict[str, str] = {}  # search_key → display name (first seen)
    for d in dishes.values():
        for v in d.variants:
            for name, _ in v.ingredients:
                sk = search_key(name)
                if sk not in all_ings:
                    all_ings[sk] = name.strip()

    out: list[str] = []
    out.append('-- Generated by scripts/ingest-menu-csv.py')
    out.append('BEGIN;')
    out.append('')

    # 2. Upsert ingredients catalog
    out.append('-- ─── Ingredients catalog ───')
    if all_ings:
        rows = ', '.join(
            f"({sql_lit(name)}, {sql_lit(sk)})"
            for sk, name in sorted(all_ings.items())
        )
        out.append(
            f"INSERT INTO public.ingredients (name_el, search_key) VALUES {rows}\n"
            f"ON CONFLICT (search_key) DO NOTHING;"
        )
    out.append('')

    # 3. Insert dishes
    out.append('-- ─── Dishes ───')
    for d in dishes.values():
        out.append(
            f"INSERT INTO public.dishes (id, category_id, name_el, desc_el, image_url) "
            f"VALUES ({sql_lit(d.id)}, {sql_lit(d.category)}, {sql_lit(d.name_el)}, "
            f"{sql_lit(d.desc_el)}, {sql_lit(d.image_url)});"
        )
    out.append('')

    # 4. Insert variants
    out.append('-- ─── Dish variants ───')
    for d in dishes.values():
        for v in d.variants:
            out.append(
                f"INSERT INTO public.dish_variants "
                f"(id, dish_id, label_el, price, calories, protein, carbs, fat, sort_order) "
                f"VALUES ({sql_lit(v.code)}, {sql_lit(d.id)}, {sql_lit(v.label_el)}, "
                f"{v.price_cents}, {sql_lit(v.calories)}, {sql_lit(v.protein)}, "
                f"{sql_lit(v.carbs)}, {sql_lit(v.fat)}, {v.sort_order});"
            )
    out.append('')

    # 5. dish_ingredients + dish_variant_ingredient_amounts (classifier output)
    out.append('-- ─── Dish recipes (fixed + variant ingredients) ───')
    for d in dishes.values():
        usage = classify_dish(d)
        sort_idx = 0
        for sk, u in usage.items():
            sort_idx += 1
            grams_set = set(u.per_variant.values())
            present_in_all = len(u.per_variant) == len(d.variants)
            is_variant = (len(grams_set) > 1) or (not present_in_all)
            ing_lookup = (
                f"(SELECT id FROM public.ingredients WHERE search_key = {sql_lit(sk)})"
            )
            if is_variant:
                out.append(
                    f"INSERT INTO public.dish_ingredients "
                    f"(dish_id, ingredient_id, sort_order, is_variant, fixed_grams) VALUES "
                    f"({sql_lit(d.id)}, {ing_lookup}, {sort_idx}, TRUE, NULL);"
                )
                # Per-variant amounts (use 0 for variants where ingredient is absent)
                for v in d.variants:
                    g = u.per_variant.get(v.sort_order, 0)
                    out.append(
                        f"INSERT INTO public.dish_variant_ingredient_amounts "
                        f"(variant_id, ingredient_id, grams) VALUES "
                        f"({sql_lit(v.code)}, {ing_lookup}, {g});"
                    )
            else:
                fixed_grams = next(iter(grams_set))
                out.append(
                    f"INSERT INTO public.dish_ingredients "
                    f"(dish_id, ingredient_id, sort_order, is_variant, fixed_grams) VALUES "
                    f"({sql_lit(d.id)}, {ing_lookup}, {sort_idx}, FALSE, {fixed_grams});"
                )
        out.append('')

    out.append('COMMIT;')
    return '\n'.join(out)


# ─── JSON emit (for dry-run review) ─────────────────────────────────────────

def emit_json(dishes: dict[str, Dish]) -> str:
    summary = []
    for d in dishes.values():
        usage = classify_dish(d)
        ings_summary = []
        for sk, u in usage.items():
            grams_set = sorted(set(u.per_variant.values()))
            present_in_all = len(u.per_variant) == len(d.variants)
            is_variant = (len(grams_set) > 1) or (not present_in_all)
            ings_summary.append({
                'name': u.name_el,
                'search_key': sk,
                'is_variant': is_variant,
                'grams_distinct': grams_set,
                'present_in_variants': len(u.per_variant),
                'total_variants': len(d.variants),
            })
        summary.append({
            'id': d.id,
            'category': d.category,
            'name_el': d.name_el,
            'variants': len(d.variants),
            'variant_codes': [v.code for v in d.variants],
            'image': d.image_url,
            'ingredients': ings_summary,
        })
    return json.dumps(summary, ensure_ascii=False, indent=2)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True, help='Path to the CSV file')
    ap.add_argument('--pilot', action='store_true', help='Take first 2 dishes/category')
    ap.add_argument('--per-category', type=int, default=2, help='Used with --pilot')
    ap.add_argument('--limit', type=int, default=None, help='Cap total dishes')
    ap.add_argument('--emit', choices=['sql', 'json'], default='sql')
    args = ap.parse_args()

    dishes = parse_csv(args.csv)

    if args.pilot:
        dishes = pilot_filter(dishes, args.per_category)
    if args.limit is not None:
        dishes = dict(list(dishes.items())[:args.limit])

    if args.emit == 'sql':
        print(emit_sql(dishes))
    else:
        print(emit_json(dishes))

    print(f'\n-- Processed {len(dishes)} dishes, '
          f'{sum(len(d.variants) for d in dishes.values())} variants',
          file=sys.stderr)


if __name__ == '__main__':
    main()
