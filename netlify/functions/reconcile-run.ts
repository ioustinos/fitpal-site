// WEC-696: HTTP-invocable trigger for the two reconcilers.
//
// WHY THIS EXISTS
// ---------------
// `viva-reconcile.ts` and `airtable-reconcile.ts` both declare
// `export const config = { schedule: '*/5 * * * *' }`. Netlify treats a
// function with a `schedule` as scheduler-only:
//
//   "You can't invoke scheduled functions directly with a URL."
//   "Scheduled functions only run on their schedule for published deploys —
//    Deploy Previews and branch deploys won't trigger them automatically."
//   — https://docs.netlify.com/build/functions/scheduled-functions/
//
// So every HTTP call to /.netlify/functions/viva-reconcile returns a bare
// 403 with an empty body. The n8n workflow has been doing exactly that,
// every 15 minutes, since it was created — silently, because a 403 from
// Netlify's edge never reaches our code and never writes a reconcile_runs
// row. Two consequences we lived with without knowing:
//
//   1. n8n has NEVER triggered a reconcile. Every row in reconcile_runs is
//      Netlify's own scheduler. The belief recorded in CLAUDE.md — that n8n
//      papers over Netlify's scheduler after WEC-485 — was false.
//   2. On DEV there has been NO reconcile at all, ever. Branch deploys don't
//      run scheduled functions, and the n8n fallback was 403ing.
//
// This module is deliberately NOT scheduled, so it is reachable over HTTP.
// It calls the same handlers, so there is one implementation, not two.
//
// Idempotency makes double-triggering safe: markPaid is a guarded
// UPDATE ... WHERE payment_status = 'pending', so the scheduler and this
// endpoint firing together produce exactly one row change.

import viva from './viva-reconcile'
import airtable from './airtable-reconcile'

type Target = 'viva' | 'airtable' | 'both'

/**
 * Shared-secret gate.
 *
 * This endpoint spends money-adjacent resources — it calls Viva's API and
 * Airtable's API on every hit — so it is not left open. Mirrors the
 * VIVA_INTERNAL_TOKEN pattern already used by viva-create-order.
 *
 * Accepts either `Authorization: Bearer <token>` or `X-Reconcile-Token`,
 * because n8n's HTTP node makes header auth fiddly and a query string would
 * put the secret in logs.
 */
function authorised(req: Request): boolean {
  const expected = process.env.RECONCILE_TRIGGER_TOKEN
  // Fail CLOSED. An unset token means nobody can trigger it, rather than
  // everybody — the opposite default is how public endpoints stay open
  // forever because "we'll lock it down later".
  if (!expected) return false

  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const header = req.headers.get('x-reconcile-token')?.trim() ?? ''
  return bearer === expected || header === expected
}

export default async (req: Request): Promise<Response> => {
  if (!process.env.RECONCILE_TRIGGER_TOKEN) {
    // Explicit, so this can never be mistaken for "the reconcile ran".
    return Response.json(
      {
        error: 'RECONCILE_TRIGGER_TOKEN is not set on this deploy context',
        hint: 'Set it in Netlify env vars (all contexts) and redeploy. Until then this endpoint refuses every request.',
      },
      { status: 503 },
    )
  }

  if (!authorised(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const raw = (url.searchParams.get('target') ?? 'both').toLowerCase()
  if (raw !== 'viva' && raw !== 'airtable' && raw !== 'both') {
    return Response.json(
      { error: `Unknown target "${raw}". Use viva, airtable or both.` },
      { status: 400 },
    )
  }
  const target = raw as Target

  const startedAt = Date.now()
  const results: Record<string, unknown> = {}

  // Sequential, not Promise.all: both hit the same Supabase service client and
  // the same external APIs, and 30s is the scheduled-function execution limit.
  // Serialising keeps one slow provider from pushing the other over the edge.
  for (const name of ['viva', 'airtable'] as const) {
    if (target !== 'both' && target !== name) continue
    try {
      // viva's handler takes an optional Request and reads ?dryRun=1 off its
      // URL (WEC-425), so forward ours — `?target=viva&dryRun=1` then gives a
      // safe read-only first test after deploying. airtable takes no args.
      const res = name === 'viva' ? await viva(req) : await airtable()
      results[name] = {
        status: res.status,
        body: await res.json().catch(() => null),
      }
    } catch (err) {
      // One provider blowing up must not stop the other. The reconcile
      // handlers already log their own per-order errors into
      // reconcile_runs.notes; this catches a hard throw (bad env var,
      // Supabase unreachable) that would otherwise 500 the whole request.
      results[name] = { error: (err as Error).message }
      console.error(`[reconcile-run] ${name} threw:`, err)
    }
  }

  const anyFailed = Object.values(results).some(
    (r) => typeof r === 'object' && r !== null && 'error' in (r as object),
  )

  return Response.json(
    { target, durationMs: Date.now() - startedAt, results },
    // 500 on failure so the n8n execution goes RED and is visible, rather
    // than a green run hiding a dead reconcile — which is the exact failure
    // mode that hid WEC-695 and WEC-537 for over a month.
    { status: anyFailed ? 500 : 200 },
  )
}

// NO `schedule` here — that is the entire point. Adding one would make this
// endpoint scheduler-only too and it would start returning 403 like the
// others.
