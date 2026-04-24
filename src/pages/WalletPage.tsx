import { useState } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { WALLET_PLANS } from '../data/menu'

/* ── Calculator constants (match demo.html) ─────────────── */
const MEAL_COSTS = [
  { breakfast: 4.0, lunch: 7.0,  dinner: 6.5  },  // 0: light
  { breakfast: 4.5, lunch: 8.5,  dinner: 8.0  },  // 1: moderate
  { breakfast: 5.0, lunch: 10.0, dinner: 9.5  },  // 2: regular
  { breakfast: 5.5, lunch: 12.0, dinner: 11.5 },  // 3: heavy
  { breakfast: 6.0, lunch: 14.0, dinner: 13.5 },  // 4: athlete
]
const WEEKS_PER_MONTH = 4.33 // 52 / 12

const FREQ_OPTIONS = [
  { id: 'biweekly',  mult: 0.5, bonusExtra: 0, label: { el: 'Δεκαπενθήμερο', en: 'Bi-weekly' } },
  { id: 'monthly',   mult: 1,   bonusExtra: 3, label: { el: 'Μηνιαίο',       en: 'Monthly'   } },
  { id: 'quarterly', mult: 3,   bonusExtra: 5, label: { el: 'Τριμηνιαίο',    en: 'Quarterly'  } },
]

const LEVELS_EL = [
  { emoji: '\u{1F957}', name: 'Ελαφρύ'   },
  { emoji: '\u{1F37D}\uFE0F', name: 'Μέτριο'   },
  { emoji: '\u{1F35B}', name: 'Κανονικό' },
  { emoji: '\u{1F969}', name: 'Μεγάλο'   },
  { emoji: '\u{1F3CB}\uFE0F', name: 'Αθλητικό' },
]
const LEVELS_EN = [
  { emoji: '\u{1F957}', name: 'Light'    },
  { emoji: '\u{1F37D}\uFE0F', name: 'Moderate' },
  { emoji: '\u{1F35B}', name: 'Regular'  },
  { emoji: '\u{1F969}', name: 'Heavy'    },
  { emoji: '\u{1F3CB}\uFE0F', name: 'Athlete'  },
]

const MEALS_EL = [
  { key: 'breakfast', emoji: '\u2600\uFE0F', name: 'Πρωινό'      },
  { key: 'lunch',     emoji: '\u{1F31E}',   name: 'Μεσημεριανό' },
  { key: 'dinner',    emoji: '\u{1F319}',   name: 'Βραδινό'     },
]
const MEALS_EN = [
  { key: 'breakfast', emoji: '\u2600\uFE0F', name: 'Breakfast' },
  { key: 'lunch',     emoji: '\u{1F31E}',   name: 'Lunch'     },
  { key: 'dinner',    emoji: '\u{1F319}',   name: 'Dinner'    },
]

const FAQS_EL = [
  { q: 'Τι γίνεται αν δεν ξοδέψω όλα τα credits μου;', a: 'Τα credits παραμένουν στο πορτοφόλι σου όσο η συνδρομή σου είναι ενεργή. Αν η συνδρομή λήξει χωρίς ανανέωση, κρατάς τα credits που αντιστοιχούν στο ποσό που πλήρωσες αλλά χάνεις τα bonus credits.' },
  { q: 'Μπορώ να αλλάξω πλάνο;', a: 'Φυσικά! Μπορείς να αλλάξεις πλάνο ανά πάσα στιγμή. Η αλλαγή θα ισχύσει από την επόμενη ανανέωση.' },
  { q: 'Πώς λειτουργεί η αυτόματη ανανέωση;', a: 'Κάθε μήνα χρεώνεσαι αυτόματα και τα νέα credits μπαίνουν αμέσως στο πορτοφόλι σου. Μπορείς να απενεργοποιήσεις την αυτόματη ανανέωση οποτεδήποτε.' },
  { q: 'Μπορώ να συνδυάσω wallet με κουπόνι;', a: 'Ναι! Τα κουπόνια εφαρμόζονται στο σύνολο της παραγγελίας και μετά αφαιρείται το ποσό από το wallet.' },
  { q: 'Υπάρχει ελάχιστη δέσμευση;', a: 'Οχι! Δεν υπάρχει ελάχιστη δέσμευση. Μπορείς να ακυρώσεις ή να σταματήσεις την ανανέωση ανά πάσα στιγμή.' },
]
const FAQS_EN = [
  { q: "What happens if I don't spend all my credits?", a: 'Credits remain in your wallet as long as your subscription is active. If your subscription expires without renewal, you keep credits matching what you paid but lose the bonus credits.' },
  { q: 'Can I change my plan?', a: 'Of course! You can switch plans at any time. The change will take effect from your next renewal.' },
  { q: 'How does auto-renewal work?', a: "Each month you're charged automatically and new credits are added to your wallet instantly. You can disable auto-renewal at any time." },
  { q: 'Can I combine wallet with a voucher?', a: 'Yes! Vouchers are applied to the order total first, then the remaining amount is deducted from your wallet.' },
  { q: 'Is there a minimum commitment?', a: "No! There's no minimum commitment. You can cancel or stop renewal at any time." },
]

