import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'

const IS_DEV = import.meta.env.DEV

export function Topbar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    // Stay on /admin — AdminGuard will render the inline sign-in card
    // because user is now null.
    navigate('/admin')
  }

  return (
    <header className="admin-topbar">
      <div className="admin-topbar-left">
        <Link to="/admin" className="admin-logo">
          <span className="admin-logo-mark">fp</span>
          <span className="admin-logo-text">fitpal<i>admin</i></span>
        </Link>
        {IS_DEV && <span className="admin-env admin-env-dev">DEV</span>}
      </div>

      <div className="admin-topbar-right">
        {user && (
          <>
            {user.adminRole && (
              <span className="admin-role-badge">{user.adminRole.replace('_', ' ')}</span>
            )}
            <span className="admin-user-email">{user.email}</span>
            <button className="admin-topbar-link" onClick={() => navigate('/')} title="Back to customer site">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/>
              </svg>
              <span>Site</span>
            </button>
            <button className="admin-logout" onClick={handleLogout}>
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  )
}
