import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'

export function AuthModal() {
  const lang = useUIStore((s) => s.lang)
  const openModal = useUIStore((s) => s.openModal)
  const closeModal = useUIStore((s) => s.closeModal)
  const { login, signup, authError, authTab, setAuthTab, setError } = useAuthStore()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)

  const isOpen = openModal === 'auth'

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const ok = await login(email, password)
    setLoading(false)
    if (ok) {
      closeModal()
      // If the signed-in user is an admin, jump straight into the admin panel.
      // Non-admins stay on whatever customer page they were on.
      const user = useAuthStore.getState().user
      if (user?.isAdmin) navigate('/admin')
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (regPassword.length < 6) {
      setError(lang === 'el' ? 'Ο κωδικός πρέπει να είναι τουλάχιστον 6 χαρακτήρες' : 'Password must be at least 6 characters')
      return
    }
    setLoading(true)
    const ok = await signup(regEmail, regPassword, regName)
    setLoading(false)
    if (ok) {
      // If user object is populated, they're logged in (email pre-confirmed or auto-confirm)
      const user = useAuthStore.getState().user
      if (user) {
        closeModal()
      } else {
        // Email confirmation required
        setSignupSuccess(true)
      }
    }
  }

  function switchTab(tab: 'login' | 'register') {
    setAuthTab(tab)
    setSignupSuccess(false)
  }

  return (
    <Modal open={isOpen} onClose={closeModal} innerClass="auth-box" overlayClass="auth-open">
      <div className="auth-logo">fitpal<span>meals</span></div>

      <div className="auth-tabs">
        <button
          className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
          onClick={() => switchTab('login')}
        >
          {lang === 'el' ? 'Σύνδεση' : 'Sign In'}
        </button>
        <button
          className={`auth-tab${authTab === 'register' ? ' active' : ''}`}
          onClick={() => switchTab('register')}
        >
          {lang === 'el' ? 'Εγγραφή' : 'Register'}
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
            <label className="form-label">{lang === 'el' ? 'Κωδικός' : 'Password'}</label>
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
            {loading ? '...' : (lang === 'el' ? 'Σύνδεση' : 'Sign In')}
          </button>
          <div className="auth-hint">Demo: demo@fitpal.gr / 1234</div>
          <div className="auth-switch">
            {lang === 'el' ? 'Δεν έχεις λογαριασμό;' : "Don't have an account?"}{' '}
            <span onClick={() => switchTab('register')}>{lang === 'el' ? 'Εγγραφή' : 'Register'}</span>
          </div>
        </form>
      ) : signupSuccess ? (
        <div className="auth-form" style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {lang === 'el' ? 'Ελέγξε το email σου' : 'Check your email'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
            {lang === 'el'
              ? 'Σου στείλαμε ένα link επιβεβαίωσης. Κάνε κλικ σε αυτό και μετά συνδέσου.'
              : 'We sent you a confirmation link. Click it and then sign in.'}
          </div>
          <button className="btn-auth" onClick={() => switchTab('login')}>
            {lang === 'el' ? 'Πήγαινε στη Σύνδεση' : 'Go to Sign In'}
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSignup}>
          <div className="form-row">
            <label className="form-label">{lang === 'el' ? 'Ονοματεπώνυμο' : 'Full Name'}</label>
            <input
              className="form-input"
              type="text"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder={lang === 'el' ? 'Γιώργης Παπαδόπουλος' : 'John Smith'}
              required
            />
          </div>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={regEmail}
              onChange={(e) => setRegEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-row">
            <label className="form-label">{lang === 'el' ? 'Κωδικός' : 'Password'}</label>
            <input
              className="form-input"
              type="password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={loading}>
            {loading ? '...' : (lang === 'el' ? 'Εγγραφή' : 'Register')}
          </button>
          <div className="auth-switch">
            {lang === 'el' ? 'Έχεις ήδη λογαριασμό;' : 'Already have an account?'}{' '}
            <span onClick={() => switchTab('login')}>{lang === 'el' ? 'Σύνδεση' : 'Sign In'}</span>
          </div>
        </form>
      )}
    </Modal>
  )
}
