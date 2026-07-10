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
// "From Company" is a valid Airtable option but is NEVER produced here — it's
// reserved for the future B2B / sub-sites feature. Do not add it to this
// classifier until that feature defines its own signal.
//
// Pure module (no React / Zustand / fetch / DB) — safe to import from both
// the Vite client bundle and Netlify Functions, same pattern as dayValidation.

export type OrderTypeCode =
  | 'alacarte_own'
  | 'alacarte_managed'
  | 'subscription_own'
  | 'subscription_managed'

export function orderTypeCode(
  paymentMethod: string,
  adminOrderId: string | null | undefined,
): OrderTypeCode {
  const managed = !!adminOrderId
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
}
