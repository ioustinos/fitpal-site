// WEC-914: shared helpers for server-to-server calls between our own Netlify
// functions (scheduled sweep → background sweep).

import { createHash } from 'node:crypto'

/**
 * A token both sides can derive without a new env var: a hash of the service
 * role key, which every server function already has. Never the key itself.
 * Keeps the background sweep from being triggered by anyone on the internet.
 */
export function internalToken(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return createHash('sha256').update(`fitpal-internal:${key}`).digest('hex')
}

/**
 * Base URL of THIS deploy's site, for calling a sibling function from a
 * scheduled function (which has no incoming request to take an origin from).
 * Production → the primary site URL; branch deploys (dev) → their branch URL.
 * Null when Netlify didn't provide one — callers fall back to working inline.
 */
export function siteBaseUrl(): string | null {
  const ctx = process.env.CONTEXT
  const url = ctx === 'production'
    ? (process.env.URL ?? process.env.DEPLOY_PRIME_URL)
    : (process.env.DEPLOY_PRIME_URL ?? process.env.URL)
  return url ? url.replace(/\/$/, '') : null
}
