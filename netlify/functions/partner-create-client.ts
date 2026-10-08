// POST /api/partner-create-client  (WEC-842, epic WEC-838 Dietitian Partners)
//
// A dietitian adds a client. Mirrors admin-create-customer (WEC-770) — same
// pre-confirmed, passwordless account so impersonation works immediately —
// plus the partner link:
//
//   • NEW email      → account created, link ACTIVE at the partner's default
//                      terms (Fitpal edits the split later in /admin/partners).
//   • EXISTING email → link PENDING: 🟢 the client must confirm (in-site prompt
//                      after login) AND Fitpal must approve. Internal partners
//                      (Fitpal's own dietitians) skip that — active at once.
//   • already linked → 409 with a plain message.
//
// 🟢 No «pending welcome» status — Ioustinos: the welcome call is not a real
// process; the client can order immediately.
// The login email ("set a password if you want") is sent by the portal with
// the normal OTP email, like admin «Στείλε πρόσκληση».

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface Body {
  email?: string
  name?: string
  phone?: string
  address?: { street?: string; area?: string; zip?: string; floor?: string; doorbell?: string; notes?: string }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default async (request: Request): Promise<Response> => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })

  let body: Body
  try { body = (await request.json()) as Body }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }

  const email = (body.email ?? '').trim().toLowerCase()
  const name = (body.name ?? '').trim()
  const phone = (body.phone ?? '').trim()
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: 'Δώσε ένα έγκυρο email. · A valid email is required.' }, { status: 400, headers: cors })
  }

  const authHeader = request.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user: caller } } = await callerClient.auth.getUser(token)
  if (!caller) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors })

  // Caller must be an active partner user (my_partner() reads auth.uid()).
  const { data: partner, error: pErr } = await callerClient.rpc('my_partner')
  const p = partner as { id: string; is_internal: boolean; default_commission_bps: number; default_discount_bps: number } | null
  if (pErr || !p?.id) {
    return Response.json({ error: 'Δεν είστε συνεργάτης διαιτολόγος. · Not a partner account.' }, { status: 403, headers: cors })
  }
  if (!SUPABASE_SERVICE_KEY) return Response.json({ error: 'Server not configured' }, { status: 500, headers: cors })
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const linkTerms = {
    partner_id: p.id,
    discount_bps: p.default_discount_bps,
    commission_bps: p.is_internal ? 0 : p.default_commission_bps,
    created_by: caller.id,
  }

  // ── Existing customer? ────────────────────────────────────────────────
  const { data: existing } = await svc.from('profiles').select('id, name').eq('email', email).maybeSingle()
  if (existing) {
    const existingId = (existing as { id: string }).id
    const { data: live } = await svc
      .from('partner_clients')
      .select('id, partner_id, status')
      .eq('client_user_id', existingId)
      .neq('status', 'inactive')
      .maybeSingle()
    if (live) {
      const mine = (live as { partner_id: string }).partner_id === p.id
      return Response.json({
        error: mine
          ? 'Ο πελάτης είναι ήδη στη λίστα σας. · This customer is already your client.'
          : 'Ο πελάτης είναι ήδη συνδεδεμένος με άλλον διαιτολόγο. Επικοινωνήστε με τη Fitpal. · This customer is already linked to another dietitian — contact Fitpal.',
        existingUserId: mine ? existingId : undefined,
      }, { status: 409, headers: cors })
    }
    const now = new Date().toISOString()
    const { error: linkErr } = await svc.from('partner_clients').insert({
      ...linkTerms,
      client_user_id: existingId,
      created_via: 'partner_existing',
      status: p.is_internal ? 'active' : 'pending',
      ...(p.is_internal ? { client_confirmed_at: now, approved_at: now } : {}),
    })
    if (linkErr) {
      console.error('[partner-create-client] link insert failed:', linkErr)
      return Response.json({ error: linkErr.message }, { status: 500, headers: cors })
    }
    return Response.json({
      userId: existingId,
      status: p.is_internal ? 'active' : 'pending',
      existing: true,
      message: p.is_internal
        ? 'Ο πελάτης προστέθηκε. · Client added.'
        : 'Ο πελάτης υπάρχει ήδη στη Fitpal: θα ενεργοποιηθεί όταν το αποδεχτεί ο ίδιος (στην επόμενη σύνδεσή του) και εγκρίνει η Fitpal. · Existing Fitpal customer: becomes active once they accept (next login) and Fitpal approves.',
    }, { status: 200, headers: cors })
  }

  // ── New customer ──────────────────────────────────────────────────────
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: name || undefined, phone: phone || undefined },
  })
  if (createErr || !created?.user) {
    console.error('[partner-create-client] createUser failed:', createErr)
    return Response.json({ error: createErr?.message ?? 'Could not create the account' }, { status: 500, headers: cors })
  }
  const userId = created.user.id

  const { error: profErr } = await svc.from('profiles').update({ name: name || null, phone: phone || null, email }).eq('id', userId)
  if (profErr) console.warn('[partner-create-client] profile update failed:', profErr.message)

  const a = body.address ?? {}
  if ((a.street ?? '').trim()) {
    const { error: addrErr } = await svc.from('addresses').insert({
      user_id: userId, label_el: 'Σπίτι', label_en: 'Home',
      street: (a.street ?? '').trim(), area: (a.area ?? '').trim() || null, zip: (a.zip ?? '').trim() || null,
      floor: (a.floor ?? '').trim() || null, doorbell: (a.doorbell ?? '').trim() || null, notes: (a.notes ?? '').trim() || null,
      is_default: true, sort_order: 0,
    })
    if (addrErr) console.warn('[partner-create-client] address insert failed:', addrErr.message)
  }

  const now = new Date().toISOString()
  const { error: linkErr } = await svc.from('partner_clients').insert({
    ...linkTerms,
    client_user_id: userId,
    created_via: 'partner_new',
    status: 'active',
    client_confirmed_at: now,
    approved_at: now,
  })
  if (linkErr) {
    // The account exists and is usable; Fitpal can link it from admin.
    console.error('[partner-create-client] link insert failed for new user %s:', userId, linkErr)
    return Response.json({ error: `Ο λογαριασμός δημιουργήθηκε αλλά η σύνδεση απέτυχε: ${linkErr.message}`, userId }, { status: 500, headers: cors })
  }

  console.info('[partner-create-client] partner %s created client %s', p.id, userId)
  return Response.json({ userId, status: 'active', existing: false }, { status: 200, headers: cors })
}
