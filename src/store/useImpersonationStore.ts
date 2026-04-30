import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'

/**
 * Admin impersonation — session swap (Approach A).
 *
 * The mental model: as if the customer gave the admin their username and
 * password. The admin's Supabase session is stashed, the customer's session
 * becomes the active one, and every Supabase query (including reactive
 * useAuthStore reload via onAuthStateChange) naturally pulls the customer's
 * data. On exit, the admin's session is restored.
 *
 * Why this beats overlaying data into the admin's session: zero refactoring
 * across the customer site. Every existing component that reads `user` from
 * useAuthStore "just works" because the user IS the impersonated customer
 * during the impersonation window. No risk of leaks (admin's wallet still
 * showing in a corner of the UI we forgot to swap).
 *
 * Flow:
 *   start(targetUserId)
 *     1. supabase.auth.getSession() — capture admin's tokens
 *     2. POST /api/admin-impersonate-start { targetUserId }
 *        → returns { hashedToken, target, adminUserId }
 *     3. supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
 *        → swaps active session to the customer
 *        → onAuthStateChange in App.tsx fires SIGNED_IN → refreshUser(customerId)
 *        → customer site renders with customer's data
 *     4. Banner becomes visible (driven by `active` flag in this store)
 *
 *   stop()
 *     1. supabase.auth.setSession({ access_token, refresh_token }) — restore admin
 *     2. onAuthStateChange fires SIGNED_IN → refreshUser(adminId)
 *     3. Banner disappears (this store cleared)
 *
 * Persistence: this store is persisted to localStorage so a tab refresh
 * mid-impersonation doesn't lose the admin's stashed tokens. Safe because
 * the admin's tokens only stay in localStorage while impersonation is
 * active; clearing on stop() removes them.
 */

export interface ImpersonationTarget {
  userId: string
  name: string
  email: string
}

interface AdminSession {
  accessToken: string
  refreshToken: string
  userId: string
}

interface ImpersonationState {
  active: boolean
  target: ImpersonationTarget | null
  /** Admin's stashed session — restored on stop(). */
  adminSession: AdminSession | null
  /** True while the start/stop API calls are in-flight. */
  loading: boolean
  /** Last error from start/stop, surfaced to the UI. */
  error: string | null
  start: (targetUserId: string) => Promise<{ ok: boolean; error?: string }>
  stop: () => Promise<{ ok: boolean; error?: string }>
}

export const useImpersonationStore = create<ImpersonationState>()(
  persist(
    (set, get) => ({
      active: false,
      target: null,
      adminSession: null,
      loading: false,
      error: null,

      start: async (targetUserId: string) => {
        if (get().active) {
          // Defensive: refuse to nest impersonation. Admin must exit first.
          return { ok: false, error: 'Already impersonating — exit first' }
        }
        set({ loading: true, error: null })
        try {
          // 1. Capture admin's session BEFORE we swap.
          const { data: { session: adminSession } } = await supabase.auth.getSession()
          if (!adminSession?.access_token || !adminSession.refresh_token) {
            set({ loading: false, error: 'Not signed in' })
            return { ok: false, error: 'Not signed in' }
          }

          // 2. Mint a magic-link hash for the target via the admin function.
          const res = await fetch('/api/admin-impersonate-start', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminSession.access_token}`,
            },
            body: JSON.stringify({ targetUserId }),
          })
          const json = await res.json()
          if (!res.ok || !json?.hashedToken || !json?.target) {
            set({ loading: false, error: json?.error ?? 'Failed to start impersonation' })
            return { ok: false, error: json?.error ?? 'Failed to start impersonation' }
          }

          // 3. Verify the magic-link hash → swaps active Supabase session.
          //    onAuthStateChange in App.tsx will fire and refreshUser(customer).
          const { error: verifyErr } = await supabase.auth.verifyOtp({
            token_hash: json.hashedToken,
            type: 'magiclink',
          })
          if (verifyErr) {
            // The admin's session is still active in supabase.auth — verifyOtp
            // didn't replace it because the call failed.
            set({ loading: false, error: verifyErr.message })
            return { ok: false, error: verifyErr.message }
          }

          // 4. Stash the admin's session for restore-on-exit.
          set({
            active: true,
            target: json.target as ImpersonationTarget,
            adminSession: {
              accessToken: adminSession.access_token,
              refreshToken: adminSession.refresh_token,
              userId: adminSession.user.id,
            },
            loading: false,
            error: null,
          })
          return { ok: true }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          set({ loading: false, error: message })
          return { ok: false, error: message }
        }
      },

      stop: async () => {
        const { adminSession } = get()
        if (!adminSession) {
          // Nothing to restore — just clear our state.
          set({ active: false, target: null, adminSession: null, error: null })
          return { ok: true }
        }
        set({ loading: true, error: null })
        try {
          // Restore admin's session. supabase.auth.setSession is the supported
          // way to swap to a known token pair; the customer's session is
          // discarded when the new session is set.
          const { error: setErr } = await supabase.auth.setSession({
            access_token: adminSession.accessToken,
            refresh_token: adminSession.refreshToken,
          })
          if (setErr) {
            // If the admin's tokens have expired, we can't restore — admin
            // will need to sign in again. Clear state regardless so the
            // banner doesn't get stuck.
            set({
              active: false, target: null, adminSession: null,
              loading: false,
              error: `Admin session expired — please sign in again. (${setErr.message})`,
            })
            return { ok: false, error: setErr.message }
          }
          set({ active: false, target: null, adminSession: null, loading: false, error: null })
          return { ok: true }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          set({ loading: false, error: message })
          return { ok: false, error: message }
        }
      },
    }),
    {
      name: 'fitpal-impersonation',
      // Only persist what we need — don't persist `loading` or `error`.
      partialize: (state) => ({
        active: state.active,
        target: state.target,
        adminSession: state.adminSession,
      }),
    },
  ),
)
