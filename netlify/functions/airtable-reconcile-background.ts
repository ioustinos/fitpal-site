// WEC-914: the Airtable mirror sweep as a BACKGROUND function.
//
// Scheduled functions are killed at ~15 s (WEC-890), which capped the sweep at
// 2–3 orders per 5-minute run. Background functions may run for 15 minutes, so
// the scheduled airtable-reconcile now just triggers this, and the whole dirty
// queue drains in one run.
//
// Budget: 4 minutes — comfortably inside Netlify's limit and shorter than the
// 5-minute schedule, so two sweeps never overlap. Anything left (only under an
// unusual backlog) stays dirty for the next run, the same contract as before.

import { createClient } from '@supabase/supabase-js'
import { airtableConfigured } from '../lib/airtable/env'
import { internalToken } from '../lib/airtable/internal'
import { runAirtableSweep } from '../lib/airtable/reconcileSweep'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  if (!SUPABASE_SERVICE_KEY || request.headers.get('x-fitpal-internal') !== internalToken()) {
    return new Response(null, { status: 401 })
  }
  if (!airtableConfigured()) return new Response(null, { status: 200 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const res = await runAirtableSweep(supabase, { budgetMs: 4 * 60_000, batchLimit: 500, mode: 'background' })
    console.log('[airtable-reconcile-background]', JSON.stringify(res))
  } catch (err) {
    console.error('[airtable-reconcile-background] sweep failed:', err)
  }
  return new Response(null, { status: 200 })
}
