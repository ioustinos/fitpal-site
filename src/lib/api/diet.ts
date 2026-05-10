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
