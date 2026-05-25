// Idempotent "flip this order to paid / failed" helpers.
//
// All three Viva paths (return-URL verify, webhook, reconcile poll) funnel
// through these helpers. The UPDATE is guarded by `payment_status = 'pending'`
// so concurrent calls from different layers produce exactly one row change.
//
// WEC-172: part of the Viva Payments integration epic (WEC-125).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendMetaCapiEvent, metaConfigured, hashLower, hashPhone } from '../metaCapi'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function audit(
  orderId: string,
  oldValue: string,
  newValue: string,
  label: string,
): Promise<void> {
  try {
    const supabase = serviceClient()
    await supabase.from('admin_change_log').insert({
      order_id: orderId,
      table_name: 'orders',
      field_name: 'payment_status',
      old_value: oldValue,
      new_value: newValue,
      label,
      admin_user: 'system_viva',
    })
  } catch (err) {
    // Audit failure must never block the state change.
    console.error('admin_change_log insert failed for orderId=%s:', orderId, err)
  }
}

/**
 * Flip an order from `pending` → `paid`. Returns true if this call won the
 * race; false if the row was already non-pending (another layer beat us,
 * or the order was cancelled in the meantime).
 *
 * Idempotent: safe to call multiple times concurrently.
 */
export async function markPaid(
  orderId: string,
  transactionId: string,
  amountCents: number,
): Promise<boolean> {
  const supabase = serviceClient()

  const { data, error } = await supabase
    .from('orders')
    .update({ payment_status: 'paid', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('markPaid update failed for orderId=%s:', orderId, error)
    throw error
  }

  if (!data) return false

  await audit(orderId, 'pending', 'paid', `Viva paid · tx=${transactionId} · €${(amountCents / 100).toFixed(2)}`)

  // WEC-397: server-side Purchase to Meta CAPI. Card orders redirect to Viva
  // before the confirmation screen, so the browser never fires Purchase — this
  // is the authoritative fire (survives a closed tab; runs once thanks to the
  // pending→paid guard above). Same event_id as the client (`purchase:<order#>`)
  // so any overlap with link/wallet orders deduplicates at Meta. Fail-soft.
  await firePurchaseCapi(supabase, orderId, amountCents)
  return true
}

/** Fire a Meta CAPI Purchase for a just-paid order. Never throws. */
async function firePurchaseCapi(
  supabase: SupabaseClient,
  orderId: string,
  amountCents: number,
): Promise<void> {
  if (!metaConfigured()) return
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('order_number, total, customer_email, customer_phone, user_id')
      .eq('id', orderId)
      .maybeSingle()
    if (!order) return
    await sendMetaCapiEvent({
      eventName: 'Purchase',
      eventId: `purchase:${order.order_number}`,
      userData: {
        em: hashLower(order.customer_email),
        ph: hashPhone(order.customer_phone),
        external_id: hashLower(order.user_id),
      },
      customData: {
        currency: 'EUR',
        value: Math.round(order.total ?? amountCents) / 100,
        order_id: order.order_number,
      },
    })
  } catch (e) {
    console.error('[markPaid] purchase CAPI failed (non-fatal) for orderId=%s:', orderId, e)
  }
}

/**
 * Flip an order from `pending` → `failed`. Same idempotency guard.
 * Called for Viva statusId `E` (error) or `X` (cancelled).
 */
export async function markFailed(
  orderId: string,
  transactionId: string,
  reason: string,
): Promise<boolean> {
  const supabase = serviceClient()

  const { data } = await supabase
    .from('orders')
    .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()

  if (!data) return false

  await audit(orderId, 'pending', 'failed', `Viva failed · tx=${transactionId} · ${reason}`)
  return true
}
