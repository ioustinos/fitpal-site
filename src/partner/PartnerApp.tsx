/**
 * WEC-841 — /partner/*: the dietitian portal (epic WEC-838).
 *
 * Its own lazy bundle (App.tsx). It imports admin.css for a consistent look,
 * but NO admin code: every read/write is a partner RPC that re-checks access
 * on the server. Greek-first UI (the dietitians are Greek); English for the
 * few shared labels comes from the site's language toggle where it matters.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { useImpersonationStore } from '../store/useImpersonationStore'
import { useUIStore } from '../store/useUIStore'
import { LogoIcon } from '../components/ui/LogoIcon'
import { fetchMyPartner, type MyPartner } from './api'
import { PartnerContext } from './context'
import { Clients } from './pages/Clients'
import { ClientDetailPage } from './pages/ClientDetail'
import { Orders } from './pages/Orders'
import { Finance } from './pages/Finance'
import '../admin/admin.css'
import './partner.css'

export default function PartnerApp() {
  const user = useAuthStore((s) => s.user)
  const sessionChecked = useAuthStore((s) => s.sessionChecked)
  const impersonating = useImpersonationStore((s) => s.active)
  const target = useImpersonationStore((s) => s.target)
  const stop = useImpersonationStore((s) => s.stop)
  const navigate = useNavigate()
  const [partner, setPartner] = useState<MyPartner | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'none' | 'error'>('loading')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const previous = document.title
    document.title = 'Διαιτολόγοι - Fitpal'
    return () => { document.title = previous }
  }, [])

  useEffect(() => {
    if (!sessionChecked || !user || impersonating) return
    let cancelled = false
    setState('loading')
    void fetchMyPartner().then(({ data, error }) => {
      if (cancelled) return
      if (error) { setErr(error); setState('error'); return }
      setPartner(data)
      setState(data ? 'ok' : 'none')
    })
    return () => { cancelled = true }
  }, [sessionChecked, user?.id, impersonating]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessionChecked) return <div className="admin-boot"><div className="admin-spinner" /></div>

  // While acting as a client, the active session IS the client's — the portal
  // must not open. Offer the way back.
  if (impersonating && target) {
    return (
      <Gate title="Είστε συνδεδεμένοι ως πελάτης" eyebrow="Παραγγελία ως πελάτης">
        <p>Αυτή τη στιγμή κάνετε παραγγελία για <strong>{target.name || target.email}</strong>. Βγείτε από τη λειτουργία πελάτη για να επιστρέψετε στο portal.</p>
        <div className="admin-403-actions">
          <button className="btn-primary" onClick={async () => { await stop(); navigate('/partner') }}>Έξοδος &amp; σύνδεση ξανά</button>
          <button className="btn-ghost" onClick={() => navigate('/')}>Συνέχεια ως {target.name?.split(' ')[0] || 'πελάτης'}</button>
        </div>
      </Gate>
    )
  }

  if (!user) {
    return (
      <Gate title="Portal διαιτολόγων" eyebrow="Fitpal">
        <p>Συνδεθείτε με το email σας (θα λάβετε κωδικό) για να δείτε τους πελάτες σας.</p>
        <div className="admin-403-actions">
          <button className="btn-primary" onClick={() => { navigate('/'); useUIStore.getState().openAuthModal('/partner') }}>Σύνδεση</button>
        </div>
      </Gate>
    )
  }

  if (state === 'loading') return <div className="admin-boot"><div className="admin-spinner" /></div>
  if (state === 'error') {
    return <Gate title="Κάτι πήγε στραβά" eyebrow="Σφάλμα"><p>{err}</p></Gate>
  }
  if (state === 'none' || !partner) {
    return (
      <Gate title="Δεν είστε συνεργάτης διαιτολόγος" eyebrow="403">
        <p>Ο λογαριασμός <strong>{user.email}</strong> δεν είναι συνδεδεμένος με προφίλ διαιτολόγου. Αν πιστεύετε ότι είναι λάθος, επικοινωνήστε με τη Fitpal.</p>
        <div className="admin-403-actions">
          <button className="btn-ghost" onClick={() => navigate('/')}>Πίσω στο site</button>
        </div>
      </Gate>
    )
  }

  return (
    <PartnerContext.Provider value={partner}>
      <div className="admin-shell partner-shell">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <Link to="/partner" className="admin-logo">
              <span className="admin-logo-mark"><LogoIcon /></span>
              <span className="admin-logo-text">fitpal<i>διαιτολόγοι</i></span>
            </Link>
          </div>
          <div className="admin-topbar-right">
            <span className="admin-role-badge">{partner.is_internal ? 'Fitpal' : partner.name}</span>
            <span className="admin-user-email">{user.email}</span>
            <button className="admin-topbar-link" onClick={() => navigate('/')}>Site</button>
            <button className="admin-logout" onClick={async () => { await useAuthStore.getState().logout(); navigate('/partner') }}>Αποσύνδεση</button>
          </div>
        </header>
        <div className="admin-body">
          <nav className="admin-sidebar">
            <NavLink to="/partner" end className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}>
              <span>Πελάτες</span>
            </NavLink>
            {!partner.is_internal && (
              <NavLink to="/partner/orders" className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}>
                <span>Παραγγελίες</span>
              </NavLink>
            )}
            {!partner.is_internal && (
              <NavLink to="/partner/finance" className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}>
                <span>Οικονομικά</span>
              </NavLink>
            )}
          </nav>
          <main className="admin-main">
            <Routes>
              <Route index element={<Clients />} />
              <Route path="clients/:userId" element={<ClientDetailPage />} />
              <Route path="orders" element={<Orders />} />
              <Route path="finance" element={<Finance />} />
              <Route path="*" element={<Navigate to="/partner" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </PartnerContext.Provider>
  )
}

function Gate({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <div className="admin-403">
      <div className="admin-403-card">
        <div className="admin-403-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  )
}
