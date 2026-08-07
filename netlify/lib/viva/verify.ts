// Retrieve a Viva transaction, validate it against our order, and flip
// payment_status via markPaid / markFailed.
//
// Shared by: return-URL verify (customer just came back), webhook (Viva
// server-to-server), reconcile (scheduled safety net). All three paths
// end up calling verifyVivaTransaction() with a transactionId.
//
// WEC-172: part of the Viva Payments integration epic (WEC-125).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaAccessToken } from './auth'
import { getVivaCreds } from './env'
import { markPaid, markFailed } from './markPaid'
import { logVivaEvent, type VivaEventLog } from './logEvent'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type VerifyOutcome =
  | { status: 'paid';     orderId: string; orderNumber: string; amountCents: number; transactionId: string }
  | { status: 'failed';   orderId: string; orderNumber: string; reason: string;     transactionId: string }
  | { status: 'pending';  orderId: string | null; statusId: string; transactionId: string }
  | { status: 'unknown';  transactionId: string; message: string }
  | { status: 'mismatch'; orderId: string; orderNumber: string; vivaCents: number; dbCents: number; transactionId: string }

interface VivaTransaction {
  orderCode: number | string
  statusId: string
  amount: number
  merchantTrns?: string
  transactionId?: string
  errorCode?: number | string
  errorText?: string
}

/**
 * Viva's Retrieve Transaction API returns amount in MAJOR units (euros as
 * a decimal). Our DB stores cents (integers). Convert defensively: if we
 * already see an integer >= 100, treat it as cents (future-proof for
 * hypothetical API changes).
 */
function normalizeAmountCents(raw: number, dbTotalCents: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  // Float with fractional part → always euros.
  if (!Number.isInteger(raw)) return Math.round(raw * 100)
  // Integer: ambiguous. If it already matches dbTotalCents exactly, accept as cents.
  if (raw === dbTotalCents) return raw
  // Otherwise assume euros (matches current Viva v2 behavior).
  return raw * 100
}

/**
 * Verify a Viva transactionId against our DB and update payment state.
 * Idempotent — safe to call concurrently with the webhook / reconcile / return-URL paths.
 */
export async function verifyVivaTransaction(transactionId: string): Promise<VerifyOutcome> {
  if (!transactionId) throw new Error('transactionId required')

  const token = await getVivaAccessToken()
  const creds = getVivaCreds()

  const res = await fetch(
    `https://${creds.apiHost}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Viva retrieve-transaction failed: ${res.status} ${body}`)
  }
  // WEC-430: read response as text + extract orderCode via regex on the raw
  // JSON, NOT via JSON.parse — 16-digit codes above MAX_SAFE_INTEGER lose
  // precision and the resulting lookup of payment_links would miss. We still
  // JSON.parse for everything else (statusId, amount, merchantTrns, etc.).
  const text = await res.text()
  const data = JSON.parse(text) as VivaTransaction
  const m = text.match(/"orderCode"\s*:\s*(\d+)/)
  const orderCode = m ? m[1] : String(data.orderCode)
  const statusId = String(data.statusId ?? '')

  const supabase = serviceClient()

  // WEC-504: durable audit of every verify outcome (fail-soft, awaited).
  const log = (outcome: string, extra: Partial<VivaEventLog> = {}) =>
    logVivaEvent(supabase, { source: 'return_verify', kind: 'order', orderCode, transactionId, statusId, outcome, payload: data, ...extra })

  // Look up our payment_links row by Viva orderCode.
  // WEC-607: also read the link's amount — a link may be for LESS than the order
  // total (partial payment), so we validate the captured amount against THIS
  // link, not against orders.total.
  const { data: link } = await supabase
    .from('payment_links')
    .select('order_id, amount')
    .eq('viva_order_code', orderCode)
    .maybeSingle()

  if (!link || !link.order_id) {
    await log('unknown', { message: `No payment_links row for orderCode=${orderCode}` })
    return { status: 'unknown', transactionId, message: `No payment_links row for orderCode=${orderCode}` }
  }

  // Load the order row (need total + order_number for response messages).
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, total')
    .eq('id', link.order_id)
    .single()

  if (!order) {
    await log('unknown', { orderId: link.order_id as string, message: `Order ${link.order_id} not found` })
    return { status: 'unknown', transactionId, message: `Order ${link.order_id} not found` }
  }

  const orderId = order.id as string
  const orderNumber = order.order_number as string
  const dbTotalCents = order.total as number
  // WEC-607: validate against what THIS link is for (may be a partial amount),
  // falling back to the order total for legacy links with no stored amount.
  const linkAmountCents = ((link as { amount: number | null }).amount ?? dbTotalCents) as number
  const amountCents = normalizeAmountCents(Number(data.amount), linkAmountCents)

  // Always record last_verified_at + the observed status/tx — even on mismatch.
  // The link's `status` is set in the branches below (guarded), so that only the
  // FIRST layer (return / webhook / reconcile) to see a finished payment credits
  // it once (WEC-606/607).
  await supabase
    .from('payment_links')
    .update({
      status_id: statusId,
      transaction_id: transactionId,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('viva_order_code', orderCode)

  if (statusId === 'F') {
    if (amountCents !== linkAmountCents) {
      // CRITICAL: never credit on amount mismatch (captured ≠ what the link was for).
      console.error(
        '[viva-verify] AMOUNT MISMATCH orderId=%s orderCode=%s vivaCents=%d linkCents=%d',
        orderId, orderCode, amountCents, linkAmountCents,
      )
      await log('mismatch', { orderId, amountCents, message: `viva=${amountCents} link=${linkAmountCents}` })
      return {
        status: 'mismatch',
        orderId, orderNumber, transactionId,
        vivaCents: amountCents, dbCents: linkAmountCents,
      }
    }
    // WEC-607: mark THIS link paid, guarded on pending so exactly one layer
    // credits it; markPaid then decides full-vs-partial from the ledger.
    const { data: flipped } = await supabase
      .from('payment_links')
      .update({ status: 'success', updated_at: new Date().toISOString() })
      .eq('viva_order_code', orderCode)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (flipped) await markPaid(orderId, transactionId, amountCents)
    await log('paid', { orderId, amountCents })
    return { status: 'paid', orderId, orderNumber, amountCents, transactionId }
  }

  if (statusId === 'E' || statusId === 'X') {
    const reason = data.errorText ? `${statusId}: ${data.errorText}` : `statusId=${statusId}`
    await supabase
      .from('payment_links')
      .update({ status: 'failure', updated_at: new Date().toISOString() })
      .eq('viva_order_code', orderCode)
      .eq('status', 'pending')
    await markFailed(orderId, transactionId, reason)
    await log('failed', { orderId, message: reason })
    return { status: 'failed', orderId, orderNumber, reason, transactionId }
  }

  // A (authorised, pre-auth flow) / anything else — leave pending.
  await log('pending', { orderId })
  return { status: 'pending', orderId, statusId, transactionId }
}
