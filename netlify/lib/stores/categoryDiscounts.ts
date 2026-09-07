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

// WEC-749: the arithmetic lives in ONE file now — `src/lib/pricing.ts` — and is
// re-exported here so existing server imports keep working. Netlify bundles
// from src/ already (see wallet-plan-purchase.ts), so this is genuinely the
// same code the admin UI runs, not a mirror of it. What stays in this file is
// the only thing that is server-specific: the Supabase read.
export {
  effectiveDiscountPct,
  applyDiscountCents,
  channelPriceCents,
  unitPriceCents,
  type CategoryDiscountMap,
} from '../../../src/lib/pricing'
import type { CategoryDiscountMap } from '../../../src/lib/pricing'

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
