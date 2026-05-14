import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import {
  sendEmailOtp,
  verifyEmailOtp,
  signInWithOAuth,
  type OAuthProvider,
} from '../../lib/api/auth'
import { supabase } from '../../lib/supabase'

/**
 * Login modes:
 *   - 'password': email + password (default for returning users — fast with autofill)
 *   - 'otp':      email → numeric code (no password required, works for any user)
 *
 * Signup mode is OTP-only — no password is collected at signup. Users who
 * want fast returning-login can opt in via Account → Profile → "Set a password"
 * later. See OTP-everywhere epic.
 *
 * WEC-272: OTP length is configured server-side in Supabase Dashboard →
 * Authentication → Email → "OTP length". Our project is set to 6 digits
 * (chosen over 8 for easier mobile readability — users memorise + retype
 * 6 digits comfortably without tab-switching). Keep this constant in sync
 * with that setting. We accept paste input up to OTP_MAX_LENGTH defensively
 * so a future config bump (e.g. to 8 or 10) doesn't silently truncate the
 * pasted code and trigger "otp_expired" mismatches at the verify step.
 */
const OTP_LENGTH = 6
const OTP_MAX_LENGTH = 10

/**
 * WEC-323 hide-toggle. Set to `true` once the Facebook Developer app is
 * created, switched to Live mode, and the App ID + App Secret are pasted
 * into Supabase Auth → Providers → Facebook. Until then we keep the
 * button out of the modal so customers don't click it and get a confusing
 * "provider not enabled" error.
 *
 * The Facebook-side code path (handleOAuth('facebook'), AuthCallback's
 * email-less FB edge case, etc.) stays in place — it's just the button
 * that's gated.
 */
const ENABLE_FACEBOOK_OAUTH = false
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

  /* ── OAuth (Google + Facebook) ──────────────────────────────────
   * Both signup and signin map to the same Supabase `signInWithOAuth`
   * call — the provider creates the user on first contact. After the
   * helper kicks off the redirect we typically never reach the post-
   * await code; only an early error (e.g. provider not configured,
   * popup blocked, network error) lands here.
   */
  async function handleOAuth(provider: OAuthProvider) {
    setError(null); setBusy(true)
    const { ok, error } = await signInWithOAuth(provider)
    if (!ok) {
      setError(
        error ??
          (isEl
            ? 'Δεν ήταν δυνατή η σύνδεση'
            : 'Could not start sign-in'),
      )
      setBusy(false)
    }
  }

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

  /* ── OAuth row (Google + Facebook, WEC-322/323) ─────────────────
   * Rendered on every tab/step that lands on an email-collection
   * step (login password, login OTP enter-email, register enter-email).
   * Hidden on intermediate code-entry steps to avoid letting the user
   * abandon the flow they're already mid-way through.
   */
  const oauthRow = (
    <>
      <div className="auth-oauth-row">
        <button
          type="button"
          className="btn-oauth btn-oauth-google"
          onClick={() => handleOAuth('google')}
          disabled={busy}
          aria-label={isEl ? 'Συνέχισε με Google' : 'Continue with Google'}
        >
          <svg className="oauth-icon" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
          </svg>
          <span>{isEl ? 'Συνέχισε με Google' : 'Continue with Google'}</span>
        </button>
        {ENABLE_FACEBOOK_OAUTH && (
          <button
            type="button"
            className="btn-oauth btn-oauth-facebook"
            onClick={() => handleOAuth('facebook')}
            disabled={busy}
            aria-label={isEl ? 'Συνέχισε με Facebook' : 'Continue with Facebook'}
          >
            <svg className="oauth-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.025 1.792-4.695 4.533-4.695 1.313 0 2.686.236 2.686.236v2.97h-1.513c-1.49 0-1.955.93-1.955 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
            </svg>
            <span>{isEl ? 'Συνέχισε με Facebook' : 'Continue with Facebook'}</span>
          </button>
        )}
      </div>
      <div className="auth-divider"><span>{isEl ? 'ή' : 'or'}</span></div>
    </>
  )

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
        <>
        {oauthRow}
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
        </>
      )}

      {authTab === 'login' && loginMode === 'otp' && loginOtpStep === 'enterEmail' && (
        <>
        {oauthRow}
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
            {isEl ? `Θα σου στείλουμε ${OTP_LENGTH}-ψήφιο κωδικό.` : `We'll send you a ${OTP_LENGTH}-digit code.`}
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
        </>
      )}

      {authTab === 'login' && loginMode === 'otp' && loginOtpStep === 'enterCode' && (
        <form className="auth-form" onSubmit={handleLoginOtpVerify}>
          <div className="auth-note">
            {isEl ? `Στείλαμε κωδικό στο ${loginEmail}` : `We sent a code to ${loginEmail}`}
          </div>
          <div className="form-row">
            <label className="form-label">{isEl ? `Κωδικός ${OTP_LENGTH} ψηφίων` : `${OTP_LENGTH}-digit code`}</label>
            <input
              className="form-input"
              type="text"
              inputMode="numeric"
              maxLength={OTP_MAX_LENGTH}
              value={loginOtpCode}
              onChange={(e) => setLoginOtpCode(e.target.value.replace(/\D/g, '').slice(0, OTP_MAX_LENGTH))}
              placeholder={'1'.repeat(OTP_LENGTH)}
              autoComplete="one-time-code"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={busy || loginOtpCode.length < OTP_LENGTH}>
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
        <>
        {oauthRow}
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
              ? `Χωρίς κωδικό στην εγγραφή — θα σου στείλουμε ${OTP_LENGTH}-ψήφιο κωδικό. Μπορείς να ορίσεις κωδικό αργότερα από τις ρυθμίσεις.`
              : `No password at signup — we'll send you a ${OTP_LENGTH}-digit code. You can set a password later from your account.`}
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
        </>
      )}

      {authTab === 'register' && regOtpStep === 'enterCode' && (
        <form className="auth-form" onSubmit={handleRegOtpVerify}>
          <div className="auth-note">
            {isEl ? `Στείλαμε κωδικό στο ${regEmail}` : `We sent a code to ${regEmail}`}
          </div>
          <div className="form-row">
            <label className="form-label">{isEl ? `Κωδικός ${OTP_LENGTH} ψηφίων` : `${OTP_LENGTH}-digit code`}</label>
            <input
              className="form-input"
              type="text"
              inputMode="numeric"
              maxLength={OTP_MAX_LENGTH}
              value={regOtpCode}
              onChange={(e) => setRegOtpCode(e.target.value.replace(/\D/g, '').slice(0, OTP_MAX_LENGTH))}
              placeholder={'1'.repeat(OTP_LENGTH)}
              autoComplete="one-time-code"
              required
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn-auth" type="submit" disabled={busy || regOtpCode.length < OTP_LENGTH}>
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
