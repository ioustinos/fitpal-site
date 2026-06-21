// WEC-479: Airtable mirror safety-net. Every 5 min, re-push any confirmed
// retail order still flagged airtable_dirty=true (event push dropped, Airtable
// outage, or an /admin edit re-flagged it). Mirrors the viva-reconcile shape.
//
// In steady state this is a no-op; synced>0 is the canary that the event push
// is missing orders.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { pushOrderToAirtable } from '../lib/airtable/pushOrder'
import { airtableConfigured } from '../lib/airtable/env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BATCH_LIMIT = 50

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

  for (const r of rows ?? []) {
    checked++
    try {
      const res = await pushOrderToAirtable(supabase, r.id)
      if (res.ok && !res.skipped) synced++
      else skipped++
    } catch (err) {
      errors++
      errorNotes.push(`${r.id}: ${(err as Error).message}`)
      console.error('[airtable-reconcile] push failed for %s:', r.id, err)
    }
  }

  const durationMs = Date.now() - startMs
  const summary = { checked, synced, skipped, errors }
  try {
    await supabase.from('reconcile_runs').insert({
      provider: 'airtable',
      checked,
      paid: synced, // reuse column: rows successfully mirrored
      failed: 0,
      still_pending: skipped,
      cancelled_timeout: 0,
      errors,
      duration_ms: durationMs,
      notes: errorNotes.length ? errorNotes.slice(0, 10).join(' | ') : null,
    })
  } catch (err) {
    console.error('[airtable-reconcile] failed to log run:', err)
  }

  return Response.json({ ...summary, durationMs })
}

export const config = {
  schedule: '*/5 * * * *',
}
