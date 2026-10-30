// WEC-896 — HTTP-invocable trigger for the renewal invitation, so it can be
// tested on dev (scheduled functions don't run on branch deploys — see the
// reconcile-run.ts note). Admin-gated: Bearer <supabase JWT> → is_admin().
//
// Query: ?days=3 (default 3), ?limit=50. Same runner as the scheduled fn.

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'
import { runRenewalInvites, serviceClient } from '../lib/subscriptionRenewalInvites'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

async function assertAdmin(token: string): Promise<boolean> {
  if (!token) return false
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userRes } = await supa.auth.getUser(token)
  if (!userRes?.user) return false
  const { data, error } = await supa.rpc('is_admin')
  return !error && !!data
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'GET, POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!(await assertAdmin(token))) {
    return Response.json({ error: 'Forbidden — admin role required' }, { status: 403, headers: cors })
  }

  const url = new URL(request.url)
  const days = Math.max(0, Math.min(30, parseInt(url.searchParams.get('days') ?? '3', 10) || 3))
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50))

  try {
    const result = await runRenewalInvites(serviceClient(), { days, limit, deadlineMs: 20_000 })
    return Response.json({ days, limit, ...result }, { headers: cors })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500, headers: cors })
  }
}

// NO `schedule` — this must stay HTTP-reachable (unlike the scheduled twin).
