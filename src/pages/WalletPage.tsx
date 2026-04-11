import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { WALLET_PLANS } from '../data/menu'

const STEPS_EL = [
  {
    n: '1',
    title: 'Επέλεξε πλάνο',
    desc: 'Διάλεξε ανάμεσα σε 3 μηνιαία πλάνα ανάλογα με τις ανάγκες σου.',
  },
  {
    n: '2',
    title: 'Λάβε bonus credits',
    desc: 'Τα credits μπαίνουν αμέσως στο πορτοφόλι σου — με bonus πάνω σε αυτά που πλήρωσες.',
  },
  {
    n: '3',
    title: 'Παράγγειλε ελεύθερα',
    desc: 'Χρησιμοποίησε τα credits σου για οποιοδήποτε γεύμα, οποιαδήποτε μέρα.',
  },
]

const STEPS_EN = [
  {
    n: '1',
    title: 'Choose a plan',
    desc: 'Pick from 3 monthly plans based on your needs.',
  },
  {
    n: '2',
    title: 'Get bonus credits',
    desc: 'Credits land instantly in your wallet — with a bonus on top of what you paid.',
  },
  {
    n: '3',
    title: 'Order freely',
    desc: 'Use your credits for any meal, any day.',
  },
]

export function WalletPage() {
  const lang = useUIStore((s) => s.lang)
  const closeWalletPage = useUIStore((s) => s.closeWalletPage)
  const openAuthModal = useUIStore((s) => s.openAuthModal)
  const user = useAuthStore((s) => s.user)
  const updateWallet = useAuthStore((s) => s.updateWallet)

  const wallet = user?.wallet
  const steps = lang === 'el' ? STEPS_EL : STEPS_EN
  const maxBonus = Math.max(...WALLET_PLANS.map((p) => p.bonusPct))

  function handleSelectPlan(planId: string) {
    if (!user) { openAuthModal(); return }
    const plan = WALLET_PLANS.find((p) => p.id === planId)
    if (!plan) return
    updateWallet({
      active: true,
      planId: plan.id,
      planEl: plan.nameEl,
      planEn: plan.nameEn,
      balance: (wallet?.balance ?? 0) + plan.credits,
      discountPct: plan.discountPct,
      autoRenew: true,
    })
  }

  return (
    <div className="wallet-page">

      {/* Back link */}
      <div className="wlp-back">
        <button className="wlp-back-btn" onClick={closeWalletPage}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {lang === 'el' ? 'Πίσω στο μενού' : 'Back to menu'}
        </button>
      </div>

      {/* Hero */}
      <div className="wlp-hero">
        <div className="wlp-hero-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <path d="M16 12h.01"/><path d="M2 10h20"/>
          </svg>
          FITPAL WALLET
        </div>
        <h1 className="wlp-hero-title">
          {lang === 'el'
            ? <>Πλήρωσε λιγότερα,<br /><span>φάε περισσότερα</span></>
            : <>Pay less,<br /><span>eat more</span></>}
        </h1>
        <p className="wlp-hero-desc">
          {lang === 'el'
            ? <>Ξεκίνα μια μηνιαία συνδρομή Fitpal Wallet και κέρδισε bonus credits σε κάθε αναπλήρωση.<br />Όσο μεγαλύτερο το πλάνο, τόσο μεγαλύτερο το bonus.</>
            : <>Start a monthly Fitpal Wallet subscription and earn bonus credits on every top-up.<br />The bigger the plan, the bigger the bonus.</>}
        </p>
      </div>

      {/* How it works */}
      <div className="wlp-steps-wrap">
        <div className="wlp-steps">
          {steps.map((s) => (
            <div key={s.n} className="wlp-step">
              <div className="wlp-step-num">{s.n}</div>
              <div className="wlp-step-title">{s.title}</div>
              <div className="wlp-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Plan selection */}
      <div className="wlp-plans-wrap">
        <h2 className="wlp-plans-title">
          {lang === 'el' ? 'Επέλεξε το πλάνο σου' : 'Choose your plan'}
        </h2>
        <p className="wlp-plans-sub">
          {lang === 'el'
            ? `Τα πλάνα ανανεώνονται μηνιαία. Μπορείς να αλλάξεις ή να ακυρώσεις οποτεδήποτε.`
            : `Plans renew monthly. You can change or cancel at any time.`}
        </p>

        <div className="wlp-plans-grid">
          {WALLET_PLANS.map((plan) => {
            const isPopular = plan.id === 'plus'
            const isActive = wallet?.planId === plan.id && wallet?.active
            const name = lang === 'el' ? plan.nameEl : plan.nameEn
            return (
              <div
                key={plan.id}
                className={`wlp-plan-card${isPopular ? ' popular' : ''}${isActive ? ' current' : ''}`}
              >
                {isPopular && (
                  <div className="wlp-popular-badge">
                    {lang === 'el' ? 'ΠΙΟ ΔΗΜΟΦΙΛΕΣ' : 'MOST POPULAR'}
                  </div>
                )}
                <div className="wlp-plan-name">{name}</div>
                <div className="wlp-plan-price">
                  €{plan.price}<span className="wlp-plan-period">/{lang === 'el' ? 'μήνα' : 'mo'}</span>
                </div>
                <div className="wlp-plan-credits-row">
                  <span className="wlp-arrow">→</span>
                  <span className="wlp-credits-val">€{plan.credits.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} credits</span>
                </div>
                <div className="wlp-plan-features">
                  <div className="wlp-feature">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    +{plan.bonusPct}% bonus credits
                  </div>
                  <div className="wlp-feature">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    -{plan.discountPct}% {lang === 'el' ? 'έκπτωση σε κάθε παραγγελία' : 'discount on every order'}
                  </div>
                  <div className="wlp-feature">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {lang === 'el' ? 'Ακύρωση οποτεδήποτε' : 'Cancel anytime'}
                  </div>
                </div>
                <button
                  className={`wlp-plan-btn${isPopular ? ' popular' : ''}${isActive ? ' active-btn' : ''}`}
                  onClick={() => !isActive && handleSelectPlan(plan.id)}
                  disabled={isActive}
                >
                  {isActive
                    ? (lang === 'el' ? '✓ Ενεργό' : '✓ Active')
                    : (lang === 'el' ? 'Επέλεξε' : 'Select')}
                </button>
              </div>
            )
          })}
        </div>

        {!user && (
          <p className="wlp-login-note">
            {lang === 'el'
              ? <><button className="wlp-inline-btn" onClick={openAuthModal}>Σύνδεση</button> ή <button className="wlp-inline-btn" onClick={openAuthModal}>Εγγραφή</button> για να αγοράσεις πακέτο</>
              : <><button className="wlp-inline-btn" onClick={openAuthModal}>Sign in</button> or <button className="wlp-inline-btn" onClick={openAuthModal}>Register</button> to purchase a plan</>}
          </p>
        )}

        {/* Max bonus callout */}
        <div className="wlp-bonus-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {lang === 'el'
            ? `Bonus credits έως +${maxBonus}%. Τα credits δεν λήγουν και χρησιμοποιούνται αυτόματα στις παραγγελίες σου.`
            : `Up to +${maxBonus}% bonus credits. Credits never expire and are applied automatically to your orders.`}
        </div>
      </div>

    </div>
  )
}
