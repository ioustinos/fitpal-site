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
  const data = (await res.json()) as VivaTransaction
  const orderCode = String(data.orderCode)
  const statusId = String(data.statusId ?? '')

  const supabase = serviceClient()

  // Look up our payment_links row by Viva orderCode.
  const { data: link } = await supabase
    .from('payment_links')
    .select('order_id')
    .eq('viva_order_code', orderCode)
    .maybeSingle()

  if (!link || !link.order_id) {
    return { status: 'unknown', transactionId, message: `No payment_links row for orderCode=${orderCode}` }
  }

  // Load the order row (need total + order_number for response messages).
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, total')
    .eq('id', link.order_id)
    .single()

  if (!order) {
    return { status: 'unknown', transactionId, message: `Order ${link.order_id} not found` }
  }

  const orderId = order.id as string
  const orderNumber = order.order_number as string
  const dbTotalCents = order.total as number
  const amountCents = normalizeAmountCents(Number(data.amount), dbTotalCents)

  // Always record last_verified_at + the observed status/tx — even on mismatch.
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
    if (amountCents !== dbTotalCents) {
      // CRITICAL: never mark paid on amount mismatch. Log loudly.
      console.error(
        '[viva-verify] AMOUNT MISMATCH orderId=%s orderCode=%s vivaCents=%d dbCents=%d',
        orderId, orderCode, amountCents, dbTotalCents,
      )
      return {
        status: 'mismatch',
        orderId, orderNumber, transactionId,
        vivaCents: amountCents, dbCents: dbTotalCents,
      }
    }
    await markPaid(orderId, transactionId, amountCents)
    return { status: 'paid', orderId, orderNumber, amountCents, transactionId }
  }

  if (statusId === 'E' || statusId === 'X') {
    const reason = data.errorText ? `${statusId}: ${data.errorText}` : `statusId=${statusId}`
    await markFailed(orderId, transactionId, reason)
    return { status: 'failed', orderId, orderNumber, reason, transactionId }
  }

  // A (authorised, pre-auth flow) / anything else — leave pending.
  return { status: 'pending', orderId, statusId, transactionId }
}
