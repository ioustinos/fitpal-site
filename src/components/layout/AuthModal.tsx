import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { makeTr } from '../../lib/translations'

export function AuthModal() {
  const lang = useUIStore((s) => s.lang)
  const openModal = useUIStore((s) => s.openModal)
  const closeModal = useUIStore((s) => s.closeModal)
  const { login, authError, authTab, setAuthTab } = useAuthStore()
  const t = makeTr(lang)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const isOpen = openModal === 'auth'

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const ok = await login(email, password)
    setLoading(false)
    if (ok) closeModal()
  }

  return (
    <Modal open={isOpen} onClose={closeModal} innerClass="auth-box" overlayClass="auth-open">
      <div className="auth-logo">fitpal<span>meals</span></div>

      <div className="auth-tabs">
        <button
          className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
          onClick={() => setAuthTab('login')}
        >
          Σύνδεση / Sign In
        </button>
        <button
          className={`auth-tab${authTab === 'register' ? ' active' : ''}`}
          onClick={() => setAuthTab('register')}
        >
          Εγγραφή / Register
        </button>
      </div>

      {authTab === 'login' ? (
        <form className="auth-form" onSubmit={handleLogin}>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="demo@fitpal.gr"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-row">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={loading}>
            {loading ? '...' : 'Σύνδεση / Sign In'}
          </button>
          <div className="auth-hint">Demo: demo@fitpal.gr / 1234</div>
          <div className="auth-switch">
            Δεν έχεις λογαριασμό; <span onClick={() => setAuthTab('register')}>Εγγραφή</span>
          </div>
        </form>
      ) : (
        <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
          <div className="form-row">
            <label className="form-label">Ονοματεπώνυμο / Full Name</label>
            <input className="form-input" type="text" placeholder="Γιώργης Παπαδόπουλος" />
          </div>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" placeholder="demo@fitpal.gr" />
          </div>
          <div className="form-row">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" placeholder="••••••••" />
          </div>
          <button className="btn-auth" type="button" disabled>
            Εγγραφή — Σύντομα διαθέσιμο
          </button>
          <div className="auth-switch">
            Έχεις ήδη λογαριασμό; <span onClick={() => setAuthTab('login')}>Σύνδεση</span>
          </div>
        </form>
      )}
    </Modal>
  )
}
