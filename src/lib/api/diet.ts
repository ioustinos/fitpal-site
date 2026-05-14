import { supabase } from '../supabase'

/**
 * Customer diet API (WEC-250).
 *
 * Three concerns live here, all customer-facing:
 *   1. The shared catalogs the menu page needs to compute allergen flags:
 *      - all `allergies` rows
 *      - the dish → ingredient-id mapping
 *      - the ingredient → allergy-id mapping (i.e. the ingredient_allergies
 *        junction "rolled up")
 *   2. The signed-in user's own diet prefs:
 *      - profile_allergies — which allergies they have
 *      - profile_avoided_ingredients — specific ingredients they prefer
 *        not to consume (independent of allergies)
 *   3. Persistence helpers (replace-style saves so the UI can do
 *      "give me the new full set" instead of computing diffs).
 *
 * Allergy detection model:
 *   - A dish "contains" an allergy when any of its ingredients is linked
 *     to that allergy via `ingredient_allergies`. There is no direct
 *     dish→allergy table; the ingredient layer is the canonical source.
 *   - A dish is "avoided" by a user when any of its ingredients is in
 *     that user's profile_avoided_ingredients list.
 *
 * These are computed in-memory on the client; the catalogs above are
 * small enough (a few hundred rows total) to ship as one fetch on app
 * load, and matching is a couple of Set lookups per dish.
 */

// ─── Catalog types ─────────────────────────────────────────────────────────

export interface AllergyDef {
  id: string
  nameEl: string
  nameEn: string | null
  description: string | null
}

/** Shared catalog: every allergy, dish→allergies, dish→ingredients. */
export interface DietCatalog {
  allergies: AllergyDef[]
  /** dish_id → set of allergy ids that appear in any of its ingredients */
  dishAllergies: Map<string, Set<string>>
  /** dish_id → set of ingredient ids in that dish (any variant) */
  dishIngredients: Map<string, Set<string>>
  /** ingredient_id → set of allergy ids it carries (for admin display) */
  ingredientAllergies: Map<string, Set<string>>
}

/** What we know about a single ingredient when offering the avoidance picker. */
export interface IngredientOption {
  id: string
  nameEl: string
  nameEn: string | null
}

export interface ProfileDiet {
  allergyIds: string[]
  avoidedIngredientIds: string[]
}

// ─── Fetchers ─────────────────────────────────────────────────────────────

/**
 * Single roundtrip to build the shared catalog. Cheap enough to call on
 * app load and keep cached in the menu store.
 */
export async function fetchDietCatalog(): Promise<{
  data: DietCatalog
  error: string | null
}> {
  const [allergiesRes, dishIngRes, ingAllRes] = await Promise.all([
    supabase.from('allergies').select('id, name_el, name_en, description').order('name_el'),
    supabase.from('dish_ingredients').select('dish_id, ingredient_id'),
    supabase.from('ingredient_allergies').select('ingredient_id, allergy_id'),
  ])

  const empty: DietCatalog = {
    allergies: [],
    dishAllergies: new Map(),
    dishIngredients: new Map(),
    ingredientAllergies: new Map(),
  }
  if (allergiesRes.error) return { data: empty, error: allergiesRes.error.message }
  if (dishIngRes.error) return { data: empty, error: dishIngRes.error.message }
  if (ingAllRes.error) return { data: empty, error: ingAllRes.error.message }

  const allergies: AllergyDef[] = (allergiesRes.data ?? []).map((r) => ({
    id: r.id,
    nameEl: r.name_el,
    nameEn: r.name_en,
    description: r.description,
  }))

  // Build ingredient → allergies map first; the dish → allergies map
  // is computed from it + the dish_ingredients join.
  const ingredientAllergies = new Map<string, Set<string>>()
  for (const r of (ingAllRes.data ?? []) as { ingredient_id: string; allergy_id: string }[]) {
    const set = ingredientAllergies.get(r.ingredient_id) ?? new Set<string>()
    set.add(r.allergy_id)
    ingredientAllergies.set(r.ingredient_id, set)
  }

  const dishIngredients = new Map<string, Set<string>>()
  const dishAllergies = new Map<string, Set<string>>()
  for (const r of (dishIngRes.data ?? []) as { dish_id: string; ingredient_id: string }[]) {
    const ings = dishIngredients.get(r.dish_id) ?? new Set<string>()
    ings.add(r.ingredient_id)
    dishIngredients.set(r.dish_id, ings)

    const allergies = ingredientAllergies.get(r.ingredient_id)
    if (allergies && allergies.size > 0) {
      const set = dishAllergies.get(r.dish_id) ?? new Set<string>()
      for (const a of allergies) set.add(a)
      dishAllergies.set(r.dish_id, set)
    }
  }

  return {
    data: { allergies, dishAllergies, dishIngredients, ingredientAllergies },
    error: null,
  }
}

