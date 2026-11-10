// WEC-914: the Airtable mirror sweep, shared by
//   • airtable-reconcile-background — the normal path. A background function
//     may run for 15 minutes, so the sweep drains the whole queue in one go.
//   • airtable-reconcile (scheduled, every 5 min) — hands off to the
//     background function, and only runs this inline, under the old 10 s
//     budget, if the hand-off fails.
// Moved here verbatim from airtable-reconcile.ts; only the budget, batch size
// and a mode tag in the run notes are now parameters.
//
// WEC-890 history: Netlify kills a SCHEDULED invocation at ~15 s (status 499),
// which is why the inline path keeps a 10 s budget and the run row is opened
// before any work and closed at the end.

import type { SupabaseClient } from '@supabase/supabase-js'
import { pushOrderToAirtable } from './pushOrder'
import { pushWalletPlanToAirtable } from './pushWalletPlan'

export interface SweepOptions {
  budgetMs: number
  batchLimit: number
  mode: string   // written into reconcile_runs.notes, e.g. 'background' / 'inline'
}

export interface SweepSummary {
  checked: number; synced: number; skipped: number; deferred: number; errors: number; durationMs: number
}

export async function runAirtableSweep(supabase: SupabaseClient, opts: SweepOptions): Promise<SweepSummary> {
  const startMs = Date.now()
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
        notes: `running (${opts.mode})`,
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
    .limit(opts.batchLimit)
  if (error) {
    console.error('[airtable-reconcile] select failed:', error)
    if (runId) await supabase.from('reconcile_runs').update({ errors: 1, notes: `orders select: ${error.message}` }).eq('id', runId)
    return { checked: 0, synced: 0, skipped: 0, deferred: 0, errors: 1, durationMs: Date.now() - startMs }
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
    if (Date.now() - startMs > opts.budgetMs) { deferred++; continue }
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
            .eq('airtable_dirty', true) // WEC-909: no-op if already cleared (see plans below)
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
    .limit(opts.batchLimit)
  if (planErr) {
    console.error('[airtable-reconcile] wallet_plans select failed:', planErr)
    errorNotes.push(`plans select: ${planErr.message}`)
    errors++
  }

  for (const r of planRows ?? []) {
    if (Date.now() - startMs > opts.budgetMs) { deferred++; continue }
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
        // WEC-909: ONLY if still dirty. pushWalletPlanToAirtable's not_eligible
        // path already clears + stamps the row itself. A second, unconditional
        // `airtable_dirty=false` write then reaches flag_wallet_plan_airtable_dirty
        // as old=false/new=false on an already-synced row — which the trigger
        // reads as "an edit to a mirrored plan" and sets dirty back to TRUE.
        // Every failed+cancelled plan that had ever been synced looped like that
        // forever, eating 2 of the ~3 push slots of every run.
        if (res.skipped === 'not_eligible' || res.skipped === 'not_found') {
          await supabase.from('wallet_plans').update({ airtable_dirty: false })
            .eq('id', r.id).eq('airtable_dirty', true)
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
    [opts.mode, ...(deferred ? [`deferred:${deferred} (budget)`] : []), ...errorNotes, ...deleteNotes]
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

  return { ...summary, durationMs }
}
