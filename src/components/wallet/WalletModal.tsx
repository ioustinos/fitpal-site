import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { WALLET_PLANS } from '../../data/menu'

export function WalletModal() {
  const lang = useUIStore((s) => s.lang)
  const openModal = useUIStore((s) => s.openModal)
  const closeModal = useUIStore((s) => s.closeModal)
  const openAuthModal = useUIStore((s) => s.openAuthModal)
  const user = useAuthStore((s) => s.user)
  const updateWallet = useAuthStore((s) => s.updateWallet)

  const [tab, setTab] = useState<'overview' | 'topup' | 'history'>(user ? 'overview' : 'topup')
  const isOpen = openModal === 'wallet'

  const wallet = user?.wallet

  return (
    <Modal open={isOpen} onClose={closeModal} innerClass="wallet-modal">
      <div className="wm-header">
        <h2 className="wm-title">Fitpal Wallet</h2>
        <button className="dm-close" onClick={closeModal} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Balance — only shown when logged in */}
      {user && (
        <div className="wm-balance-card">
          <div className="wm-balance-label">
            {lang === 'el' ? 'Διαθέσιμο υπόλοιπο' : 'Available balance'}
          </div>
          <div className="wm-balance-amt">€{(wallet?.balance ?? 0).toFixed(2)}</div>
          {wallet?.active && wallet.discountPct && (
            <div className="wm-discount-badge">
              -{wallet.discountPct}% {lang === 'el' ? 'σε κάθε παραγγελία' : 'on every order'}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="wm-tabs">
        {(user ? ['overview', 'topup', 'history'] as const : ['topup'] as const).map((t) => (
          <button
            key={t}
            className={`wm-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {tabLabel(t, lang)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="wm-overview">
          {!wallet?.active ? (
            <div className="wm-inactive">
              <p>{lang === 'el' ? 'Δεν έχεις ενεργό συνδρομή wallet.' : 'You have no active wallet subscription.'}</p>
              <button className="wm-tab-switch-btn" onClick={() => setTab('topup')}>
                {lang === 'el' ? 'Αγορά πακέτου' : 'Get a package'}
              </button>
            </div>
          ) : (
            <div className="wm-plan-info">
              <div className="wm-plan-name">{lang === 'el' ? wallet.planEl ?? '' : wallet.planEn ?? ''}</div>
              <div className="wm-plan-row">
                <span>{lang === 'el' ? 'Έκπτωση:' : 'Discount:'}</span>
                <strong>{wallet.discountPct}%</strong>
              </div>
              <div className="wm-plan-row">
                <span>{lang === 'el' ? 'Ανανέωση:' : 'Renewal:'}</span>
                <strong>{wallet.autoRenew ? (lang === 'el' ? 'Αυτόματη' : 'Automatic') : (lang === 'el' ? 'Χειροκίνητη' : 'Manual')}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'topup' && (
        <div className="wm-topup">
          <p className="wm-topup-intro">
            {lang === 'el'
              ? 'Επέλεξε ένα πακέτο και απόλαυσε bonus credits + έκπτωση σε κάθε παραγγελία.'
              : 'Choose a package to get bonus credits and a discount on every order.'}
          </p>
          <div className="wallet-plans">
            {WALLET_PLANS.map((plan) => (
              <button
                key={plan.id}
                className={`wallet-plan-card${wallet?.planId === plan.id ? ' active' : ''}`}
                onClick={() => {
                  if (!user) { closeModal(); openAuthModal(); return }
                  updateWallet({
                    active: true,
                    planId: plan.id,
                    planEl: plan.nameEl,
                    planEn: plan.nameEn,
                    balance: plan.credits,
                    discountPct: plan.discountPct,
                    autoRenew: true,
                  })
                }}
              >
                <div className="wp-name">{lang === 'el' ? plan.nameEl : plan.nameEn}</div>
                <div className="wp-price">€{plan.price.toFixed(2)}</div>
                <div className="wp-credits">→ €{plan.credits.toFixed(2)} credits</div>
                <div className="wp-bonus">+{plan.discountPct}% {lang === 'el' ? 'έκπτωση' : 'discount'}</div>
              </button>
            ))}
          </div>
          {!user && (
            <p className="wm-login-cta">
              {lang === 'el'
                ? <><button className="wm-inline-btn" onClick={() => { closeModal(); openAuthModal() }}>Σύνδεση</button> για να αγοράσεις πακέτο</>
                : <><button className="wm-inline-btn" onClick={() => { closeModal(); openAuthModal() }}>Sign in</button> to purchase a package</>}
            </p>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="wm-history">
          {!wallet?.transactions?.length ? (
            <p className="wm-empty">{lang === 'el' ? 'Δεν υπάρχουν συναλλαγές.' : 'No transactions yet.'}</p>
          ) : (
            wallet.transactions.map((tx, i) => (
              <div key={i} className="wm-tx">
                <div className="wm-tx-desc">{lang === 'el' ? tx.descEl : tx.descEn}</div>
                <div className={`wm-tx-amt ${tx.amount >= 0 ? 'pos' : 'neg'}`}>
                  {tx.amount >= 0 ? '+' : ''}€{tx.amount.toFixed(2)}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  )
}

function tabLabel(tab: string, lang: 'el' | 'en') {
  const m: Record<string, { el: string; en: string }> = {
    overview: { el: 'Επισκόπηση', en: 'Overview' },
    topup:    { el: 'Αγορά', en: 'Top up' },
    history:  { el: 'Ιστορικό', en: 'History' },
  }
  return m[tab]?.[lang] ?? tab
}