/**
 * Lightweight ingredient list for the avoidance picker. Active only,
 * id + display names. Includes ALL active ingredients (~380 rows) — the
 * picker filters client-side as the user types.
 */
export async function fetchIngredientOptions(): Promise<{
  data: IngredientOption[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('ingredients')
    .select('id, name_el, name_en')
    .eq('active', true)
    .order('name_el')
  if (error) return { data: [], error: error.message }
  return {
    data: (data ?? []).map((r) => ({
      id: r.id,
      nameEl: r.name_el,
      nameEn: r.name_en,
    })),
    error: null,
  }
}

// ─── Combined diet autocomplete (WEC-338) ─────────────────────────────────

/**
 * A single hit from the diet autocomplete — either an allergy or an
 * ingredient. The shape is intentionally flat (same fields for both kinds)
 * so the dropdown can render them uniformly with a type badge.
 */
export interface DietSearchHit {
  kind: 'allergy' | 'ingredient'
  id: string
  nameEl: string
  nameEn: string | null
}

/**
 * Server-side typeahead over BOTH allergies (15 rows) and ingredients (~380
 * rows). Used by the subscription page's diet-avoidance section.
 *
 * Why server-side instead of preloading: we have hundreds of ingredients, so
 * we don't want to ship the full list on page load. Postgres ilike on a
 * 400-row table with an index on lower(name_el) is well under 50ms.
 *
 * Allergies are queried in the same trip — they're surfaced FIRST so they
 * rank above ingredient matches in the dropdown. Caller decides ordering.
 *
 * `q` should already be trimmed; empty `q` returns `[]` without hitting the DB.
 */
export async function searchDietTerms(
  q: string,
  limit = 12,
): Promise<{ data: DietSearchHit[]; error: string | null }> {
  const trimmed = q.trim()
  if (!trimmed) return { data: [], error: null }

  // Postgres ilike escape — keep it simple, we only need to neutralise the
  // wildcard characters that could leak into the pattern.
  const pat = `%${trimmed.replace(/[%_]/g, (m) => '\\' + m)}%`

  const [allergyRes, ingRes] = await Promise.all([
    supabase
      .from('allergies')
      .select('id, name_el, name_en')
      .or(`name_el.ilike.${pat},name_en.ilike.${pat}`)
      .limit(limit),
    supabase
      .from('ingredients')
      .select('id, name_el, name_en')
      .eq('active', true)
      .or(`name_el.ilike.${pat},name_en.ilike.${pat}`)
      .limit(limit),
  ])

  if (allergyRes.error) return { data: [], error: allergyRes.error.message }
  if (ingRes.error)     return { data: [], error: ingRes.error.message }

  const hits: DietSearchHit[] = [
    ...(allergyRes.data ?? []).map((r) => ({
      kind: 'allergy' as const,
      id: r.id as string,
      nameEl: r.name_el as string,
      nameEn: (r.name_en as string | null) ?? null,
    })),
    ...(ingRes.data ?? []).map((r) => ({
      kind: 'ingredient' as const,
      id: r.id as string,
      nameEl: r.name_el as string,
      nameEn: (r.name_en as string | null) ?? null,
    })),
  ].slice(0, limit)

  return { data: hits, error: null }
}

/** Read the signed-in user's diet prefs (allergies + avoided ingredients). */
export async function fetchProfileDiet(userId: string): Promise<{
  data: ProfileDiet
  error: string | null
}> {
  const [paRes, paiRes] = await Promise.all([
    supabase.from('profile_allergies').select('allergy_id').eq('profile_id', userId),
    supabase.from('profile_avoided_ingredients').select('ingredient_id').eq('profile_id', userId),
  ])
  if (paRes.error) return { data: { allergyIds: [], avoidedIngredientIds: [] }, error: paRes.error.message }
  if (paiRes.error) return { data: { allergyIds: [], avoidedIngredientIds: [] }, error: paiRes.error.message }

  return {
    data: {
      allergyIds: (paRes.data ?? []).map((r) => r.allergy_id as string),
      avoidedIngredientIds: (paiRes.data ?? []).map((r) => r.ingredient_id as string),
    },
    error: null,
  }
}

/**
 * Replace-style save: blow away the user's existing rows and re-insert.
 * The two tables are small (single-digit row counts per user) so the
 * delete+insert pattern is fine and avoids dirty-diff logic in the UI.
 */
export async function saveProfileAllergies(
  userId: string,
  allergyIds: string[],
): Promise<{ error: string | null }> {
  // Wipe existing
  const del = await supabase.from('profile_allergies').delete().eq('profile_id', userId)
  if (del.error) return { error: del.error.message }

  if (allergyIds.length === 0) return { error: null }

  const rows = allergyIds.map((id) => ({ profile_id: userId, allergy_id: id }))
  const ins = await supabase.from('profile_allergies').insert(rows)
  return { error: ins.error?.message ?? null }
}

export async function saveProfileAvoidedIngredients(
  userId: string,
  ingredientIds: string[],
): Promise<{ error: string | null }> {
  const del = await supabase.from('profile_avoided_ingredients').delete().eq('profile_id', userId)
  if (del.error) return { error: del.error.message }

  if (ingredientIds.length === 0) return { error: null }

  const rows = ingredientIds.map((id) => ({ profile_id: userId, ingredient_id: id }))
  const ins = await supabase.from('profile_avoided_ingredients').insert(rows)
  return { error: ins.error?.message ?? null }
}

// ─── Per-dish flag computation ────────────────────────────────────────────

export interface DishDietFlags {
  /** Allergies the customer is flagged for that this dish triggers. */
  matchedAllergies: AllergyDef[]
  /** Ingredient ids in this dish that the customer is avoiding. */
  matchedAvoidedIngredientIds: string[]
  /** True if anything matched — convenience flag. */
  any: boolean
}

/**
 * Compute the per-dish warning flags for the signed-in user.
 * Returns empty matches if the catalog isn't loaded yet or the user has
 * no diet prefs — callers should treat that as "no warning to show".
 */
export function dishDietFlags(
  dishId: string,
  catalog: DietCatalog | null,
  userAllergyIds: Set<string>,
  userAvoidedIngredientIds: Set<string>,
): DishDietFlags {
  const empty: DishDietFlags = { matchedAllergies: [], matchedAvoidedIngredientIds: [], any: false }
  if (!catalog) return empty
  if (userAllergyIds.size === 0 && userAvoidedIngredientIds.size === 0) return empty

  const dishAllergyIds = catalog.dishAllergies.get(dishId)
  const dishIngredientIds = catalog.dishIngredients.get(dishId)

  const matchedAllergies: AllergyDef[] = []
  if (dishAllergyIds) {
    for (const aId of dishAllergyIds) {
      if (userAllergyIds.has(aId)) {
        const def = catalog.allergies.find((a) => a.id === aId)
        if (def) matchedAllergies.push(def)
      }
    }
  }

  const matchedAvoidedIngredientIds: string[] = []
  if (dishIngredientIds) {
    for (const iId of dishIngredientIds) {
      if (userAvoidedIngredientIds.has(iId)) {
        matchedAvoidedIngredientIds.push(iId)
      }
    }
  }

  return {
    matchedAllergies,
    matchedAvoidedIngredientIds,
    any: matchedAllergies.length > 0 || matchedAvoidedIngredientIds.length > 0,
  }
}

// ─── Cart-level aggregate diet summary (WEC-345) ──────────────────────────

export interface CartDietSummary {
  /** Number of cart line items whose dish triggers any flag. */
  flaggedCount: number
  /** Distinct allergy defs that any cart item triggers (sorted by nameEl). */
  matchedAllergies: AllergyDef[]
  /** Total count of distinct avoided ingredients across the cart. */
  matchedIngredientCount: number
}

/**
 * Aggregate the per-dish diet flags across every line item in the cart.
 * Used by `CartSidebar`, `OrderSummary`, and `CheckoutPage` to surface a
 * single banner above the checkout CTA when a customer's allergies / avoided
 * ingredients are in their cart — defending against the "skim past the menu
 * warning, hit Place Order" failure mode (WEC-345).
 *
 * Returns a zero-summary (no flags) when:
 *   - the catalog isn't loaded yet (race on first paint)
 *   - the user has no diet prefs (e.g. guest checkout)
 *   - the cart contains no dishes matching any of the prefs
 *
 * Callers should render the banner only when `flaggedCount > 0`.
 */
export function cartDietSummary(
  cart: Record<string, { dishId: string }[]>,
  catalog: DietCatalog | null,
  userAllergyIds: Set<string>,
  userAvoidedIngredientIds: Set<string>,
): CartDietSummary {
  const zero: CartDietSummary = {
    flaggedCount: 0,
    matchedAllergies: [],
    matchedIngredientCount: 0,
  }
  if (!catalog) return zero
  if (userAllergyIds.size === 0 && userAvoidedIngredientIds.size === 0) return zero

  let flaggedCount = 0
  const allergyMap = new Map<string, AllergyDef>()  // dedupe by id
  const ingredientIds = new Set<string>()

  for (const items of Object.values(cart)) {
    for (const it of items) {
      const flags = dishDietFlags(it.dishId, catalog, userAllergyIds, userAvoidedIngredientIds)
      if (!flags.any) continue
      flaggedCount += 1
      for (const a of flags.matchedAllergies) {
        if (!allergyMap.has(a.id)) allergyMap.set(a.id, a)
      }
      for (const ingId of flags.matchedAvoidedIngredientIds) {
        ingredientIds.add(ingId)
      }
    }
  }

  return {
    flaggedCount,
    matchedAllergies: Array.from(allergyMap.values()).sort((a, b) =>
      a.nameEl.localeCompare(b.nameEl, 'el'),
    ),
    matchedIngredientCount: ingredientIds.size,
  }
}
