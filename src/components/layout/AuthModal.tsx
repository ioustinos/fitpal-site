import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { sendEmailOtp, verifyEmailOtp } from '../../lib/api/auth'
import { supabase } from '../../lib/supabase'

/**
 * Login modes:
 *   - 'password': email + password (default for returning users — fast with autofill)
 *   - 'otp':      email → 6-digit code (no password required, works for any user)
 *
 * Signup mode is OTP-only — no password is collected at signup. Users who
 * want fast returning-login can opt in via Account → Profile → "Set a password"
 * later. See OTP-everywhere epic.
 */
type LoginMode = 'password' | 'otp'
type OtpStep = 'enterEmail' | 'enterCode'

export function AuthModal() {
  const lang = useUIStore((s) => s.lang)
  const openModal = useUIStore((s) => s.openModal)
  const closeModal = useUIStore((s) => s.closeModal)
  const { login, authError, authTab, setAuthTab, setError, refreshUser } = useAuthStore()
  const navigate = useNavigate()

  const isOpen = openModal === 'auth'
  const isEl = lang === 'el'

  /* ── Login state ─────────────────────────────────────────────── */
  const [loginMode, setLoginMode] = useState<LoginMode>('password')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginOtpStep, setLoginOtpStep] = useState<OtpStep>('enterEmail')
  const [loginOtpCode, setLoginOtpCode] = useState('')

  /* ── Signup state (OTP-only) ─────────────────────────────────── */
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regOtpStep, setRegOtpStep] = useState<OtpStep>('enterEmail')
  const [regOtpCode, setRegOtpCode] = useState('')

  /* ── Async ───────────────────────────────────────────────────── */
  const [busy, setBusy] = useState(false)

  function resetAll() {
    setLoginMode('password')
    setLoginEmail(''); setLoginPassword(''); setLoginOtpStep('enterEmail'); setLoginOtpCode('')
    setRegName(''); setRegEmail(''); setRegOtpStep('enterEmail'); setRegOtpCode('')
    setError(null); setBusy(false)
  }

  function switchTab(tab: 'login' | 'register') {
    setAuthTab(tab)
    resetAll()
    setAuthTab(tab) // restore (resetAll cleared error but not tab)
  }

  async function postAuthRedirect() {
    closeModal()
    resetAll()
    const user = useAuthStore.getState().user
    if (user?.isAdmin) navigate('/admin')
  }

  /* ── Login: password path ────────────────────────────────────── */
  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    const ok = await login(loginEmail, loginPassword)
    setBusy(false)
    if (ok) await postAuthRedirect()
  }

  /* ── Login: OTP path ─────────────────────────────────────────── */
  async function handleLoginOtpSend(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    const { ok, error } = await sendEmailOtp(loginEmail.trim())
    setBusy(false)
    if (!ok) { setError(error ?? 'Could not send code'); return }
    setLoginOtpStep('enterCode')
  }

  async function handleLoginOtpVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    const { ok, error } = await verifyEmailOtp(loginEmail.trim(), loginOtpCode)
    if (!ok) { setBusy(false); setError(error ?? 'Invalid code'); return }
    // Session is now active; refresh the in-memory user
    const { data: session } = await supabase.auth.getSession()
    if (session?.session?.user?.id) {
      await refreshUser(session.session.user.id)
    }
    setBusy(false)
    await postAuthRedirect()
  }

  /* ── Signup: OTP-only ────────────────────────────────────────── */
  async function handleRegOtpSend(e: React.FormEvent) {
    e.preventDefault()
    if (!regName.trim()) { setError(isEl ? 'Συμπλήρωσε το όνομά σου' : 'Please enter your name'); return }
    setError(null); setBusy(true)
    const { ok, error } = await sendEmailOtp(regEmail.trim(), regName.trim())
    setBusy(false)
    if (!ok) { setError(error ?? 'Could not send code'); return }
    setRegOtpStep('enterCode')
  }

  async function handleRegOtpVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    const { ok, error } = await verifyEmailOtp(regEmail.trim(), regOtpCode)
    if (!ok) { setBusy(false); setError(error ?? 'Invalid code'); return }
    const { data: session } = await supabase.auth.getSession()
    if (session?.session?.user?.id) {
      await refreshUser(session.session.user.id)
    }
    setBusy(false)
    await postAuthRedirect()
  }

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <Modal open={isOpen} onClose={closeModal} innerClass="auth-box" overlayClass="auth-open">
      <div className="auth-logo">fitpal<span>meals</span></div>

      <div className="auth-tabs">
        <button
          className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
          onClick={() => switchTab('login')}
        >
          {isEl ? 'Σύνδεση' : 'Sign In'}
        </button>
        <button
          className={`auth-tab${authTab === 'register' ? ' active' : ''}`}
          onClick={() => switchTab('register')}
        >
          {isEl ? 'Εγγραφή' : 'Register'}
        </button>
      </div>

      {/* ─── LOGIN TAB ─────────────────────────────────────────── */}
      {authTab === 'login' && loginMode === 'password' && (
        <form className="auth-form" onSubmit={handlePasswordLogin}>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="demo@fitpal.gr"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-row">
            <label className="form-label">{isEl ? 'Κωδικός' : 'Password'}</label>
            <input
              className="form-input"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={busy}>
            {busy ? '...' : (isEl ? 'Σύνδεση' : 'Sign In')}
          </button>

          <div className="auth-otp-toggle">
            <button type="button" onClick={() => { setLoginMode('otp'); setError(null) }}>
              {isEl ? 'Ή στείλε μου κωδικό στο email' : 'Or send me a code by email'}
            </button>
          </div>

          <div className="auth-hint">Demo: demo@fitpal.gr / 1234</div>
          <div className="auth-switch">
            {isEl ? 'Δεν έχεις λογαριασμό;' : "Don't have an account?"}{' '}
            <span onClick={() => switchTab('register')}>{isEl ? 'Εγγραφή' : 'Register'}</span>
          </div>
        </form>
      )}

      {authTab === 'login' && loginMode === 'otp' && loginOtpStep === 'enterEmail' && (
        <form className="auth-form" onSubmit={handleLoginOtpSend}>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="auth-note">
            {isEl ? 'Θα σου στείλουμε 6-ψήφιο κωδικό.' : "We'll send you a 6-digit code."}
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={busy || !loginEmail}>
            {busy ? '...' : (isEl ? 'Στείλε μου κωδικό' : 'Send me a code')}
          </button>
          <div className="auth-otp-toggle">
            <button type="button" onClick={() => { setLoginMode('password'); setError(null) }}>
              {isEl ? '← Πίσω σε σύνδεση με κωδικό' : '← Back to password sign-in'}
            </button>
          </div>
        </form>
      )}

      {authTab === 'login' && loginMode === 'otp' && loginOtpStep === 'enterCode' && (
        <form className="auth-form" onSubmit={handleLoginOtpVerify}>
          <div className="auth-note">
            {isEl ? `Στείλαμε κωδικό στο ${loginEmail}` : `We sent a code to ${loginEmail}`}
          </div>
          <div className="form-row">
            <label className="form-label">{isEl ? 'Κωδικός 6 ψηφίων' : '6-digit code'}</label>
            <input
              className="form-input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={loginOtpCode}
              onChange={(e) => setLoginOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              autoComplete="one-time-code"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={busy || loginOtpCode.length !== 6}>
            {busy ? '...' : (isEl ? 'Επαλήθευση & σύνδεση' : 'Verify & sign in')}
          </button>
          <div className="auth-otp-toggle">
            <button type="button" onClick={() => { setLoginOtpStep('enterEmail'); setLoginOtpCode(''); setError(null) }}>
              {isEl ? '← Άλλαξε email' : '← Change email'}
            </button>
          </div>
        </form>
      )}

      {/* ─── SIGNUP TAB (OTP-only) ─────────────────────────────── */}
      {authTab === 'register' && regOtpStep === 'enterEmail' && (
        <form className="auth-form" onSubmit={handleRegOtpSend}>
          <div className="form-row">
            <label className="form-label">{isEl ? 'Ονοματεπώνυμο' : 'Full Name'}</label>
            <input
              className="form-input"
              type="text"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder={isEl ? 'Γιώργης Παπαδόπουλος' : 'John Smith'}
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
          <div className="auth-note">
            {isEl
              ? 'Χωρίς κωδικό στην εγγραφή — θα σου στείλουμε 6-ψήφιο κωδικό. Μπορείς να ορίσεις κωδικό αργότερα από τις ρυθμίσεις.'
              : "No password at signup — we'll send you a 6-digit code. You can set a password later from your account."}
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={busy || !regName || !regEmail}>
            {busy ? '...' : (isEl ? 'Στείλε μου κωδικό' : 'Send me a code')}
          </button>
          <div className="auth-switch">
            {isEl ? 'Έχεις ήδη λογαριασμό;' : 'Already have an account?'}{' '}
            <span onClick={() => switchTab('login')}>{isEl ? 'Σύνδεση' : 'Sign In'}</span>
          </div>
        </form>
      )}

      {authTab === 'register' && regOtpStep === 'enterCode' && (
        <form className="auth-form" onSubmit={handleRegOtpVerify}>
          <div className="auth-note">
            {isEl ? `Στείλαμε κωδικό στο ${regEmail}` : `We sent a code to ${regEmail}`}
          </div>
          <div className="form-row">
            <label className="form-label">{isEl ? 'Κωδικός 6 ψηφίων' : '6-digit code'}</label>
            <input
              className="form-input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={regOtpCode}
              onChange={(e) => setRegOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              autoComplete="one-time-code"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={busy || regOtpCode.length !== 6}>
            {busy ? '...' : (isEl ? 'Επαλήθευση & ολοκλήρωση' : 'Verify & finish')}
          </button>
          <div className="auth-otp-toggle">
            <button type="button" onClick={() => { setRegOtpStep('enterEmail'); setRegOtpCode(''); setError(null) }}>
              {isEl ? '← Άλλαξε email' : '← Change email'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
