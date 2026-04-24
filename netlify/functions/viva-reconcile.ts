// Scheduled safety-net: catches orders that neither the return-URL path
// nor the webhook resolved. Runs every 5 minutes.
//
// Also cancels orphan `pending` card/link orders older than 48h.
//
// Reconcile flipping an order to `paid` is the canary for webhook
// problems — in steady state this function is a no-op.
//
// WEC-174: part of the Viva Payments integration epic (WEC-125).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaAccessToken } from '../lib/viva/auth'
import { getVivaCreds } from '../lib/viva/env'
import { verifyVivaTransaction } from '../lib/viva/verify'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const BATCH_LIMIT = 50

interface PendingRow {
  order_id: string
  viva_order_code: string
}

interface VivaOrderTransactions {
  transactions?: Array<{ transactionId?: string; statusId?: string }>
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** List all transactions Viva has recorded for an orderCode. */
async function listVivaTransactions(orderCode: string): Promise<string[]> {
  const token = await getVivaAccessToken()
  const creds = getVivaCreds()
  const res = await fetch(
    `https://${creds.apiHost}/checkout/v2/orders/${encodeURIComponent(orderCode)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    // 404 = no transactions yet. Not an error — customer just hasn't paid.
    if (res.status === 404) return []
    const body = await res.text().catch(() => '')
    throw new Error(`Viva list-transactions failed: ${res.status} ${body}`)
  }
  const data = (await res.json()) as VivaOrderTransactions
  return (data.transactions ?? [])
    .map((t) => t.transactionId)
    .filter((id): id is string => typeof id === 'string')
}

export default async () => {
  const supabase = serviceClient()
  let checked = 0, paid = 0, failedN = 0, stillPending = 0, cancelledTimeout = 0, errors = 0

  // ── 1. Find stale pending orders via SQL function ──────────────────
  const { data: rows, error: fnErr } = await supabase.rpc('viva_stale_pending_orders', {
    p_limit: BATCH_LIMIT,
  })
  if (fnErr) {
    console.error('[viva-reconcile] viva_stale_pending_orders RPC failed:', fnErr)
    return Response.json({ error: fnErr.message, checked: 0 }, { status: 500 })
  }
  const pendingRows: PendingRow[] = (rows ?? []) as PendingRow[]

  for (const row of pendingRows) {
    checked++
    try {
      const txIds = await listVivaTransactions(row.viva_order_code)
      if (txIds.length === 0) {
        await supabase
          .from('payment_links')
          .update({ last_verified_at: new Date().toISOString() })
          .eq('viva_order_code', row.viva_order_code)
        stillPending++
        continue
      }
      // Verify the most recent transaction.
      const latestTx = txIds[txIds.length - 1]
      const outcome = await verifyVivaTransaction(latestTx)
      if (outcome.status === 'paid') paid++
      else if (outcome.status === 'failed') failedN++
      else stillPending++
    } catch (err) {
      errors++
      console.error('[viva-reconcile] error for orderCode=%s:', row.viva_order_code, err)
    }
  }

  // ── 2. Cancel orphan pending card/link orders older than 48h ───────
  const abandonThreshold = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data: cancelled } = await supabase
    .from('orders')
    .update({
      payment_status: 'failed',
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .in('payment_method', ['card', 'link'])
    .eq('payment_status', 'pending')
    .lt('created_at', abandonThreshold)
    .select('id')

  cancelledTimeout = (cancelled ?? []).length

  const summary = { checked, paid, failed: failedN, stillPending, cancelledTimeout, errors }
  if (paid > 0) {
    console.warn('[viva-reconcile] RESCUED %d pending orders — webhook may be unhealthy', paid)
  }
  console.info('[viva-reconcile]', summary)
  return Response.json(summary)
}

// Netlify scheduled function config — runs every 5 min.
export const config = {
  schedule: '*/5 * * * *',
}
