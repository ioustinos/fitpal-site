import { createClient } from '@supabase/supabase-js'

/**
 * Admin endpoint: bulk-import a parsed menu (dishes + variants + ingredient
 * recipes) in one transaction-ish operation.
 *
 * The client (admin/import-menu page) parses the CSV with the shared
 * src/lib/menu-csv/parse.ts library and POSTs the structured payload here.
 * Doing parsing client-side keeps the function tight (no CSV gymnastics
 * server-side) and lets the admin preview before submitting.
 *
 * Idempotency:
 *   - ingredients: insert-or-skip by search_key. Preserves any allergy
 *     links the admin curated previously.
 *   - dishes / dish_variants: upsert by id.
 *   - dish_ingredients / dish_variant_ingredient_amounts: delete-then-insert
 *     per dish, so a refreshed CSV cleanly replaces the recipe state without
 *     orphan rows.
 *
 * Auth: admin Bearer JWT validated via is_admin() RPC on the caller's token.
 * Service-role client used for the actual writes.
 *
 * Wire format — see ImportMenuPayload below.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface InVariant {
  code: string
  sortOrder: number
  labelEl: string
  priceCents: number
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

interface InIngredient {
  searchKey: string
  nameEl: string
  sortOrder: number
  isVariant: boolean
  fixedGrams: number | null
  /** Map of variant code → grams. Empty for fixed ingredients. */
  perVariant: Record<string, number>
}

interface InDish {
  id: string
  categoryId: string
  nameEl: string
  descEl: string
  imageUrl: string
  variants: InVariant[]
  ingredients: InIngredient[]
}

interface ImportMenuPayload {
  dishes: InDish[]
}

