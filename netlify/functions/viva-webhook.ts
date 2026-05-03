// Viva webhook receiver.
//
// Two jobs:
//
//   1. GET — dashboard registration handshake. Viva's docs explain that we
//      must fetch a "verification key" from Viva's own
//      /api/messages/config/token endpoint (Basic auth with Merchant ID +
//      API Key). The key is deterministic per merchant. When Viva's
//      dashboard verifies our URL, it calls GET on us and expects our
//      response body to match that same {"Key":"<the-key>"} JSON. The fact
//      that we can produce it proves we hold the merchant credentials.
//
//   2. POST — real events (1796 Payment Created / 1798 Transaction Failed /
//      1797 Reversal Created). Dedupe by MessageId, then — critically — we
//      re-fetch the transaction via Viva's Retrieve Transaction API
//      rather than trusting the payload. This is the documented security
//      model; Viva's webhook docs don't mention HMAC signatures.
//
// WEC-173: part of the Viva Payments integration epic (WEC-125).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaCreds } from '../lib/viva/env'
import { verifyVivaTransaction } from '../lib/viva/verify'
import { markFailed } from '../lib/viva/markPaid'
import { verifyWalletPlanTransaction } from '../lib/wallet/verifyWalletPlanTransaction'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Viva event type IDs we care about.
const EVT_PAYMENT_CREATED  = 1796
const EVT_TRANSACTION_FAIL = 1798
const EVT_REVERSAL_CREATED = 1797

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Cache Viva's webhook verification key per warm container.
// Refreshed at most once per hour. Ignorable — the key is deterministic
// for a merchant, so a cold start fetch works for the first verify call.
let cachedKey: { value: string; fetchedAtMs: number; env: string } | null = null
const KEY_TTL_MS = 60 * 60 * 1000

async function fetchWebhookKey(): Promise<string> {
  const creds = getVivaCreds()
  const now = Date.now()
  if (cachedKey && cachedKey.env === creds.env && now - cachedKey.fetchedAtMs < KEY_TTL_MS) {
    return cachedKey.value
  }

  const basic = Buffer.from(`${creds.merchantId}:${creds.apiKey}`).toString('base64')
  const res = await fetch(`https://${creds.checkoutHost}/api/messages/config/token`, {
    headers: { Authorization: `Basic ${basic}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Viva webhook-key fetch failed: ${res.status} ${body}`)
  }
  const json = (await res.json()) as { Key?: string; key?: string }
  const value = json.Key ?? json.key
  if (!value) throw new Error('Viva webhook-key response missing Key field')
  cachedKey = { value, fetchedAtMs: now, env: creds.env }
  return value
}

function pickMessageId(headers: Headers, payload: unknown): string {
  const fromHeader =
    headers.get('x-message-id') ??
    headers.get('message-id') ??
    headers.get('x-correlation-id')
  if (fromHeader) return fromHeader

  if (payload && typeof payload === 'object' && 'MessageId' in payload) {
    const id = (payload as Record<string, unknown>).MessageId
    if (typeof id === 'string') return id
  }
  if (payload && typeof payload === 'object' && 'Id' in payload) {
    const id = (payload as Record<string, unknown>).Id
    if (typeof id === 'string') return id
  }
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
      const key = await fetchWebhookKey()
      return Response.json({ Key: key })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[viva-webhook] handshake failed:', msg)
      return Response.json({ error: 'Webhook key fetch failed', detail: msg }, { status: 500 })
    }
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // Log source IP — future-proofs us if we later enforce Viva's IP allowlist.
  const sourceIp =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for') ??
    'unknown'
  console.info('[viva-webhook] POST from ip=%s', sourceIp)

  const rawBody = await request.text()
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
  }
  const isRetry = !inserted && !!dupErr
  if (isRetry) {
    return Response.json({ ok: true, deduped: true, messageId })
  }

  const eventData = (payload.EventData ?? {}) as Record<string, unknown>
  const transactionId = typeof eventData.TransactionId === 'string' ? eventData.TransactionId : ''
  // merchantTrns is used ONLY for routing (order vs wallet plan). The verify
  // functions re-fetch via Viva API, so any tampering here is harmless.
  const merchantTrns = typeof eventData.MerchantTrns === 'string' ? eventData.MerchantTrns : ''
  const isWalletPlan = merchantTrns.startsWith('wp:')

  try {
    if (eventTypeId === EVT_PAYMENT_CREATED) {
      if (!transactionId) throw new Error('Payment Created event without TransactionId')
      if (isWalletPlan) {
        const outcome = await verifyWalletPlanTransaction(transactionId)
        console.info('[viva-webhook] payment-created (wallet) outcome=%s', outcome.status)
      } else {
        const outcome = await verifyVivaTransaction(transactionId)
        console.info('[viva-webhook] payment-created (order) outcome=%s', outcome.status)
      }
    } else if (eventTypeId === EVT_TRANSACTION_FAIL) {
      if (transactionId) {
        const verifier = isWalletPlan
          ? () => verifyWalletPlanTransaction(transactionId)
          : () => verifyVivaTransaction(transactionId)
        await verifier().catch(async () => {
          // Fallback: mark failed by orderCode if retrieve failed.
          const orderCode = eventData.OrderCode ? String(eventData.OrderCode) : null
          if (!orderCode) return
          if (isWalletPlan) {
            await supabase
              .from('wallet_plans')
              .update({ payment_status: 'failed' })
              .eq('viva_order_code', orderCode)
              .eq('payment_status', 'pending')
          } else {
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
      console.info('[viva-webhook] reversal-created tx=%s (admin refund path records state first)', transactionId)
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
    // Return 200 — reconcile will catch anything that needs catching, and
    // Viva's 24-retry escalation on transient failures is noise not signal.
    return Response.json({ ok: true, error: msg })
  }
}
