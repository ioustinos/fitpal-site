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

interface SettingsResponse {
  rows: SettingRow[]
  generatedAt: string
}

export const handler: Handler = async () => {
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
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', PUBLIC_KEYS as unknown as string[])

    if (error) throw new Error(error.message)

    const rows: SettingRow[] = (data ?? []) as SettingRow[]

    const body: SettingsResponse = {
      rows,
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
