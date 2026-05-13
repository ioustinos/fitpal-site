import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/useAuthStore'
import { useUIStore } from '../store/useUIStore'
import FpLoader from '../components/ui/FpLoader'

/**
 * Post-OAuth redirect handler (WEC-322 / WEC-323).
 *
 * After Supabase Auth redirects back from Google or Facebook, the URL contains
 * the session tokens — in the URL fragment for implicit flow (which we pin in
 * `src/lib/supabase.ts` for OTP compatibility). The supabase-js client picks
 * them up automatically on init via `detectSessionInUrl: true`, fires a
 * `SIGNED_IN` event, and App.tsx's `onAuthStateChange` listener hydrates the
 * user store. This page just waits for that pipeline to land, then routes
 * the user to the right destination.
 *
 * Why not call `exchangeCodeForSession` directly? Because the implicit-flow
 * callback URL has tokens in the hash fragment, not a `code` param — the
 * exchange call is for PKCE flow. If we ever flip to PKCE, this page would
 * need to call `supabase.auth.exchangeCodeForSession(window.location.href)`
 * explicitly. See the setup-auth skill for the trade-off.
 *
 * Edge cases handled:
 *   - Provider error in URL (`?error=access_denied` etc.) → surface and bail.
 *   - Facebook account without an email (old phone-only accounts) → sign out
 *     and ask the customer to use Google or email signup instead. Without
 *     this they'd get a half-broken session with `email = null` that breaks
 *     downstream profile / invoice / order-receipt flows.
 *   - Stalled hydrate (slow network, RLS hiccup) → timeout after 10s, return
 *     to home with a generic error.
 */
export function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const lang = useUIStore((s) => s.lang)
  const isEl = lang === 'el'
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    /** Pull an error description out of either the query string or the
     *  hash fragment. Supabase sometimes uses one, sometimes the other,
     *  depending on which step of the OAuth dance failed. */
    function readUrlError(): string | null {
      const q = searchParams.get('error_description') || searchParams.get('error')
      if (q) return q
      if (typeof window !== 'undefined' && window.location.hash.includes('error')) {
        const hash = window.location.hash.replace(/^#/, '')
        const params = new URLSearchParams(hash)
        return params.get('error_description') || params.get('error')
      }
      return null
    }

    const urlError = readUrlError()
    if (urlError) {
      setError(
        isEl
          ? `Η σύνδεση απέτυχε: ${urlError}`
          : `Sign-in failed: ${urlError}`,
      )
      return
    }

    const start = Date.now()
    const TIMEOUT_MS = 10_000

    const tick = async () => {
      if (cancelled) return

      const { data: { session } } = await supabase.auth.getSession()

      // Session not yet processed from the URL fragment — keep polling.
      if (!session?.user) {
        if (Date.now() - start > TIMEOUT_MS) {
          setError(
            isEl
              ? 'Η σύνδεση καθυστερεί. Δοκίμασε ξανά.'
              : 'Sign-in is taking too long. Please try again.',
          )
          return
        }
        window.setTimeout(tick, 200)
        return
      }

      // Facebook-no-email edge case (rare but real for old phone-only FB
      // accounts). Sign them out so they don't see a half-broken state.
      if (!session.user.email) {
        await supabase.auth.signOut()
        if (cancelled) return
        setError(
          isEl
            ? 'Ο λογαριασμός Facebook σου δεν έχει συνδεδεμένο email. Χρησιμοποίησε Google ή εγγραφή με email.'
            : "Your Facebook account doesn't have a linked email. Please use Google or email signup instead.",
        )
        return
      }

      // Wait until App.tsx's onAuthStateChange has called refreshUser and
      // the store has caught up.
      const user = useAuthStore.getState().user
      if (!user || user.id !== session.user.id) {
        if (Date.now() - start > TIMEOUT_MS) {
          setError(
            isEl
              ? 'Η φόρτωση χρήστη απέτυχε. Δοκίμασε ξανά.'
              : 'Failed to load user data. Please try again.',
          )
          return
        }
        window.setTimeout(tick, 200)
        return
      }

      // Done — route by role.
      navigate(user.isAdmin ? '/admin' : '/', { replace: true })
    }

    tick()
    return () => { cancelled = true }
  }, [navigate, searchParams, isEl])

  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          gap: '1.5rem',
        }}
      >
        <div className="auth-error" style={{ maxWidth: 460 }}>{error}</div>
        <button className="btn-auth" onClick={() => navigate('/', { replace: true })}>
          {isEl ? 'Επιστροφή στην αρχική' : 'Back to home'}
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <FpLoader label={isEl ? 'Σύνδεση…' : 'Signing in…'} />
    </div>
  )
}
