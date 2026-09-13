/**
 * WEC-350: public settings endpoint.
 *
 * Returns the subset of `public.settings` rows that are safe to expose to
 * anonymous visitors. The customer site reads cutoff config, min order,
 * time slots, enabled payment methods, contact info, bank-transfer details,
 * macros display mode, pickup locations, and the variant pill threshold.
 *
 * Admin-only settings (anything not in the whitelist below) are excluded
 * server-side — so even if a future setting key is added that shouldn't be
 * public, it won't leak through this endpoint until explicitly whitelisted.
 *
 * Response shape is `{ rows: [{ key, value }] }` — the SAME shape the
 * existing client `fetchSettings` parser already consumes. That means the
 * heavy JSON-validation logic in `src/lib/api/settings.ts` stays exactly
 * where it is; only the data source changes.
 *
 * Cache headers: 5 min edge TTL + 24h stale-while-revalidate, same as
 * /api/menu/bootstrap. Settings rarely change, so this is borderline
 * over-cautious — but it keeps the customer-facing read path at zero DB
 * load even under sustained traffic.
 */

import type { Handler } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

// Keys safe to expose to anonymous customers. Anything not in this list
// — admin-only flags, internal toggles, feature gates — is filtered out
// before the response is built. KEEP THIS LIST TIGHT.
const PUBLIC_KEYS = [
  'min_order',
  'cutoff_hour',
  'cutoff_weekday_overrides',
  'cutoff_date_overrides',
  'payment_methods_enabled',
  'contact',
  'bank_transfer_info',
  'macros_display',
  'pickup_locations',
  'variant_pill_threshold',
] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
  // WEC-351: tag so admin settings/cutoff edits can purge this instantly.
  'Netlify-Cache-Tag': 'settings',
  'Content-Type': 'application/json; charset=utf-8',
} as const

interface SettingRow {
  key: string
  value: unknown
}

interface UiStringRow {
  key: string
  value_el: string | null
  value_en: string | null
}

interface SettingsResponse {
  rows: SettingRow[]
  // WEC-734: admin copy overrides ride ALONG with settings rather than getting
  // their own endpoint. This response is already edge-cached for 5 minutes with
  // a 24h stale-while-revalidate and a `settings` purge tag, so carrying them
  // here costs zero extra requests and zero extra DB round-trips — the whole
  // point of the decision. A separate endpoint or an on-mount fetch would turn
  // a free feature into a per-page cost. Do not "tidy" this into its own route.
  uiStrings: UiStringRow[]
  generatedAt: string
}

export const handler: Handler = async (event) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Supabase env vars missing' }),
    }
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // One round trip for both. ui_strings is public-read by RLS (the strings are
    // on the page anyway) so the anon key is enough.
    const [{ data, error }, uiRes] = await Promise.all([
      supabase.from('settings').select('key, value').in('key', PUBLIC_KEYS as unknown as string[]),
      supabase.from('ui_strings').select('key, value_el, value_en'),
    ])

    if (error) throw new Error(error.message)

    // ⚠️ A failed overrides read is NOT fatal. Copy overrides are a nicety; the
    // compiled defaults are always right. Failing the whole settings response —
    // which carries the minimum order and the cutoff — because someone's typo
    // fix could not be read would be a catastrophic trade.
    const uiStrings: UiStringRow[] = uiRes.error ? [] : ((uiRes.data ?? []) as UiStringRow[])
    if (uiRes.error) console.warn('[settings-public] ui_strings read failed, serving file defaults:', uiRes.error.message)

    let rows: SettingRow[] = (data ?? []) as SettingRow[]

    // WEC-711: a company/reseller storefront overlays its own values on top
    // of the platform defaults — a store that has not overridden its cutoff
    // inherits the global one rather than getting a null. Only the whitelist
    // above can be overridden, so a store cannot surface a non-public key.
    //
    // Retail sends no `storeId`, so its URL, its cache entry and its response
    // are byte-identical to before this ticket.
    const storeIdParam = (event.queryStringParameters?.storeId ?? '').trim()
    if (UUID_RE.test(storeIdParam)) {
      const { data: storeRows, error: storeErr } = await supabase
        .from('store_settings')
        .select('key, value')
        .eq('store_id', storeIdParam)
        .in('key', PUBLIC_KEYS as unknown as string[])

      // A failed overlay is not fatal: fall through with the global defaults
      // rather than showing the storefront an error page.
      if (!storeErr && storeRows?.length) {
        const merged = new Map<string, unknown>(rows.map((r) => [r.key, r.value]))
        for (const r of storeRows as SettingRow[]) merged.set(r.key, r.value)
        rows = [...merged].map(([key, value]) => ({ key, value }))
      }
    }

    const body: SettingsResponse = {
      rows,
      uiStrings,
      generatedAt: new Date().toISOString(),
    }

    return {
      statusCode: 200,
      headers: { ...CACHE_HEADERS },
      body: JSON.stringify(body),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return {
      statusCode: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ error: `settings-public failed: ${message}` }),
    }
  }
}
