import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useImpersonationStore } from '../../store/useImpersonationStore'

/**
 * Persistent banner shown at the top of every page while an admin is
 * impersonating a customer. Click "Exit" to drop impersonation and return
 * to /admin/users.
 *
 * The banner pushes the page content down by 36px via the body class
 * `is-impersonating` (set in this component, removed on unmount/exit).
 */
export function ImpersonationBanner() {
  const active = useImpersonationStore((s) => s.active)
  const stop = useImpersonationStore((s) => s.stop)
  const navigate = useNavigate()

  useEffect(() => {
    if (active) {
      document.body.classList.add('is-impersonating')
    } else {
      document.body.classList.remove('is-impersonating')
    }
    return () => { document.body.classList.remove('is-impersonating') }
  }, [active])

  if (!active) return null

  function handleExit() {
    stop()
    navigate('/admin/users')
  }

  return (
    <div className="impersonation-banner" role="status" aria-live="polite">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1" />
      </svg>
      <span>
        Impersonating <strong>{active.name || active.email}</strong>
        {active.walletAdminManaged && (
          <span style={{ marginLeft: 8, opacity: 0.85, fontSize: 11 }}>· managed wallet</span>
        )}
      </span>
      <button onClick={handleExit}>Exit impersonation</button>
    </div>
  )
}
