/**
 * WEC-710 (B2B-2 — store resolution from the URL path): client fetcher for
 * /api/resolve-store, memoized for the tab's lifetime with in-flight dedupe —
 * the same Layer-4 pattern as src/lib/api/bootstrap.ts.
 *
 * A storefront never changes under a customer mid-session, so one fetch per
 * slug per tab is right. `resetStorefrontCache()` exists for the admin store
 * editor (WEC-715) and for tests.
 */

export interface StoreRow {
  id: string
  slug: string
  type: 'main' | 'company' | 'reseller'
  name_el: string
  name_en: string
  logo_url: string | null
  accent_color: string | null
  banner_1_el: string | null
  banner_1_en: string | null
  banner_2_el: string | null
  banner_2_en: string | null
  /** The ONE locked delivery address. Null on main — retail asks the customer. */
  address_street: string | null
  address_area: string | null
  address_zip: string | null
  address_floor: string | null
  address_doorbell: string | null
  address_notes: string | null
  is_default: boolean
  active: boolean
}

export interface StoreSettingRow {
  key: string
  value: unknown
}

export type StorefrontResult =
  | { status: 'ok'; store: StoreRow; settings: StoreSettingRow[] }
  | { status: 'inactive'; slug: string }
  | { status: 'not_found'; slug: string }
  /** Network/server failure — distinct from not_found so we never 404 a real store. */
  | { status: 'error'; slug: string; message: string }

const cache = new Map<string, StorefrontResult>()
const inFlight = new Map<string, Promise<StorefrontResult>>()

export function resetStorefrontCache(slug?: string): void {
  if (slug) {
    cache.delete(slug)
    inFlight.delete(slug)
  } else {
    cache.clear()
    inFlight.clear()
  }
}

export function fetchStorefront(slug: string, force = false): Promise<StorefrontResult> {
  if (force) resetStorefrontCache(slug)

  const cached = cache.get(slug)
  if (cached) return Promise.resolve(cached)

  const pending = inFlight.get(slug)
  if (pending) return pending

  const promise = (async (): Promise<StorefrontResult> => {
    try {
      const res = await fetch(`/api/resolve-store?slug=${encodeURIComponent(slug)}`)

      if (res.status === 404) return { status: 'not_found', slug }

      if (!res.ok) {
        return { status: 'error', slug, message: `HTTP ${res.status}` }
      }

      const body = await res.json()
      if (body?.status === 'inactive') return { status: 'inactive', slug }
      if (body?.status === 'ok' && body.store) {
        return { status: 'ok', store: body.store as StoreRow, settings: body.settings ?? [] }
      }
      return { status: 'error', slug, message: 'unexpected payload' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error'
      return { status: 'error', slug, message }
    }
  })()

  inFlight.set(slug, promise)

  return promise.then((result) => {
    inFlight.delete(slug)
    // Never memoize a transient failure — a flaky network must not pin a
    // real storefront as broken for the rest of the tab's life.
    if (result.status !== 'error') cache.set(slug, result)
    return result
  })
}
