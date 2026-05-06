/**
 * Shared CSV parser + ingredient classifier for the Wecook menu sheet.
 *
 * Used by:
 *   - The admin /admin/import-menu page (client-side parse for preview +
 *     payload construction)
 *   - The admin-import-menu Netlify function (server-side parse — same
 *     logic, fed the same way, no drift between preview and actual import)
 *
 * Mirrors scripts/ingest-menu-csv.py — keep them in sync if the CSV shape
 * changes. The Python script is the source of truth for the SQL emit;
 * this file is the runtime logic for the admin button-driven flow.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface ParsedIngredient {
  /** Display name as it appeared in the source text */
  name: string
  /** Canonical lookup form (lowercase, accent-stripped) */
  searchKey: string
  /** Grams used in this variant. May be fractional. */
  grams: number
}

export interface ParsedVariant {
  /** Variant ID — e.g. "5-1" (multi) or "5" (single). Stored as dish_variants.id. */
  code: string
  /** Position within the dish (1-based). For "5-1" → 1, "5-3" → 3. */
  sortOrder: number
  /** Customer-facing short label. Stored as dish_variants.label_el (Ποσότητα). */
  labelEl: string
  descEl: string
  imageUrl: string
  priceCents: number
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  /** Full recipe parsed from the Κρυμμένο Πεδίο column. */
  ingredients: ParsedIngredient[]
}

export interface ParsedDish {
  /** Dish ID (the prefix before the dash, or the full code for single-variant). */
  id: string
  /** Resolved category id (breakfast, cooked, grilled, salads, snacks). */
  categoryId: string
  nameEl: string
  descEl: string
  imageUrl: string
  variants: ParsedVariant[]
}

export interface ClassifiedDishIngredient {
  searchKey: string
  /** Display name (first occurrence wins). */
  nameEl: string
  sortOrder: number
  /** True if grams differ across variants OR ingredient is missing in some. */
  isVariant: boolean
  /** Set when isVariant=false; null otherwise. */
  fixedGrams: number | null
  /**
   * Per-variant grams. Empty for fixed ingredients. Keys are variant codes
   * (dish_variants.id), values are grams. Variants where the ingredient is
   * absent are represented with grams = 0.
   */
  perVariant: Record<string, number>
}

export interface ParseSummary {
  totalRows: number
  dishCount: number
  variantCount: number
  ingredientCount: number
  warnings: string[]
}

export interface ParseResult {
  dishes: ParsedDish[]
  /** Map of search_key → display name. Used to upsert into ingredients catalog. */
  ingredients: Map<string, string>
  summary: ParseSummary
}

// ─── Constants ────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  'πρωινά': 'breakfast',
  'μαγειρευτά': 'cooked',
  'ψητές επιλογές': 'grilled',
  'σαλάτες': 'salads',
  'snacks': 'snacks',
}

// Match `(<grams>γρ)` boundaries — accepts decimal comma or dot.
// Greek "γρ" suffix; trailing dot tolerated.
const INGREDIENT_RE = /\(\s*(\d+(?:[.,]\d+)?)\s*γρ\.?\s*\)/g

// ─── Helpers ─────────────────────────────────────────────────────────────

export function searchKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function parseGrams(s: string): number {
  return parseFloat(s.replace(',', '.'))
}

function parseIntOrNull(s: string): number | null {
  if (!s) return null
  const cleaned = s.replace(',', '.').trim()
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? Math.round(n) : null
}

function parsePriceCents(s: string): number {
  const cleaned = s.replace(',', '.').trim()
  if (!cleaned) return 0
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function categoryId(name: string): string | null {
  return CATEGORY_MAP[name.trim().toLowerCase()] ?? null
}

function splitCode(code: string): { dishId: string; sortOrder: number } {
  const parts = code.trim().split('-', 2)
  const dishId = parts[0]
  if (parts.length === 1) return { dishId, sortOrder: 1 }
  const n = parseInt(parts[1], 10)
  return { dishId, sortOrder: Number.isFinite(n) ? n : 1 }
}

/**
 * Tokenise a Κρυμμένο-Πεδίο ingredient string. Each token is `<name> (<grams>γρ)`.
 * Tolerates ingredient names containing commas (regex matches the (Xγρ) marker
 * as the boundary, not commas).
 */
export function parseIngredientList(raw: string): ParsedIngredient[] {
  if (!raw || !raw.trim()) return []
  const out: ParsedIngredient[] = []
  // Reset stateful global regex
  INGREDIENT_RE.lastIndex = 0
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = INGREDIENT_RE.exec(raw)) !== null) {
    let name = raw.slice(cursor, match.index)
    name = name.replace(/^[, \t ]+/, '').replace(/[, \t ]+$/, '').trim()
    if (name) {
      out.push({
        name,
        searchKey: searchKey(name),
        grams: parseGrams(match[1]),
      })
    }
    cursor = match.index + match[0].length
  }
  return out
}

// ─── CSV parser (hand-rolled, RFC 4180-ish) ──────────────────────────────

interface CsvRow {
  category: string
  title: string
  code: string
  desc: string
  qtyLabel: string
  fullRecipe: string
  imageUrl: string
  priceGross: string
  calories: string
  carbs: string
  protein: string
  fat: string
}

