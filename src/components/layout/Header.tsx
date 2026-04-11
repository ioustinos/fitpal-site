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
                    onClick={() => { setMenuOpen(false); goToAccount() }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                    </svg>
                    {lang === 'el' ? 'Ο Λογαριασμός μου' : 'My Account'}
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => { setMenuOpen(false); openWalletModal() }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h.01"/><path d="M2 10h20"/>
                    </svg>
                    {lang === 'el'
                      ? `Wallet • €${user.wallet.balance.toFixed(2)}`
                      : `Wallet • €${user.wallet.balance.toFixed(2)}`}
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
