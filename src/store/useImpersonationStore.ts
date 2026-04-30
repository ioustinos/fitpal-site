import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase'

/**
 * Admin impersonation — session swap with re-login convention.
 *
 * The mental model: as if the customer gave the admin their username and
 * password. The admin's Supabase session is dropped, the customer's session
 * becomes the active one, and every Supabase query (including reactive
 * useAuthStore reload via onAuthStateChange) naturally pulls the customer's
 * data. On exit, the customer is signed out and the admin must sign in again.
 *
 * Why session-swap over a data overlay: zero refactoring across the customer
 * site. Every existing component that reads `user` from useAuthStore "just
 * works" because the user IS the impersonated customer during impersonation.
 *
 * Why re-login on exit (the convention): we initially stashed the admin's
 * tokens to restore. That created edge cases — stale token expiry, cross-tab
 * session leaks (a second admin tab unknowingly running as the customer),
 * admin-impersonating-admin confusion. The fix is to drop the stash entirely
 * and force a fresh login after each impersonation session. One extra login
 * per session (~5 sec) buys us robustness across every edge case the
 * reviewer flagged. Acceptable trade for an admin-only feature.
 *
 * Flow:
 *   start(targetUserId)
 *     1. POST /api/admin-impersonate-start { targetUserId }
 *        → returns { hashedToken, target, adminUserId }
 *     2. supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
 *        → swaps active session to the customer
 *        → onAuthStateChange in App.tsx fires SIGNED_IN → refreshUser(customerId)
 *        → customer site renders with customer's data
 *     3. Banner becomes visible (driven by `active` flag in this store)
 *
 *   stop()
 *     1. supabase.auth.signOut() — drops the customer's session entirely
 *     2. onAuthStateChange fires SIGNED_OUT → user cleared in App.tsx
 *     3. Banner disappears (this store cleared by SIGNED_OUT handler too)
 *     4. Admin lands at the login page; signs back in to resume admin work.
 *
 * Persistence: minimal — only `active` and `target` so the banner survives
 * a tab refresh mid-impersonation. We deliberately do NOT persist any admin
 * tokens; if the admin's tokens are ever needed again, they sign in fresh.
 */

export interface ImpersonationTarget {
  userId: string
  name: string
  email: string
}

interface ImpersonationState {
  active: boolean
  target: ImpersonationTarget | null
  /**
   * The admin's user_id at the moment impersonation started. Captured so
   * orders submitted during this session can carry admin_order_id for the
   * audit trail. NOT a token, NOT useful for re-authentication — just an
   * identifier the server validates against `public.admin_users` before
   * trusting.
   */
  adminUserId: string | null
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
      adminUserId: null,
      loading: false,
      error: null,

      start: async (targetUserId: string) => {
        // Refuse to nest impersonation. Admin must exit first.
        // (`active` is a boolean now; no shape-mismatch self-heal needed
        // because the persist version bump discards old-shape state.)
        if (get().active) {
          return { ok: false, error: 'Already impersonating — exit first' }
        }
        set({ loading: true, error: null })
        try {
          // 1. Need an admin session to call the impersonate-start function.
          const { data: { session: adminSession } } = await supabase.auth.getSession()
          if (!adminSession?.access_token) {
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

          // 3. Verify the magic-link hash → swaps active Supabase session
          //    to the customer. onAuthStateChange in App.tsx fires SIGNED_IN
          //    → refreshUser(customerId) → customer site renders.
          const { error: verifyErr } = await supabase.auth.verifyOtp({
            token_hash: json.hashedToken,
            type: 'magiclink',
          })
          if (verifyErr) {
            set({ loading: false, error: verifyErr.message })
            return { ok: false, error: verifyErr.message }
          }

          // 4. Mark active. We capture only the admin's user_id (not any
          //    tokens) so submit-order can write admin_order_id for the
          //    audit trail. The server validates this id corresponds to a
          //    real admin before trusting it.
          set({
            active: true,
            target: json.target as ImpersonationTarget,
            adminUserId: json.adminUserId ?? null,
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
        set({ loading: true, error: null })
        try {
          set({ active: false, target: null, adminUserId: null, loading: false, error: null })
          await supabase.auth.signOut()
          return { ok: true }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          set({ active: false, target: null, adminUserId: null, loading: false, error: message })
          return { ok: false, error: message }
        }
      },
    }),
    {
      name: 'fitpal-impersonation',
      // v3: dropped the adminSession stash entirely (we sign-out on exit
      // now and re-login). v2 had adminSession + boolean active; v1 had
      // active as an object. Discard anything from older versions.
      version: 3,
      migrate: () => ({
        active: false,
        target: null,
        adminUserId: null,
        loading: false,
        error: null,
        start: async () => ({ ok: false, error: 'rehydrating' }),
        stop: async () => ({ ok: true }),
      }),
      // Persist `active`, `target`, `adminUserId` so impersonation survives
      // a tab refresh. NEVER persist tokens.
      partialize: (state) => ({
        active: state.active,
        target: state.target,
        adminUserId: state.adminUserId,
      }),
    },
  ),
)
