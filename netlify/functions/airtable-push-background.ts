// WEC-477: background push of one order into Airtable.
// WEC-914: also called straight from /admin after an order or subscription is
// edited (body { orderId } or { walletPlanId }), so Airtable updates within
// seconds instead of waiting for the 5-minute sweep. If the row was edited
// again while the push was in flight (WEC-833 leaves it dirty), push once more.
// Netlify background function (`-background` suffix) — returns 202 immediately
// so the caller (submit-order) is never blocked by Airtable latency. The order
// stays airtable_dirty=true until pushOrderToAirtable succeeds, so the 5-min
// reconcile is the guaranteed backstop if this invocation fails.

import { createClient } from '@supabase/supabase-js'
import { pushOrderToAirtable } from '../lib/airtable/pushOrder'
import { pushWalletPlanToAirtable } from '../lib/airtable/pushWalletPlan'
import { airtableConfigured } from '../lib/airtable/env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  if (!airtableConfigured()) {
    console.warn('[airtable-push] AIRTABLE_PAT not set — skipping')
    return new Response(null, { status: 200 })
  }
  let orderId: string | undefined
  let walletPlanId: string | undefined
  try {
    const body = await request.json()
    orderId = typeof body?.orderId === 'string' ? body.orderId : undefined
    walletPlanId = typeof body?.walletPlanId === 'string' ? body.walletPlanId : undefined
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!orderId && !walletPlanId) return new Response(null, { status: 400 })

  if (!SUPABASE_SERVICE_KEY) {
    console.error('[airtable-push] SUPABASE_SERVICE_ROLE_KEY not set')
    return new Response(null, { status: 500 })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const table = orderId ? 'orders' : 'wallet_plans'
  const id = (orderId ?? walletPlanId) as string
  // Up to 2 passes: the second only if an edit landed mid-push (row still dirty).
  for (let pass = 1; pass <= 2; pass++) {
    try {
      const res = orderId
        ? await pushOrderToAirtable(supabase, orderId)
        : await pushWalletPlanToAirtable(supabase, walletPlanId as string)
      console.log('[airtable-push]', JSON.stringify(res))
      if (('skipped' in res) && res.skipped) break
    } catch (err) {
      console.error('[airtable-push] error for %s %s:', table, id, err)
      break  // the sweep retries it; don't hammer a failing Airtable
    }
    const { data } = await supabase.from(table).select('airtable_dirty').eq('id', id).maybeSingle()
    if (!(data as { airtable_dirty?: boolean } | null)?.airtable_dirty) break
  }
  return new Response(null, { status: 200 })
}
