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
 * Base URL of THIS exact deploy, for calling a sibling function from a
 * scheduled function (which has no incoming request to take an origin from).
 *
 * Built from the Functions `context` — `<deployId>--<siteName>.netlify.app` is
 * Netlify's permalink for one specific deploy, so the call can only ever reach
 * the same code and the same environment (dev never hands its sweep to
 * production or vice versa). The first attempt used the URL env var, which on
 * the dev branch resolved to a site where the function didn't exist (404).
 * Null when the context lacks the ids — callers then work inline.
 */
export function deployBaseUrl(context: unknown): string | null {
  const c = context as { deploy?: { id?: string }; site?: { name?: string } } | undefined
  const deployId = c?.deploy?.id
  const siteName = c?.site?.name
  if (!deployId || !siteName) return null
  return `https://${deployId}--${siteName}.netlify.app`
}
