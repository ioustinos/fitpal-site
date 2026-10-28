// WEC-479: Airtable mirror safety-net. Every 5 min, re-push any confirmed
// retail order still flagged airtable_dirty=true (event push dropped, Airtable
// outage, or an /admin edit re-flagged it). Mirrors the viva-reconcile shape.
//
// In steady state this is a no-op; synced>0 is the canary that the event push
// is missing orders.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { pushOrderToAirtable } from '../lib/airtable/pushOrder'
import { pushWalletPlanToAirtable } from '../lib/airtable/pushWalletPlan'
import { airtableConfigured } from '../lib/airtable/env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BATCH_LIMIT = 10
// WEC-890: hard wall-clock budget for the push loop.
//
// On 2026-10-28 Netlify killed EVERY scheduled invocation of this function at
// ~14.98s with status 499. The real execution limit is ~15 SECONDS, not the
// 30s asserted in reconcile-run.ts — that comment was wrong and is now fixed.
//
// One pushOrderToAirtable costs ~8s (it writes child orders, order items and
// runs reconcileDeletes), so only 1-2 fit in a run. BATCH_LIMIT was 50, i.e.
// ~400s of work in a 15s window: the batch could never drain, every run was
// killed, and because the run row was written on the LAST line nothing was
// ever logged. The job looked dead for 2h31m while it was in fact running and
// dying every 5 minutes with errors: 0 — and FP-261027-00024 (4 portions,
// 29/10) never reached the kitchen view.
//
// Stop pushing at 10s so there is time left to write the run row. Whatever is
// still dirty waits for the next run; that is the correct contract, and the
// two-flag design already guarantees it is picked up.
const PUSH_BUDGET_MS = 10_000

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export default async (): Promise<Response> => {
  const startMs = Date.now()
  if (!airtableConfigured()) {
    return Response.json({ skipped: 'AIRTABLE_PAT not set' })
  }
  const supabase = serviceClient()

  // WEC-890: open the run row BEFORE doing any work, close it at the end.
  // It used to be a single insert on the last line of the function, so a run
  // killed at 15s logged NOTHING: 17 invocations between 00:25 and 03:10 on
  // 2026-10-28 produced 4 rows. A row left saying 'running' is itself the
  // signal that an invocation was killed — silence must not be possible.
  let runId: string | null = null
  try {
    const { data } = await supabase
      .from('reconcile_runs')
      .insert({
        provider: 'airtable',
        checked: 0, paid: 0, failed: 0, still_pending: 0,
        cancelled_timeout: 0, errors: 0, duration_ms: 0,
        notes: 'running',
      })
      .select('id')
      .single()
    runId = (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[airtable-reconcile] could not open run log:', err)
  }

  // Dirty orders are eligible by construction (we only flag eligible ones),
  // but pushOrderToAirtable re-checks defensively.
  const { data: rows, error } = await supabase
    .from('orders')
    .select('id')
    .eq('airtable_dirty', true)
    .neq('status', 'draft')
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT)
  if (error) {
    console.error('[airtable-reconcile] select failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  let checked = 0
  let synced = 0
  let skipped = 0
  let errors = 0
  const errorNotes: string[] = []
  // WEC-697: audit trail of what the delete-reconcile removed (or, in dry-run,
  // would remove). Lands in reconcile_runs.notes so the dry-run can be reviewed
  // before AIRTABLE_DELETE_ENABLED is flipped on.
  const deleteNotes: string[] = []

  let deferred = 0
  for (const r of rows ?? []) {
    // WEC-890: out of time — leave the rest dirty for the next run.
    if (Date.now() - startMs > PUSH_BUDGET_MS) { deferred++; continue }
    checked++
    try {
      const res = await pushOrderToAirtable(supabase, r.id)
      if (res.ok && !res.skipped) synced++
      else {
        skipped++
        // WEC-789: an order that is dirty but NOT mirror-eligible (e.g. a
        // refunded card order: `card && payment_status !== 'paid'`) returns
        // early from pushOrderToAirtable, before the line that clears the
        // flag. It therefore stays dirty forever and this job re-checks it
        // every 5 minutes, reporting errors: 0 the whole time. Three orders
        // had been looping since 10 September when this was found.
        // Nothing will ever make them eligible, so retiring the flag is the
        // correct end state — there is no work left to do.
        if (res.skipped === 'not_eligible' || res.skipped === 'not_found') {
          await supabase
            .from('orders')
            .update({ airtable_dirty: false })
            .eq('id', r.id)
        }
      }
      const d = res.deletions
      if (d && (d.childKeys.length || d.itemUuids.length || d.skippedReason)) {
        const tag = d.skippedReason ? `SKIP(${d.skippedReason})` : d.dryRun ? 'DRYRUN' : 'DELETED'
        deleteNotes.push(`${tag} ${r.id}: ${d.childKeys.length}d/${d.itemUuids.length}i`)
      }
    } catch (err) {
      errors++
      errorNotes.push(`${r.id}: ${(err as Error).message}`)
      console.error('[airtable-reconcile] push failed for %s:', r.id, err)
    }
  }

  // ── WEC-810: subscriptions (wallet_plans) ────────────────────────────────
  // Same two-flag contract as orders, in the same sweep so there is one
  // schedule and one run record to watch rather than a second cron nobody
  // remembers exists. Counted into the same totals; failures are tagged
  // `plan <id>` in notes so the two sources stay distinguishable.
  const { data: planRows, error: planErr } = await supabase
    .from('wallet_plans')
    .select('id')
    .eq('airtable_dirty', true)
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT)
  if (planErr) {
    console.error('[airtable-reconcile] wallet_plans select failed:', planErr)
    errorNotes.push(`plans select: ${planErr.message}`)
    errors++
  }

  for (const r of planRows ?? []) {
    if (Date.now() - startMs > PUSH_BUDGET_MS) { deferred++; continue }
    checked++
    try {
      const res = await pushWalletPlanToAirtable(supabase, r.id)
      if (res.ok && !res.skipped) synced++
      else {
        skipped++
        // A plan that can never be mirrored (only `failed` qualifies today)
        // must have its flag retired, or the sweep re-checks it every five
        // minutes forever — the WEC-789 loop, which ran unnoticed from 10 to
        // 18 September because `errors` stayed 0 the whole time.
        if (res.skipped === 'not_eligible' || res.skipped === 'not_found') {
          await supabase.from('wallet_plans').update({ airtable_dirty: false }).eq('id', r.id)
        }
      }
    } catch (err) {
      errors++
      errorNotes.push(`plan ${r.id}: ${(err as Error).message}`)
      console.error('[airtable-reconcile] plan push failed for %s:', r.id, err)
    }
  }

  const durationMs = Date.now() - startMs
  const summary = { checked, synced, skipped, deferred, errors }
  const notes =
    [...(deferred ? [`deferred:${deferred} (budget)`] : []), ...errorNotes, ...deleteNotes]
      .slice(0, 15)
      .join(' | ') || null
  const row = {
    provider: 'airtable',
    checked,
    paid: synced, // reuse column: rows successfully mirrored
    failed: 0,
    still_pending: skipped,
    cancelled_timeout: 0,
    errors,
    duration_ms: durationMs,
    notes,
  }
  try {
    // WEC-890: close the row opened at the top. Fall back to an insert only if
    // opening it failed, so a run is never completely unrecorded.
    if (runId) await supabase.from('reconcile_runs').update(row).eq('id', runId)
    else await supabase.from('reconcile_runs').insert(row)
  } catch (err) {
    console.error('[airtable-reconcile] failed to log run:', err)
  }

  return Response.json({ ...summary, durationMs })
}

export const config = {
  schedule: '*/5 * * * *',
}
