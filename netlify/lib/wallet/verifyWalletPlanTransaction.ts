// Verify a Viva transaction that belongs to a *wallet plan* purchase.
// Mirrors netlify/lib/viva/verify.ts but for wallet_plans. Called from the
// webhook (after merchantTrns prefix routing) and the reconcile cron.
//
// Security model is identical: re-fetch via Viva's Retrieve Transaction API,
// validate orderCode + merchantTrns + amount, then call the idempotent SQL
// function `wallet_plan_mark_paid`. Never trusts the webhook payload.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaAccessToken } from '../viva/auth'
import { getVivaCreds } from '../viva/env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export type WalletVerifyOutcome =
  | { status: 'paid';     walletPlanId: string; amountCents: number; transactionId: string }
  | { status: 'failed';   walletPlanId: string; reason: string;     transactionId: string }
  | { status: 'pending';  walletPlanId: string | null; statusId: string; transactionId: string }
  | { status: 'unknown';  transactionId: string; message: string }
  | { status: 'mismatch'; walletPlanId: string; vivaCents: number; dbCents: number; transactionId: string }

interface VivaTransaction {
  orderCode: number | string
  statusId: string
  amount: number
  merchantTrns?: string
  transactionId?: string
  errorCode?: number | string
  errorText?: string
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Same defensive normalization as verify.ts */
function normalizeAmountCents(raw: number, dbCents: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (!Number.isInteger(raw)) return Math.round(raw * 100)
  if (raw === dbCents) return raw
  return raw * 100
}

export async function verifyWalletPlanTransaction(
  transactionId: string,
): Promise<WalletVerifyOutcome> {
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
  const merchantTrns = String(data.merchantTrns ?? '')

  // Parse the wp: prefix to extract our wallet_plan_id
  if (!merchantTrns.startsWith('wp:')) {
    return {
      status: 'unknown',
      transactionId,
      message: `merchantTrns "${merchantTrns}" is not a wallet plan ref`,
    }
  }
  const walletPlanId = merchantTrns.slice(3)

  const supabase = serviceClient()

  const { data: plan } = await supabase
    .from('wallet_plans')
    .select('id, amount_to_pay_cents, payment_status, viva_order_code')
    .eq('id', walletPlanId)
    .maybeSingle()

  if (!plan) {
    return { status: 'unknown', transactionId, message: `wallet_plan ${walletPlanId} not found` }
  }

  const dbCents = plan.amount_to_pay_cents as number
  const amountCents = normalizeAmountCents(Number(data.amount), dbCents)

  // Sanity-check orderCode matches the one we recorded (defense in depth)
  if (plan.viva_order_code && plan.viva_order_code !== orderCode) {
    console.error(
      '[verifyWalletPlanTransaction] orderCode mismatch planId=%s db=%s viva=%s',
      walletPlanId, plan.viva_order_code, orderCode,
    )
    return { status: 'unknown', transactionId, message: 'orderCode mismatch' }
  }

  if (statusId === 'F') {
    if (amountCents !== dbCents) {
      console.error(
        '[verifyWalletPlanTransaction] AMOUNT MISMATCH planId=%s vivaCents=%d dbCents=%d',
        walletPlanId, amountCents, dbCents,
      )
      return { status: 'mismatch', walletPlanId, vivaCents: amountCents, dbCents, transactionId }
    }

    const { error } = await supabase.rpc('wallet_plan_mark_paid', {
      p_plan_id: walletPlanId,
      p_transaction_id: transactionId,
      p_amount_cents: amountCents,
    })
    if (error) {
      console.error('[verifyWalletPlanTransaction] wallet_plan_mark_paid failed:', error)
      throw error
    }
    return { status: 'paid', walletPlanId, amountCents, transactionId }
  }

  if (statusId === 'E' || statusId === 'X') {
    const reason = data.errorText ? `${statusId}: ${data.errorText}` : `statusId=${statusId}`
    await supabase
      .from('wallet_plans')
      .update({ payment_status: 'failed' })
      .eq('id', walletPlanId)
      .eq('payment_status', 'pending')
    return { status: 'failed', walletPlanId, reason, transactionId }
  }

  return { status: 'pending', walletPlanId, statusId, transactionId }
}
