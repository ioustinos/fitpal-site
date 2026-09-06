// WEC-528: single source of truth for the "Order Type" classification.
//
// Two axes, both already present on every `orders` row:
//   - payment_method  → wallet = subscription-funded, anything else = à la carte
//   - admin_order_id  → set when an admin placed the order via impersonation
//                       ("managed"); null when the customer placed it ("own")
//
// Consumers:
//   - netlify/lib/airtable/maps.ts → mapOrderType() (exact Airtable option strings)
//   - src/admin/pages/Orders.tsx  → badge + filter in the orders list/drawer
//
// WEC-727: B2B is now a third value on the first axis. The signal is the
// STORE the order was placed on — anything that is not the main retail store
// is B2B, whatever it was paid with. That beats deriving it from the payment
// method, because a company employee can pay by card, cash or wallet and it is
// still a company order.
//
// This also unlocks Airtable's long-reserved "From Company" option, which
// mapOrderType has been forbidden from emitting until the feature had a real
// signal. It has one now.
//
// Pure module (no React / Zustand / fetch / DB) — safe to import from both
// the Vite client bundle and Netlify Functions, same pattern as dayValidation.

export type OrderTypeCode =
  | 'alacarte_own'
  | 'alacarte_managed'
  | 'subscription_own'
  | 'subscription_managed'
  | 'b2b_own'
  | 'b2b_managed'

/**
 * @param storeSlug the storefront the order was placed on. `'main'`, null or
 *   undefined all mean the retail site — so every pre-B2B order, and every
 *   caller that does not know about stores yet, classifies exactly as before.
 */
export function orderTypeCode(
  paymentMethod: string,
  adminOrderId: string | null | undefined,
  storeSlug?: string | null,
): OrderTypeCode {
  const managed = !!adminOrderId
  // WEC-727: the store wins over the payment method. A company order paid from
  // a wallet is still a company order, and ops needs to see it as one.
  const isB2B = !!storeSlug && storeSlug !== 'main'
  if (isB2B) return managed ? 'b2b_managed' : 'b2b_own'
  const subscription = paymentMethod === 'wallet'
  if (subscription) return managed ? 'subscription_managed' : 'subscription_own'
  return managed ? 'alacarte_managed' : 'alacarte_own'
}

/** Bilingual display labels for the admin UI. */
export const ORDER_TYPE_LABELS: Record<OrderTypeCode, { el: string; en: string }> = {
  alacarte_own: { el: 'A la carte (πελάτης)', en: 'A la carte (own)' },
  alacarte_managed: { el: 'A la carte (διαχ.)', en: 'A la carte (managed)' },
  subscription_own: { el: 'Συνδρομή (πελάτης)', en: 'Subscription (own)' },
  subscription_managed: { el: 'Συνδρομή (διαχ.)', en: 'Subscription (managed)' },
  b2b_own: { el: 'B2B (πελάτης)', en: 'B2B (own)' },
  b2b_managed: { el: 'B2B (διαχ.)', en: 'B2B (managed)' },
}
