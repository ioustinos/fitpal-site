import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useImpersonationStore } from '../../store/useImpersonationStore'

/**
 * Persistent banner shown at the top of every page while an admin is
 * impersonating a customer. Click "Exit" to restore the admin's session
 * and return to /admin/users.
 *
 * The banner pushes the page content down by 36px via the body class
 * `is-impersonating` (set in this component, removed on unmount/exit).
 */
export function ImpersonationBanner() {
  const active = useImpersonationStore((s) => s.active)
  const target = useImpersonationStore((s) => s.target)
  const loading = useImpersonationStore((s) => s.loading)
  const stop = useImpersonationStore((s) => s.stop)
  const navigate = useNavigate()

  // Only flip the body class when we'd actually render the banner. Without
  // the `target` guard we can end up with the page padded down 36px while
  // the banner is invisible — the symptom of stale persisted state.
  const shouldShow = active && !!target

  useEffect(() => {
    if (shouldShow) {
      document.body.classList.add('is-impersonating')
    } else {
      document.body.classList.remove('is-impersonating')
    }
    return () => { document.body.classList.remove('is-impersonating') }
  }, [shouldShow])

  if (!shouldShow || !target) return null

  async function handleExit() {
    const { ok, error } = await stop()
    if (!ok) {
      // setSession failed — admin tokens probably expired. The store has
      // already cleared state so the banner is gone; surface the message
      // so the admin knows to sign in again.
      window.alert(`Could not restore admin session: ${error ?? 'unknown error'}\n\nPlease sign in as admin again.`)
      navigate('/admin')
      return
    }
    navigate('/admin/users')
  }

  return (
    <div className="impersonation-banner" role="status" aria-live="polite">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1" />
      </svg>
      <span>
        Impersonating <strong>{target.name || target.email}</strong>
      </span>
      <button onClick={handleExit} disabled={loading}>
        {loading ? 'Exiting…' : 'Exit impersonation'}
      </button>
    </div>
  )
}
