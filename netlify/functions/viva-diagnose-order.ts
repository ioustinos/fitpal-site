// Admin-only Viva order diagnostic — "why did this payment not complete?"
//
// Given a Viva orderCode (the 16-digit code we stash on wallet_plans /
// payment_links before the redirect), this returns everything we can learn
// about that attempt, from BOTH our DB and Viva, so an admin can tell a
// declined card apart from an abandoned checkout without logging into the
// Viva dashboard.
//
// WEC-789. Motivated by a real case (subscription, EUR 634.87): three card
// attempts, all left with no transactionId, one marked `failed` purely by the
// failure-return path (revert-wallet-plan) which never asks Viva why. So we
// had no decline reason on record. This endpoint fills that blind spot on
// demand; a follow-up wires the same lookup into the failure path so it is
// captured automatically.
//
// Auth: Supabase JWT in Authorization: Bearer <token>, verified against
// public.is_admin() (mirrors viva-refund). Non-admin -> 403, missing -> 401.
//
// Read-only. Touches no DB rows, changes no payment state.

import { createClient } from '@supabase/supabase-js'
import { getVivaAccessToken } from '../lib/viva/auth'
import { getVivaCreds } from '../lib/viva/env'
import { getVivaOrderState } from '../lib/viva/orderState'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface AdminOk { userId: string }
interface AdminErr { error: string; status: number }

async function assertAdmin(token: string): Promise<AdminOk | AdminErr> {
  if (!token) return { error: 'Missing Authorization header', status: 401 }
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userRes } = await supa.auth.getUser()
  if (!userRes?.user) return { error: 'Invalid session', status: 401 }
  const { data, error } = await supa.rpc('is_admin')
  if (error) return { error: `Admin check failed: ${error.message}`, status: 500 }
  if (!data) return { error: 'Forbidden - admin role required', status: 403 }
  return { userId: userRes.user.id }
}

interface VivaTxn {
  transactionId: string
  statusId: string | null
  errorCode: number | string | null
  errorText: string | null
  amountEuros: number | null
}

/** F = finalized (paid), A = authorised, E = error/declined, X = cancelled. */
function txnStatusLabel(statusId: string | null): string {
  switch (statusId) {
    case 'F': return 'paid (finalized)'
    case 'A': return 'authorised (not captured)'
    case 'E': return 'error / declined'
    case 'X': return 'cancelled'
    case 'M': return 'awaiting authentication'
    default:  return statusId ? `statusId=${statusId}` : 'unknown'
  }
}

/**
 * Best-effort list of the transactions Viva recorded for an orderCode, each
 * enriched with its decline reason. Uses the OAuth Smart Checkout endpoints.
 *
 * WEC-432: GET /checkout/v2/orders/{orderCode} has been observed to 404 for
 * every code we tried - so this may legitimately return an empty list even
 * when the legacy order-state endpoint knows the order. An empty list is NOT
 * proof no card was tried; read it together with orderState and the DB rows.
 */
async function listTransactionsWithReasons(orderCode: string): Promise<{
  txns: VivaTxn[]
  listOk: boolean
  note: string | null
}> {
  const creds = getVivaCreds()
  let token: string
  try {
    token = await getVivaAccessToken()
  } catch (err) {
    return { txns: [], listOk: false, note: `OAuth token fetch failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  let listRes: Response
  try {
    listRes = await fetch(
      `https://${creds.apiHost}/checkout/v2/orders/${encodeURIComponent(orderCode)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  } catch (err) {
    return { txns: [], listOk: false, note: `orders lookup network error: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (listRes.status === 404) {
    return { txns: [], listOk: false, note: 'orders/{code} returned 404 (expected for many codes - see WEC-432)' }
  }
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => '')
    return { txns: [], listOk: false, note: `orders/{code} ${listRes.status}: ${body.slice(0, 200)}` }
  }
  const listData = (await listRes.json()) as { transactions?: Array<{ transactionId?: string; statusId?: string }> }
  const ids = (listData.transactions ?? [])
    .map((t) => t.transactionId)
    .filter((id): id is string => typeof id === 'string')

  const txns: VivaTxn[] = []
  for (const id of ids) {
    try {
      const res = await fetch(
        `https://${creds.apiHost}/checkout/v2/transactions/${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) {
        txns.push({ transactionId: id, statusId: null, errorCode: null, errorText: `retrieve ${res.status}`, amountEuros: null })
        continue
      }
      const d = (await res.json()) as {
        statusId?: string; amount?: number; errorCode?: number | string; errorText?: string
      }
      txns.push({
        transactionId: id,
        statusId: d.statusId ?? null,
        errorCode: d.errorCode ?? null,
        errorText: d.errorText ?? null,
        amountEuros: typeof d.amount === 'number' ? d.amount : null,
      })
    } catch (err) {
      txns.push({ transactionId: id, statusId: null, errorCode: null, errorText: `retrieve error: ${err instanceof Error ? err.message : String(err)}`, amountEuros: null })
    }
  }
  return { txns, listOk: true, note: null }
}

