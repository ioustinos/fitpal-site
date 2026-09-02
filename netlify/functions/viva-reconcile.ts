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
import { verifyWalletPlanTransaction } from '../lib/wallet/verifyWalletPlanTransaction'
import { getVivaOrderState } from '../lib/viva/orderState'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const BATCH_LIMIT = 50

interface PendingRow {
  order_id: string
  viva_order_code: string
}

interface PendingWalletPlanRow {
  id: string
  viva_order_code: string
  amount_cents: number
  created_at: string
}

interface VivaOrderTransactions {
  transactions?: Array<{ transactionId?: string; statusId?: string }>
}

// WEC-425: structured view of a Viva orderCode lookup — returns the raw rows
// so verify-before-cancel can branch on statusId without re-fetching.
interface VivaTransactionSummary {
  transactionId: string
  statusId: string | null
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** WEC-425: parse `?dryRun=1` from the request URL. Scheduled invocations
 *  may pass no Request at all (Netlify scheduled fn signature); treat that
 *  as live. Accepts `1`, `true`, `yes` (case-insensitive). */
function readDryRun(request?: Request): boolean {
  if (!request) return false
  try {
    const u = new URL(request.url)
    const v = (u.searchParams.get('dryRun') ?? '').toLowerCase()
    return v === '1' || v === 'true' || v === 'yes'
  } catch {
    return false
  }
}

/** List all transactions Viva has recorded for an orderCode. */
async function listVivaTransactions(orderCode: string): Promise<string[]> {
  const summaries = await listVivaTransactionSummaries(orderCode)
  return summaries.map((t) => t.transactionId)
}

/** WEC-425: like listVivaTransactions but keeps the statusId, so the
 *  verify-before-cancel path can decide "is any of these PAID?" without a
 *  second fetch per transaction. Viva's `statusId = 'F'` means Finalized
 *  (paid); anything else is in-flight / failed / refused. */
async function listVivaTransactionSummaries(orderCode: string): Promise<VivaTransactionSummary[]> {
  const token = await getVivaAccessToken()
  const creds = getVivaCreds()
  const res = await fetch(
    `https://${creds.apiHost}/checkout/v2/orders/${encodeURIComponent(orderCode)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    if (res.status === 404) return []
    const body = await res.text().catch(() => '')
    throw new Error(`Viva list-transactions failed: ${res.status} ${body}`)
  }
  const data = (await res.json()) as VivaOrderTransactions
  return (data.transactions ?? [])
    .filter((t): t is { transactionId: string; statusId?: string } => typeof t.transactionId === 'string')
    .map((t) => ({ transactionId: t.transactionId, statusId: t.statusId ?? null }))
}

// WEC-425: signature now accepts Request so we can read ?dryRun=1 from a
// manual invocation (testBot harness / admin probe). Scheduled invocations
// pass no body / no query — dryRun stays false.
export default async (request?: Request) => {
  const dryRun = readDryRun(request)
  const startMs = Date.now()
  const supabase = serviceClient()
  let checked = 0, paid = 0, failedN = 0, stillPending = 0, cancelledTimeout = 0, errors = 0
  // WEC-425: verify-before-cancel saved counters. A non-zero "rescued" count
  // is a LOUD canary — Phase 2 was about to cancel a row Viva considers paid.
  let rescuedFromCancelOrders = 0, rescuedFromCancelWalletPlans = 0
  const errorNotes: string[] = []
  const dryRunActions: string[] = []

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
      // WEC-425: in dry-run, use the summary call (which doesn't mutate) and
      // infer the outcome from statusId, instead of calling verifyVivaTransaction
      // (which would markPaid → mutate the DB).
      const txs = await listVivaTransactionSummaries(row.viva_order_code)
      if (txs.length === 0) {
        if (!dryRun) {
          await supabase
            .from('payment_links')
            .update({ last_verified_at: new Date().toISOString() })
            .eq('viva_order_code', row.viva_order_code)
        }
        stillPending++
        continue
      }
      const latestTx = txs[txs.length - 1]
      if (dryRun) {
        if (latestTx.statusId === 'F') paid++
        else if (latestTx.statusId === 'X' || latestTx.statusId === 'E') failedN++
        else stillPending++
        dryRunActions.push(`verify order ${row.order_id} tx=${latestTx.transactionId} statusId=${latestTx.statusId}`)
        continue
      }
      const outcome = await verifyVivaTransaction(latestTx.transactionId)
      if (outcome.status === 'paid') paid++
      else if (outcome.status === 'failed') failedN++
      else stillPending++
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      errorNotes.push(`${row.viva_order_code}: ${msg}`)
      console.error('[viva-reconcile] error for orderCode=%s:', row.viva_order_code, err)
    }
  }

  // ── 1b. Find stale pending WALLET PLANS via parallel SQL function ──
  let walletChecked = 0, walletPaid = 0, walletFailed = 0, walletStillPending = 0
  const { data: walletRows, error: walletFnErr } = await supabase.rpc('viva_stale_pending_wallet_plans', {
    p_limit: BATCH_LIMIT,
  })
  if (walletFnErr) {
    console.error('[viva-reconcile] viva_stale_pending_wallet_plans RPC failed:', walletFnErr)
    errorNotes.push(`wallet_rpc: ${walletFnErr.message}`)
  } else {
    const planRows: PendingWalletPlanRow[] = (walletRows ?? []) as PendingWalletPlanRow[]
    for (const row of planRows) {
      walletChecked++
      try {
        const txs = await listVivaTransactionSummaries(row.viva_order_code)
        if (txs.length === 0) { walletStillPending++; continue }
        const latestTx = txs[txs.length - 1]
        if (dryRun) {
          if (latestTx.statusId === 'F') walletPaid++
          else if (latestTx.statusId === 'X' || latestTx.statusId === 'E') walletFailed++
          else walletStillPending++
          dryRunActions.push(`verify wp/${row.id} tx=${latestTx.transactionId} statusId=${latestTx.statusId}`)
          continue
        }
        const outcome = await verifyWalletPlanTransaction(latestTx.transactionId)
        if (outcome.status === 'paid')        walletPaid++
        else if (outcome.status === 'failed') walletFailed++
        else                                   walletStillPending++
      } catch (err) {
        errors++
        const msg = err instanceof Error ? err.message : String(err)
        errorNotes.push(`wp/${row.viva_order_code}: ${msg}`)
        console.error('[viva-reconcile] wallet plan error orderCode=%s:', row.viva_order_code, err)
      }
    }
  }

  // ── 2. Cancel orphan pending card/link orders older than 48h ───────
  //
  // WEC-425 hardening: before flipping any row to 'failed' / 'cancelled',
  // fetch its Viva transactions one final time. If Viva has a FINALIZED
  // (statusId='F') transaction for the row, ABORT THE CANCEL and emit a
  // loud canary log — that's a webhook-missed-AND-return-URL-missed case
  // and reconcile must NOT mask it by cancelling the row out from under us.
  //
  // Previously: this loop did a single bulk UPDATE with no per-row Viva
  // check (the per-row check in Phase 1 is gated by created_at < 48h, so
  // Phase 1 NEVER inspected the rows that Phase 2 then cancelled).
  const abandonThreshold = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data: orphanCandidates } = await supabase
    .from('orders')
    .select('id, payment_method, viva_order_code:payment_links(viva_order_code)')
    // payment_links join above resolves implicitly; explicit join via
    // payment_links is cleaner — fetch viva_order_code in a follow-up query
    // to keep this readable.
    .in('payment_method', ['card', 'link'])
    // WEC-599: «pending_link_sent» is still an unpaid orphan candidate.
    .in('payment_status', ['pending', 'pending_link_sent'])
    .lt('created_at', abandonThreshold)
  // Build a map of order_id → viva_order_code via payment_links for the
  // verify-before-cancel step.
  const orphanIds = (orphanCandidates ?? []).map((o: { id: string }) => o.id)
  let orphanCodeByOrder = new Map<string, string | null>()
  if (orphanIds.length > 0) {
    const { data: links } = await supabase
      .from('payment_links')
      .select('order_id, viva_order_code')
      .in('order_id', orphanIds)
    for (const l of (links ?? []) as Array<{ order_id: string; viva_order_code: string | null }>) {
      orphanCodeByOrder.set(l.order_id, l.viva_order_code)
    }
  }

  for (const cand of (orphanCandidates ?? []) as Array<{ id: string }>) {
    const code = orphanCodeByOrder.get(cand.id) ?? null
    // No viva_order_code → Viva never knew about this order, safe to cancel.
    let vivaSaidPaid = false
    if (code) {
      // WEC-432: use the legacy Basic-auth order-state endpoint. The OAuth
      // /checkout/v2/orders/{code} we were calling returns 404 for every
      // orderCode (paid or not), making the rescue a no-op.
      const state = await getVivaOrderState(code)
      vivaSaidPaid = state.state === 'paid'
      if (state.state === 'unknown' && state.stateId === null) {
        // Endpoint errored / 404 / unknown StateId — leave the row pending
        // for next reconcile rather than risk a wrong cancel.
        errors++
        errorNotes.push(`pre-cancel state-unknown ${cand.id}: viva=${code}`)
        continue
      }
    }
    if (vivaSaidPaid) {
      rescuedFromCancelOrders++
      console.warn(
        '[viva-reconcile] CANARY: would-have-cancelled order %s but Viva says PAID (orderCode=%s) — webhook + return-URL both missed; admin must investigate manually (we lack the transactionId from this endpoint to call markPaid)',
        cand.id, code,
      )
      errorNotes.push(`rescued-from-cancel ${cand.id} viva=${code}`)
      // WEC-432: we DON'T flip to paid here — that needs a transactionId we
      // can't get from the state endpoint. Leaving the row alone is the
      // safe default; the CANARY log pages the admin to investigate.
      continue
    }

    if (dryRun) {
      dryRunActions.push(`cancel order ${cand.id} (viva=${code ?? 'none'})`)
      cancelledTimeout++
      continue
    }

    const { error: upErr } = await supabase
      .from('orders')
      .update({
        payment_status: 'failed',
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', cand.id)
      .eq('payment_status', 'pending')   // race guard (someone else may have flipped it)
    if (upErr) {
      errors++
      errorNotes.push(`cancel ${cand.id}: ${upErr.message}`)
      continue
    }
    cancelledTimeout++
    // WEC-425: provenance — every reconcile-driven cancel writes one row
    // each for status + payment_status, so the admin order timeline shows
    // exactly who flipped them. Best-effort; failure to log doesn't undo.
    try {
      await supabase.from('admin_change_log').insert([
        { table_name: 'orders', order_id: cand.id, field_name: 'status',
          old_value: 'pending', new_value: 'cancelled',
          label: 'reconcile-orphan-timeout', admin_user: 'system_reconcile' },
        { table_name: 'orders', order_id: cand.id, field_name: 'payment_status',
          old_value: 'pending', new_value: 'failed',
          label: 'reconcile-orphan-timeout', admin_user: 'system_reconcile' },
      ])
    } catch (err) {
      console.error('[viva-reconcile] admin_change_log insert failed:', err)
    }
  }

  // ── 2b. Cancel orphan pending wallet plans (card/link) older than 48h ─
  //
  // Same verify-before-cancel + dryRun hardening as Phase 2. wallet_plans
  // doesn't have a row in admin_change_log (different domain), so the audit
  // trail goes into a note via a follow-up update — see project_viva for
  // the dev-to-prod-checklist item to add a wallet_change_log table later.
  const { data: orphanPlans } = await supabase
    .from('wallet_plans')
    .select('id, viva_order_code')
    .in('payment_method', ['card', 'link'])
    .eq('payment_status', 'pending')
    .lt('created_at', abandonThreshold)
  let cancelledWalletTimeout = 0
  for (const plan of (orphanPlans ?? []) as Array<{ id: string; viva_order_code: string | null }>) {
    let vivaSaidPaid = false
    if (plan.viva_order_code) {
      // WEC-432: same legacy-Basic-auth swap as Phase 2 (orders).
      const state = await getVivaOrderState(plan.viva_order_code)
      vivaSaidPaid = state.state === 'paid'
      if (state.state === 'unknown' && state.stateId === null) {
        errors++
        errorNotes.push(`pre-cancel state-unknown wp/${plan.id}: viva=${plan.viva_order_code}`)
        continue
      }
    }
    if (vivaSaidPaid) {
      rescuedFromCancelWalletPlans++
      console.warn(
        '[viva-reconcile] CANARY: would-have-cancelled wallet_plan %s but Viva says PAID (orderCode=%s) — admin must investigate manually',
        plan.id, plan.viva_order_code,
      )
      errorNotes.push(`rescued-from-cancel wp/${plan.id} viva=${plan.viva_order_code}`)
      // WEC-432: don't try to mark paid — no transactionId available here.
      continue
    }
    if (dryRun) {
      dryRunActions.push(`cancel wallet_plan ${plan.id} (viva=${plan.viva_order_code ?? 'none'})`)
      cancelledWalletTimeout++
      continue
    }
    const { error: upErr } = await supabase
      .from('wallet_plans')
      .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', plan.id)
      .eq('payment_status', 'pending')
    if (upErr) {
      errors++
      errorNotes.push(`cancel wp/${plan.id}: ${upErr.message}`)
      continue
    }
    cancelledWalletTimeout++
  }

  const summary = {
    dryRun,
    checked, paid, failed: failedN, stillPending, cancelledTimeout, errors,
    walletChecked, walletPaid, walletFailed, walletStillPending, cancelledWalletTimeout,
    rescuedFromCancelOrders, rescuedFromCancelWalletPlans,
  }
  if (paid > 0) {
    console.warn('[viva-reconcile] RESCUED %d pending orders — webhook may be unhealthy', paid)
  }
  if (walletPaid > 0) {
    console.warn('[viva-reconcile] RESCUED %d pending wallet plans — webhook may be unhealthy', walletPaid)
  }
  if (rescuedFromCancelOrders > 0 || rescuedFromCancelWalletPlans > 0) {
    console.warn(
      '[viva-reconcile] CANARY rescued-from-cancel orders=%d wallet_plans=%d — webhook + return-URL both missed',
      rescuedFromCancelOrders, rescuedFromCancelWalletPlans,
    )
  }
  console.info('[viva-reconcile]', summary)

  // Record this run so the admin dashboard can surface "last reconcile: Xm ago".
  // Also serves as the canary — `paid > 0` means the webhook missed something.
  // WEC-425: dry-run skips the insert; the testBot harness gets the answer
  // back in the response body without leaving a noise row in reconcile_runs.
  const durationMs = Date.now() - startMs
  if (dryRun) {
    return Response.json({ ...summary, durationMs, dryRunActions })
  }
  try {
    await supabase.from('reconcile_runs').insert({
      provider: 'viva',
      checked,
      paid,
      failed: failedN,
      still_pending: stillPending,
      cancelled_timeout: cancelledTimeout,
      errors,
      duration_ms: durationMs,
      notes: errorNotes.length ? errorNotes.slice(0, 10).join(' | ') : null,
    })
  } catch (err) {
    console.error('[viva-reconcile] failed to log run:', err)
  }

  return Response.json({ ...summary, durationMs })
}

// Netlify scheduled function config — runs every 5 min.
export const config = {
  schedule: '*/5 * * * *',
}
