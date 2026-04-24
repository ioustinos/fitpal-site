// Viva refund helper. Called exclusively from the admin-only
// viva-refund Netlify Function (the admin drawer's Refund tab).
//
// Behavior:
//   - Validates refund amount fits in (order.total - orders.refund_amount).
//   - POST /api/transactions/{id}?Amount=...&SourceCode=... with Basic auth
//     (MerchantId:ApiKey). Confirmed by Viva support: this endpoint does
//     NOT accept OAuth bearer tokens even for Smart Checkout accounts.
//     The /checkout/v2/ path is not used for refunds.
//   - On success, increments orders.refund_amount; flips payment_status
//     to 'refunded' if cumulative >= total. Writes admin_change_log.
//
// WEC-175: part of the Viva Payments integration epic (WEC-125).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaCreds } from './env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export interface RefundArgs {
  orderId: string
  /** Omit for full refund of the remaining unpaid amount. */
  amountCents?: number
  reason: string
  adminUserId: string
}

export interface RefundResult {
  refundedCents: number
  newRefundTotal: number
  orderRefunded: boolean
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function refundVivaTransaction(args: RefundArgs): Promise<RefundResult> {
  if (!args.orderId) throw new Error('orderId required')
  if (!args.reason?.trim()) throw new Error('reason required')

  const supabase = serviceClient()

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, total, refund_amount, payment_status')
    .eq('id', args.orderId)
    .single()
  if (!order) throw new Error(`Order ${args.orderId} not found`)

  const { data: link } = await supabase
    .from('payment_links')
    .select('transaction_id, viva_order_code')
    .eq('order_id', args.orderId)
    .not('transaction_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!link || !link.transaction_id) {
    throw new Error('No Viva transaction found on this order — refund via wallet or mark manually')
  }

  const totalCents = order.total as number
  const currentRefund = (order.refund_amount ?? 0) as number
  const remaining = totalCents - currentRefund
  if (remaining <= 0) throw new Error('Order has no refundable balance remaining')

  const refundCents = args.amountCents ?? remaining
  if (!Number.isInteger(refundCents) || refundCents <= 0) throw new Error('Refund amount must be a positive integer (cents)')
  if (refundCents > remaining) {
    throw new Error(`Refund €${(refundCents / 100).toFixed(2)} exceeds remaining €${(remaining / 100).toFixed(2)}`)
  }

  // Call Viva refund via the legacy /api/transactions/{id} endpoint.
  // Authentication: Basic auth with MerchantId:ApiKey (NOT OAuth bearer).
  // Per Viva support, Smart Checkout OAuth cannot be used for refunds.
  const creds = getVivaCreds()
  const basic = Buffer.from(`${creds.merchantId}:${creds.apiKey}`).toString('base64')
  const url = new URL(
    `https://${creds.apiHost}/api/transactions/${encodeURIComponent(link.transaction_id as string)}`,
  )
  url.searchParams.set('Amount', String(refundCents))
  url.searchParams.set('SourceCode', creds.sourceCode)

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      'Content-Length': '0',
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Viva refund failed: ${res.status} ${body}`)
  }

  const newTotalRefunded = currentRefund + refundCents
  const isFullyRefunded = newTotalRefunded >= totalCents

  const updates: Record<string, unknown> = {
    refund_amount: newTotalRefunded,
    updated_at: new Date().toISOString(),
  }
  if (isFullyRefunded) updates.payment_status = 'refunded'

  await supabase.from('orders').update(updates).eq('id', args.orderId)

  await supabase.from('admin_change_log').insert({
    order_id: args.orderId,
    table_name: 'orders',
    field_name: 'refund_amount',
    old_value: String(currentRefund),
    new_value: String(newTotalRefunded),
    label: `Viva refund €${(refundCents / 100).toFixed(2)} — ${args.reason}`,
    admin_user: args.adminUserId,
  })

  return {
    refundedCents: refundCents,
    newRefundTotal: newTotalRefunded,
    orderRefunded: isFullyRefunded,
  }
}