function parseCsvText(raw: string): CsvRow[] {
  const rows: string[][] = []
  let cur: string[] = []
  let cell = ''
  let inQuote = false
  let i = 0
  while (i < raw.length) {
    const c = raw[i]
    if (inQuote) {
      if (c === '"') {
        if (raw[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuote = false
        i++
        continue
      }
      cell += c; i++; continue
    }
    if (c === '"') { inQuote = true; i++; continue }
    if (c === ',') { cur.push(cell); cell = ''; i++; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && raw[i + 1] === '\n') i++
      cur.push(cell); rows.push(cur); cur = []; cell = ''
      i++; continue
    }
    cell += c; i++
  }
  if (cell.length || cur.length) { cur.push(cell); rows.push(cur) }
  if (rows.length === 0) return []

  const headers = rows[0].map((h) => h.trim())
  const idx = (name: string) => headers.indexOf(name)
  const cI = idx('Κατηγορία')
  const tI = idx('Τίτλος')
  const codeI = idx('Κωδικός')
  const descI = idx('Περιγραφή')
  const qtyI = idx('Ποσότητα')
  const recipeI = idx('Κρυμμένο Πεδίο')
  const imgI = idx('Image')
  const priceGrossI = idx('Price (ΦΠΑ)')
  const calI = idx('Θερμίδες')
  const carbI = idx('Υδατάνθρακες')
  const proI = idx('Πρωτεϊνη')
  const fatI = idx('Λιπαρά')

  const out: CsvRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.every((v) => !v.trim())) continue
    const get = (k: number) => (k >= 0 ? (row[k] ?? '').trim() : '')
    out.push({
      category: get(cI),
      title: get(tI),
      code: get(codeI),
      desc: get(descI),
      qtyLabel: get(qtyI),
      fullRecipe: get(recipeI),
      imageUrl: get(imgI),
      priceGross: get(priceGrossI),
      calories: get(calI),
      carbs: get(carbI),
      protein: get(proI),
      fat: get(fatI),
    })
  }
  return out
}

// ─── Public entry point ──────────────────────────────────────────────────

export function parseMenuCsv(text: string): ParseResult {
  const rows = parseCsvText(text)
  const dishes = new Map<string, ParsedDish>()
  const ingredients = new Map<string, string>() // search_key → display name
  const warnings: string[] = []

  for (const row of rows) {
    if (!row.code) continue
    const cat = categoryId(row.category)
    if (!cat) {
      warnings.push(`row code=${row.code}: unknown category "${row.category}", skipped`)
      continue
    }

    const { dishId, sortOrder } = splitCode(row.code)
    const parsedIngs = parseIngredientList(row.fullRecipe)

    // Track ingredient names — first-seen wins for display.
    for (const ing of parsedIngs) {
      if (!ingredients.has(ing.searchKey)) ingredients.set(ing.searchKey, ing.name)
    }

    const variant: ParsedVariant = {
      code: row.code,
      sortOrder,
      labelEl: row.qtyLabel,
      descEl: row.desc,
      imageUrl: row.imageUrl,
      priceCents: parsePriceCents(row.priceGross),
      calories: parseIntOrNull(row.calories),
      protein: parseIntOrNull(row.protein),
      carbs: parseIntOrNull(row.carbs),
      fat: parseIntOrNull(row.fat),
      ingredients: parsedIngs,
    }

    if (!dishes.has(dishId)) {
      dishes.set(dishId, {
        id: dishId,
        categoryId: cat,
        nameEl: row.title,
        descEl: row.desc,
        imageUrl: row.imageUrl,
        variants: [],
      })
    }
    dishes.get(dishId)!.variants.push(variant)
  }

  // Sort variants within each dish by sortOrder
  for (const d of dishes.values()) {
    d.variants.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  return {
    dishes: Array.from(dishes.values()),
    ingredients,
    summary: {
      totalRows: rows.length,
      dishCount: dishes.size,
      variantCount: rows.length,
      ingredientCount: ingredients.size,
      warnings,
    },
  }
}

/**
 * Run the fixed-vs-variant classifier on a single dish.
 *
 * Algorithm:
 *   For each ingredient referenced by any variant of this dish, collect the
 *   grams across all variants. Decide:
 *     - present in 100% of variants with same grams  → fixed
 *     - present in 100% with differing grams         → variant-scoped
 *     - present in <100%                             → variant-scoped
 *                                                      (grams=0 in absent variants)
 */
export function classifyDish(dish: ParsedDish): ClassifiedDishIngredient[] {
  // Preserve first-occurrence ordering across the dish's variants
  const orderIndex = new Map<string, number>()
  let nextOrder = 0
  const usage = new Map<string, ClassifiedDishIngredient>()

  for (const v of dish.variants) {
    for (const ing of v.ingredients) {
      if (!orderIndex.has(ing.searchKey)) orderIndex.set(ing.searchKey, ++nextOrder)
      if (!usage.has(ing.searchKey)) {
        usage.set(ing.searchKey, {
          searchKey: ing.searchKey,
          nameEl: ing.name,
          sortOrder: orderIndex.get(ing.searchKey)!,
          isVariant: false,
          fixedGrams: null,
          perVariant: {},
        })
      }
      // If somehow same ingredient appears twice in a variant, sum (rare).
      const u = usage.get(ing.searchKey)!
      u.perVariant[v.code] = (u.perVariant[v.code] ?? 0) + ing.grams
    }
  }

  const out: ClassifiedDishIngredient[] = []
  for (const u of usage.values()) {
    const distinctGrams = new Set(Object.values(u.perVariant))
    const presentInAll = Object.keys(u.perVariant).length === dish.variants.length
    if (distinctGrams.size === 1 && presentInAll) {
      u.isVariant = false
      u.fixedGrams = Array.from(distinctGrams)[0]
      u.perVariant = {} // not needed for fixed
    } else {
      u.isVariant = true
      u.fixedGrams = null
      // Fill 0 for variants where the ingredient is absent
      for (const v of dish.variants) {
        if (u.perVariant[v.code] == null) u.perVariant[v.code] = 0
      }
    }
    out.push(u)
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder)
  return out
}
