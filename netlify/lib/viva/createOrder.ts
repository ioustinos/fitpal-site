// Creates a Viva Smart Checkout order and persists a payment_links row
// linking our internal orderId to it. Returns the hosted checkout URL.
//
// Anti-tamper: the caller passes amountCents, and we re-read orders.total
// and confirm they match before calling Viva. Prevents a compromised client
// from submitting a low total and still getting a valid payment URL.
//
// WEC-171: part of the Viva Payments integration epic (WEC-125).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaAccessToken } from './auth'
import { getVivaCreds, checkoutUrl } from './env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export interface CreateOrderArgs {
  orderId: string
  amountCents: number
  customerEmail: string
  customerFullName: string
  /** 'card' = 30-min timeout; 'link' = 24h (admin-sent payment link). */
  mode: 'card' | 'link'
  /**
   * If true, any existing pending payment_links row for this order is
   * marked 'failure' before the new one is inserted. Used by the
   * "regenerate link" admin action (sub-issue 7 / WEC-176).
   */
  regenerate?: boolean
}

export interface CreateOrderResult {
  orderCode: string
  paymentUrl: string
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function createVivaOrder(args: CreateOrderArgs): Promise<CreateOrderResult> {
  if (!args.orderId) throw new Error('orderId is required')
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error(`amountCents must be a positive integer, got ${args.amountCents}`)
  }
  if (args.mode !== 'card' && args.mode !== 'link') {
    throw new Error(`Invalid mode: ${args.mode}`)
  }

  const supabase = serviceClient()

  // Verify order state + total match.
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, order_number, total, payment_status')
    .eq('id', args.orderId)
    .single()

  if (error || !order) throw new Error(`Order ${args.orderId} not found`)
  if (order.payment_status !== 'pending') {
    throw new Error(
      `Order ${args.orderId} is not pending (payment_status=${order.payment_status})`,
    )
  }
  if (order.total !== args.amountCents) {
    throw new Error(
      `Amount mismatch: order.total=${order.total}, args.amountCents=${args.amountCents}`,
    )
  }

  // Create the Viva checkout order.
  const token = await getVivaAccessToken()
  const creds = getVivaCreds()
  const paymentTimeOut = args.mode === 'link' ? 86400 : 1800

  const body = {
    amount: args.amountCents,
    customerTrns: order.order_number,
    merchantTrns: args.orderId,
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
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Viva create-order failed: ${res.status} ${errBody}`)
  }

  const json = (await res.json()) as { orderCode: number | string }
  const orderCode = String(json.orderCode)
  const paymentUrl = checkoutUrl(orderCode)

  // Regenerate mode: fail any pending row for this order first.
  if (args.regenerate) {
    await supabase
      .from('payment_links')
      .update({ status: 'failure', updated_at: new Date().toISOString() })
      .eq('order_id', args.orderId)
      .eq('status', 'pending')
  }

  const { error: insertErr } = await supabase.from('payment_links').insert({
    order_id: args.orderId,
    viva_order_code: orderCode,
    payment_url: paymentUrl,
    status: 'pending',
  })

  if (insertErr) {
    // The Viva order already exists; surfacing the URL keeps payment
    // possible even if our DB write drifted. Reconcile (WEC-174) will
    // detect the missing row and recover.
    console.error('payment_links insert failed for orderId=%s:', args.orderId, insertErr)
  }

  return { orderCode, paymentUrl }
}
