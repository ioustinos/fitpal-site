// WEC-479: Airtable mirror safety-net. Every 5 min, re-push any confirmed
// retail order / subscription still flagged airtable_dirty=true (event push
// dropped, Airtable outage, or an /admin edit re-flagged it).
//
// WEC-914: this scheduled function no longer does the pushing itself. Netlify
// kills scheduled invocations at ~15 s (WEC-890), so it could only push 2–3
// orders per run. It now hands the sweep to airtable-reconcile-background
// (15-minute limit) and returns. If the hand-off fails — no site URL, network
// error, non-202 — it falls back to the old inline sweep under the 10 s budget,
// so the mirror never stops; the run row's notes say which mode ran.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { airtableConfigured } from '../lib/airtable/env'
import { internalToken, siteBaseUrl } from '../lib/airtable/internal'
import { runAirtableSweep } from '../lib/airtable/reconcileSweep'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
// WEC-890: inline fallback only — stop pushing at 10 s so there is time left
// to write the run row before the ~15 s kill.
const INLINE_BUDGET_MS = 10_000
const INLINE_BATCH_LIMIT = 10

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function handOff(): Promise<string | null> {
  const base = siteBaseUrl()
  if (!base) return 'no site URL in env'
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`${base}/.netlify/functions/airtable-reconcile-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fitpal-internal': internalToken() },
      body: '{}',
      signal: ctrl.signal,
    })
    clearTimeout(to)
    // A background function acknowledges with 202 and keeps running.
    return res.status === 202 ? null : `hand-off HTTP ${res.status}`
  } catch (err) {
    return `hand-off failed: ${(err as Error).message}`
  }
}

export default async (): Promise<Response> => {
  if (!airtableConfigured()) {
    return Response.json({ skipped: 'AIRTABLE_PAT not set' })
  }
  const why = await handOff()
  if (!why) return Response.json({ handedOff: true })

  console.warn('[airtable-reconcile] %s — sweeping inline', why)
  const res = await runAirtableSweep(serviceClient(), {
    budgetMs: INLINE_BUDGET_MS,
    batchLimit: INLINE_BATCH_LIMIT,
    mode: `inline (${why})`,
  })
  return Response.json(res)
}

export const config = {
  schedule: '*/5 * * * *',
}
