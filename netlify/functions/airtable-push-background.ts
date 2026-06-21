// WEC-477: background push of one order into Airtable.
// Netlify background function (`-background` suffix) — returns 202 immediately
// so the caller (submit-order) is never blocked by Airtable latency. The order
// stays airtable_dirty=true until pushOrderToAirtable succeeds, so the 5-min
// reconcile is the guaranteed backstop if this invocation fails.

import { createClient } from '@supabase/supabase-js'
import { pushOrderToAirtable } from '../lib/airtable/pushOrder'
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
  try {
    orderId = (await request.json())?.orderId
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!orderId) return new Response(null, { status: 400 })

  if (!SUPABASE_SERVICE_KEY) {
    console.error('[airtable-push] SUPABASE_SERVICE_ROLE_KEY not set')
    return new Response(null, { status: 500 })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const res = await pushOrderToAirtable(supabase, orderId)
    console.log('[airtable-push]', JSON.stringify(res))
  } catch (err) {
    console.error('[airtable-push] error for order %s:', orderId, err)
  }
  return new Response(null, { status: 200 })
}
