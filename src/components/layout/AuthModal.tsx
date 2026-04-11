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
    <Modal open={isOpen} onClose={closeModal} innerClass="auth-box">
      <div className="auth-tabs">
        <button
          className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
          onClick={() => setAuthTab('login')}
        >
          {t('signIn')}
        </button>
        <button
          className={`auth-tab${authTab === 'register' ? ' active' : ''}`}
          onClick={() => setAuthTab('register')}
        >
          {t('register')}
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
            <label className="form-label">{t('password')}</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••"
              autoComplete="current-password"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={loading}>
            {loading ? '...' : t('signIn')}
          </button>
          <div className="auth-hint">
            {lang === 'el' ? 'Demo: ' : 'Demo: '}
            <code>demo@fitpal.gr / 1234</code>
          </div>
        </form>
      ) : (
        <div className="auth-form">
          <p className="auth-coming-soon">
            {lang === 'el'
              ? 'Η εγγραφή θα είναι διαθέσιμη σύντομα.'
              : 'Registration coming soon.'}
          </p>
        </div>
      )}
    </Modal>
  )
}
