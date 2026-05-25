// Shared Meta Conversions API sender (WEC-397).
//
// Used by server flows that need to emit a Meta event without a browser in the
// loop — currently the card-order Purchase fired from markPaid (the customer has
// been redirected to Viva, so there's no client to fire the browser Pixel). The
// HTTP function `track-server-event.ts` handles browser-originated events; a
// follow-up can refactor it to call this too (DRY).
//
// FAIL-SOFT: never throws, returns false if unconfigured or on error.

import crypto from 'node:crypto'

const GRAPH_VERSION = 'v19.0'
const PIXEL_ID = process.env.META_PIXEL_ID || process.env.VITE_META_PIXEL_ID || ''
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN || ''
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || process.env.VITE_META_TEST_EVENT_CODE || ''
const IS_PROD = process.env.VITE_FITPAL_ENV === 'prod' || process.env.CONTEXT === 'production'

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export const hashLower = (v?: string | null) => (v && v.trim() ? sha256(v.trim().toLowerCase()) : undefined)
export const hashPhone = (v?: string | null) => {
  const d = (v || '').replace(/\D/g, '')
  return d ? sha256(d) : undefined
}
const compact = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>

export function metaConfigured(): boolean {
  return Boolean(PIXEL_ID && ACCESS_TOKEN)
}

export interface MetaCapiEvent {
  eventName: string
  eventId: string
  eventSourceUrl?: string
  ldu?: boolean
  /** 'website' (default) for user-driven; 'system_generated' for pure backend. */
  actionSource?: string
  userData?: {
    em?: string
    ph?: string
    fn?: string
    ln?: string
    external_id?: string
    client_ip_address?: string
    client_user_agent?: string
    fbp?: string
    fbc?: string
  }
  customData?: Record<string, unknown>
}

export async function sendMetaCapiEvent(ev: MetaCapiEvent): Promise<boolean> {
  if (!metaConfigured()) return false

  const eventData: Record<string, unknown> = {
    event_name: ev.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: ev.eventId,
    action_source: ev.actionSource ?? 'website',
    event_source_url: ev.eventSourceUrl,
    user_data: compact(ev.userData ?? {}),
    custom_data: ev.customData ? compact(ev.customData) : undefined,
  }
  if (ev.ldu) {
    eventData.data_processing_options = ['LDU']
    eventData.data_processing_options_country = 0
    eventData.data_processing_options_state = 0
  }

  const payload: Record<string, unknown> = { data: [eventData] }
  if (!IS_PROD && TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    )
    if (!res.ok) {
      console.error('[metaCapi] error', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (e) {
    console.error('[metaCapi] request failed', e)
    return false
  }
}
