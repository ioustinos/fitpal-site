/**
 * WEC-749: THE pricing rule. One implementation, imported by everything that
 * has to decide what a variant costs.
 *
 * ⚠️ WHY THIS FILE EXISTS
 *
 * The rule grew in two steps and each step was taught to `submit-order` only:
 *
 *   WEC-714  a reseller store charges `reseller_price`, not `price`
 *   WEC-717  a store (retail included) can discount whole categories
 *
 * Every OTHER place that computed a price kept charging plain retail, and the
 * mismatch is invisible until the two disagree in front of a customer:
 *
 *   WEC-748  `menu-quote` quoted retail against a wholesale cart, so the
 *            pre-submit drift guard fired a false "the price changed" modal
 *            showing MORE than the basket, moments before charging less.
 *   WEC-749  the admin order editor wrote retail into `order_items.unit_price`
 *            when an admin added an item to a B2B or reseller order — which
 *            does not merely display a wrong number, it CHARGES one.
 *
 * Three call sites, two of them wrong, because the rule lived in one of them.
 * So it lives here now, and `submit-order`, `menu-quote` and the admin editor
 * all call it. A fourth pricing rule belongs in this file and nowhere else.
 *
 * Netlify functions import from `src/` (see `wallet-plan-purchase.ts`), so
 * server and client genuinely share this code rather than mirroring it.
 */

/** category_id → discount percentage (0–100). */
export type CategoryDiscountMap = Map<string, number>

/** The bits of a variant that decide its price. */
export interface PricedVariant {
  price: number                        // retail, cents
  resellerPrice?: number | null        // wholesale, cents
  resellerAvailable?: boolean | null
}

/** The bits of a dish that decide its discount. */
export interface PricedDish {
  discountPct?: number | null
  categoryId?: string | null
}

export interface PricingChannel {
  /** True only on a store whose `type` is 'reseller'. */
  isReseller: boolean
  categoryDiscounts: CategoryDiscountMap
}

/**
 * 🔵 INTERACTION RULE (mine, flagged on WEC-717 — say so if you want it the
 * other way): a dish's own `discount_pct` WINS and the two do NOT stack.
 * Stacking makes the effective price impossible to predict, or to explain to a
 * customer on the phone.
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
 * Apply a percentage to a cents amount.
 *
 * Deliberately mirrors the client's `effPrice` step for step — euros, round to
 * 2dp, back to cents — so the price rendered on a card and the price charged
 * by the server cannot differ by a cent.
 */
export function applyDiscountCents(priceCents: number, pct: number): number {
  if (!pct || pct <= 0) return priceCents
  const euros = priceCents / 100
  const discounted = +(euros * (1 - pct / 100)).toFixed(2)
  return Math.round(discounted * 100)
}

/**
 * Step 1 — which price column applies on this channel.
 *
 * Returns **null** on a reseller store when the variant is not sold wholesale
 * or carries no wholesale price. That is deliberate and load-bearing (WEC-714):
 * there is NO fallback to retail, because falling back would sell stock at the
 * retail price to a wholesale customer — silently, and in their favour never.
 * Callers must treat null as "not purchasable here", not as "use retail".
 */
export function channelPriceCents(variant: PricedVariant, isReseller: boolean): number | null {
  if (!isReseller) return variant.price
  return (variant.resellerAvailable === true && typeof variant.resellerPrice === 'number')
    ? variant.resellerPrice
    : null
}

/**
 * The whole rule: channel first, then discount. Null = not purchasable on this
 * channel.
 */
export function unitPriceCents(
  variant: PricedVariant,
  dish: PricedDish | null | undefined,
  channel: PricingChannel,
): number | null {
  const base = channelPriceCents(variant, channel.isReseller)
  if (base === null) return null
  const pct = effectiveDiscountPct(dish?.discountPct, dish?.categoryId, channel.categoryDiscounts)
  return pct > 0 ? applyDiscountCents(base, pct) : base
}
