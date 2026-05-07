import { supabase } from '../supabase'

/**
 * Recipe data for a single dish — used by the dish modal's recipe panel
 * (WEC-245) and variant picker (WEC-246). Lazy-loaded on modal open so the
 * menu list stays snappy.
 *
 * Shape:
 *   ingredients[] — every dish_ingredients row joined to ingredients(name_el, name_en)
 *   variantAmounts[] — every dish_variant_ingredient_amounts row for the dish's variants
 *
 * The caller (DishModal / VariantPicker) merges the two: for is_variant=true
 * ingredients, look up the per-variant grams; for is_variant=false, use fixed_grams.
 */

export interface DishIngredient {
  ingredientId: string
  nameEl: string
  nameEn: string | null
  sortOrder: number
  isVariant: boolean
  fixedGrams: number | null
}

export interface VariantAmount {
  variantId: string
  ingredientId: string
  grams: number
}

export interface DishRecipe {
  ingredients: DishIngredient[]
  variantAmounts: VariantAmount[]
}

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

export async function fetchDishRecipe(dishId: string): Promise<{
  data: DishRecipe | null
  error: string | null
}> {
  // Get dish's ingredients (joined to catalog for names)
  const { data: ingRows, error: ingErr } = await supabase
    .from('dish_ingredients')
    .select('ingredient_id, sort_order, is_variant, fixed_grams, ingredients(name_el, name_en)')
    .eq('dish_id', dishId)
    .order('sort_order')

  if (ingErr) return { data: null, error: ingErr.message }

  // Variant amounts — only meaningful for is_variant=true ingredients but we
  // pull all and let the caller filter, simpler than a join.
  const variantIds = await supabase
    .from('dish_variants')
    .select('id')
    .eq('dish_id', dishId)
  const ids = (variantIds.data ?? []).map((v) => v.id)

  let amtRows: DbVariantAmount[] = []
  if (ids.length > 0) {
    const { data, error: amtErr } = await supabase
      .from('dish_variant_ingredient_amounts')
      .select('variant_id, ingredient_id, grams')
      .in('variant_id', ids)
    if (amtErr) return { data: null, error: amtErr.message }
    amtRows = (data ?? []) as DbVariantAmount[]
  }

  return {
    data: {
      ingredients: (ingRows as unknown as DbDishIngredient[]).map((r) => ({
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
    },
    error: null,
  }
}

/**
 * Compute the effective ingredient list for a specific variant by merging
 * fixed and variant-scoped grams. Skips ingredients with grams === 0
 * (means "absent in this variant").
 */
export function effectiveIngredients(
  recipe: DishRecipe,
  variantId: string,
): { ingredientId: string; nameEl: string; nameEn: string | null; grams: number }[] {
  const amountByPair = new Map<string, number>()
  for (const a of recipe.variantAmounts) {
    if (a.variantId === variantId) amountByPair.set(a.ingredientId, a.grams)
  }
  const out: { ingredientId: string; nameEl: string; nameEn: string | null; grams: number }[] = []
  for (const ing of recipe.ingredients) {
    const grams = ing.isVariant
      ? (amountByPair.get(ing.ingredientId) ?? 0)
      : (ing.fixedGrams ?? 0)
    if (grams <= 0) continue
    out.push({
      ingredientId: ing.ingredientId,
      nameEl: ing.nameEl,
      nameEn: ing.nameEn,
      grams,
    })
  }
  return out.sort((a, b) => {
    const ai = recipe.ingredients.findIndex((i) => i.ingredientId === a.ingredientId)
    const bi = recipe.ingredients.findIndex((i) => i.ingredientId === b.ingredientId)
    return ai - bi
  })
}
