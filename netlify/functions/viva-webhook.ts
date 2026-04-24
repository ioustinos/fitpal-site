// Viva webhook receiver.
//
// Two jobs:
//   1. GET — dashboard registration handshake. Viva calls GET on the URL
//      once when you add it; we echo back the configured Key so the
//      "Verify" button in Viva's dashboard succeeds.
//   2. POST — real events (Transaction Payment Created / Failed / Reversal).
//      HMAC-SHA256 verify, dedupe by MessageId, then re-fetch the
//      transaction from Viva (never trust the payload) and flip our order.
//
// This is THE authoritative path. The return-URL layer is a UX nicety;
// the reconcile poll is a safety net. Whoever wins, `markPaid` is
// idempotent so nothing double-processes.
//
// WEC-173: part of the Viva Payments integration epic (WEC-125).

import { createHmac, timingSafeEqual } from 'crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaCreds } from '../lib/viva/env'
import { verifyVivaTransaction } from '../lib/viva/verify'
import { markFailed } from '../lib/viva/markPaid'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Known Viva event type IDs we care about.
const EVT_PAYMENT_CREATED  = 1796
const EVT_TRANSACTION_FAIL = 1798
const EVT_REVERSAL_CREATED = 1797

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Verify Viva HMAC-SHA256 signature. Viva sends the signature in one of
 * a handful of header names depending on the account — we check the common
 * ones. The signature is Base64(HMAC-SHA256(rawBody, webhookKey)).
 */
function verifyHmac(rawBody: string, headerSig: string, webhookKey: string): boolean {
  if (!headerSig || !webhookKey) return false
  const expected = createHmac('sha256', webhookKey).update(rawBody, 'utf8').digest('base64')
  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(headerSig, 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function pickSignatureHeader(headers: Headers): string {
  // Viva's docs have moved around on this. Accept any of the common variants.
  return (
    headers.get('x-viva-signature') ??
    headers.get('x-hmac-signature') ??
    headers.get('x-signature') ??
    headers.get('signature') ??
    ''
  )
}

function pickMessageId(headers: Headers, payload: unknown): string {
  const fromHeader =
    headers.get('x-message-id') ??
    headers.get('message-id') ??
    headers.get('x-correlation-id')
  if (fromHeader) return fromHeader

  // Fall back to the payload's MessageId field.
  if (payload && typeof payload === 'object' && 'MessageId' in payload) {
    const id = (payload as Record<string, unknown>).MessageId
    if (typeof id === 'string') return id
  }
  if (payload && typeof payload === 'object' && 'Id' in payload) {
    const id = (payload as Record<string, unknown>).Id
    if (typeof id === 'string') return id
  }
  // Last-ditch: the TransactionId (a payment can produce multiple webhook
  // retries but only one real event, so this dedupes retries at least).
  if (payload && typeof payload === 'object' && 'EventData' in payload) {
    const ed = (payload as Record<string, unknown>).EventData as Record<string, unknown> | undefined
    const tx = ed?.TransactionId
    if (typeof tx === 'string') return `tx:${tx}`
  }
  return `unknown:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

export default async (request: Request) => {
  // ─── GET — registration handshake ────────────────────────────────────
  if (request.method === 'GET') {
    try {
      const { webhookKey } = getVivaCreds()
      return Response.json({ Key: webhookKey })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('viva-webhook handshake failed:', msg)
      return Response.json({ error: msg }, { status: 500 })
    }
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // Read the raw body BEFORE any JSON parsing — HMAC is over raw bytes.
  const rawBody = await request.text()

  let creds
  try {
    creds = getVivaCreds()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('viva-webhook creds failed:', msg)
    return Response.json({ error: msg }, { status: 500 })
  }

  const sig = pickSignatureHeader(request.headers)
  if (!verifyHmac(rawBody, sig, creds.webhookKey)) {
    // Log header NAMES (not values) to help us identify which header Viva
    // actually uses for the signature. Once sandbox confirms, trim this
    // logging and hardcode the correct header name in pickSignatureHeader().
    const headerNames: string[] = []
    request.headers.forEach((_v, k) => headerNames.push(k))
    console.warn(
      '[viva-webhook] HMAC verification failed. sigHeaderTried=%s headerNames=%j bodyLen=%d',
      sig ? 'found' : 'none',
      headerNames,
      rawBody.length,
    )
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventTypeId = Number(payload.EventTypeId)
  const messageId = pickMessageId(request.headers, payload)
  const supabase = serviceClient()

  // Dedupe: insert into webhook_events with a unique (provider, message_id).
  // If conflict, this is a Viva retry — return 200 without reprocessing.
  const { data: inserted, error: dupErr } = await supabase
    .from('webhook_events')
    .insert({
      provider: 'viva',
      message_id: messageId,
      event_type_id: Number.isFinite(eventTypeId) ? eventTypeId : null,
      payload,
    })
    .select('id')
    .maybeSingle()

  if (dupErr && !String(dupErr.message ?? '').includes('duplicate')) {
    console.error('[viva-webhook] webhook_events insert failed:', dupErr)
    // Still proceed — better to process than to bounce back to Viva.
  }
  const isRetry = !inserted && !!dupErr

  if (isRetry) {
    return Response.json({ ok: true, deduped: true, messageId })
  }

  // Dispatch by event type.
  const eventData = (payload.EventData ?? {}) as Record<string, unknown>
  const transactionId = typeof eventData.TransactionId === 'string' ? eventData.TransactionId : ''

  try {
    if (eventTypeId === EVT_PAYMENT_CREATED) {
      if (!transactionId) throw new Error('Payment Created event without TransactionId')
      const outcome = await verifyVivaTransaction(transactionId)
      console.info('[viva-webhook] payment-created outcome=%s', outcome.status)
    } else if (eventTypeId === EVT_TRANSACTION_FAIL) {
      if (transactionId) {
        // Re-verify via API to get the definitive state + orderCode linkage.
        await verifyVivaTransaction(transactionId).catch(async () => {
          // If retrieve fails (e.g. tx too new), at least mark our order failed
          // if we can find it via the payload.
          const orderCode = eventData.OrderCode ? String(eventData.OrderCode) : null
          if (orderCode) {
            const { data: link } = await supabase
              .from('payment_links')
              .select('order_id')
              .eq('viva_order_code', orderCode)
              .maybeSingle()
            if (link?.order_id) {
              await markFailed(link.order_id as string, transactionId, 'Viva Transaction Failed event')
            }
          }
        })
      }
    } else if (eventTypeId === EVT_REVERSAL_CREATED) {
      // WEC-175 handles refund bookkeeping at the moment of admin action.
      // This webhook is secondary; we just dedupe + log.
      console.info('[viva-webhook] reversal-created tx=%s (handled by admin refund path)', transactionId)
    } else {
      console.info('[viva-webhook] ignoring eventTypeId=%s', eventTypeId)
    }

    await supabase
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'viva')
      .eq('message_id', messageId)

    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[viva-webhook] handler failed eventTypeId=%s err=%s', eventTypeId, msg)
    // Still return 200 — we've recorded the event, reconcile will catch
    // anything that needs catching, and we don't want Viva's 24-retry
    // escalation on a transient downstream failure.
    return Response.json({ ok: true, error: msg })
  }
}
