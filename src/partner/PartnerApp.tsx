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
import { IS_CLIENT_TAB, closeClientTab } from '../lib/clientTab'
import { useUIStore } from '../store/useUIStore'
import { LogoIcon } from '../components/ui/LogoIcon'
import { fetchMyPartner, fetchAllPartnersForAdmin, getViewAs, setViewAs, type MyPartner } from './api'
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
  const impersonating = IS_CLIENT_TAB // WEC-868: client tabs never open the portal
  const target = useImpersonationStore((s) => s.target)
  const navigate = useNavigate()
  const [partner, setPartner] = useState<MyPartner | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'none' | 'error'>('loading')
  const [err, setErr] = useState<string | null>(null)
  // Admins: view the portal AS any partner (x-partner-view header, admin-only on the DB side).
  // 23/10: admin's «Open portal as …» opens a NEW tab with ?view_as=<id>
  // (sessionStorage is per tab, so the choice travels in the URL once).
  const [viewAs, setViewAsState] = useState<string | null>(() => {
    try {
      const u = new URL(window.location.href)
      const q = u.searchParams.get('view_as')
      if (q) {
        setViewAs(q)
        u.searchParams.delete('view_as')
        window.history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash)
      }
    } catch { /* ignore */ }
    return getViewAs()
  })
  const [allPartners, setAllPartners] = useState<Array<{ id: string; name: string; is_internal: boolean; active: boolean }>>([])
  const isAdmin = !!user?.isAdmin
  useEffect(() => {
    if (!isAdmin) return
    void fetchAllPartnersForAdmin().then(({ data }) => setAllPartners(data))
  }, [isAdmin])
  function chooseView(id: string | null) {
    setViewAs(id); setViewAsState(id)
    navigate('/partner')
  }

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
  }, [sessionChecked, user?.id, impersonating, viewAs]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessionChecked) return <div className="admin-boot"><div className="admin-spinner" /></div>

  // WEC-868: a client tab holds the CUSTOMER's session — the portal never
  // opens in it. The dietitian's portal lives in their other tab.
  if (impersonating) {
    const who = target?.name || target?.email
    return (
      <Gate title="Αυτή η καρτέλα είναι καρτέλα πελάτη" eyebrow="Λειτουργία πελάτη">
        <p>{who ? <>Εδώ ενεργείτε ως <strong>{who}</strong>. </> : null}Το portal δεν ανοίγει σε καρτέλα πελάτη. Το portal σας είναι ανοιχτό στην άλλη σας καρτέλα.</p>
        <div className="admin-403-actions">
          <button className="btn-primary" onClick={() => void closeClientTab('closed')}>Κλείσιμο καρτέλας πελάτη</button>
          {who && <button className="btn-ghost" onClick={() => navigate('/')}>Συνέχεια ως {target?.name?.split(' ')[0] || 'πελάτης'}</button>}
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
  if ((state === 'none' || !partner) && isAdmin) {
    return (
      <Gate title="Προβολή ως διαιτολόγος" eyebrow="Admin">
        <p>Ως admin μπορείτε να ανοίξετε το portal οποιουδήποτε διαιτολόγου.</p>
        {allPartners.length === 0
          ? <p>Δεν υπάρχουν διαιτολόγοι ακόμα — δημιουργήστε από <a href="/admin/partners">Admin → Dietitians</a>.</p>
          : (
            <div className="admin-403-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              {allPartners.map((p) => (
                <button key={p.id} className="btn-ghost" onClick={() => chooseView(p.id)}>
                  {p.name}{p.is_internal ? ' · Fitpal' : ''}{p.active ? '' : ' (ανενεργός)'}
                </button>
              ))}
            </div>
          )}
      </Gate>
    )
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
            {isAdmin && allPartners.length > 0 ? (
              <select className="admin-select" value={partner.id} onChange={(e) => chooseView(e.target.value)} title="Admin: προβολή ως">
                {allPartners.map((p) => <option key={p.id} value={p.id}>Προβολή ως: {p.name}</option>)}
              </select>
            ) : (
              <span className="admin-role-badge">{partner.is_internal ? 'Fitpal' : partner.name}</span>
            )}
            <span className="admin-user-email">{user.email}</span>
            {/* 23/10 (Slack): a way back to the admin view for admins. */}
            {isAdmin && <button className="admin-topbar-link" onClick={() => navigate('/admin/partners')}>← Admin</button>}
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
