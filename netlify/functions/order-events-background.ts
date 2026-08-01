// WEC-580: background firing of order-confirmation events (Klaviyo subscribe +
// "Order Placed", customer + admin BCC).
//
// Netlify background function (`-background` suffix) — returns 202 immediately
// so the caller (submit-order / markPaid) is never blocked by Klaviyo latency,
// which was ~2-3s of the ~4-5s wall-time on submit. The ENTIRE payload is
// re-read from the DB inside fireOrderConfirmationFromDb — nothing is trusted
// from the request body beyond { orderId, kind, lang? }. Each external call is
// retried with backoff inside the lib; a give-up is logged loudly as
// `[order-events] GAVE UP …` so a manual re-invoke with the same body is a valid
// recovery tool.
//
// Auth model mirrors airtable-push-background exactly: an open POST, no shared
// secret (keeps dev friction low per standing decision). The only data it can
// touch is derived server-side from an orderId, so there's nothing to leak.

import { createClient } from '@supabase/supabase-js'
import { fireOrderConfirmationFromDb, type OrderEventOpts } from '../lib/orderConfirmationEmail'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

type Kind = NonNullable<OrderEventOpts['kind']>
const VALID_KINDS: Kind[] = ['order_placed', 'order_paid_confirmation']

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })

  let body: { orderId?: string; kind?: string; lang?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }
  const orderId = body?.orderId
  const kind = body?.kind
  if (!orderId || !kind || !VALID_KINDS.includes(kind as Kind)) {
    console.warn('[order-events] bad request:', JSON.stringify(body))
    return new Response(null, { status: 400 })
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.error('[order-events] SUPABASE_SERVICE_ROLE_KEY not set')
    return new Response(null, { status: 500 })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const lang = body.lang === 'en' || body.lang === 'el' ? body.lang : undefined
  try {
    await fireOrderConfirmationFromDb(supabase, orderId, { kind: kind as Kind, lang })
    console.log('[order-events] done kind=%s order=%s', kind, orderId)
  } catch (err) {
    // fireOrderConfirmationFromDb is fail-soft, but guard anyway.
    console.error('[order-events] error kind=%s order=%s:', kind, orderId, err)
  }
  return new Response(null, { status: 200 })
}
