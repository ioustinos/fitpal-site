// Viva refund helper. Called exclusively from the admin-only
// viva-refund Netlify Function (the admin drawer's Refund tab).
//
// Behavior:
//   - Validates refund amount fits in (order.total - orders.refund_amount).
//   - DELETE https://{checkoutHost}/api/transactions/{id}/?amount=&sourceCode=
//     with Basic auth (MerchantId:ApiKey). Per Viva's "Issue a refund" doc,
//     the endpoint lives on the *checkout host* (demo.vivapayments.com /
//     www.vivapayments.com), NOT the API host, and uses DELETE not POST.
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

  // Call Viva refund via DELETE /api/transactions/{id}/ on the CHECKOUT host
  // (demo.vivapayments.com / www.vivapayments.com), with Basic auth using
  // MerchantId:ApiKey. NOT the API host, NOT OAuth — confirmed by Viva docs.
  const creds = getVivaCreds()
  const basic = Buffer.from(`${creds.merchantId}:${creds.apiKey}`).toString('base64')
  // Trailing slash on the path is important per Viva's documented format.
  const url = new URL(
    `https://${creds.checkoutHost}/api/transactions/${encodeURIComponent(link.transaction_id as string)}/`,
  )
  url.searchParams.set('amount', String(refundCents))
  url.searchParams.set('sourceCode', creds.sourceCode)

  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Basic ${basic}` },
  })

  const responseText = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`Viva refund failed: ${res.status} ${responseText}`)
  }
  // Viva returns 200 with { Success: true, StatusId: 'F', ... } on success
  // and { Success: false, StatusId: 'E', ErrorCode: ..., ErrorText: ... } on
  // application-level failure. Treat StatusId !== 'F' as error.
  let parsed: { StatusId?: string; ErrorCode?: number; ErrorText?: string; Success?: boolean } = {}
  try { parsed = JSON.parse(responseText) } catch { /* leave empty */ }
  if (parsed.StatusId && parsed.StatusId !== 'F') {
    throw new Error(`Viva refund declined: ${parsed.ErrorCode ?? '?'} ${parsed.ErrorText ?? 'unknown'}`)
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
