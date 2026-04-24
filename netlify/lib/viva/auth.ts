// Viva OAuth2 client-credentials flow with in-memory token cache.
//
// Token TTL is 3600s; we refresh 5 min before expiry. Cache is per warm
// Netlify Function container, so cold starts pay one extra round-trip.
//
// WEC-171: part of the Viva Payments integration epic (WEC-125).

import { getVivaCreds } from './env'

interface CachedToken {
  token: string
  expiresAtMs: number
  env: string // invalidate cache if VIVA_ENV is swapped at runtime
}

let cached: CachedToken | null = null

const SAFETY_MARGIN_MS = 5 * 60 * 1000

/** Returns a live bearer token for the current VIVA_ENV, fetching if needed. */
export async function getVivaAccessToken(): Promise<string> {
  const creds = getVivaCreds()
  const now = Date.now()

  if (cached && cached.env === creds.env && cached.expiresAtMs - now > SAFETY_MARGIN_MS) {
    return cached.token
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
  const res = await fetch(`https://${creds.accountsHost}/connect/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'urn:viva:payments:core:api:redirectcheckout',
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Viva OAuth failed: ${res.status} ${body}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = {
    token: json.access_token,
    expiresAtMs: now + json.expires_in * 1000,
    env: creds.env,
  }
  return cached.token
}

/** Test-only helper: clears the cached token. */
export function _resetVivaTokenCache(): void {
  cached = null
}
