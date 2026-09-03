// WEC-687 — admin list filters that survive navigation.
//
// Two problems, one hook:
//   1. Filters live in the URL  → Back/Forward/refresh work, views are shareable.
//   2. Last set remembered per admin → returning to a bare list restores it.
//
// Precedence (get this right or it annoys more than the bug):
//   • URL has any known filter param → URL wins (a deliberately clean/shared link
//     must never inherit someone's stale filters).
//   • Bare URL → restore the saved set (and reflect it back into the URL).
//   • Explicit clear → wipe both.
//
// localStorage is scoped by admin user id because Fitpal admins share machines:
// Nena must not inherit Christos's filters.
//
// Low-touch by design: the hook does NOT own the filter state. A page keeps its
// existing useState calls, seeds them from `initial`, and calls `persist(...)`
// from one effect. No setter call-site has to change.

import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

export type FilterValue = string | string[]
export type FilterMap = Record<string, FilterValue>

function serialize(v: FilterValue): string {
  return Array.isArray(v) ? v.join(',') : v
}

function storageKeyFor(list: string, userId: string | undefined): string {
  return `fitpal.admin.${userId ?? 'anon'}.${list}.filters`
}

export interface AdminFilters<T extends FilterMap> {
  /** Resolved once on mount: URL → localStorage → defaults. Seed useState with this. */
  initial: T
  /** Write the current snapshot to the URL (replace) + per-admin localStorage. */
  persist: (snapshot: T) => void
  /** Remove the saved set. The caller resets its own state to defaults. */
  clear: () => void
}

export function useAdminFilters<T extends FilterMap>(
  list: string,
  userId: string | undefined,
  defaults: T,
): AdminFilters<T> {
  const [searchParams, setSearchParams] = useSearchParams()
  const storageKey = storageKeyFor(list, userId)

  // Keep the latest setter/params in a ref so persist() (called from an effect)
  // never closes over a stale value.
  const spRef = useRef(setSearchParams)
  spRef.current = setSearchParams
  const paramsRef = useRef(searchParams)
  paramsRef.current = searchParams

  const initial = useMemo<T>(() => {
    const keys = Object.keys(defaults) as (keyof T & string)[]

    // 1. URL wins if it carries any known key.
    let urlHasAny = false
    const fromUrl = {} as T
    for (const k of keys) {
      const raw = searchParams.get(k)
      if (raw !== null) {
        urlHasAny = true
        fromUrl[k] = (Array.isArray(defaults[k])
          ? (raw ? raw.split(',') : [])
          : raw) as T[typeof k]
      }
    }
    if (urlHasAny) return { ...defaults, ...fromUrl }

    // 2. Otherwise restore the saved set.
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (saved && typeof saved === 'object') {
        // Only adopt keys we know about, keeping the declared types.
        const merged = { ...defaults }
        for (const k of keys) {
          const v = (saved as Record<string, unknown>)[k]
          if (Array.isArray(defaults[k]) ? Array.isArray(v) : typeof v === 'string') {
            merged[k] = v as T[typeof k]
          }
        }
        return merged
      }
    } catch { /* ignore corrupt storage */ }

    // 3. Defaults.
    return defaults
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = (snapshot: T) => {
    const next = new URLSearchParams(paramsRef.current)
    for (const k of Object.keys(defaults)) {
      const s = serialize(snapshot[k])
      const def = serialize(defaults[k])
      if (s && s !== def) next.set(k, s)
      else next.delete(k)
    }
    spRef.current(next, { replace: true })
    try { localStorage.setItem(storageKey, JSON.stringify(snapshot)) } catch { /* quota / private mode */ }
  }

  const clear = () => {
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
  }

  return { initial, persist, clear }
}
