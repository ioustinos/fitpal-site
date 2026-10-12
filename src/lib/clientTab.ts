/**
 * WEC-868 — client mode in its own tab (one identity per tab for admins and
 * dietitians).
 *
 * A "client tab" is a browser tab in which an admin or dietitian acts as one
 * customer. Everything that identifies a person lives in that tab ONLY:
 *   • its Supabase session (sessionStorage, own storageKey — so the operator's
 *     other tabs, which use localStorage, never see or lose their own session);
 *   • the impersonation store, cart and plan wizard (tabStorage below).
 * The operator's own tabs stay exactly as they were.
 *
 * A tab becomes a client tab when it is opened with ?client_tab=1; the flag is
 * then kept in sessionStorage so reloads and in-app navigation keep it.
 */

const FLAG_KEY = 'fitpal_client_tab'
const TAB_ID_KEY = 'fitpal_client_tab_id'
export const CLIENT_TAB_READY = 'fitpal-client-tab-ready'
export const CLIENT_TAB_HANDOFF = 'fitpal-client-tab-handoff'

function detect(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('client_tab') === '1') {
      window.sessionStorage.setItem(FLAG_KEY, '1')
      return true
    }
    return window.sessionStorage.getItem(FLAG_KEY) === '1'
  } catch {
    return false
  }
}

/** True for the whole life of a client-mode tab. Resolved once at load. */
export const IS_CLIENT_TAB = detect()

/** Auth storage key, unique PER client tab. supabase-js opens a
 *  BroadcastChannel named after its storageKey; a shared key would let one
 *  client tab's sign-in (customer Y) be announced inside another client tab
 *  (customer X). A per-tab key keeps every tab deaf to the others. */
export const CLIENT_TAB_AUTH_KEY = (() => {
  if (!IS_CLIENT_TAB) return 'fitpal-client-tab-auth'
  try {
    let id = window.sessionStorage.getItem(TAB_ID_KEY)
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36)
      window.sessionStorage.setItem(TAB_ID_KEY, id)
    }
    return 'fitpal-client-tab-auth-' + id
  } catch {
    return 'fitpal-client-tab-auth'
  }
})()

const memory = new Map<string, string>()
const memoryStorage: Storage = {
  get length() { return memory.size },
  clear: () => memory.clear(),
  getItem: (k) => (memory.has(k) ? memory.get(k)! : null),
  key: (i) => Array.from(memory.keys())[i] ?? null,
  removeItem: (k) => { memory.delete(k) },
  setItem: (k, v) => { memory.set(k, String(v)) },
}

function pick(): Storage {
  if (typeof window === 'undefined') return memoryStorage
  try {
    return IS_CLIENT_TAB ? window.sessionStorage : window.localStorage
  } catch {
    return memoryStorage
  }
}

/** Storage for anything tied to WHO is using this tab (cart, wizard,
 *  impersonation). Per-tab in client tabs, shared localStorage otherwise. */
export const tabStorage: Storage = pick()

/** Payload the operator tab hands to a freshly opened client tab. */
export interface ClientTabHandoff {
  type: typeof CLIENT_TAB_HANDOFF
  hashedToken: string
  target: unknown
  clientSessionId: string
  expiresAt: string
  impersonatorRole: 'admin' | 'partner'
  adminUserId: string
  where: string
}

/** Leave the client tab: end the server session (best effort), drop ONLY this
 *  tab's session (scope 'local' — the customer's own devices stay signed in),
 *  and close the tab. Browsers allow window.close() here because the tab was
 *  opened by script; if it refuses, the lock screen stays up. */
export async function closeClientTab(reason: 'closed' | 'ended' = 'closed') {
  const { supabase } = await import('./supabase')
  const { useImpersonationStore } = await import('../store/useImpersonationStore')
  const st = useImpersonationStore.getState()
  try {
    if (reason === 'closed' && st.clientSessionId) {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token) {
        await fetch('/.netlify/functions/client-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessionId: st.clientSessionId, action: 'end' }),
          keepalive: true,
        })
      }
    }
  } catch { /* best effort — the session also dies by heartbeat timeout */ }
  useImpersonationStore.getState().lock(reason === 'closed' ? 'closed' : 'ended')
  try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
  try {
    const keep = [FLAG_KEY, TAB_ID_KEY].map((k) => [k, window.sessionStorage.getItem(k)] as const)
    tabStorage.clear()
    for (const [k, v] of keep) if (v) window.sessionStorage.setItem(k, v)
  } catch { /* ignore */ }
  window.close()
}
