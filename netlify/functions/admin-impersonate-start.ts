import { createClient } from '@supabase/supabase-js'

/**
 * Mint a magic-link token for an arbitrary customer, callable only by admins.
 *
 * Used by the customer-impersonation flow: admin clicks "Place order for X"
 * in /admin/users → frontend hits this function → we generate (but never
 * send) a magic link for X via Supabase Admin API → return the `hashed_token`
 * → frontend calls `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`
 * which swaps the active session to X's. From that point, every Supabase
 * query on the customer site naturally pulls X's data because auth.uid() is
 * now X. No client-side refactoring required.
 *
 * Security:
 *   - Caller MUST present an admin JWT (verified via `is_admin()` RPC).
 *     A non-admin call returns 403.
 *   - The generated token is single-use and short-lived (Supabase default ~1h).
 *   - We do NOT send an email — `generateLink` returns the link properties
 *     directly without dispatching mail (Supabase docs).
 *   - The frontend stashes the admin's existing session client-side BEFORE
 *     calling this, so exit-impersonation can restore it via setSession.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface RequestBody {
  targetUserId: string
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const body: RequestBody = await request.json()
    if (!body.targetUserId) {
      return Response.json({ error: 'targetUserId required' }, { status: 400 })
    }

    // ── Verify caller is admin ──────────────────────────────────────────
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) {
      return Response.json({ error: 'Invalid session' }, { status: 401 })
    }
    const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc('is_admin')
    if (adminCheckErr || !isAdmin) {
      return Response.json({ error: 'Not authorised' }, { status: 403 })
    }

    if (!SUPABASE_SERVICE_KEY) {
      return Response.json({ error: 'Server not configured for impersonation' }, { status: 500 })
    }
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ── Look up target user ────────────────────────────────────────────
    const { data: target, error: targetErr } = await svc.auth.admin.getUserById(body.targetUserId)
    if (targetErr || !target?.user) {
      return Response.json({ error: 'Target user not found' }, { status: 404 })
    }
    const targetEmail = target.user.email
    if (!targetEmail) {
      return Response.json({ error: 'Target user has no email' }, { status: 400 })
    }

    // ── Generate magic link (no email sent) ────────────────────────────
    // We pass redirectTo back to our own success path; not actually used by
    // verifyOtp but Supabase requires it on some accounts.
    const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
    })
    if (linkErr || !linkData?.properties?.hashed_token) {
      return Response.json({
        error: 'Failed to generate impersonation token',
        detail: linkErr?.message ?? 'no hashed_token in response',
      }, { status: 500 })
    }

    // Pull profile name for the banner display.
    const { data: profile } = await svc
      .from('profiles')
      .select('name')
      .eq('id', body.targetUserId)
      .maybeSingle()

    return Response.json({
      hashedToken: linkData.properties.hashed_token,
      target: {
        userId: body.targetUserId,
        email: targetEmail,
        name: (profile as { name: string | null } | null)?.name ?? targetEmail,
      },
      // Echo admin id back so the client can stash it for the
      // X-Impersonator-Token attribution header on order submission.
      adminUserId: caller.id,
    }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('[admin-impersonate-start] failed:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
