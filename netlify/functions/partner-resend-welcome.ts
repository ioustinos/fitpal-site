// POST /api/partner-resend-welcome  { clientUserId }   (WEC-899)
//
// Re-sends the dietitian-client welcome email (fresh 7-day link). Allowed for:
//   • the client's own dietitian (active link to an active partner), or
//   • a Fitpal admin (uses the client's current dietitian's name).
// Built to resend to Θεοδώρα Δάμα's clients who got the old OTP email on
// 02/11, and reusable from the portal later.

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'
import { sendPartnerWelcome } from '../lib/partnerWelcome'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async (request: Request): Promise<Response> => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })

  let body: { clientUserId?: string }
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }
  const clientUserId = (body.clientUserId ?? '').trim()
  if (!clientUserId) return Response.json({ error: 'clientUserId required' }, { status: 400, headers: cors })

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
  const viewAs = request.headers.get('x-partner-view')
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, ...(viewAs ? { 'x-partner-view': viewAs } : {}) } },
  })
  const { data: { user } } = await caller.auth.getUser(token)
  if (!user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors })
  if (!SUPABASE_SERVICE_KEY) return Response.json({ error: 'Server not configured' }, { status: 500, headers: cors })
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // The client's live link and its dietitian.
  const { data: link } = await svc
    .from('partner_clients')
    .select('partner_id, status, partners!inner(name, active)')
    .eq('client_user_id', clientUserId)
    .eq('status', 'active')
    .maybeSingle()
  const l = link as { partner_id: string; partners: { name: string; active: boolean } } | null
  if (!l || !l.partners?.active) {
    return Response.json({ error: 'Ο πελάτης δεν έχει ενεργή σύνδεση με διαιτολόγο. · No active dietitian link.' }, { status: 409, headers: cors })
  }

  const { data: isAdmin } = await caller.rpc('is_admin')
  let allowed = isAdmin === true
  if (!allowed) {
    const { data: mine } = await caller.rpc('my_partner')
    allowed = (mine as { id?: string } | null)?.id === l.partner_id
  }
  if (!allowed) return Response.json({ error: 'Δεν επιτρέπεται. · Not allowed.' }, { status: 403, headers: cors })

  const { data: u } = await svc.auth.admin.getUserById(clientUserId)
  const email = u?.user?.email
  if (!email) return Response.json({ error: 'Client has no email' }, { status: 409, headers: cors })
  const { data: prof } = await svc.from('profiles').select('name').eq('id', clientUserId).maybeSingle()
  const name = (prof as { name?: string } | null)?.name ?? undefined

  const err = await sendPartnerWelcome({ email, name }, clientUserId, l.partners.name)
  console.info('[partner-resend-welcome] by %s → %s (%s): %s', user.id, clientUserId, email, err ?? 'sent')
  if (err) return Response.json({ error: err }, { status: 502, headers: cors })
  return Response.json({ ok: true, email }, { status: 200, headers: cors })
}
