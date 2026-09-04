// Event routing map (WEC-373/§3.7). Internal snake_case names → per-platform
// names + routing flags. Meta = PascalCase, GA4 + Klaviyo = their own names.

import type { StandardEvent, Platform } from './types'

export interface EventRoute {
  meta?: string // PascalCase standard event
  ga4?: string // snake_case
  klaviyo?: string // metric name
  /** also dispatch via the server pipeline (track-server-event), not just client */
  server?: boolean
  /** fire even without cookie consent (LDU / Consent Mode v2 flags applied) */
  always?: boolean
}

export const EVENT_MAP: Record<StandardEvent, EventRoute> = {
  page_view: { meta: 'PageView', ga4: 'page_view' },
  view_content: { meta: 'ViewContent', ga4: 'view_item', klaviyo: 'Viewed Product' },
  add_to_cart: { meta: 'AddToCart', ga4: 'add_to_cart', klaviyo: 'Added to Cart' },
  remove_from_cart: { ga4: 'remove_from_cart' },
  initiate_checkout: { meta: 'InitiateCheckout', ga4: 'begin_checkout', klaviyo: 'Started Checkout', server: true },
  add_payment_info: { meta: 'AddPaymentInfo', ga4: 'add_payment_info' },
  purchase: { meta: 'Purchase', ga4: 'purchase', klaviyo: 'Placed Order', server: true, always: true },
  // WEC-701 §C: subscription (wallet-plan) purchases fire a DISTINCT event so
  // Michalis can optimise/report subscription conversions separately from
  // food-order Purchases in Ads Manager. Meta standard 'Subscribe' event.
  subscribe: { meta: 'Subscribe', ga4: 'subscribe', klaviyo: 'Subscribed Plan', server: true, always: true },
  lead: { meta: 'Lead', ga4: 'generate_lead', klaviyo: 'Signed Up', server: true },
  complete_registration: { meta: 'CompleteRegistration', ga4: 'sign_up', klaviyo: 'Created Account' },
  schedule: { meta: 'Schedule', ga4: 'schedule', klaviyo: 'Selected Delivery Day' },
}

export function platformName(event: StandardEvent, platform: Platform): string | undefined {
  return EVENT_MAP[event][platform]
}
