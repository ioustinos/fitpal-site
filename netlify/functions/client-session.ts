import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'
import { checkClientSession, endClientSession, sessionReasonText } from '../lib/clientSession'

/**
 * WEC-868 — heartbeat / end for a client-mode tab.
 *
 *   POST { sessionId, action: 'status' }  → { active, reason?, message?, expiresAt }
 *        also refreshes last_seen_at while the session is alive (the heartbeat)
 *   POST { sessionId, action: 'end' }     → { ok: true }
 *
 * The caller must present a JWT for either the customer of that session (the
 * client tab itself) or the operator who opened it.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  try {
    const body = await request.json() as { sessionId?: string; action?: string }
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
    if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors })
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    const state = await checkClientSession(svc, body.sessionId)
    const row = state.row
    if (row && row.client_user_id !== user.id && row.operator_user_id !== user.id) {
      return Response.json({ error: 'Not your session' }, { status: 403, headers: cors })
    }

    if (body.action === 'end') {
      if (state.ok) await endClientSession(svc, state.row.id, 'closed')
      return Response.json({ ok: true }, { headers: cors })
    }

    if (!state.ok) {
      return Response.json({ active: false, reason: state.reason, message: sessionReasonText(state.reason) }, { headers: cors })
    }
    await svc.from('impersonation_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', state.row.id)
    return Response.json({ active: true, expiresAt: state.row.expires_at }, { headers: cors })
  } catch (err) {
    console.error('[client-session] failed:', err)
    return Response.json({ error: 'Server error' }, { status: 500, headers: cors })
  }
}
