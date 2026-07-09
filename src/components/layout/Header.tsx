import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useMenuStore } from '../../store/useMenuStore'
import { makeTr } from '../../lib/translations'
import { ACCOUNT_TABS, accountTabLabel, logoutIcon } from '../../lib/accountNav'
import { LogoLockup } from '../ui/LogoLockup'

export function Header() {
  const lang = useUIStore((s) => s.lang)
  const setLang = useUIStore((s) => s.setLang)
  // WEC-406: mobile lang popover state + click-outside close.
  const [langOpen, setLangOpen] = useState(false)
  const langRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!langOpen) return
    const onDoc = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [langOpen])
  const openAuthModal = useUIStore((s) => s.openAuthModal)
  const goToAccount = useUIStore((s) => s.goToAccount)
  const goToMenu = useUIStore((s) => s.goToMenu)
  const { user, logout } = useAuthStore()

  // WEC-297: hide the wallet pill when 'wallet' isn't in payment_methods_enabled.
  // Surfacing a balance the customer can't actually spend at checkout is
  // misleading. Same setting gates the checkout payment-method list, so this
  // keeps the two surfaces consistent.
  const paymentMethodsEnabled = useMenuStore((s) => s.settings.paymentMethodsEnabled)
  const walletEnabled = !paymentMethodsEnabled || paymentMethodsEnabled.includes('wallet')

  // WEC-141: after sign out, always drop back to the menu. Sign-out can be
  // triggered from any overlay page (checkout, wallet, account, subscription);
  // without an explicit navigation the user would stay on an empty logged-out
  // version of that page, which is confusing.
  const handleSignOut = async () => {
    setMenuOpen(false)
    await logout()
    goToMenu()
  }
  const navigate = useNavigate()
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
        <LogoLockup className="logo-lockup" />
        <div className="logo-sub">Healthy delivery</div>
      </a>

      {/* Right side */}
      <div className="lang-wrap">
        {/* Admin link (only visible to admins) */}
        {user?.isAdmin && (
          <button
            className="hdr-admin-link"
            onClick={() => navigate('/admin')}
            title="Admin panel"
            aria-label={t('adminPanel')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/>
            </svg>
            <span>Admin</span>
          </button>
        )}

        {/* Wallet badge (only when logged in AND wallet payment is enabled — WEC-297).
            WEC-519: display-only for now — the click used to open the deprecated
            WalletModal, but there are no self-serve wallet purchases yet (balance
            comes only from subscriptions). To re-enable later, make this a <button>
            again with onClick={goToWalletPage} (NOT the old openWalletModal). */}
        {user?.wallet?.active && walletEnabled && (
          <div
            className="wallet-hdr-badge"
            style={{ cursor: 'default' }}
            title="Fitpal Wallet"
            aria-label={lang === 'el' ? `Υπόλοιπο πορτοφολιού ${user.wallet.balance.toFixed(2)} ευρώ` : `Wallet balance ${user.wallet.balance.toFixed(2)} euros`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <path d="M16 12h.01"/>
              <path d="M2 10h20"/>
            </svg>
            <span className="wallet-hdr-amt">€{user.wallet.balance.toFixed(2)}</span>
          </div>
        )}

        {/* Language toggle — WEC-406: dual pills on desktop; mobile (<640) gets
            a single globe icon that opens a small popover so the header keeps
            its space for the logo + account. */}
        <div className="lang-toggle" ref={langRef}>
          <div className="lang-toggle-desktop">
            <button
              className={`lang-btn${lang === 'el' ? ' active' : ''}`}
              onClick={() => setLang('el')}
            >ΕΛ</button>
            <button
              className={`lang-btn${lang === 'en' ? ' active' : ''}`}
              onClick={() => setLang('en')}
            >EN</button>
          </div>
          <div className="lang-toggle-mobile">
            <button
              type="button"
              className="lang-globe"
              onClick={() => setLangOpen((v) => !v)}
              aria-label={t('languageLbl')}
              aria-expanded={langOpen}
              aria-haspopup="menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <ellipse cx="12" cy="12" rx="4" ry="10" />
              </svg>
              <span className="lang-globe-badge" aria-hidden="true">{lang === 'el' ? 'EL' : 'EN'}</span>
            </button>
            {langOpen && (
              <div className="lang-popover" role="menu">
                <button
                  role="menuitemradio"
                  aria-checked={lang === 'el'}
                  className={`lang-popover-item${lang === 'el' ? ' active' : ''}`}
                  onClick={() => { setLang('el'); setLangOpen(false) }}
                >
                  <span className="lang-popover-check">{lang === 'el' ? '✓' : ''}</span> Ελληνικά
                </button>
                <button
                  role="menuitemradio"
                  aria-checked={lang === 'en'}
                  className={`lang-popover-item${lang === 'en' ? ' active' : ''}`}
                  onClick={() => { setLang('en'); setLangOpen(false) }}
                >
                  <span className="lang-popover-check">{lang === 'en' ? '✓' : ''}</span> English
                </button>
              </div>
            )}
          </div>
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
                  {/* WEC-518: rendered from ACCOUNT_TABS (src/lib/accountNav) —
                      the SAME source the AccountPage sidebar renders from, so
                      order, wording and icons can never drift between the two. */}
                  {ACCOUNT_TABS.map((tb) => (
                    <button
                      key={tb.key}
                      className="user-menu-item"
                      onClick={() => { setMenuOpen(false); goToAccount(tb.key) }}
                    >
                      {tb.icon}
                      {accountTabLabel(tb.key, lang)}
                    </button>
                  ))}
                  <div className="user-menu-divider" />
                  <button
                    className="user-menu-item danger"
                    onClick={handleSignOut}
                  >
                    {logoutIcon}
                    {t('signOut')}
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
