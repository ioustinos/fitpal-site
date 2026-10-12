import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { supabase } from '../lib/supabase'
import {
  IS_CLIENT_TAB, tabStorage, CLIENT_TAB_READY, CLIENT_TAB_HANDOFF, type ClientTabHandoff,
} from '../lib/clientTab'

/**
 * Client mode — an admin or a dietitian acting as one customer.
 *
 * WEC-868 (client mode in its own tab — one identity per tab): client mode no
 * longer swaps the browser's session. It opens a NEW TAB that holds the
 * customer's session privately (sessionStorage, see lib/clientTab.ts). The
 * operator's own tabs — admin, portal, their own shopping — are untouched,
 * and leaving client mode never signs anyone out anywhere else.
 *
 *   operator tab                         client tab (?client_tab=1)
 *   ────────────                         ──────────────────────────
 *   openClientTab(userId, where)
 *     window.open (sync, on the click)  → boots, posts CLIENT_TAB_READY
 *     POST admin-impersonate-start         to window.opener
 *       → server ends the operator's
 *         previous client session and
 *         opens a new one (2h)
 *     ← waits for READY, sends HANDOFF →  acceptHandoff(): verifyOtp into its
 *                                         own storage, sets this store, drops
 *                                         window.opener
 *
 * Every order from a client tab carries X-Client-Session-Id; the server only
 * attributes it to the operator while that session is open, unexpired, still
 * heartbeating and for this very customer. The tab heartbeats every minute and
 * locks itself as soon as the server says the session is over (replaced by a
 * newer client tab, expired, closed).
 */

export interface ImpersonationTarget {
  userId: string
  name: string
  email: string
  /** WEC-816: customer's profile phone (E.164 or null) so impersonated checkout
   *  prefills the customer's number, not the admin's. */
  phone?: string | null
  /** WEC-817: customer's saved invoice details, for impersonated checkout prefill. */
  invoiceName?: string | null
  invoiceVat?: string | null
  /** WEC-818: customer's saved addresses, for impersonated checkout picker. */
  addresses?: Array<{
    id: string; labelEl: string; labelEn: string; street: string; area: string
    zip?: string; floor?: string; doorbell?: string; notes?: string
  }>
  /** WEC-819: customer's saved delivery/payment prefs, for impersonated checkout. */
  paymentMethod?: string
  cutlery?: boolean
  invoice?: boolean
  slots?: Record<number, string>
  dayAddress?: Record<number, string>
  /** WEC-822: the customer's spendable wallet (balance in EUROS, active flag),
   *  so the admin's managed-user checkout shows/spends the CUSTOMER's wallet —
   *  not the admin's. Without this the wallet badge showed the admin's balance
   *  and the wallet button was disabled when the admin's own wallet was
   *  inactive/insufficient (Maria: «δειχνει το δικο μου» + «δεν με αφηνει να
   *  πληρωσει μεσω wallet»). undefined = customer has no wallet. */
  wallet?: { balance: number; active: boolean }
}

export type ClientWhere = 'order' | 'plan' | 'account'
export type LockReason = 'closed' | 'ended' | 'replaced' | 'expired' | 'stale' | 'wrong_client' | 'missing' | 'failed'

interface ImpersonationState {
  /** True only inside a live client tab. Always false in operator tabs. */
  active: boolean
  target: ImpersonationTarget | null
  /** The operator's user id (admin or dietitian) — display/audit only; the
   *  server derives attribution from the session, never from this. */
  adminUserId: string | null
  impersonatorRole: 'admin' | 'partner' | null
  /** WEC-868: server-side session this tab acts under. */
  clientSessionId: string | null
  expiresAt: string | null
  /** WEC-868: set when this client tab may no longer act. The UI shows a lock
   *  screen; nothing can be ordered from a locked tab. */
  locked: LockReason | null
  lockMessage: string | null
  loading: boolean
  error: string | null
  /** Operator side: open a new client tab for this customer. */
  openClientTab: (targetUserId: string, where?: ClientWhere, as?: 'admin' | 'partner') => Promise<{ ok: boolean; error?: string }>
  /** Client-tab side: take the handoff from the opener and sign in. */
  acceptHandoff: (h: ClientTabHandoff) => Promise<{ ok: boolean; error?: string }>
  lock: (reason: LockReason, message?: string | null) => void
  /** WEC-820: update the impersonated customer's addresses in-place (after the
   *  admin adds/edits one during impersonated checkout). */
  setTargetAddresses: (addresses: ImpersonationTarget['addresses']) => void
}

const HANDOFF_TIMEOUT_MS = 30_000

/** Runs BEFORE the store hydrates (persist would otherwise overwrite the
 *  old record first).
 *  WEC-868 cleanup for tabs still holding an OLD session-swap impersonation
 *  (pre-WEC-868 build): that tab is signed in as the customer with no banner.
 *  Drop the customer session from this browser (local only — never the
 *  customer's other devices) so the operator signs back in as themselves. */
if (typeof window !== 'undefined' && !IS_CLIENT_TAB) {
  try {
    const raw = window.localStorage.getItem('fitpal-impersonation')
    if (raw) {
      const old = JSON.parse(raw) as { state?: { active?: boolean }; version?: number }
      window.localStorage.removeItem('fitpal-impersonation')
      if (old?.state?.active && (old.version ?? 0) < 4) {
        void supabase.auth.signOut({ scope: 'local' })
      }
    }
  } catch { /* ignore */ }
}

