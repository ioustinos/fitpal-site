/**
 * WEC-710 (B2B-2 — store resolution from the URL path + StoreProvider).
 * Part of WEC-649 «[EPIC] Company Portals & Reseller Portals».
 *
 * Works out which storefront the current URL points at and exposes it through
 * `useStorefront()`. NOTHING consumes it yet — the behaviour change lands in
 * WEC-711 «B2B-3 — per-store data loading». This ticket only resolves.
 *
 * Naming note: the hook is `useStorefront`, not `useStore` as the ticket wrote
 * it, because `useStore` is also a zustand export and this codebase is full of
 * zustand stores — a file importing both would collide on the name.
 *
 * Retail cost: on a normal URL the slug resolves to null synchronously, so the
 * retail site renders exactly as before with no gate and no waiting. The one
 * addition is a single background GET of the main store row (edge-cached,
 * non-blocking, failures ignored) so `id` is populated for WEC-711.
 */

import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode, type CSSProperties,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { supabase } from '../supabase'
import { resolveSlugFromLocation } from './reserved'
import { fetchStorefront, type StoreRow, type StoreSettingRow } from './api'

export interface Storefront {
  /** null only while the main store row is still being enriched in the background. */
  id: string | null
  slug: string
  type: 'main' | 'company' | 'reseller'
  name: { el: string; en: string }
  branding: {
    logoUrl: string | null
    accentColor: string | null
    banner1: { el: string | null; en: string | null }
    banner2: { el: string | null; en: string | null }
  }
  /** The ONE locked delivery address. Null on main — retail asks the customer. */
  address: {
    street: string | null
    area: string | null
    zip: string | null
    floor: string | null
    doorbell: string | null
    notes: string | null
  } | null
  /** Per-store settings, same key/value shape as the global `settings` table. */
  settings: Record<string, unknown>
  isMain: boolean
}

type Status =
  | 'ready' | 'resolving' | 'inactive' | 'not_found' | 'error'
  // WEC-714: a reseller store is invite-only. These two are the honest answers
  // to "why can't I see the menu" — a generic refusal would be worse.
  | 'needs_login' | 'no_access'

interface StoreContextValue {
  storefront: Storefront
  status: Status
}

const MAIN: Storefront = {
  id: null,
  slug: 'main',
  type: 'main',
  name: { el: 'Fitpal', en: 'Fitpal' },
  branding: {
    logoUrl: null, accentColor: null,
    banner1: { el: null, en: null }, banner2: { el: null, en: null },
  },
  address: null,
  settings: {},
  isMain: true,
}

const StoreContext = createContext<StoreContextValue>({ storefront: MAIN, status: 'ready' })

export function useStorefront(): Storefront {
  return useContext(StoreContext).storefront
}

export function useStorefrontStatus(): Status {
  return useContext(StoreContext).status
}

function toStorefront(row: StoreRow, settings: StoreSettingRow[]): Storefront {
  const hasAddress = !!(row.address_street || row.address_zip || row.address_area)
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    name: { el: row.name_el, en: row.name_en },
    branding: {
      logoUrl: row.logo_url,
      accentColor: row.accent_color,
      banner1: { el: row.banner_1_el, en: row.banner_1_en },
      banner2: { el: row.banner_2_el, en: row.banner_2_en },
    },
    address: hasAddress
      ? {
          street: row.address_street,
          area: row.address_area,
          zip: row.address_zip,
          floor: row.address_floor,
          doorbell: row.address_doorbell,
          notes: row.address_notes,
        }
      : null,
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    isMain: row.type === 'main' || row.is_default,
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const location = useLocation()

  const slug = useMemo(
    () =>
      resolveSlugFromLocation({
        hostname: typeof window === 'undefined' ? 'localhost' : window.location.hostname,
        pathname: location.pathname,
        search: location.search,
      }),
    [location.pathname, location.search],
  )

  const [state, setState] = useState<StoreContextValue>(
    slug === null ? { storefront: MAIN, status: 'ready' } : { storefront: MAIN, status: 'resolving' },
  )

  useEffect(() => {
    let cancelled = false

    // Main store — the retail site. Render immediately; enrich in the
    // background purely so `id` and per-store settings are available to
    // WEC-711. A failure here is a no-op: retail reads the global `settings`
    // table exactly as it always has.
    if (slug === null) {
      setState({ storefront: MAIN, status: 'ready' })
      void fetchStorefront('main').then((r) => {
        if (cancelled || r.status !== 'ok') return
        setState({ storefront: toStorefront(r.store, r.settings), status: 'ready' })
      })
      return () => { cancelled = true }
    }

    setState((prev) => ({ ...prev, status: 'resolving' }))
    void fetchStorefront(slug).then((r) => {
      if (cancelled) return
      if (r.status === 'ok') {
        const sf = toStorefront(r.store, r.settings)

        // WEC-714: reseller stores are gated to admin-selected users. This is
        // the courtesy layer — submit-order enforces the same rule server-side,
        // because a hidden menu is not access control.
        if (sf.type === 'reseller') {
          void (async () => {
            const { data: auth } = await supabase.auth.getUser()
            if (cancelled) return
            if (!auth?.user) { setState({ storefront: MAIN, status: 'needs_login' }); return }
            const { data: member } = await supabase
              .from('store_members')
              .select('user_id')
              .eq('store_id', sf.id as string)
              .eq('user_id', auth.user.id)
              .maybeSingle()
            if (cancelled) return
            if (!member) { setState({ storefront: MAIN, status: 'no_access' }); return }
            useMenuStore.getState().setStorefront({ id: sf.id, slug: sf.slug, isMain: sf.isMain })
            setState({ storefront: sf, status: 'ready' })
          })()
          return
        }

        // WEC-711: tell the menu store which storefront to load. Done before
        // the children mount, so MenuPage's load() makes exactly one fetch.
        useMenuStore.getState().setStorefront({ id: sf.id, slug: sf.slug, isMain: sf.isMain })
        setState({ storefront: sf, status: 'ready' })
      } else if (r.status === 'inactive') {
        setState({ storefront: MAIN, status: 'inactive' })
      } else if (r.status === 'not_found') {
        // Never silently fall back to main — a wrong URL must be visible.
        setState({ storefront: MAIN, status: 'not_found' })
      } else {
        setState({ storefront: MAIN, status: 'error' })
      }
    })

    return () => { cancelled = true }
  }, [slug])

  if (state.status === 'resolving') return <StoreBootFallback />
  if (state.status === 'inactive') return <StoreMessage kind="inactive" slug={slug ?? ''} />
  if (state.status === 'not_found') return <StoreMessage kind="not_found" slug={slug ?? ''} />
  if (state.status === 'error') return <StoreMessage kind="error" slug={slug ?? ''} />
  if (state.status === 'needs_login') return <StoreMessage kind="needs_login" slug={slug ?? ''} />
  if (state.status === 'no_access') return <StoreMessage kind="no_access" slug={slug ?? ''} />

  return <StoreContext.Provider value={state}>{children}</StoreContext.Provider>
}

