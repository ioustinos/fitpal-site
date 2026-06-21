// WEC-351: instant CDN invalidation of the customer menu cache after an admin
// menu edit. The menu-meta / menu-week / menu-catalog responses are tagged
// `Netlify-Cache-Tag: menu`; this purges that tag so changes show in ~1s
// instead of waiting out the 5-min s-maxage + stale-while-revalidate window.
//
// Auth: admin Bearer JWT validated via is_admin() RPC on the caller's token.
// Purge uses Netlify's platform-injected purge credentials (same mechanism the
// @netlify/functions `purgeCache` helper uses internally) — no user token. If
// those aren't present, it no-ops and stale-while-revalidate still refreshes
// within ~5 min, so this only ever improves latency, never breaks.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the caller is an admin.
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin')
  if (adminErr || !isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Platform-injected token, or a manually-set Netlify PAT (NETLIFY_PURGE_TOKEN,
  // per the WEC-351 plan) — whichever is present.
  const purgeToken = process.env.NETLIFY_PURGE_API_TOKEN ?? process.env.NETLIFY_PURGE_TOKEN
  const siteId = process.env.SITE_ID ?? process.env.NETLIFY_SITE_ID
  if (!purgeToken || !siteId) {
    console.warn('[purge-menu-cache] no injected purge creds (token=%s site=%s) — relying on stale-while-revalidate', !!purgeToken, !!siteId)
    return Response.json({ purged: false, reason: 'no-injected-credentials' })
  }

  try {
    const res = await fetch('https://api.netlify.com/api/v1/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${purgeToken}` },
      body: JSON.stringify({ site_id: siteId, cache_tags: ['menu'] }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[purge-menu-cache] purge HTTP %s: %s', res.status, body.slice(0, 300))
      return Response.json({ purged: false, status: res.status }, { status: 502 })
    }
    return Response.json({ purged: true })
  } catch (err) {
    console.error('[purge-menu-cache] purge error:', err)
    return Response.json({ purged: false, error: String(err) }, { status: 500 })
  }
}