export const useImpersonationStore = create<ImpersonationState>()(
  persist(
    (set) => ({
      active: false,
      target: null,
      adminUserId: null,
      impersonatorRole: null,
      clientSessionId: null,
      expiresAt: null,
      locked: null,
      lockMessage: null,
      loading: false,
      error: null,
      setTargetAddresses: (addresses) => set((s) => (s.target ? { target: { ...s.target, addresses } } : s)),

      lock: (reason, message = null) => set({ locked: reason, lockMessage: message, loading: false }),

      openClientTab: async (targetUserId, where = 'order', as = 'admin') => {
        if (IS_CLIENT_TAB) {
          return { ok: false, error: 'Αυτή η καρτέλα είναι ήδη σε λειτουργία πελάτη. · This tab is already in client mode.' }
        }
        // 1. Open the tab NOW, inside the click, or the popup blocker eats it.
        const win = window.open(`/?client_tab=1&where=${encodeURIComponent(where)}`, '_blank')
        if (!win) {
          const msg = 'Ο browser μπλόκαρε τη νέα καρτέλα. Επιτρέψτε τα pop-ups για αυτό το site. · The browser blocked the new tab. Allow pop-ups for this site.'
          set({ error: msg })
          return { ok: false, error: msg }
        }
        set({ loading: true, error: null })
        const fail = (message: string) => {
          try { win.close() } catch { /* ignore */ }
          set({ loading: false, error: message })
          return { ok: false, error: message }
        }
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session?.access_token) return fail('Not signed in')
          const res = await fetch('/.netlify/functions/admin-impersonate-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ targetUserId, as }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.hashedToken || !json?.target || !json?.clientSessionId) {
            const composed = [json?.error, json?.detail].filter(Boolean).join(' — ')
            return fail(composed || 'Failed to start client mode')
          }
          const handoff: ClientTabHandoff = {
            type: CLIENT_TAB_HANDOFF,
            hashedToken: json.hashedToken,
            target: json.target,
            clientSessionId: json.clientSessionId,
            expiresAt: json.expiresAt,
            impersonatorRole: json.impersonatorRole === 'partner' ? 'partner' : 'admin',
            adminUserId: json.adminUserId,
            where,
          }
          // 2. Hand the token over once the new tab says it is ready. Only to
          //    that exact window, only on our own origin.
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => { cleanup(); reject(new Error('timeout')) }, HANDOFF_TIMEOUT_MS)
            function onMsg(ev: MessageEvent) {
              if (ev.source !== win || ev.origin !== window.location.origin) return
              if (ev.data?.type !== CLIENT_TAB_READY) return
              win!.postMessage(handoff, window.location.origin)
              cleanup(); resolve()
            }
            function cleanup() { window.clearTimeout(timer); window.removeEventListener('message', onMsg) }
            window.addEventListener('message', onMsg)
            // The tab may have announced READY before we started listening.
            try { win.postMessage({ type: 'fitpal-client-tab-ping' }, window.location.origin) } catch { /* ignore */ }
          })
          set({ loading: false, error: null })
          return { ok: true }
        } catch (err) {
          const m = err instanceof Error && err.message === 'timeout'
            ? 'Η νέα καρτέλα δεν απάντησε. Δοκιμάστε ξανά. · The new tab did not respond. Try again.'
            : err instanceof Error ? err.message : 'Unknown error'
          return fail(m)
        }
      },

      acceptHandoff: async (h) => {
        if (!IS_CLIENT_TAB) return { ok: false, error: 'not a client tab' }
        set({ loading: true, error: null })
        const { error } = await supabase.auth.verifyOtp({ token_hash: h.hashedToken, type: 'magiclink' })
        if (error) {
          set({ loading: false, error: error.message, locked: 'failed', lockMessage: error.message })
          return { ok: false, error: error.message }
        }
        set({
          active: true,
          target: h.target as ImpersonationTarget,
          adminUserId: h.adminUserId ?? null,
          impersonatorRole: h.impersonatorRole,
          clientSessionId: h.clientSessionId,
          expiresAt: h.expiresAt,
          locked: null, lockMessage: null,
          loading: false, error: null,
        })
        // The tab never needs to talk back to the operator's tab again.
        try { (window as unknown as { opener: Window | null }).opener = null } catch { /* ignore */ }
        return { ok: true }
      },
    }),
    {
      name: 'fitpal-impersonation',
      // v4 (WEC-868): state lives in the client tab's sessionStorage. Anything
      // older (a session-swap impersonation from before) is discarded.
      version: 4,
      storage: createJSONStorage(() => tabStorage),
      migrate: () => ({
        active: false, target: null, adminUserId: null, impersonatorRole: null,
        clientSessionId: null, expiresAt: null, locked: null, lockMessage: null,
      }) as unknown as ImpersonationState,
      partialize: (state) => (IS_CLIENT_TAB ? {
        active: state.active,
        target: state.target,
        adminUserId: state.adminUserId,
        impersonatorRole: state.impersonatorRole,
        clientSessionId: state.clientSessionId,
        expiresAt: state.expiresAt,
        locked: state.locked,
        lockMessage: state.lockMessage,
      } : {}) as Partial<ImpersonationState>,
    },
  ),
)
