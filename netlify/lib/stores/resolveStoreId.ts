/**
 * WEC-711 (B2B-3 — per-store data loading): resolve which store a public read
 * endpoint should serve, from an optional `?storeId=` query param.
 *
 * Part of WEC-649 «[EPIC] Company Portals & Reseller Portals».
 *
 * ⚠️ FAIL-OPEN BY DESIGN. If the default ('main') store cannot be resolved —
 * DB hiccup, missing row, anything — this returns `null`, and every caller
 * treats null as "do not filter by store", i.e. exactly the behaviour the
 * platform had before this epic. The alternative (filtering on a null id)
 * would return an empty menu, which is a retail outage. A broken lookup must
 * cost correctness of the B2B split, never the retail site.
 *
 * The main store id is cached per warm container (Layer 3 in the
 * `caching-layer` skill) — it never changes in practice.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let cachedMainStoreId: string | null = null

/** Test/ops helper — drops the per-container memo. */
export function _resetMainStoreIdCache(): void {
  cachedMainStoreId = null
}

/**
 * @param param raw `storeId` query param, if the caller passed one
 * @returns the store id to filter by, or null meaning "don't filter"
 */
export async function resolveEffectiveStoreId(
  supabase: SupabaseClient,
  param?: string | null,
): Promise<string | null> {
  const raw = (param ?? '').trim()
  if (raw && UUID_RE.test(raw)) return raw

  // No (or malformed) param → the main store. An invalid uuid deliberately
  // falls through to main rather than 400ing: a garbage param on a public
  // read endpoint should show the retail menu, not an error page.
  if (cachedMainStoreId) return cachedMainStoreId

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id')
      .eq('is_default', true)
      .limit(1)
      .maybeSingle()

    if (error || !data?.id) return null
    cachedMainStoreId = data.id as string
    return cachedMainStoreId
  } catch {
    return null
  }
}
