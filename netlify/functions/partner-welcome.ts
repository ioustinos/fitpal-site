// GET /api/partner-welcome?u=<userId>&e=<exp>&s=<sig>   (WEC-899)
//
// The «Πάτα εδώ» button in the dietitian-client welcome email. Valid token →
// mint a fresh Supabase magic link for that user right now and 302 into it;
// Supabase verifies it and lands on /auth/callback, which hydrates the session
// and sends the customer to the menu. Expired/invalid → the site home page,
// where they sign in with their email as usual. Never a 4xx page.

import { createClient } from '@supabase/supabase-js'
import { siteBase, verifyWelcome } from '../lib/partnerWelcome'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const go = (url: string) => new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } })

export default async (request: Request): Promise<Response> => {
  const q = new URL(request.url).searchParams
  const home = `${siteBase()}/`
  const userId = verifyWelcome(q.get('u'), q.get('e'), q.get('s'))
  if (!userId || !SUPABASE_SERVICE_KEY) {
    console.info('[partner-welcome] invalid or expired token → home')
    return go(home)
  }
  try {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: u, error: uErr } = await svc.auth.admin.getUserById(userId)
    const email = u?.user?.email
    if (uErr || !email) { console.warn('[partner-welcome] user lookup failed', userId, uErr?.message); return go(home) }
    const { data, error } = await svc.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${siteBase()}/auth/callback` },
    })
    const link = data?.properties?.action_link
    if (error || !link) { console.warn('[partner-welcome] generateLink failed', userId, error?.message); return go(home) }
    console.info('[partner-welcome] signed in via welcome link', userId)
    return go(link)
  } catch (e) {
    console.error('[partner-welcome] threw', e)
    return go(home)
  }
}
