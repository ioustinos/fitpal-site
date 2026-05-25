// Meta Conversions API (server-side) — WEC-397 / WEC-373.
//
// Receives a tracking event from the browser dispatcher (src/lib/tracking/track.ts)
// and mirrors it to Meta's Conversions API. Pairs with the browser Pixel via a
// shared `eventId` so Meta deduplicates the two copies. SHA-256 hashes all PII
// before it leaves us. FAIL-SOFT: any error returns 200 with {ok:false} so a
// tracking hiccup never breaks the customer flow.
//
// Env (server-only — never VITE_ prefixed for the secret):
//   META_CAPI_TOKEN          – Conversions API access token (secret)
//   META_PIXEL_ID            – pixel id (falls back to VITE_META_PIXEL_ID)
//   META_TEST_EVENT_CODE     – test code (falls back to VITE_META_TEST_EVENT_CODE)
//   VITE_FITPAL_ENV / CONTEXT – env resolution (test code only applied off-prod)

import crypto from 'node:crypto'
import { corsHeaders } from '../lib/cors'

const GRAPH_VERSION = 'v19.0'

const PIXEL_ID = process.env.META_PIXEL_ID || process.env.VITE_META_PIXEL_ID || ''
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN || ''
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || process.env.VITE_META_TEST_EVENT_CODE || ''
const IS_PROD =
  process.env.VITE_FITPAL_ENV === 'prod' || process.env.CONTEXT === 'production'

interface TrackBody {
  eventName: string          // Meta PascalCase, e.g. 'Purchase'
  eventId: string            // shared with the browser Pixel for dedup
  eventSourceUrl?: string
  ldu?: boolean              // Limited Data Use (fired without ads consent)
  userData?: {
    email?: string
    phone?: string
    firstName?: string
    lastName?: string
    externalId?: string      // our user id
    fbp?: string             // _fbp cookie (not hashed)
    fbc?: string             // _fbc cookie (not hashed)
  }
  customData?: {
    currency?: string
    value?: number
    contentIds?: string[]
    contentName?: string
    contentType?: string
    numItems?: number
    orderId?: string
    contents?: Array<{ id: string; quantity: number; item_price?: number }>
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const hashLower = (v?: string) => (v && v.trim() ? sha256(v.trim().toLowerCase()) : undefined)
const hashPhone = (v?: string) => {
  const digits = (v || '').replace(/\D/g, '')
  return digits ? sha256(digits) : undefined
}
const compact = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST')
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: cors })

  // Inert until configured — mirrors the client master switch.
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return Response.json({ ok: false, skipped: 'not_configured' }, { status: 200, headers: cors })
  }

  let body: TrackBody
  try {
    body = (await request.json()) as TrackBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: cors })
  }
  if (!body?.eventName || !body?.eventId) {
    return Response.json({ ok: false, error: 'eventName and eventId required' }, { status: 400, headers: cors })
  }

  const h = request.headers
  const clientIp =
    h.get('x-nf-client-connection-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
  const userAgent = h.get('user-agent') || undefined

  const ud = body.userData ?? {}
  const user_data = compact({
    em: hashLower(ud.email),
    ph: hashPhone(ud.phone),
    fn: hashLower(ud.firstName),
    ln: hashLower(ud.lastName),
    external_id: hashLower(ud.externalId),
    client_ip_address: clientIp,
    client_user_agent: userAgent,
    fbp: ud.fbp,
    fbc: ud.fbc,
  })

  const cd = body.customData ?? {}
  const custom_data = compact({
    currency: cd.currency,
    value: cd.value,
    content_ids: cd.contentIds,
    content_name: cd.contentName,
    content_type: cd.contentType ?? (cd.contentIds?.length ? 'product' : undefined),
    contents: cd.contents,
    num_items: cd.numItems,
    order_id: cd.orderId,
  })

  const eventData: Record<string, unknown> = {
    event_name: body.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.eventId,
    action_source: 'website',
    event_source_url: body.eventSourceUrl,
    user_data,
    custom_data,
  }

  // Limited Data Use — applied when the event is fired without ads consent
  // (e.g. a `purchase` marked `always` in EVENT_MAP). 0/0 → let Meta geo-detect.
  const payload: Record<string, unknown> = { data: [eventData] }
  if (body.ldu) {
    eventData.data_processing_options = ['LDU']
    eventData.data_processing_options_country = 0
    eventData.data_processing_options_state = 0
  }
  if (!IS_PROD && TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    )
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      console.error('[track-server-event] Meta CAPI error', res.status, json)
      return Response.json({ ok: false, status: res.status, meta: json }, { status: 200, headers: cors })
    }
    return Response.json({ ok: true, events_received: json.events_received ?? 1 }, { status: 200, headers: cors })
  } catch (err) {
    console.error('[track-server-event] request failed', err)
    return Response.json({ ok: false, error: 'capi_request_failed' }, { status: 200, headers: cors })
  }
}