interface ImportSummary {
  ok: true
  dishesProcessed: number
  variantsProcessed: number
  ingredientsUpserted: number
  recipeRowsInserted: number
}

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status })
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }
  if (request.method !== 'POST') return jsonError(405, 'Method not allowed')

  // ─── Auth ────────────────────────────────────────────────────────────
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return jsonError(401, 'Missing Authorization: Bearer <jwt>')

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: isAdminRow, error: adminErr } = await callerClient.rpc('is_admin')
  if (adminErr) {
    console.error('is_admin RPC failed:', adminErr)
    return jsonError(500, 'Auth check failed')
  }
  if (isAdminRow !== true) return jsonError(403, 'Admin only')

  // ─── Body ────────────────────────────────────────────────────────────
  let payload: ImportMenuPayload
  try {
    payload = await request.json() as ImportMenuPayload
  } catch {
    return jsonError(400, 'Invalid JSON body')
  }
  const dishes = payload.dishes ?? []
  if (!Array.isArray(dishes) || dishes.length === 0) {
    return jsonError(400, 'dishes array required and non-empty')
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ─── 1. Upsert ingredients catalog ────────────────────────────────────
  // Collect unique (search_key, name) pairs across all incoming dishes.
  // First-occurrence wins for the display name on new rows; existing rows
  // keep whatever name the admin already curated.
  const uniqueIngredients = new Map<string, string>()
  for (const d of dishes) {
    for (const ing of d.ingredients) {
      if (!uniqueIngredients.has(ing.searchKey)) uniqueIngredients.set(ing.searchKey, ing.nameEl)
    }
  }

  if (uniqueIngredients.size > 0) {
    const ingRows = Array.from(uniqueIngredients.entries()).map(([sk, name]) => ({
      name_el: name,
      search_key: sk,
    }))
    const { error: ingErr } = await svc
      .from('ingredients')
      .upsert(ingRows, { onConflict: 'search_key', ignoreDuplicates: true })
    if (ingErr) {
      console.error('ingredients upsert failed:', ingErr)
      return jsonError(500, `ingredients upsert: ${ingErr.message}`)
    }
  }

  // Look up the resolved IDs for every search_key we touched.
  const allSearchKeys = Array.from(uniqueIngredients.keys())
  const { data: idLookup, error: lookupErr } = await svc
    .from('ingredients')
    .select('id, search_key')
    .in('search_key', allSearchKeys)
  if (lookupErr || !idLookup) {
    console.error('ingredients lookup failed:', lookupErr)
    return jsonError(500, `ingredients lookup: ${lookupErr?.message ?? 'no rows'}`)
  }
  const skToId = new Map<string, string>(idLookup.map((r) => [r.search_key, r.id]))

  // ─── 2. Upsert dishes ────────────────────────────────────────────────
  const dishRows = dishes.map((d) => ({
    id: d.id,
    category_id: d.categoryId,
    name_el: d.nameEl,
    desc_el: d.descEl || null,
    image_url: d.imageUrl || null,
  }))
  const { error: dishErr } = await svc.from('dishes').upsert(dishRows, { onConflict: 'id' })
  if (dishErr) {
    console.error('dishes upsert failed:', dishErr)
    return jsonError(500, `dishes upsert: ${dishErr.message}`)
  }

  // ─── 3. Upsert variants ──────────────────────────────────────────────
  const variantRows = dishes.flatMap((d) =>
    d.variants.map((v) => ({
      id: v.code,
      dish_id: d.id,
      label_el: v.labelEl,
      price: v.priceCents,
      calories: v.calories,
      protein: v.protein,
      carbs: v.carbs,
      fat: v.fat,
      sort_order: v.sortOrder,
    }))
  )
  const { error: varErr } = await svc.from('dish_variants').upsert(variantRows, { onConflict: 'id' })
  if (varErr) {
    console.error('dish_variants upsert failed:', varErr)
    return jsonError(500, `dish_variants upsert: ${varErr.message}`)
  }

  // ─── 4. Refresh recipe rows (delete-then-insert per dish set) ────────
  const allVariantCodes = variantRows.map((v) => v.id)
  const allDishIds = dishes.map((d) => d.id)

  // Delete existing recipe rows for the touched dishes/variants. The order
  // matters: variant_amounts first (their FK on variant_id was set up with
  // ON DELETE CASCADE — but we're not deleting the variants, just the
  // amount rows themselves), then dish_ingredients.
  const { error: delAmtErr } = await svc
    .from('dish_variant_ingredient_amounts')
    .delete()
    .in('variant_id', allVariantCodes)
  if (delAmtErr) {
    console.error('amounts delete failed:', delAmtErr)
    return jsonError(500, `amounts delete: ${delAmtErr.message}`)
  }
  const { error: delDIErr } = await svc
    .from('dish_ingredients')
    .delete()
    .in('dish_id', allDishIds)
  if (delDIErr) {
    console.error('dish_ingredients delete failed:', delDIErr)
    return jsonError(500, `dish_ingredients delete: ${delDIErr.message}`)
  }

  // Build insert payloads
  const dishIngRows: Array<{
    dish_id: string
    ingredient_id: string
    sort_order: number
    is_variant: boolean
    fixed_grams: number | null
  }> = []
  const amountRows: Array<{
    variant_id: string
    ingredient_id: string
    grams: number
  }> = []

  for (const d of dishes) {
    for (const ing of d.ingredients) {
      const ingId = skToId.get(ing.searchKey)
      if (!ingId) continue // shouldn't happen — we just upserted
      dishIngRows.push({
        dish_id: d.id,
        ingredient_id: ingId,
        sort_order: ing.sortOrder,
        is_variant: ing.isVariant,
        fixed_grams: ing.isVariant ? null : ing.fixedGrams,
      })
      if (ing.isVariant) {
        for (const [variantCode, grams] of Object.entries(ing.perVariant)) {
          amountRows.push({
            variant_id: variantCode,
            ingredient_id: ingId,
            grams,
          })
        }
      }
    }
  }

  if (dishIngRows.length > 0) {
    const { error: diErr } = await svc.from('dish_ingredients').insert(dishIngRows)
    if (diErr) {
      console.error('dish_ingredients insert failed:', diErr)
      return jsonError(500, `dish_ingredients insert: ${diErr.message}`)
    }
  }
  if (amountRows.length > 0) {
    const { error: amtErr } = await svc.from('dish_variant_ingredient_amounts').insert(amountRows)
    if (amtErr) {
      console.error('amounts insert failed:', amtErr)
      return jsonError(500, `amounts insert: ${amtErr.message}`)
    }
  }

  const summary: ImportSummary = {
    ok: true,
    dishesProcessed: dishes.length,
    variantsProcessed: variantRows.length,
    ingredientsUpserted: uniqueIngredients.size,
    recipeRowsInserted: dishIngRows.length + amountRows.length,
  }
  return Response.json(summary)
}
