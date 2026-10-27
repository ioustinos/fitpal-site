// WEC-882: admin-only, on-demand sync DB -> Airtable Menu Reference.
//
// Approach B: keeps the Menu Reference rows (Κρυμμένο Πεδίο + 4 macros) in step
// with our DB. Order-item writes are NOT affected by this endpoint.
//
// Dry-run by DEFAULT. Pass {"apply": true} in the body (or ?apply=true) to write.
// Returns the full diff report either way.
//
// Auth: Supabase JWT in Authorization: Bearer <token>, verified via is_admin()
// (same pattern as viva-refund). Non-admin -> 403, missing token -> 401.

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'
import { airtableConfigured, isDevAirtableTarget } from '../lib/airtable/env'
import { syncMenuReference } from '../lib/airtable/syncMenuReference'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

async function assertAdmin(
  token: string,
): Promise<{ userId: string } | { error: string; status: number }> {
  if (!token) return { error: 'Missing Authorization header', status: 401 }
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userRes } = await supa.auth.getUser()
  if (!userRes?.user) return { error: 'Invalid session', status: 401 }
  const { data, error } = await supa.rpc('is_admin')
  if (error) return { error: `Admin check failed: ${error.message}`, status: 500 }
  if (!data) return { error: 'Forbidden — admin role required', status: 403 }
  return { userId: userRes.user.id }
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const who = await assertAdmin(token)
  if ('error' in who) return Response.json({ error: who.error }, { status: who.status, headers: cors })

  if (!airtableConfigured()) {
    return Response.json({ error: 'AIRTABLE_PAT not set' }, { status: 500, headers: cors })
  }
  if (!SUPABASE_SERVICE_KEY) {
    return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 500, headers: cors })
  }

  let apply = false
  let codes: string[] | undefined
  let dishId: string | undefined
  try {
    const body = (await request.json()) as { apply?: boolean; codes?: string[]; dishId?: string }
    apply = body?.apply === true
    if (Array.isArray(body?.codes) && body.codes.length > 0) codes = body.codes.map(String)
    if (typeof body?.dishId === 'string' && body.dishId) dishId = body.dishId
  } catch {
    /* no body -> full dry-run */
  }
  if (new URL(request.url).searchParams.get('apply') === 'true') apply = true

  // Dev and prod share ONE Airtable base and Menu Reference rows are not
  // dev/prod-split (keyed only by Κωδικός). Writing from a dev deploy would
  // push dev-DB values into the production Menu Reference, so apply is hard-
  // blocked on dev — dry-run only. Real writes happen from prod.
  const devGuard = isDevAirtableTarget()
  if (devGuard) apply = false

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Scope by dish: resolve that dish's variant codes from the view.
  if (!codes && dishId) {
    const { data, error } = await service
      .from('v_menu_reference_sync')
      .select('code')
      .eq('dish_id', dishId)
    if (error) {
      return Response.json({ error: `dish scope lookup failed: ${error.message}` }, { status: 500, headers: cors })
    }
    codes = (data ?? []).map((r: { code: string }) => r.code).filter(Boolean)
    if (codes.length === 0) {
      return Response.json(
        { mode: apply ? 'apply' : 'dry-run', dishVariants: 0, note: 'no variants for dish', changed: [] },
        { headers: cors },
      )
    }
  }

  try {
    const report = await syncMenuReference(service, { apply, codes })
    return Response.json({ ...report, devGuard }, { headers: cors })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: cors },
    )
  }
}
