// Tracking dispatcher (WEC-397). The single public entry point the app calls:
//   track('purchase', { value, currency, items, orderId, orderNumber }, user)
//
// Routes one logical event to: Meta browser Pixel + Meta server CAPI (deduped via
// a shared eventId) + Klaviyo client. Consent-aware per EVENT_MAP. Fully INERT
// while VITE_TRACKING_ENABLED is false or no SDK is configured.

import { trackingConfig, trackingConfigured } from './config'
import { EVENT_MAP } from './events'
import type { StandardEvent, EventPayload } from './types'
import { currentConsent } from './consent'
import { loadMetaPixel, loadKlaviyo } from './loaders'

export interface TrackUser {
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  externalId?: string
}

function uuid(): string {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const m = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[2]) : undefined
}

function compact<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)),
  ) as Partial<T>
}

export function track(event: StandardEvent, payload: EventPayload = {}, user?: TrackUser): void {
  if (typeof window === 'undefined') return
  if (!trackingConfig.trackingEnabled || !trackingConfigured) return // master switch / inert

  const route = EVENT_MAP[event]
  const consent = currentConsent()
  const adsAllowed = consent.ads || route.always === true

  // Stable id so the browser Pixel copy and the server CAPI copy dedup at Meta.
  const eventId = (payload.orderId && `${event}:${payload.orderId}`) || `${event}:${uuid()}`

  // ── Meta browser Pixel (only with ads consent) ─────────────────────────
  if (route.meta && consent.ads && trackingConfig.metaPixelId) {
    loadMetaPixel()
    window.fbq?.('track', route.meta, metaParams(payload), { eventID: eventId })
  }

  // ── Meta server CAPI (server flag) — also covers `always` w/o consent (LDU) ─
  if (route.meta && route.server && adsAllowed) {
    void fetch('/api/track-server-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        eventName: route.meta,
        eventId,
        eventSourceUrl: window.location.href,
        ldu: !consent.ads, // fired under `always` without ads consent → Limited Data Use
        userData: compact({ ...(user ?? {}), fbp: readCookie('_fbp'), fbc: readCookie('_fbc') }),
        customData: metaCustomData(payload),
      }),
    }).catch(() => {})
  }

  // ── Klaviyo client behavioral event (analytics consent) ────────────────
  if (route.klaviyo && consent.analytics && trackingConfig.klaviyoPublicKey) {
    loadKlaviyo()
    window.klaviyo = window.klaviyo || []
    window.klaviyo.push([
      'track',
      route.klaviyo,
      compact({
        value: payload.value,
        currency: payload.currency ?? 'EUR',
        items: payload.items,
        orderId: payload.orderNumber || payload.orderId,
      }),
    ])
  }
}

function metaParams(p: EventPayload) {
  return compact({
    value: p.value,
    currency: p.currency ?? (p.value != null ? 'EUR' : undefined),
    content_ids: p.contentIds,
    content_name: p.contentName,
    content_type: p.contentIds?.length ? 'product' : undefined,
    num_items: p.numItems,
  })
}

function metaCustomData(p: EventPayload) {
  return compact({
    currency: p.currency ?? 'EUR',
    value: p.value,
    contentIds: p.contentIds,
    contentName: p.contentName,
    numItems: p.numItems,
    orderId: p.orderNumber || p.orderId,
    contents: p.items?.map((i) => ({ id: i.dishId, quantity: i.quantity, item_price: i.price })),
  })
}
