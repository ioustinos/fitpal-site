// WEC-504: durable Viva audit logging.
//
// Persists every Viva interaction (return-verify outcomes, wallet-plan verify,
// webhook payloads, transaction retrievals) into public.viva_events so the next
// payment incident is diagnosable straight from the DB instead of reverse-
// engineering from order state + a live Viva probe.
//
// Written service-role only (the table has RLS enabled with no policies).
// STRICTLY fail-soft — logging must never break or delay a payment flow.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface VivaEventLog {
  /** Where the event came from. */
  source: 'return_verify' | 'wallet_verify' | 'webhook' | 'reconcile'
  /** What kind of purchase, when known. */
  kind?: 'order' | 'wallet' | null
  orderId?: string | null
  walletPlanId?: string | null
  orderCode?: string | null
  transactionId?: string | null
  statusId?: string | null
  /** Normalized outcome: paid | failed | pending | unknown | mismatch | error. */
  outcome?: string | null
  message?: string | null
  amountCents?: number | null
  /** Raw Viva response or webhook body — kept verbatim for forensics. */
  payload?: unknown
}

export async function logVivaEvent(supabase: SupabaseClient, e: VivaEventLog): Promise<void> {
  try {
    await supabase.from('viva_events').insert({
      source: e.source,
      kind: e.kind ?? null,
      order_id: e.orderId ?? null,
      wallet_plan_id: e.walletPlanId ?? null,
      order_code: e.orderCode ?? null,
      transaction_id: e.transactionId ?? null,
      status_id: e.statusId ?? null,
      outcome: e.outcome ?? null,
      message: e.message ?? null,
      amount_cents: e.amountCents ?? null,
      payload: (e.payload ?? null) as never,
    })
  } catch (err) {
    console.warn('[logVivaEvent] failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}
