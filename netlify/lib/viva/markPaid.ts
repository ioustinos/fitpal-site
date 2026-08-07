// Idempotent "flip this order to paid / failed" helpers.
//
// All three Viva paths (return-URL verify, webhook, reconcile poll) funnel
// through these helpers. The UPDATE is guarded by `payment_status = 'pending'`
// so concurrent calls from different layers produce exactly one row change.
//
// WEC-172: part of the Viva Payments integration epic (WEC-125).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendMetaCapiEvent, metaConfigured, hashLower, hashPhone } from '../metaCapi'
import { fireOrderConfirmationFromDb } from '../orderConfirmationEmail'

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

  // WEC-607: payments can now be PARTIAL — a link may be for less than the order
  // total, and several links can coexist. The just-paid link is already marked
  // 'success' by verify.ts, so the payment ledger (order_payment_summary)
  // already counts it. Flip the whole order to 'paid' ONLY when the sum of
  // everything collected covers the total; otherwise leave it pending (partial).
  const { data: sum } = await supabase.rpc('order_payment_summary', { p_order_id: orderId })
  const s = (Array.isArray(sum) ? sum[0] : sum) as { total: number; paid: number } | undefined
  const total = s?.total ?? 0
  const paid = s?.paid ?? 0

  if (!(total > 0 && paid >= total)) {
    // Partial payment — order stays pending. verify.ts only calls markPaid on the
    // FIRST transition of a given link (guarded), so this logs once per link.
    await audit(
      orderId, 'partial', 'partial',
      `Viva partial payment · tx=${transactionId} · €${(amountCents / 100).toFixed(2)} · collected ${(paid / 100).toFixed(2)}/${(total / 100).toFixed(2)} €`,
    )
    return false
  }

  const { data, error } = await supabase
    .from('orders')
    // WEC-477: a card order is only Airtable-mirror-eligible once paid. It was
    // never flagged at submit (card+pending is skipped), and the dirty trigger
    // won't auto-flag a never-mirrored row, so flag it explicitly here. The
    // 5-min airtable-reconcile then pushes it.
    .update({ payment_status: 'paid', airtable_dirty: true, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    // WEC-599: «pending_link_sent» is still unpaid — the guard must accept it or
    // the webhook/return/reconcile paths silently stop flipping link-sent orders
    // to paid. Both values still funnel through the same idempotent single-row win.
    .in('payment_status', ['pending', 'pending_link_sent'])
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('markPaid update failed for orderId=%s:', orderId, error)
    throw error
  }

  if (!data) return false

  await audit(orderId, 'pending', 'paid', `Viva paid · tx=${transactionId} · €${(amountCents / 100).toFixed(2)} · covers total`)

  // WEC-397: server-side Purchase to Meta CAPI. Card orders redirect to Viva
  // before the confirmation screen, so the browser never fires Purchase — this
  // is the authoritative fire (survives a closed tab; runs once thanks to the
  // pending→paid guard above). Same event_id as the client (`purchase:<order#>`)
  // so any overlap with link/wallet orders deduplicates at Meta. Fail-soft.
  await firePurchaseCapi(supabase, orderId, amountCents)

  // WEC-498: card / link orders skip the "Order Placed" confirmation email at
  // submit (the order was still pending then). Now that payment is confirmed,
  // fire it here. Runs only on the call that won the pending→paid race above,
  // so it sends exactly once across all three Viva layers. Fail-soft.
  // WEC-580: explicit kind. Default is already 'order_paid_confirmation', but
  // stating it keeps the two call-sites (submit vs markPaid) self-documenting.
  await fireOrderConfirmationFromDb(supabase, orderId, { kind: 'order_paid_confirmation' })
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

  // WEC-607: with coexisting links, one link failing/cancelling must NOT fail an
  // order that already collected a partial payment on another link. Only fail
  // when nothing has been collected yet.
  const { data: sum } = await supabase.rpc('order_payment_summary', { p_order_id: orderId })
  const s = (Array.isArray(sum) ? sum[0] : sum) as { paid: number } | undefined
  if ((s?.paid ?? 0) > 0) {
    await audit(orderId, 'partial', 'partial', `Viva link failed · tx=${transactionId} · ${reason} (order kept — partial payment on file)`)
    return false
  }

  const { data } = await supabase
    .from('orders')
    .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    // WEC-599: accept «pending_link_sent» as well (still unpaid).
    .in('payment_status', ['pending', 'pending_link_sent'])
    .select('id')
    .maybeSingle()

  if (!data) return false

  await audit(orderId, 'pending', 'failed', `Viva failed · tx=${transactionId} · ${reason}`)
  return true
}
