import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { useImpersonationStore } from '../store/useImpersonationStore'
import { IS_CLIENT_TAB, closeClientTab } from '../lib/clientTab'

/**
 * Gates /admin/*:
 *  - still checking session → spinner
 *  - no user                → inline admin sign-in card (stays on /admin)
 *  - signed in, not admin   → 403 with email + swap-account / back-to-site
 *  - signed in as admin     → children
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const sessionChecked = useAuthStore((s) => s.sessionChecked)
  const target = useImpersonationStore((s) => s.target)
  const navigate = useNavigate()

  if (!sessionChecked) {
    return (
      <div className="admin-boot">
        <div className="admin-spinner" />
      </div>
    )
  }

  // WEC-868: a client-mode tab holds a CUSTOMER's session and must never
  // open admin — even if that customer is an admin themselves. Admin lives
  // in the operator's other tabs, which client mode never touches.
  if (IS_CLIENT_TAB) {
    const who = target?.name || target?.email
    return (
      <div className="admin-403">
        <div className="admin-403-card">
          <div className="admin-403-eyebrow">Λειτουργία πελάτη · Client mode</div>
          <h1>Αυτή η καρτέλα είναι καρτέλα πελάτη</h1>
          <p>
            {who ? <>Εδώ ενεργείτε ως <strong>{who}</strong>. </> : null}
            Το admin δεν ανοίγει σε καρτέλα πελάτη. Χρησιμοποιήστε την άλλη σας καρτέλα για το admin.
          </p>
          <p style={{ fontSize: 13, opacity: 0.75 }}>
            This tab is a client tab. Admin does not open here — use your other tab.
          </p>
          <div className="admin-403-actions">
            <button className="btn-primary" onClick={() => void closeClientTab('closed')}>
              Κλείσιμο καρτέλας πελάτη
            </button>
            {who && (
              <button className="btn-ghost" onClick={() => navigate('/')}>
                Συνέχεια ως {target?.name?.split(' ')[0] || 'πελάτης'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AdminSignIn />
  }

  if (!user.isAdmin) {
    const signOutAndStay = async () => {
      await useAuthStore.getState().logout()
      // AdminGuard re-renders with user=null → AdminSignIn takes over.
    }
    return (
      <div className="admin-403">
        <div className="admin-403-card">
          <div className="admin-403-eyebrow">403</div>
          <h1>Not an admin account</h1>
          <p>
            You're signed in as <strong>{user.email}</strong>, but this account isn't an admin.
            Sign out and use an admin account, or head back to the customer site.
          </p>
          <div className="admin-403-actions">
            <button className="btn-primary" onClick={signOutAndStay}>Sign in as admin</button>
            <button className="btn-ghost" onClick={() => navigate('/')}>Back to site</button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

/**
 * Standalone admin sign-in card. Reuses useAuthStore.login so the normal
 * auth flow (buildFullUser → isAdmin population) kicks in. Once user is set,
 * AdminGuard re-renders automatically — no manual navigation needed.
 */
function AdminSignIn() {
  const login = useAuthStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const ok = await login(email, password)
    setLoading(false)
    if (!ok) {
      setError(useAuthStore.getState().authError ?? 'Sign in failed')
    }
    // On success, store.user gets set → AdminGuard re-renders. Nothing else to do.
  }

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <span className="admin-logo-mark">fp</span>
          <div>
            <div className="admin-login-title">Fitpal Admin</div>
            <div className="admin-login-sub">Sign in to continue</div>
          </div>
        </div>

        <form className="admin-login-form" onSubmit={onSubmit}>
          <label className="admin-login-label">
            <span>Email</span>
            <input
              className="admin-login-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="admin-login-label">
            <span>Password</span>
            <input
              className="admin-login-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <div className="admin-login-error">{error}</div>}

          <button type="submit" className="admin-login-submit" disabled={loading || !email || !password}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="admin-login-footnote">
          Not an admin? <a href="/">Go to the customer site</a>.
        </div>
      </div>
    </div>
  )
}
