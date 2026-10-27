// Tracking layer — shared types (WEC-373). Inert until env vars are set.

export type StandardEvent =
  | 'page_view'
  | 'view_content'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'initiate_checkout'
  | 'add_payment_info'
  | 'purchase'
  // WEC-887: an order paid from wallet balance is NOT new revenue — the money
  // was collected (and reported as Subscribe) when the plan was bought. It gets
  // its own event so it never lands in the Purchase column.
  | 'wallet_redemption'
  | 'subscribe'
  | 'lead'
  | 'complete_registration'
  | 'schedule'

export type Platform = 'meta' | 'ga4' | 'klaviyo'

export interface EcommerceItem {
  dishId: string
  nameEl: string
  quantity: number
  /** euros (decimal), already normalized from DB cents at the tracking boundary */
  price: number
}

export interface EventPayload {
  value?: number // euros
  currency?: string // 'EUR'
  contentIds?: string[] // dish_id slugs
  contentName?: string // name_el
  numItems?: number
  orderId?: string // Supabase orders.id → event_id (Pixel ↔ CAPI dedup)
  orderNumber?: string // human-facing e.g. FP-2026-04-1234
  items?: EcommerceItem[]
  /** WEC-887: cash | card | link | transfer | wallet — reported to Meta so
   *  conversions can be segmented by how they were actually paid. */
  paymentMethod?: string
  [k: string]: unknown
}

export type ConsentCategory = 'analytics' | 'ads' | 'preferences'
export type ConsentState = Record<ConsentCategory, boolean>

export const DENIED_CONSENT: ConsentState = { analytics: false, ads: false, preferences: false }
