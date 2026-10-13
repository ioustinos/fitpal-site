// WEC-861 (costing nightly check): recompute every cost item, component and
// dish variant from scratch and compare with the cost_history ledger.
//
// All the work happens in the DB function public.cost_check_run(), which
// writes its own row to cost_check_runs (status ok / mismatch / error) —
// results are persisted, never only logged. This function is just the clock.
//
// Netlify runs scheduled functions on the PRODUCTION deploy only; on dev use
// the «Run now» button on /admin/costing (calls admin_cost_check_run()).

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async (): Promise<Response> => {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('[costing-nightly-check] SUPABASE_SERVICE_ROLE_KEY not set')
    return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 500 })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.rpc('cost_check_run', { p_trigger: 'scheduled', p_days: 90 })
  if (error) {
    // The RPC itself failed before it could write a run row (e.g. timeout).
    console.error('[costing-nightly-check] rpc failed:', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }
  console.log('[costing-nightly-check]', JSON.stringify(data))
  return Response.json(data)
}

// 00:15 UTC = 03:15 Athens (summer) / 02:15 (winter) — after the day's edits.
export const config = {
  schedule: '15 0 * * *',
}
