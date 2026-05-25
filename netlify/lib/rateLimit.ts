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
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
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
