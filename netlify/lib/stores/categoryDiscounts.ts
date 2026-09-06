/**
 * WEC-717 (B2B-9 — category-level discounts, per store AND on the retail site).
 *
 * Ioustinos: *"A company can choose to have a discount on whole categories
 * (add this feature to the regular site as well but each company can set their
 * own)."* So `category_discounts.store_id` is nullable and **null means
 * retail** — a company store reads only its own rows and never inherits
 * retail's, because "each company can set their own".
 *
 * 🔵 INTERACTION RULE (Fil's recommendation, flagged on the ticket — say so if
 * you want it the other way): **a dish's own `discount_pct` WINS and the two do
 * NOT stack.** Stacking makes the effective price impossible for anyone to
 * predict or explain to a customer on the phone.
 *
 * Both the client read path (`menu-week`) and the write path (`submit-order`)
 * resolve the discount through this one function, so a price the customer sees
 * and the price the server charges cannot drift apart.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** category_id → discount percentage (0–100). */
export type CategoryDiscountMap = Map<string, number>

/**
 * @param storeId the resolved store, or null when the store could not be
 *   resolved at all (in which case no discounts are applied — fail-open, the
 *   customer is never overcharged by a lookup failure).
 * @param isMainStore true for retail, which reads the `store_id IS NULL` rows.
 */
export async function loadCategoryDiscounts(
  supabase: SupabaseClient,
  storeId: string | null,
  isMainStore: boolean,
): Promise<CategoryDiscountMap> {
  const map: CategoryDiscountMap = new Map()
  try {
    const q = supabase.from('category_discounts').select('category_id, discount_pct')
    const { data, error } = isMainStore
      ? await q.is('store_id', null)
      : storeId
        ? await q.eq('store_id', storeId)
        : { data: [], error: null }

    if (error) return map
    for (const r of (data ?? []) as Array<{ category_id: string; discount_pct: number | string }>) {
      const pct = typeof r.discount_pct === 'number' ? r.discount_pct : Number(r.discount_pct)
      if (Number.isFinite(pct) && pct > 0) map.set(r.category_id, pct)
    }
  } catch {
    /* Fail-open: no discounts rather than a broken menu or a failed order. */
  }
  return map
}

/**
 * The discount percentage that actually applies to a dish, 0 when none.
 * Dish-level wins; no stacking.
 */
export function effectiveDiscountPct(
  dishDiscountPct: number | null | undefined,
  categoryId: string | null | undefined,
  categoryDiscounts: CategoryDiscountMap,
): number {
  if (dishDiscountPct && dishDiscountPct > 0) return dishDiscountPct
  if (!categoryId) return 0
  return categoryDiscounts.get(categoryId) ?? 0
}

/**
 * Apply a percentage to a price in CENTS.
 *
 * ⚠️ This deliberately mirrors the CLIENT's `effPrice` in
 * `src/lib/helpers.ts` step for step — convert to euros, multiply, round to
 * 2dp, convert back — rather than doing the arithmetic in cents. Cent-based
 * rounding is tidier but disagrees with the client by one cent on some prices,
 * and "the total I saw is not the total I was charged" is a far worse bug than
 * an ugly line of code. If `effPrice` ever changes, change this with it.
 */
export function applyDiscountCents(priceCents: number, pct: number): number {
  if (!pct || pct <= 0) return priceCents
  const euros = priceCents / 100
  const discounted = +(euros * (1 - pct / 100)).toFixed(2)
  return Math.round(discounted * 100)
}