function avgMealCost(levelIdx: number) {
  const c = MEAL_COSTS[levelIdx]
  return ((c.breakfast + c.lunch + c.dinner) / 3).toFixed(1)
}

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
  const isEl = lang === 'el'

  /* Calculator state */
  const [calcLevel, setCalcLevel] = useState(2)  // regular
  const [calcMeals, setCalcMeals] = useState({ breakfast: false, lunch: true, dinner: true })
  const [calcPeople, setCalcPeople] = useState(1)
  const [calcDays, setCalcDays] = useState(5)
  const [calcFreq, setCalcFreq] = useState('monthly')

  /* FAQ state */
  const [faqOpen, setFaqOpen] = useState<number | null>(null)

  /* Calculator logic (matches demo exactly) */
  const costs = MEAL_COSTS[calcLevel]
  let perDayPerPerson = 0
  if (calcMeals.breakfast) perDayPerPerson += costs.breakfast
  if (calcMeals.lunch) perDayPerPerson += costs.lunch
  if (calcMeals.dinner) perDayPerPerson += costs.dinner
  const monthlySpend = Math.round(perDayPerPerson * calcPeople * calcDays * WEEKS_PER_MONTH)

  const freq = FREQ_OPTIONS.find((f) => f.id === calcFreq) || FREQ_OPTIONS[1]
  const periodSpend = Math.round(monthlySpend * freq.mult)

  // Determine bonus tier based on monthly spend
  let baseBonusPct: number
  if (monthlySpend <= 60) baseBonusPct = WALLET_PLANS[0].bonusPct
  else if (monthlySpend <= 120) baseBonusPct = WALLET_PLANS[1].bonusPct
  else baseBonusPct = WALLET_PLANS[2].bonusPct

  // Effective bonus = tier bonus + frequency extra bonus
  const effectiveBonusPct = baseBonusPct + freq.bonusExtra
  const totalPaid = periodSpend
  const totalCredits = Math.round(totalPaid * (1 + effectiveBonusPct / 100))
  const bonusTotal = totalCredits - totalPaid
  const mealCount = (calcMeals.breakfast ? 1 : 0) + (calcMeals.lunch ? 1 : 0) + (calcMeals.dinner ? 1 : 0)

  const perLabel = isEl
    ? (calcFreq === 'biweekly' ? '/ 2 εβδ.' : calcFreq === 'quarterly' ? '/ τρίμηνο' : '/ μήνα')
    : (calcFreq === 'biweekly' ? '/ 2 wks' : calcFreq === 'quarterly' ? '/ quarter' : '/ mo')

  const levels = isEl ? LEVELS_EL : LEVELS_EN
  const meals = isEl ? MEALS_EL : MEALS_EN
  const faqs = isEl ? FAQS_EL : FAQS_EN

  // handleSelectPlan() lived here and was referenced by the plan-selection
  // grid ~line 280, which is currently commented out. Removing the function
  // until we re-enable the block; the pattern is trivial to recreate from
  // updateWallet + WALLET_PLANS when needed.

  function handleStartSubscription() {
    if (!user) { openAuthModal(); return }
    updateWallet({
      active: true,
      planId: 'custom',
      planEl: 'Custom',
      planEn: 'Custom',
      balance: (wallet?.balance ?? 0) + totalCredits,
      bonusPct: effectiveBonusPct,
      autoRenew: true,
      monthlyAmount: monthlySpend,
      creditAmount: totalCredits,
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
            ? <>Ξεκίνα μια μηνιαία συνδρομή Fitpal Wallet και κέρδισε bonus credits σε κάθε αναπλήρωση.<br />Οσο μεγαλύτερο το πλάνο, τόσο μεγαλύτερο το bonus.</>
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

      {/* Plan selection — commented out, will revisit later */}
      {/*
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

        <div className="wlp-bonus-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {lang === 'el'
            ? `Bonus credits έως +${maxBonus}%. Τα credits δεν λήγουν και χρησιμοποιούνται αυτόματα στις παραγγελίες σου.`
            : `Up to +${maxBonus}% bonus credits. Credits never expire and are applied automatically to your orders.`}
        </div>
      </div>
      */}

      {/* ═══ SAVINGS CALCULATOR ═══ */}
      <div className="wlp-calc-wrap">
        <h2 className="wlp-section-title">
          {isEl ? 'Υπολόγισε την εξοικονόμησή σου' : 'Calculate your savings'}
        </h2>
        <p className="wlp-section-sub">
          {isEl ? 'Πες μας τις διατροφικές σου συνήθειες και βρες το ιδανικό πλάνο' : 'Tell us your eating habits and find the ideal plan'}
        </p>

        <div className="sub-calc">
          <div className="sub-calc-grid">
            {/* Left: inputs */}
            <div className="sub-calc-left">

              {/* Consumption level */}
              <div className="sub-calc-field">
                <div className="sub-calc-label">
                  {isEl ? 'Τι τύπος καταναλωτή είσαι;' : 'What type of eater are you?'}
                </div>
                <div className="sub-calc-levels">
                  {levels.map((l, i) => (
                    <div
                      key={i}
                      className={`sub-calc-level${calcLevel === i ? ' sel' : ''}`}
                      onClick={() => setCalcLevel(i)}
                    >
                      <div className="sub-calc-level-emoji">{l.emoji}</div>
                      <div className="sub-calc-level-name">{l.name}</div>
                      <div className="sub-calc-level-avg">~€{avgMealCost(i)}/{isEl ? 'γεύμα' : 'meal'}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Meal toggles */}
              <div className="sub-calc-field">
                <div className="sub-calc-label">
                  {isEl ? 'Ποια γεύματα παραγγέλνεις;' : 'Which meals do you order?'}
                </div>
                <div className="sub-calc-meals">
                  {meals.map((m) => (
                    <div
                      key={m.key}
                      className={`sub-calc-meal${calcMeals[m.key as keyof typeof calcMeals] ? ' sel' : ''}`}
                      onClick={() => setCalcMeals((prev) => ({ ...prev, [m.key]: !prev[m.key as keyof typeof prev] }))}
                    >
                      <div className="sub-calc-meal-emoji">{m.emoji}</div>
                      <div className="sub-calc-meal-name">{m.name}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* People & days steppers */}
              <div className="sub-calc-field">
                <div className="sub-calc-row-inputs">
                  <div>
                    <div className="sub-calc-label">{isEl ? 'Ατομα' : 'People'}</div>
                    <div className="sub-calc-stepper">
                      <button className="sub-calc-stepper-btn" onClick={() => setCalcPeople((p) => Math.max(1, p - 1))}>−</button>
                      <div className="sub-calc-stepper-val">{calcPeople}</div>
                      <button className="sub-calc-stepper-btn" onClick={() => setCalcPeople((p) => Math.min(10, p + 1))}>+</button>
                    </div>
                  </div>
                  <div>
                    <div className="sub-calc-label">{isEl ? 'Μέρες / εβδομάδα' : 'Days / week'}</div>
                    <div className="sub-calc-stepper">
                      <button className="sub-calc-stepper-btn" onClick={() => setCalcDays((d) => Math.max(1, d - 1))}>−</button>
                      <div className="sub-calc-stepper-val">{calcDays}</div>
                      <button className="sub-calc-stepper-btn" onClick={() => setCalcDays((d) => Math.min(7, d + 1))}>+</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Estimated spending */}
              <div className="sub-calc-estimate">
                <div className="sub-calc-estimate-label">
                  {isEl ? 'Εκτιμώμενη δαπάνη' : 'Estimated spending'} {perLabel}
                </div>
                <div className="sub-calc-estimate-amt">
                  €{periodSpend}<small> {perLabel}</small>
                </div>
                <div className="sub-calc-estimate-note">
                  {calcPeople} {isEl ? (calcPeople === 1 ? 'άτομο' : 'άτομα') : (calcPeople === 1 ? 'person' : 'people')} · {mealCount} {isEl ? (mealCount === 1 ? 'γεύμα' : 'γεύματα') : (mealCount === 1 ? 'meal' : 'meals')} · {calcDays} {isEl ? 'μέρες/εβδ.' : 'days/wk'}
                </div>
              </div>

            </div>

            {/* Right: results panel */}
            <div className="sub-calc-right">
              <div className="sub-calc-result-title">{isEl ? 'Το πλάνο σου' : 'Your plan'}</div>

              {/* Payment frequency selector inside the green box */}
              <div className="sub-calc-field" style={{ marginBottom: '1rem' }}>
                <div className="sub-calc-label" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>
                  {isEl ? 'Συχνότητα πληρωμής:' : 'Payment frequency:'}
                </div>
                <div className="sub-calc-freq">
                  {FREQ_OPTIONS.map((f) => (
                    <div
                      key={f.id}
                      className={`sub-calc-freq-opt${calcFreq === f.id ? ' sel' : ''}`}
                      onClick={() => setCalcFreq(f.id)}
                    >
                      {f.label[lang]}
                      {f.bonusExtra > 0 && <span className="sub-calc-freq-bonus">+{f.bonusExtra}%</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Cost & credits hero */}
              <div className="sub-calc-plan-hero">
                <div className="sub-calc-plan-cost">
                  <span className="sub-calc-cost-label">{isEl ? 'Κόστος' : 'Cost'}</span>
                  <span className="sub-calc-cost-val">€{totalPaid}</span>
                  <span className="sub-calc-cost-per">{perLabel}</span>
                </div>
                <div className="sub-calc-plan-arrow">→</div>
                <div className="sub-calc-plan-credits-total">
                  <span className="sub-calc-credits-label">{isEl ? 'Λαμβάνεις' : 'You receive'}</span>
                  <span className="sub-calc-credits-val">€{totalCredits}</span>
                  <span className="sub-calc-credits-sub">credits</span>
                </div>
              </div>

              <div className="sub-calc-savings">
                <div className="sub-calc-savings-pct">+{effectiveBonusPct}% bonus</div>
                <div className="sub-calc-savings-amt">€{bonusTotal}</div>
                <div className="sub-calc-savings-label">
                  {isEl ? `δωρεάν credits ${perLabel}` : `free credits ${perLabel}`}
                </div>
              </div>
              <button className="sub-calc-cta" onClick={handleStartSubscription}>
                {isEl ? 'Ξεκίνα τη συνδρομή →' : 'Start subscription →'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ FAQ ═══ */}
      <div className="wlp-faq-wrap">
        <h2 className="wlp-section-title">
          {isEl ? 'Συχνές ερωτήσεις' : 'Frequently asked questions'}
        </h2>
        <p className="wlp-section-sub">
          {isEl ? 'Ο,τι χρειάζεται να ξέρεις για το Fitpal Wallet' : 'Everything you need to know about Fitpal Wallet'}
        </p>
        <div className="sub-faq">
          {faqs.map((f, i) => (
            <div key={i} className={`sub-faq-item${faqOpen === i ? ' open' : ''}`}>
              <div className="sub-faq-q" onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                {f.q}
                <span className="sub-faq-arrow">▾</span>
              </div>
              <div className="sub-faq-a">
                <div className="sub-faq-a-inner">{f.a}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ FINAL CTA ═══ */}
      <div className="sub-final-cta">
        <div className="sub-final-title">
          {isEl ? 'Ετοιμος να ξεκινήσεις;' : 'Ready to get started?'}
        </div>
        <div className="sub-final-sub">
          {isEl
            ? 'Ξεκίνα σήμερα και απόλαυσε bonus credits από την πρώτη στιγμή.'
            : 'Start today and enjoy bonus credits from day one.'}
        </div>
        <button className="sub-final-btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          {isEl ? 'Ξεκίνα τη συνδρομή →' : 'Start subscription →'}
        </button>
      </div>

    </div>
  )
}
