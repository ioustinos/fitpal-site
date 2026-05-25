// First-party UTM capture (WEC-381). Stores first-touch UTMs for the current
// session; signup persists them to profiles (never overwritten). This is
// functional attribution data, not a third-party tracker — safe pre-consent.

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type UtmKey = (typeof UTM_KEYS)[number]
export type UtmParams = Partial<Record<UtmKey, string>>

const STORAGE_KEY = 'fitpal_first_utm'
const ALLOWED_MEDIUMS = new Set(['cpc', 'email', 'social', 'referral', 'affiliate'])

/** Parse UTMs from the URL and persist first-touch (never overwrite an existing
 *  stored set). Returns whatever was found on this URL. */
export function captureUtm(search: string = typeof window !== 'undefined' ? window.location.search : ''): UtmParams {
  const params = new URLSearchParams(search)
  const found: UtmParams = {}
  for (const k of UTM_KEYS) {
    const v = params.get(k)
    if (v) found[k] = v
  }
  // Log (don't block) non-standard mediums — anomaly visibility per §3.8.
  if (found.utm_medium && !ALLOWED_MEDIUMS.has(found.utm_medium)) {
    console.warn('[utm] non-standard utm_medium:', found.utm_medium)
  }
  if (Object.keys(found).length > 0 && !getStoredUtm()) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(found))
    } catch {
      /* sessionStorage unavailable — ignore */
    }
  }
  return found
}

/** First-touch UTMs captured this session, or null. */
export function getStoredUtm(): UtmParams | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as UtmParams) : null
  } catch {
    return null
  }
}
