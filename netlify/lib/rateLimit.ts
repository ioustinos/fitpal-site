// Rate limiting for public Netlify functions — WEC-147.
//
// Netlify functions are stateless across invocations, so the counter lives in
// Postgres (public.rate_limits + check_rate_limit RPC, fixed-window). This guards
// the unauthenticated endpoints against voucher brute-force and order spam.
//
// Design choice: FAIL-OPEN. If the limiter can't be reached (misconfigured env,
// Supabase blip), we ALLOW the request rather than block a paying customer. The
// limiter is a mitigation, not a gate.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// WEC-540: Netlify build context. dev/branch/preview are NOT 'production'
// (matches the Viva _DEV/_PROD resolution — dev never runs as production).
const IS_PRODUCTION = (process.env.CONTEXT ?? '') === 'production'

/**
 * WEC-540: dev-only load-test bypass. When RATE_LIMIT_DISABLED=true AND we are
 * NOT in the production context, checkRateLimit short-circuits to `true` WITHOUT
 * touching the RPC — important, because the RPC's per-IP `SELECT … FOR UPDATE`
 * is itself a single-IP serialization point that contaminates capacity
 * measurements from a bounded-IP load source. Production ignores the flag.
 */
function bypassEnabled(): boolean {
  return !IS_PRODUCTION && process.env.RATE_LIMIT_DISABLED === 'true'
}

interface LimitCfg { max?: number; window?: number }

// In-memory cache of the settings.rate_limits override (per warm instance).
// Short TTL so an admin change takes effect within ~30s without a deploy.
let _rlCache: { at: number; map: Record<string, LimitCfg> } | null = null
const RL_CACHE_TTL_MS = 30_000

async function loadRateLimitOverrides(): Promise<Record<string, LimitCfg>> {
  if (_rlCache && Date.now() - _rlCache.at < RL_CACHE_TTL_MS) return _rlCache.map
  let map: Record<string, LimitCfg> = {}
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data } = await supabase.from('settings').select('value').eq('key', 'rate_limits').maybeSingle()
    const v = (data as { value?: unknown } | null)?.value
    if (v && typeof v === 'object' && !Array.isArray(v)) map = v as Record<string, LimitCfg>
  } catch {
    // fall through to hardcoded defaults — never block on a settings read
  }
  _rlCache = { at: Date.now(), map }
  return map
}

/** Best-effort client IP from Netlify / proxy headers. */
export function clientIp(request: Request): string {
  const h = request.headers
  return (
    h.get('x-nf-client-connection-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('client-ip') ||
    'unknown'
  )
}

/**
 * Returns true if the request is allowed (under the limit), false if it should
 * be rejected with 429. Never throws — fails open.
 *
 * @param key    stable identifier, e.g. `submit-order:<ip>`
 * @param max    max requests allowed within the window
 * @param windowSeconds  window length in seconds
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return true // not configured → fail open
  if (bypassEnabled()) return true               // WEC-540: dev load-test bypass (skips the RPC entirely)
  try {
    // WEC-540: per-endpoint override from settings.rate_limits[<endpoint>],
    // where <endpoint> is the key prefix (e.g. 'submit-order:1.2.3.4' →
    // 'submit-order'). Falls back to the hardcoded caller values when unset.
    const endpoint = key.split(':')[0]
    const cfg = (await loadRateLimitOverrides())[endpoint]
    const effMax = cfg && Number.isFinite(cfg.max) ? (cfg.max as number) : max
    const effWindow = cfg && Number.isFinite(cfg.window) ? (cfg.window as number) : windowSeconds
    if (effMax <= 0) return true // a configured max of 0 disables the limit for that endpoint

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_max: effMax,
      p_window_seconds: effWindow,
    })
    if (error) {
      console.error('[rateLimit] rpc error, failing open:', error.message)
      return true
    }
    return data === true
  } catch (e) {
    console.error('[rateLimit] unexpected error, failing open:', e)
    return true
  }
}
