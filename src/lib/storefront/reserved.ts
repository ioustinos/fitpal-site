/**
 * WEC-710 (B2B-2 — store resolution from the URL path).
 *
 * Routing is path-based: orders.fitpal.gr/acme. The first path segment is the
 * store slug — UNLESS it is one of the app's own routes, which is the trap this
 * file exists to avoid. A store slugged `account` would shadow the account page.
 *
 * Defence in depth, three layers, and they must stay in sync:
 *   1. DB   — `stores_slug_safe` check constraint (migration wec709/wec710)
 *   2. here — the client never even attempts to resolve a reserved segment
 *   3. admin create-store form (WEC-715 «B2B-7 — Admin: store CRUD»)
 *
 * The server function needs no copy: a reserved slug cannot exist as a row,
 * because the DB rejects it at insert.
 */

/**
 * Path segments that are NOT store slugs. Includes every real route in
 * App.tsx plus the obvious future ones — reserving a word costs nothing,
 * un-reserving one later is free, but discovering a collision in production
 * means a corporate client's URL ate a real page.
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  'admin', 'account', 'api', 'assets', 'auth', 'callback', 'cart', 'checkout',
  'login', 'logout', 'menu', 'order', 'orders', 'pay', 'payment', 'privacy',
  'profile', 'signup', 'static', 'subscription', 'terms', 'wallet',
])

/** Same shape the DB constraint enforces. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

/** Hostnames that are the MAIN store, never a per-store subdomain. */
const MAIN_HOSTS = new Set([
  'orders.fitpal.gr',
  'www.fitpal.gr',
  'fitpal.gr',
  'localhost',
])

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SEGMENTS.has(slug.toLowerCase())
}

/**
 * Work out which storefront a URL points at.
 *
 * Returns `null` for the main store — the retail site — which is the answer for
 * every existing URL. That is deliberate: retail then costs zero extra work.
 *
 * Order of precedence:
 *   1. `?store=acme` — dev/localhost only, so a scenario can be tested without
 *      touching the path.
 *   2. hostname — `acme.fitpal.gr`. Not used today (V1 is path-based) but the
 *      branch exists so a branded subdomain for one demanding client later
 *      costs a DNS record, not a refactor.
 *   3. first path segment — `/acme`.
 */
export function resolveSlugFromLocation(loc: {
  hostname: string
  pathname: string
  search: string
}): string | null {
  const host = loc.hostname.toLowerCase()

  // 1. dev-only query override
  const isDevHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.startsWith('dev--') ||
    host.endsWith('.local')
  if (isDevHost) {
    const override = new URLSearchParams(loc.search).get('store')?.trim().toLowerCase()
    if (override) {
      if (override === 'main') return null
      if (SLUG_RE.test(override) && !isReservedSlug(override)) return override
    }
  }

  // 2. hostname branch — inert in V1, kept so subdomains stay cheap later.
  if (!MAIN_HOSTS.has(host) && host.endsWith('.fitpal.gr')) {
    const label = host.slice(0, -'.fitpal.gr'.length)
    if (SLUG_RE.test(label) && !isReservedSlug(label) && label !== 'orders' && label !== 'www') {
      return label
    }
  }

  // 3. path branch — the one that actually runs.
  const first = loc.pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  if (!first) return null
  if (isReservedSlug(first)) return null
  if (!SLUG_RE.test(first)) return null
  return first
}
