// Creates a Viva Smart Checkout order for a *wallet plan purchase*.
// Mirrors netlify/lib/viva/createOrder.ts but reads from `wallet_plans`
// instead of `orders`, and writes the resulting orderCode back to the
// wallet_plans row directly (no payment_links row needed — wallet_plans
// holds viva_order_code + viva_transaction_id natively).
//
// merchantTrns is encoded as `wp:<wallet_plan_id>` so the webhook +
// reconcile dispatchers can route by prefix.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaAccessToken } from '../viva/auth'
import { getVivaCreds, checkoutUrl } from '../viva/env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export interface CreateWalletPlanOrderArgs {
  walletPlanId: string
  amountCents: number
  customerEmail: string
  customerFullName: string
  /** 'card' = 30-min timeout (redirect flow); 'link' = 18h (admin-sent link) */
  mode: 'card' | 'link'
}

export interface CreateWalletPlanOrderResult {
  orderCode: string
  paymentUrl: string
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function createWalletPlanVivaOrder(
  args: CreateWalletPlanOrderArgs,
): Promise<CreateWalletPlanOrderResult> {
  if (!args.walletPlanId) throw new Error('walletPlanId required')
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error(`amountCents must be a positive integer, got ${args.amountCents}`)
  }
  if (args.mode !== 'card' && args.mode !== 'link') {
    throw new Error(`Invalid mode: ${args.mode}`)
  }

  const supabase = serviceClient()

  // Verify the wallet_plan row + amount match
  const { data: plan, error } = await supabase
    .from('wallet_plans')
    .select('id, amount_to_pay_cents, payment_status')
    .eq('id', args.walletPlanId)
    .single()

  if (error || !plan) throw new Error(`wallet_plan ${args.walletPlanId} not found`)
  if (plan.payment_status !== 'pending') {
    throw new Error(`wallet_plan ${args.walletPlanId} is not pending (status=${plan.payment_status})`)
  }
  if (plan.amount_to_pay_cents !== args.amountCents) {
    throw new Error(
      `Amount mismatch: plan=${plan.amount_to_pay_cents} arg=${args.amountCents}`,
    )
  }

  const token = await getVivaAccessToken()
  const creds = getVivaCreds()
  const paymentTimeOut = args.mode === 'link' ? 64800 : 1800

  const body = {
    amount: args.amountCents,
    customerTrns: `Fitpal Wallet · €${(args.amountCents / 100).toFixed(2)}`,
    merchantTrns: `wp:${args.walletPlanId}`,    // ← prefix lets webhook/reconcile route
    sourceCode: creds.sourceCode,
    customer: {
      email: args.customerEmail,
      fullName: args.customerFullName,
      countryCode: 'GR',
    },
    paymentTimeOut,
    preauth: false,
    allowRecurring: false,
    maxInstallments: 0,
  }

  const res = await fetch(`https://${creds.apiHost}/checkout/v2/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Viva create-order failed: ${res.status} ${errBody}`)
  }

  const json = (await res.json()) as { orderCode: number | string }
  const orderCode = String(json.orderCode)
  const paymentUrl = checkoutUrl(orderCode)

  // Persist orderCode on the wallet_plan
  const { error: updErr } = await supabase
    .from('wallet_plans')
    .update({ viva_order_code: orderCode, payment_method: args.mode === 'link' ? 'link' : 'card' })
    .eq('id', args.walletPlanId)

  if (updErr) {
    console.error('[createWalletPlanVivaOrder] failed to write orderCode for plan=%s:', args.walletPlanId, updErr)
    // Don't fail the request — the Viva order exists, the customer can still pay.
    // Reconcile will recover via merchantTrns lookup if our DB write drifted.
  }

  return { orderCode, paymentUrl }
}
