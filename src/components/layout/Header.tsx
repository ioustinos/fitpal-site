import { useState } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { makeTr } from '../../lib/translations'

export function Header() {
  const lang = useUIStore((s) => s.lang)
  const setLang = useUIStore((s) => s.setLang)
  const openAuthModal = useUIStore((s) => s.openAuthModal)
  const openWalletModal = useUIStore((s) => s.openWalletModal)
  const goToAccount = useUIStore((s) => s.goToAccount)
  const { user, logout } = useAuthStore()
  const t = makeTr(lang)

  const [menuOpen, setMenuOpen] = useState(false)

  const initials = user
    ? (user.name || user.email).slice(0, 1).toUpperCase()
    : ''

  const displayName = user
    ? (lang === 'en' && user.nameEn ? user.nameEn : user.name).split(' ')[0]
    : ''

  return (
    <header>
      {/* Logo */}
      <a className="logo" href="#" onClick={(e) => e.preventDefault()}>
        <div className="logo-icon">fp</div>
        <div className="logo-group">
          <div className="logo-text">fitpal<span>meals</span></div>
          <div className="logo-sub">Healthy delivery</div>
        </div>
      </a>

      {/* Right side */}
      <div className="lang-wrap">
        {/* Wallet badge (only when logged in) */}
        {user?.wallet?.active && (
          <button
            className="wallet-hdr-badge"
            onClick={openWalletModal}
            title="Fitpal Wallet"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <path d="M16 12h.01"/>
              <path d="M2 10h20"/>
            </svg>
            <span className="wallet-hdr-amt">€{user.wallet.balance.toFixed(2)}</span>
          </button>
        )}

        {/* Language toggle */}
        <div className="lang-toggle">
          <button
            className={`lang-btn${lang === 'el' ? ' active' : ''}`}
            onClick={() => setLang('el')}
          >ΕΛ</button>
          <button
            className={`lang-btn${lang === 'en' ? ' active' : ''}`}
            onClick={() => setLang('en')}
          >EN</button>
        </div>

        {/* Auth */}
        {user ? (
          <div className="user-dropdown-wrap">
            <button
              className="user-btn"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <div className="user-avatar">{initials}</div>
              <span className="user-name">{displayName}</span>
            </button>
            {menuOpen && (
              <>
                {/* Backdrop */}
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                  onClick={() => setMenuOpen(false)}
                />
                <div className="user-menu">
                  <button
                    className="user-menu-item"
                    onClick={() => { setMenuOpen(false); goToAccount('orders') }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>
                    </svg>
                    {lang === 'el' ? 'Οι Παραγγελίες μου' : 'My Orders'}
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => { setMenuOpen(false); goToAccount('wallet') }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h.01"/><path d="M2 10h20"/>
                    </svg>
                    {lang === 'el'
                      ? `Πορτοφόλι • €${user.wallet.balance.toFixed(2)}`
                      : `Wallet • €${user.wallet.balance.toFixed(2)}`}
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => { setMenuOpen(false); goToAccount('addresses') }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    {lang === 'el' ? 'Διευθύνσεις' : 'Addresses'}
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => { setMenuOpen(false); goToAccount('profile') }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                    </svg>
                    {lang === 'el' ? 'Τα Στοιχεία μου' : 'My Profile'}
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => { setMenuOpen(false); goToAccount('goals') }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
                    </svg>
                    {lang === 'el' ? 'Στόχοι' : 'Goals'}
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => { setMenuOpen(false); goToAccount('prefs') }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    {lang === 'el' ? 'Προτιμήσεις' : 'Preferences'}
                  </button>
                  <div className="user-menu-divider" />
                  <button
                    className="user-menu-item danger"
                    onClick={() => { setMenuOpen(false); logout() }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    {lang === 'el' ? 'Αποσύνδεση' : 'Sign Out'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button className="hdr-auth-btn" onClick={openAuthModal}>
            {t('signIn')}
          </button>
        )}
      </div>
    </header>
  )
}