/** Minimal shell — index.css may not describe these states yet. */
function StoreBootFallback() {
  return (
    <div style={shellStyle}>
      <div style={{ color: '#6b7280', fontSize: 14 }}>…</div>
    </div>
  )
}

const shellStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
  textAlign: 'center',
  fontFamily: 'Geologica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

/**
 * Bilingual, specific, and honest about which of the three things went wrong —
 * per the project's error-messaging standard. A customer who mistypes a company
 * URL should be told the URL is wrong, not shown the retail menu as if nothing
 * happened.
 */
function StoreMessage({ kind, slug }: { kind: 'inactive' | 'not_found' | 'error' | 'needs_login' | 'no_access'; slug: string }) {
  const lang = useUIStore((s) => s.lang)

  const copy = {
    inactive: {
      el: { title: 'Το κατάστημα δεν είναι διαθέσιμο', body: `Η παραγγελία για «${slug}» είναι προσωρινά κλειστή. Επικοινώνησε με την εταιρεία σου ή δοκίμασε αργότερα.` },
      en: { title: 'This store is unavailable', body: `Ordering for “${slug}” is temporarily closed. Check with your company or try again later.` },
    },
    not_found: {
      el: { title: 'Δεν βρέθηκε το κατάστημα', body: `Δεν υπάρχει κατάστημα «${slug}». Έλεγξε τον σύνδεσμο που σου έστειλαν.` },
      en: { title: 'Store not found', body: `There is no store called “${slug}”. Check the link you were sent.` },
    },
    error: {
      el: { title: 'Κάτι πήγε στραβά', body: 'Δεν μπορέσαμε να φορτώσουμε το κατάστημα. Δοκίμασε ξανά σε λίγο.' },
      en: { title: 'Something went wrong', body: 'We could not load this store. Please try again shortly.' },
    },
    // WEC-714 — say what happened and what to do about it, per the project's
    // error-messaging standard. A blank "access denied" helps nobody.
    needs_login: {
      el: { title: 'Χρειάζεται σύνδεση', body: `Το «${slug}» είναι κατάστημα χονδρικής με πρόσβαση μόνο για εγκεκριμένους συνεργάτες. Συνδέσου για να συνεχίσεις.` },
      en: { title: 'Sign in required', body: `“${slug}” is a wholesale store, open only to approved partners. Sign in to continue.` },
    },
    no_access: {
      el: { title: 'Δεν έχεις πρόσβαση σε αυτό το κατάστημα', body: `Ο λογαριασμός σου δεν είναι εγκεκριμένος για το «${slug}». Επικοινώνησε με τη Fitpal αν πιστεύεις ότι πρόκειται για λάθος.` },
      en: { title: 'You do not have access to this store', body: `Your account is not approved for “${slug}”. Contact Fitpal if you think that is a mistake.` },
    },
  }[kind][lang === 'en' ? 'en' : 'el']

  return (
    <div style={shellStyle}>
      <img src="/logo.svg" alt="Fitpal" style={{ height: 32, marginBottom: 8 }} />
      <h1 style={{ fontSize: 20, margin: 0 }}>{copy.title}</h1>
      <p style={{ color: '#6b7280', margin: 0, maxWidth: 420 }}>{copy.body}</p>
      <a href="/" style={{ marginTop: 8, color: '#00b96b', fontWeight: 600 }}>
        {lang === 'en' ? 'Go to fitpal.gr →' : 'Πήγαινε στο fitpal.gr →'}
      </a>
    </div>
  )
}
