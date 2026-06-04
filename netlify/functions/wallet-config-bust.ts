// WEC-433: admin endpoint that invalidates the in-memory wallet-config
// cache that loadWalletConfig() holds for 60s. Called by /admin/settings
// (WalletSettings.tsx) the instant an admin saves a wallet_* setting, so
// the very next call to /api/wallet-plan-quote or /api/wallet-plan-purchase
// re-reads from the DB instead of serving up-to-60s-stale values.
//
// Auth: admin JWT required. is_admin(auth.uid()) check via the user's
// bearer token against Supabase.

import { createClient } from '@supabase/supabase-js'
import { invalidateWalletConfigCache } from '../lib/wallet/loadSettings'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  const auth = request.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : ''
  if (!token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
  }

  // Validate admin status — use the caller's JWT against an anon client so
  // RLS / is_admin() runs as them. Cheaper than service-role + manual check.
  try {
    const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await c.rpc('is_admin')
    if (error || data !== true) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors })
    }
  } catch {
    return Response.json({ error: 'Auth check failed' }, { status: 500, headers: cors })
  }

  invalidateWalletConfigCache()
  return Response.json({ ok: true, busted: 'wallet_config' }, { status: 200, headers: cors })
}