/** Map a legacy StateId + transaction list into a one-line plain verdict. */
function buildVerdict(orderStateId: number | null, txns: VivaTxn[]): string {
  const declined = txns.find((t) => t.statusId === 'E' || t.statusId === 'X')
  if (declined) {
    const reason = declined.errorText ? `: ${declined.errorText}` : (declined.errorCode != null ? ` (code ${declined.errorCode})` : '')
    return `Card was submitted and Viva did NOT complete it${reason}. This is a decline/cancel on the bank/Viva side, not our bug.`
  }
  if (txns.some((t) => t.statusId === 'F')) {
    return 'Viva shows a FINALIZED (paid) transaction for this order - if our DB says pending/failed, this is a reconcile gap, not a customer problem.'
  }
  if (orderStateId === 3) {
    return 'Viva order state is Captured/paid - reconcile gap on our side; investigate.'
  }
  if (orderStateId === 0) {
    return 'Viva order is still Created/awaiting payment with no completed transaction - the customer never finished paying (closed the page / cancelled before submitting a card). No decline code exists because nothing was charged.'
  }
  return 'No completed or declined transaction found for this order code. Most consistent with an abandoned checkout (customer left before Viva processed a card). Confirm against the Viva dashboard if a decline code is needed.'
}

export default async (request: Request): Promise<Response> => {
  const cors = corsHeaders(request, 'POST, GET, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const who = await assertAdmin(token)
  if ('error' in who) return Response.json({ error: who.error }, { status: who.status, headers: cors })

  let orderCode = ''
  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as { orderCode?: string | number }
      orderCode = String(body.orderCode ?? '').trim()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
    }
  } else if (request.method === 'GET') {
    try { orderCode = (new URL(request.url).searchParams.get('orderCode') ?? '').trim() } catch { /* noop */ }
  } else {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }
  if (!/^\d{6,20}$/.test(orderCode)) {
    return Response.json({ error: 'orderCode must be the numeric Viva order code' }, { status: 400, headers: cors })
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: plan } = await svc
    .from('wallet_plans')
    .select('id, payment_method, payment_status, viva_transaction_id, amount_to_pay_cents, created_at, updated_at, confirmed_at')
    .eq('viva_order_code', orderCode)
    .maybeSingle()

  const { data: link } = await svc
    .from('payment_links')
    .select('order_id, status')
    .eq('viva_order_code', orderCode)
    .maybeSingle()

  let order: Record<string, unknown> | null = null
  if (link?.order_id) {
    const { data: o } = await svc
      .from('orders')
      .select('id, order_number, payment_method, payment_status, total')
      .eq('id', link.order_id)
      .maybeSingle()
    order = o ?? null
  }

  const { data: events } = await svc
    .from('viva_events')
    .select('created_at, source, kind, outcome, message, status_id')
    .eq('order_code', orderCode)
    .order('created_at', { ascending: true })

  const orderState = await getVivaOrderState(orderCode)
  const { txns, listOk, note } = await listTransactionsWithReasons(orderCode)

  const verdict = buildVerdict(orderState.stateId, txns)

  return Response.json({
    orderCode,
    env: getVivaCreds().env,
    db: {
      walletPlan: plan
        ? { id: plan.id, paymentMethod: plan.payment_method, paymentStatus: plan.payment_status,
            hasTransactionId: !!plan.viva_transaction_id, amountToPayCents: plan.amount_to_pay_cents,
            createdAt: plan.created_at, updatedAt: plan.updated_at, confirmedAt: plan.confirmed_at }
        : null,
      order: order
        ? { id: order.id, orderNumber: order.order_number, paymentMethod: order.payment_method,
            paymentStatus: order.payment_status, totalCents: order.total }
        : null,
      ourVivaEvents: events ?? [],
    },
    viva: {
      orderState: { state: orderState.state, stateId: orderState.stateId, requestAmountEuros: orderState.requestAmount, merchantTrns: orderState.merchantTrns },
      transactions: txns.map((t) => ({ ...t, statusLabel: txnStatusLabel(t.statusId) })),
      transactionListOk: listOk,
      transactionListNote: note,
    },
    verdict,
  }, { headers: cors })
}
