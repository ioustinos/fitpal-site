/**
 * WEC-711 (B2B-3 — cart isolation): which localStorage key this tab's cart
 * lives under.
 *
 * Per-store cart, no cross-store cart (confirmed 2026-09-06). A customer
 * building a corporate order at /acme must not have those items appear in
 * their personal retail basket, and vice versa.
 *
 * ⚠️ MAIN KEEPS THE EXACT OLD KEY, `fitpal-cart`. That is the whole point of
 * doing this by slug rather than by store uuid: every cart that exists in a
 * customer's browser right now keeps working across the deploy, with no
 * migration step to get wrong. The ticket proposed `fitpal-cart-<storeId>`
 * plus a one-time migration; this achieves the same isolation with nothing
 * to migrate.
 *
 * Resolved once at module load from window.location. Stores are separate
 * documents (there is no client-side link from one storefront to another),
 * so the key never needs to change during a tab's life.
 */

import { resolveSlugFromLocation } from './reserved'

const BASE_KEY = 'fitpal-cart'

function computeKey(): string {
  if (typeof window === 'undefined') return BASE_KEY
  try {
    const slug = resolveSlugFromLocation({
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      search: window.location.search,
    })
    return slug ? `${BASE_KEY}-${slug}` : BASE_KEY
  } catch {
    // Never let cart storage break on a URL edge case — fall back to retail's
    // key, which is what the customer had before.
    return BASE_KEY
  }
}

export const CART_STORAGE_KEY = computeKey()
