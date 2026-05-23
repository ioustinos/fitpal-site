/**
 * WEC-387: dish recipe / ingredient detail endpoint.
 *
 * Returns the structured recipe for ONE dish — its ingredient list (joined
 * to ingredient names) plus the per-variant gram amounts. This is the data
 * the customer dish modal's RecipePanel + VariantPicker need.
 *
 * Before this, `fetchDishRecipe` queried Supabase directly on every modal
 * open (3 queries each). This endpoint is edge-cached (5 min TTL + 24h SWR),
 * so popular dishes hit the DB once per window instead of once per open.
 *
 * Anonymous-identical data, read via the Supabase anon key (RLS public read
 * already covers dish_ingredients / ingredients / dish_variants /
 * dish_variant_ingredient_amounts — the customer site already reads them
 * with the anon client today).
 *
 * Admin keeps the direct `fetchDishRecipe` path (low volume + must see
 * un-stale data while editing).
 */

import type { Handler } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
  // Tagged so a future WEC-351 purge (on dish/recipe admin edits) clears it
  // alongside the menu endpoints.
  'Netlify-Cache-Tag': 'menu',
  'Content-Type': 'application/json; charset=utf-8',
} as const

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface DbDishIngredient {
  ingredient_id: string
  sort_order: number
  is_variant: boolean
  fixed_grams: number | null
  ingredients: { name_el: string; name_en: string | null } | null
}

interface DbVariantAmount {
  variant_id: string
  ingredient_id: string
  grams: number
}

// ─── Wire shape (matches src/lib/api/dishRecipe.ts DishRecipe) ──────────────

interface WireDishIngredient {
  ingredientId: string
  nameEl: string
  nameEn: string | null
  sortOrder: number
  isVariant: boolean
  fixedGrams: number | null
}

interface WireVariantAmount {
  variantId: string
  ingredientId: string
  grams: number
}

interface RecipeResponse {
  ingredients: WireDishIngredient[]
  variantAmounts: WireVariantAmount[]
  generatedAt: string
}

export const handler: Handler = async (event) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase env vars missing' }) }
  }

  const dishId = (event.queryStringParameters?.dishId ?? '').trim()
  if (!dishId) {
    return {
      statusCode: 400,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'dishId query param required' }),
    }
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 1. Dish ingredients, joined to the catalog for display names.
    const { data: ingRows, error: ingErr } = await supabase
      .from('dish_ingredients')
      .select('ingredient_id, sort_order, is_variant, fixed_grams, ingredients(name_el, name_en)')
      .eq('dish_id', dishId)
      .order('sort_order')
    if (ingErr) throw new Error(`dish_ingredients: ${ingErr.message}`)

    // 2. This dish's variant ids (to scope the amounts query).
    const { data: varRows, error: varErr } = await supabase
      .from('dish_variants')
      .select('id')
      .eq('dish_id', dishId)
    if (varErr) throw new Error(`dish_variants: ${varErr.message}`)
    const variantIds = (varRows ?? []).map((v) => (v as { id: string }).id)

    // 3. Per-variant gram amounts (only meaningful for is_variant ingredients;
    //    we pull all and let the client filter, same as the legacy fetcher).
    let amtRows: DbVariantAmount[] = []
    if (variantIds.length > 0) {
      const { data, error: amtErr } = await supabase
        .from('dish_variant_ingredient_amounts')
        .select('variant_id, ingredient_id, grams')
        .in('variant_id', variantIds)
      if (amtErr) throw new Error(`dish_variant_ingredient_amounts: ${amtErr.message}`)
      amtRows = (data ?? []) as DbVariantAmount[]
    }

    const body: RecipeResponse = {
      ingredients: ((ingRows as unknown as DbDishIngredient[]) ?? []).map((r) => ({
        ingredientId: r.ingredient_id,
        nameEl: r.ingredients?.name_el ?? '',
        nameEn: r.ingredients?.name_en ?? null,
        sortOrder: r.sort_order,
        isVariant: r.is_variant,
        fixedGrams: r.fixed_grams,
      })),
      variantAmounts: amtRows.map((r) => ({
        variantId: r.variant_id,
        ingredientId: r.ingredient_id,
        grams: r.grams,
      })),
      generatedAt: new Date().toISOString(),
    }

    return { statusCode: 200, headers: { ...CACHE_HEADERS }, body: JSON.stringify(body) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return {
      statusCode: 503,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: `dish-recipe failed: ${message}` }),
    }
  }
}
