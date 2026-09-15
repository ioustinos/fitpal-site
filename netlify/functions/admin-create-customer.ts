// POST /api/admin-create-customer  (WEC-770)
//
// Create a customer account on the customer's behalf, so the team can take a
// phone order for someone who has never used the site.
//
// Before this, /admin/users was read-only and the only way to get a customer
// into the system was for Ioustinos to insert rows by hand — which is exactly
// what the team was asking for in Slack.
//
// ⚠️ `email_confirm: true` is the load-bearing line. It creates an ALREADY
// CONFIRMED account with NO password, which is what lets the existing
// impersonation flow (admin-impersonate-start) mint a magic-link token for
// this user immediately. Without it the customer would have to click a link in
// an email before the team could place their first order — the whole point of
// the feature is that the customer does nothing.
//
// No email is sent here, deliberately (Ioustinos's call). A separate
// «Στείλε πρόσκληση» button invites them, if and when the team wants to.

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface Body {
  email?: string
  name?: string
  phone?: string
  address?: {
    street?: string
    area?: string
    zip?: string
    floor?: string
    doorbell?: string
    notes?: string
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default async (request: Request): Promise<Response> => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  let body: Body
  try { body = (await request.json()) as Body }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }

  const email = (body.email ?? '').trim().toLowerCase()
  const name = (body.name ?? '').trim()
  const phone = (body.phone ?? '').trim()
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: 'Δώσε ένα έγκυρο email. · A valid email is required.' }, { status: 400, headers: cors })
  }

  // ── Caller must be an admin (same pattern as admin-impersonate-start) ──
  const authHeader = request.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user: caller } } = await callerClient.auth.getUser()
  if (!caller) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors })
  const { data: isAdmin, error: adminErr } = await callerClient.rpc('is_admin')
  if (adminErr || !isAdmin) return Response.json({ error: 'Not authorised' }, { status: 403, headers: cors })

  if (!SUPABASE_SERVICE_KEY) {
    return Response.json({ error: 'Server not configured' }, { status: 500, headers: cors })
  }
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Already a customer? Say so plainly and hand back the id, so the admin
  //    can jump straight to them instead of being told "something went wrong".
  const { data: existing } = await svc
    .from('profiles')
    .select('id, name')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    return Response.json({
      error: 'Υπάρχει ήδη πελάτης με αυτό το email. · A customer with this email already exists.',
      existingUserId: (existing as { id: string }).id,
      existingName: (existing as { name: string | null }).name,
    }, { status: 409, headers: cors })
  }

  // ── Create the auth user, pre-confirmed, passwordless ──────────────────
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: name || undefined, phone: phone || undefined },
  })
  if (createErr || !created?.user) {
    console.error('[admin-create-customer] createUser failed:', createErr)
    return Response.json({ error: createErr?.message ?? 'Could not create the account' }, { status: 500, headers: cors })
  }
  const userId = created.user.id

  // The handle_new_user() trigger has already inserted profiles / user_goals /
  // user_prefs. Fill in what the trigger can't know. Failures here are NOT
  // fatal — the account exists and is usable; a missing name is a nuisance,
  // a rolled-back account is a dead end.
  const { error: profErr } = await svc
    .from('profiles')
    .update({ name: name || null, phone: phone || null, email })
    .eq('id', userId)
  if (profErr) console.warn('[admin-create-customer] profile update failed:', profErr.message)

  const a = body.address ?? {}
  let addressId: string | null = null
  if ((a.street ?? '').trim()) {
    const { data: addr, error: addrErr } = await svc
      .from('addresses')
      .insert({
        user_id: userId,
        label_el: 'Σπίτι',
        label_en: 'Home',
        street: (a.street ?? '').trim(),
        area: (a.area ?? '').trim() || null,
        zip: (a.zip ?? '').trim() || null,
        floor: (a.floor ?? '').trim() || null,
        doorbell: (a.doorbell ?? '').trim() || null,
        notes: (a.notes ?? '').trim() || null,
        is_default: true,
        sort_order: 0,
      })
      .select('id')
      .maybeSingle()
    if (addrErr) console.warn('[admin-create-customer] address insert failed:', addrErr.message)
    else addressId = (addr as { id: string } | null)?.id ?? null
  }

  console.info('[admin-create-customer] created %s by admin %s', userId, caller.id)
  return Response.json({ userId, addressId, emailSent: false }, { status: 200, headers: cors })
}
