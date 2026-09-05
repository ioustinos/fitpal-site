/**
 * WEC-710 (B2B-2 — store resolution from the URL path): resolve one storefront
 * by slug, for the customer site's StoreProvider.
 *
 * Part of WEC-649 «[EPIC] Company Portals & Reseller Portals». Routing is
 * path-based — orders.fitpal.gr/acme — so the first path segment is the slug.
 *
 * Returns the store row plus its `store_settings` in ONE payload so the client
 * has no waterfall. Read-only, public data (a storefront's name, branding and
 * its single locked delivery address are shown on the storefront itself).
 *
 * `airtable_store_id` is deliberately NOT returned — it is an internal ops id.
 *
 * Three outcomes, deliberately distinguishable:
 *   200 { status: 'ok', store, settings }   → render the store
 *   200 { status: 'inactive', store }       → "store unavailable" page
 *   404 { error: 'store_not_found' }        → 404, never a silent fall back to main
 *
 * A reserved slug (admin, checkout, account, …) can never reach here as a real
 * store: the `stores_slug_safe` check constraint rejects it at insert time, and
 * the client skips resolution for those segments entirely.
 *
 * Caching (see the `caching-layer` skill): only the successful 'ok' branch is
 * edge-cached, tagged `stores` so an admin store edit can purge it instantly
 * (WEC-715). Inactive and error branches are `no-store`, so flipping a store
 * back to active shows up immediately instead of being pinned for 5 minutes.
 */

import type { Handler } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Same shape the DB constraint enforces (stores_slug_safe).
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

// Public-safe store columns. Keep this list explicit — a future internal
// column must be opted in, not leak by virtue of select('*').
const STORE_COLUMNS = [
  'id', 'slug', 'type', 'name_el', 'name_en',
  'logo_url', 'accent_color',
  'banner_1_el', 'banner_1_en', 'banner_2_el', 'banner_2_en',
  'address_street', 'address_area', 'address_zip',
  'address_floor', 'address_doorbell', 'address_notes',
  'is_default', 'active',
].join(', ')

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
  'Netlify-Cache-Tag': 'stores',
  'Content-Type': 'application/json; charset=utf-8',
} as const

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const

export const handler: Handler = async (event) => {
  const slug = (event.queryStringParameters?.slug ?? '').trim().toLowerCase()

  // Validate before touching the DB, so a malformed request 400s instead of
  // risking a cached 503.
  if (!slug || !SLUG_RE.test(slug)) {
    return {
      statusCode: 400,
      headers: NO_STORE_HEADERS,
      body: JSON.stringify({ error: 'invalid_slug' }),
    }
  }

  if (!SUPABASE_URL || !(SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY)) {
    return {
      statusCode: 500,
      headers: NO_STORE_HEADERS,
      body: JSON.stringify({ error: 'Supabase env vars missing' }),
    }
  }

  // Service role when available: the public read policy on `stores` is
  // active-only, so an inactive store would otherwise be indistinguishable
  // from a missing one and we could not tell "unavailable" from 404.
  // Falls back to anon (still correct, just collapses inactive into 404).
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
  const supabase: SupabaseClient = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data: store, error } = await supabase
      .from('stores')
      .select(STORE_COLUMNS)
      .eq('slug', slug)
      .maybeSingle()

    if (error) throw new Error(error.message)

    if (!store) {
      return {
        statusCode: 404,
        headers: NO_STORE_HEADERS,
        body: JSON.stringify({ error: 'store_not_found', slug }),
      }
    }

    const row = store as Record<string, unknown>

    if (row.active === false) {
      return {
        statusCode: 200,
        headers: NO_STORE_HEADERS,
        body: JSON.stringify({
          status: 'inactive',
          store: { slug: row.slug, name_el: row.name_el, name_en: row.name_en },
        }),
      }
    }

    const { data: settings, error: settingsErr } = await supabase
      .from('store_settings')
      .select('key, value')
      .eq('store_id', row.id as string)

    if (settingsErr) throw new Error(settingsErr.message)

    return {
      statusCode: 200,
      headers: { ...CACHE_HEADERS },
      body: JSON.stringify({
        status: 'ok',
        store: row,
        settings: settings ?? [],
        generatedAt: new Date().toISOString(),
      }),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return {
      statusCode: 503,
      headers: NO_STORE_HEADERS,
      body: JSON.stringify({ error: `resolve-store failed: ${message}` }),
    }
  }
}
