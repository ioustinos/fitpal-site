import { useMemo, useState } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { calculateWalletPlan } from '../lib/wallet/calculator'
import { DEFAULT_WALLET_SETTINGS, ACTIVITY_LABELS, MEAL_LABELS } from '../lib/wallet/constants'
import type { ActivityLevel, DaysPerWeek, Goal, MealsSelection, PaymentMethod, PlanLength, Sex, MealKey } from '../lib/wallet/types'
import { purchaseWalletPlan, sendEmailOtp, verifyEmailOtp, savePhoneToProfile } from '../lib/api/walletPlan'

/* ─────────────────────────────────────────────────────────────────
   Static content & display data
   ───────────────────────────────────────────────────────────────── */

interface GoalCardData {
  id: Goal
  nameEl: string
  nameEn: string
  descEl: string
  descEn: string
  img: string
}

const GOAL_CARDS: GoalCardData[] = [
  {
    id: 'lose',
    nameEl: 'Χάσε Βάρος',
    nameEn: 'Lose Weight',
    descEl: 'Ισορροπημένα γεύματα με έλλειμμα θερμίδων',
    descEn: 'Balanced meals with a calorie deficit',
    img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80',
  },
  {
    id: 'maintain',
    nameEl: 'Διατήρησε Βάρος',
    nameEn: 'Maintain Weight',
    descEl: 'Ευέλικτα μενού για καθημερινή ρουτίνα',
    descEn: 'Flexible menu for everyday routine',
    img: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=80',
  },
  {
    id: 'gain',
    nameEl: 'Χτίσε Μύες',
    nameEn: 'Build Muscle',
    descEl: 'Υψηλή πρωτεΐνη για δύναμη & ανάκαμψη',
    descEn: 'High protein for strength & recovery',
    img: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=600&q=80',
  },
]

const PLAN_LENGTH_CARDS: Array<{
  id: PlanLength
  badge: { el: string; en: string; cls: 'test' | 'popular' | 'value' }
  nameEl: string
  nameEn: string
  daysLabel: { el: string; en: string }
}> = [
  {
    id: '2w',
    badge: { el: 'ΔΟΚΙΜΑΣΤΙΚΟ', en: 'TRIAL', cls: 'test' },
    nameEl: '2 Εβδομάδες', nameEn: '2 Weeks',
    daysLabel: { el: '14 ημέρες', en: '14 days' },
  },
  {
    id: '1mo',
    badge: { el: 'ΔΗΜΟΦΙΛΕΣ', en: 'POPULAR', cls: 'popular' },
    nameEl: '1 Μήνας', nameEn: '1 Month',
    daysLabel: { el: '30 ημέρες', en: '30 days' },
  },
  {
    id: '3mo',
    badge: { el: 'ΚΑΛΥΤΕΡΗ ΑΞΙΑ', en: 'BEST VALUE', cls: 'value' },
    nameEl: '3 Μήνες', nameEn: '3 Months',
    daysLabel: { el: '90 ημέρες', en: '90 days' },
  },
]

const FREQ_CARDS: Array<{ id: DaysPerWeek; nameEl: string; nameEn: string; subEl: string; subEn: string }> = [
  { id: 5, nameEl: '5 ημέρες', nameEn: '5 days', subEl: 'Δευ–Παρ',         subEn: 'Mon–Fri' },
  { id: 6, nameEl: '6 ημέρες', nameEn: '6 days', subEl: 'Δευ–Σαβ',         subEn: 'Mon–Sat' },
  { id: 7, nameEl: '7 ημέρες', nameEn: '7 days', subEl: 'Όλη την εβδομάδα', subEn: 'Whole week' },
]

/* ─────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────── */

/** Parse a string input to a clamped integer. */
function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = parseInt(value, 10)
  if (isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Format euro amount with the right decimals (whole euros if int, else 2 dp). */
function fmtEur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`
}

/* ─────────────────────────────────────────────────────────────────
   Defaults
   ───────────────────────────────────────────────────────────────── */

const DEFAULTS = {
  goal: 'maintain' as Goal,
  sex: 'female' as Sex,
  age: '30',
  heightCm: '170',
  weightKg: '70',
  activity: 'moderate' as ActivityLevel,
  meals: { breakfast: false, lunch: true, dinner: true, snack: false } as MealsSelection,
  planLength: '1mo' as PlanLength,
  daysPerWeek: 5 as DaysPerWeek,
  dieticianManaged: true,
}

/* ════════════════════════════════════════════════════════════════ */

export function WalletPage() {
  const lang = useUIStore((s) => s.lang)
  const closeWalletPage = useUIStore((s) => s.closeWalletPage)
  const user = useAuthStore((s) => s.user)
  const refreshUser = useAuthStore((s) => s.refreshUser)

  const isEl = lang === 'el'

  /* ── Calculator state — strings for free-typing inputs ─────── */
  const [goal, setGoal] = useState<Goal>(DEFAULTS.goal)
  const [sex, setSex] = useState<Sex>(DEFAULTS.sex)
  const [age, setAge] = useState(DEFAULTS.age)
  const [heightCm, setHeightCm] = useState(DEFAULTS.heightCm)
  const [weightKg, setWeightKg] = useState(DEFAULTS.weightKg)
  const [activity, setActivity] = useState<ActivityLevel>(DEFAULTS.activity)
  const [meals, setMeals] = useState<MealsSelection>(DEFAULTS.meals)
  const [planLength, setPlanLength] = useState<PlanLength>(DEFAULTS.planLength)
  const [daysPerWeek, setDaysPerWeek] = useState<DaysPerWeek>(DEFAULTS.daysPerWeek)
  const [dieticianManaged, setDieticianManaged] = useState(DEFAULTS.dieticianManaged)

  /* ── Live result ────────────────────────────────────────────── */
  const result = useMemo(() => calculateWalletPlan({
    sex,
    age:      clampInt(age,      14, 100, 30),
    heightCm: clampInt(heightCm, 120, 230, 170),
    weightKg: clampInt(weightKg, 35,  250, 70),
    activity,
    goal,
    meals,
    planLength,
    daysPerWeek,
    services: { dieticianManaged },
  }), [sex, age, heightCm, weightKg, activity, goal, meals, planLength, daysPerWeek, dieticianManaged])

  /* ── Payment method (default card; transfer shows bank info) ─ */
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')

  /* ── Inline signup state ───────────────────────────────────── */
  const [signupOpen, setSignupOpen] = useState(false)
  const [signupStep, setSignupStep] = useState<'identity' | 'verify' | 'phone'>('identity')
  const [suName, setSuName] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [suOtp, setSuOtp] = useState('')
  const [suPhone, setSuPhone] = useState('')

  /* ── Async/error state ─────────────────────────────────────── */
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [bankInfo, setBankInfo] = useState<{ iban: string; beneficiary: string; reference: string } | null>(null)

  const [voucher, setVoucher] = useState('')

  /* ── Handlers ──────────────────────────────────────────────── */
  function toggleMeal(key: MealKey) {
    setMeals((m) => ({ ...m, [key]: !m[key] }))
  }

  /** Build the canonical input the calculator + purchase API both expect. */
  function buildInput() {
    return {
      sex,
      age:      clampInt(age,      14, 100, 30),
      heightCm: clampInt(heightCm, 120, 230, 170),
      weightKg: clampInt(weightKg, 35,  250, 70),
      activity, goal, meals, planLength, daysPerWeek,
      services: { dieticianManaged },
    }
  }

  /** Fire the real /api/wallet-plan-purchase call. Assumes a session exists. */
  async function startPurchase() {
    setBusy(true)
    setErrMsg(null)
    try {
      const { data, error } = await purchaseWalletPlan({ ...buildInput(), paymentMethod })
      if (error || !data) { setErrMsg(error ?? 'Purchase failed'); return }

      if (data.paymentMethod === 'transfer') {
        setBankInfo(data.bankInstructions)
        // Refresh user so UI sees the pending wallet plan in account history
        if (user) refreshUser(user.id)
        return
      }
      // card / link → redirect to Viva hosted checkout
      window.location.href = data.paymentUrl
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  function handleStartPlan() {
    if (result.selectedMealCount === 0) return
    setErrMsg(null)
    if (!user) {
      setSignupOpen(true)
      return
    }
    void startPurchase()
  }

  async function handleSignupSendCode() {
    if (!suEmail || !suName) return
    setBusy(true)
    setErrMsg(null)
    const { ok, error } = await sendEmailOtp(suEmail.trim(), suName.trim())
    setBusy(false)
    if (!ok) { setErrMsg(error ?? 'Could not send code'); return }
    setSignupStep('verify')
  }

  async function handleSignupVerify() {
    if (suOtp.length !== 6) return
    setBusy(true)
    setErrMsg(null)
    const { ok, error } = await verifyEmailOtp(suEmail.trim(), suOtp)
    setBusy(false)
    if (!ok) { setErrMsg(error ?? 'Invalid code'); return }
    setSignupStep('phone')
  }

  async function handleSignupComplete() {
    if (!suPhone) return
    setBusy(true)
    setErrMsg(null)
    const { ok, error } = await savePhoneToProfile(suPhone.trim())
    if (!ok) { setBusy(false); setErrMsg(error ?? 'Could not save phone'); return }

    // Refresh user so the auth-required purchase call sees us as logged in
    const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession()
    if (session?.user?.id) await refreshUser(session.user.id)

    setSignupOpen(false)
    void startPurchase()
  }

  /* ── Derived sidebar values ────────────────────────────────── */
  const subtotal = result.periodPriceBeforeDiscount
  const discountAmt = subtotal - result.amountToPay
  const total = result.amountToPay
  const goalCard = GOAL_CARDS.find((g) => g.id === goal)!

  /* ════════════════════════════════════════════════════════════ */
  return (
    <div className="wpv2-page">

      {/* ── Header ───────────────────────────────────── */}
      <div className="wpv2-h">
        <button className="wpv2-back" onClick={closeWalletPage}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {isEl ? 'Πίσω στο μενού' : 'Back to menu'}
        </button>
        <h1 className="wpv2-h-title">{isEl ? 'Φτιάξε το πλάνο σου' : 'Build your plan'}</h1>
        <p className="wpv2-h-sub">
          {isEl
            ? 'Επίλεξε στόχο, γεύματα και διάρκεια — εμείς φροντίζουμε τα υπόλοιπα.'
            : 'Pick your goal, meals and duration — we handle the rest.'}
        </p>
        <button className="wpv2-h-cta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l18-7-7 18-2-8-9-3z"/>
          </svg>
          {isEl ? 'Δες το δείγμα μενού' : 'See sample menu'}
        </button>
      </div>

      {/* ── Two-column grid ──────────────────────────── */}
      <div className="wpv2-grid">

        {/* ── MAIN COLUMN ──────────────────────────── */}
        <div className="wpv2-main">

          {/* SECTION 1 · Goal */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">1</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Πες μας τον στόχο σου' : 'Tell us your goal'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Θα ρυθμίσουμε τα macros και το θερμιδικό προφίλ του πλάνου σου.' : 'We\'ll tune your macros and calorie profile.'}
                </div>
              </div>
            </div>
            <div className="wpv2-goals">
              {GOAL_CARDS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`wpv2-goal${goal === g.id ? ' sel' : ''}`}
                  onClick={() => setGoal(g.id)}
                >
                  <img className="wpv2-goal-img" src={g.img} alt={isEl ? g.nameEl : g.nameEn} loading="lazy" />
                  <div className="wpv2-goal-body">
                    <div className="wpv2-goal-name">{isEl ? g.nameEl : g.nameEn}</div>
                    <div className="wpv2-goal-desc">{isEl ? g.descEl : g.descEn}</div>
                  </div>
                  <div className="wpv2-goal-check">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* SECTION 2 · Profile */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">2</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Πες μας λίγα για σένα' : 'Tell us about you'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Για να υπολογίσουμε με ακρίβεια τις διατροφικές σου ανάγκες.' : 'So we can calculate your nutrition needs accurately.'}
                </div>
              </div>
            </div>

            <div className="wpv2-profile-row r2">
              <div className="wpv2-field">
                <span className="wpv2-label">{isEl ? 'Φύλο' : 'Sex'}</span>
                <div className="wpv2-seg">
                  {(['female', 'male'] as Sex[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`wpv2-seg-opt${sex === s ? ' sel' : ''}`}
                      onClick={() => setSex(s)}
                    >{isEl ? (s === 'female' ? 'Γυναίκα' : 'Άνδρας') : (s === 'female' ? 'Female' : 'Male')}</button>
                  ))}
                </div>
              </div>
              <div className="wpv2-field">
                <span className="wpv2-label">{isEl ? 'Ηλικία' : 'Age'}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="wpv2-input"
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  onBlur={() => setAge(String(clampInt(age, 14, 100, 30)))}
                  placeholder="30"
                />
              </div>
            </div>

            <div className="wpv2-profile-row r2">
              <div className="wpv2-field">
                <span className="wpv2-label">{isEl ? 'Ύψος (cm)' : 'Height (cm)'}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="wpv2-input"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  onBlur={() => setHeightCm(String(clampInt(heightCm, 120, 230, 170)))}
                  placeholder="170"
                />
              </div>
              <div className="wpv2-field">
                <span className="wpv2-label">{isEl ? 'Βάρος (kg)' : 'Weight (kg)'}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="wpv2-input"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  onBlur={() => setWeightKg(String(clampInt(weightKg, 35, 250, 70)))}
                  placeholder="70"
                />
              </div>
            </div>

            <div className="wpv2-profile-row">
              <div className="wpv2-field">
                <span className="wpv2-label">{isEl ? 'Επίπεδο δραστηριότητας' : 'Activity level'}</span>
                <div className="wpv2-activity">
                  {(['sedentary', 'light', 'moderate', 'active', 'very_active'] as ActivityLevel[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`wpv2-activity-opt${activity === a ? ' sel' : ''}`}
                      onClick={() => setActivity(a)}
                    >
                      <div className="wpv2-activity-name">{ACTIVITY_LABELS[a][lang]}</div>
                      <div className="wpv2-activity-sub">{ACTIVITY_LABELS[a].sub[lang]}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 3 · Macros (computed) */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">3</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Το διατροφικό σου προφίλ' : 'Your nutrition profile'}
                </div>
                <div className="wpv2-section-sub">
                  {result.dailyKcal} kcal / {isEl ? 'ημέρα' : 'day'} · {isEl ? 'υπολογίζεται από το προφίλ + στόχο σου' : 'derived from your profile + goal'}
                </div>
              </div>
            </div>
            <div className="wpv2-macros">
              <div className="wpv2-macro carbs">
                <div className="wpv2-macro-label">{isEl ? 'ΥΔΑΤΑΝΘΡΑΚΕΣ' : 'CARBS'}</div>
                <div className="wpv2-macro-val">{result.macroSplitPct.c}<small>%</small></div>
                <div className="wpv2-macro-bar">
                  <div className="wpv2-macro-bar-fill" style={{ width: `${result.macroSplitPct.c}%` }} />
                </div>
                <div className="wpv2-macro-grams">{result.macroGramsPerDay.c} g / {isEl ? 'ημέρα' : 'day'}</div>
              </div>
              <div className="wpv2-macro protein">
                <div className="wpv2-macro-label">{isEl ? 'ΠΡΩΤΕΪΝΗ' : 'PROTEIN'}</div>
                <div className="wpv2-macro-val">{result.macroSplitPct.p}<small>%</small></div>
                <div className="wpv2-macro-bar">
                  <div className="wpv2-macro-bar-fill" style={{ width: `${result.macroSplitPct.p}%` }} />
                </div>
                <div className="wpv2-macro-grams">{result.macroGramsPerDay.p} g / {isEl ? 'ημέρα' : 'day'}</div>
              </div>
              <div className="wpv2-macro fat">
                <div className="wpv2-macro-label">{isEl ? 'ΛΙΠΑΡΑ' : 'FAT'}</div>
                <div className="wpv2-macro-val">{result.macroSplitPct.f}<small>%</small></div>
                <div className="wpv2-macro-bar">
                  <div className="wpv2-macro-bar-fill" style={{ width: `${result.macroSplitPct.f}%` }} />
                </div>
                <div className="wpv2-macro-grams">{result.macroGramsPerDay.f} g / {isEl ? 'ημέρα' : 'day'}</div>
              </div>
            </div>
          </section>

          {/* SECTION 4 · Meals */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">4</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Επίλεξε τα γεύματα που χρειάζεσαι' : 'Pick the meals you need'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl
                    ? 'Όσα δεν επιλέξεις, δεν χρεώνονται — και δεν αναπληρώνονται από άλλα γεύματα.'
                    : "Meals you don't pick aren't charged — and aren't redistributed to other meals."}
                </div>
              </div>
            </div>
            <div className="wpv2-meals">
              {(['breakfast', 'lunch', 'dinner', 'snack'] as MealKey[]).map((m) => {
                const sel = meals[m]
                return (
                  <button
                    key={m}
                    type="button"
                    className={`wpv2-meal${sel ? ' sel' : ''}`}
                    onClick={() => toggleMeal(m)}
                  >
                    <span className="wpv2-meal-check">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </span>
                    <span className="wpv2-meal-emoji">{MEAL_LABELS[m].emoji}</span>
                    <span className="wpv2-meal-name">{MEAL_LABELS[m][lang]}</span>
                  </button>
                )
              })}
            </div>
            {result.selectedMealCount === 0 && (
              <div className="wpv2-meals-warn">{isEl ? 'Διάλεξε τουλάχιστον ένα γεύμα.' : 'Pick at least one meal.'}</div>
            )}
          </section>

          {/* SECTION 5 · Frequency */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">5</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Πόσο συχνά θα τρως Fitpal' : 'How often will you eat Fitpal'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Επίλεξε πόσες ημέρες την εβδομάδα θέλεις να λαμβάνεις τα γεύματά σου.' : 'How many days a week do you want delivery.'}
                </div>
              </div>
            </div>
            <div className="wpv2-freq">
              {FREQ_CARDS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`wpv2-freq-opt${daysPerWeek === f.id ? ' sel' : ''}`}
                  onClick={() => setDaysPerWeek(f.id)}
                >
                  <span className="wpv2-freq-radio" />
                  <div>
                    <div className="wpv2-freq-name">{isEl ? f.nameEl : f.nameEn}</div>
                    <div className="wpv2-freq-sub">{isEl ? f.subEl : f.subEn}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* SECTION 6 · Plan length */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">6</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Διάρκεια πλάνου' : 'Plan duration'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Μεγαλύτερη διάρκεια = μεγαλύτερη έκπτωση.' : 'Longer plan = bigger discount.'}
                </div>
              </div>
            </div>
            <div className="wpv2-lengths">
              {PLAN_LENGTH_CARDS.map((pl) => {
                const disc = DEFAULT_WALLET_SETTINGS.discountMatrix[pl.id][daysPerWeek] ?? 0
                return (
                  <button
                    key={pl.id}
                    type="button"
                    className={`wpv2-length${planLength === pl.id ? ' sel' : ''}`}
                    onClick={() => setPlanLength(pl.id)}
                  >
                    <span className={`wpv2-length-badge ${pl.badge.cls}`}>{isEl ? pl.badge.el : pl.badge.en}</span>
                    <div className="wpv2-length-name">{isEl ? pl.nameEl : pl.nameEn}</div>
                    <div className="wpv2-length-sub">{isEl ? pl.daysLabel.el : pl.daysLabel.en}</div>
                    <div className={`wpv2-length-disc${disc === 0 ? ' none' : ''}`}>
                      {disc === 0
                        ? (isEl ? 'Χωρίς έκπτωση' : 'No discount')
                        : `−${Math.round(disc * 100)}% ${isEl ? 'έκπτωση' : 'off'}`}
                    </div>
                    <div className="wpv2-length-check">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* SECTION 7 · Services */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">7</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Πρόσθεσε υπηρεσίες' : 'Add services'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Προσαρμόσε το πλάνο σου με επιπλέον υπηρεσίες.' : 'Customize your plan with extra services.'}
                </div>
              </div>
            </div>
            <div className="wpv2-services">
              <button
                type="button"
                className={`wpv2-service${dieticianManaged ? ' sel' : ''}`}
                onClick={() => setDieticianManaged((v) => !v)}
              >
                <span className="wpv2-service-cb">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <div className="wpv2-service-body">
                  <div className="wpv2-service-name">
                    {isEl ? 'Διαχείριση από διαιτολόγο' : 'Dietician-managed ordering'}
                  </div>
                  <div className="wpv2-service-desc">
                    {isEl
                      ? 'Ο διαιτολόγος μας μπαίνει εβδομαδιαία και παραγγέλνει για σένα — χωρίς κόπο.'
                      : 'Our dietician logs in each week and orders for you — zero effort.'}
                  </div>
                </div>
                <div className="wpv2-service-price">{isEl ? 'Δωρεάν' : 'Free'}</div>
              </button>
            </div>
          </section>

        </div>

        {/* ── ASIDE / STICKY SIDEBAR ───────────────── */}
        <aside className="wpv2-aside">
          <div className="wpv2-aside-card">

            <div>
              <div className="wpv2-aside-h">{isEl ? 'Περίληψη πλάνου' : 'Plan summary'}</div>
              <div className="wpv2-aside-sub" style={{ marginTop: 4 }}>
                {isEl ? 'Όλες οι τιμές σε Ευρώ, με ΦΠΑ.' : 'All prices in EUR, VAT included.'}
              </div>
            </div>

            <button className="wpv2-aside-menu-cta">
              <div className="wpv2-aside-menu-cta-l">
                <span className="wpv2-aside-menu-cta-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11l18-7-7 18-2-8-9-3z"/>
                  </svg>
                </span>
                <div className="wpv2-aside-menu-cta-text">
                  {isEl ? 'Δες το δείγμα μενού' : 'See sample menu'}
                  <small>{isEl ? 'Γεύματα που θα λαμβάνεις' : 'Meals you\'ll receive'}</small>
                </div>
              </div>
              <svg className="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>

            <div className="wpv2-aside-plan">
              <span className="wpv2-aside-plan-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3-3.6 19.4-8.2 17.04Z"/>
                  <path d="M2 21c0-3 1.85-5.36 5.08-6"/>
                </svg>
              </span>
              <div className="wpv2-aside-plan-name">
                {isEl ? 'Πλάνο' : 'Plan'} · {isEl ? goalCard.nameEl : goalCard.nameEn}
                <small>{result.dailyKcal} kcal / {isEl ? 'ημέρα' : 'day'}</small>
              </div>
            </div>

            <div className="wpv2-aside-rows">
              <div className="wpv2-aside-row">
                <span className="wpv2-aside-row-lbl">{isEl ? 'Γεύματα' : 'Meals'}</span>
                <span className="wpv2-aside-row-val">{result.selectedMealCount} × {Math.round(result.daysCovered)} {isEl ? 'ημέρες' : 'days'}</span>
              </div>
              <div className="wpv2-aside-row">
                <span className="wpv2-aside-row-lbl">{isEl ? 'Ημερήσιο κόστος' : 'Daily cost'}</span>
                <span className="wpv2-aside-row-val">{fmtEur(result.dailyPrice)}</span>
              </div>
              <div className="wpv2-aside-divider" />
              <div className="wpv2-aside-row">
                <span className="wpv2-aside-row-lbl">{isEl ? 'Υποσύνολο' : 'Subtotal'}</span>
                <span className="wpv2-aside-row-val">{fmtEur(subtotal)}</span>
              </div>
              {result.discountPct > 0 && (
                <div className="wpv2-aside-row discount">
                  <span className="wpv2-aside-row-lbl">{isEl ? 'Έκπτωση' : 'Discount'} ({Math.round(result.discountPct * 100)}%)</span>
                  <span className="wpv2-aside-row-val">−{fmtEur(discountAmt)}</span>
                </div>
              )}
            </div>

            <div className="wpv2-aside-voucher">
              <input
                type="text"
                placeholder={isEl ? 'Κωδικός προσφοράς' : 'Voucher code'}
                value={voucher}
                onChange={(e) => setVoucher(e.target.value)}
              />
              <button type="button">{isEl ? 'Εφαρμογή' : 'Apply'}</button>
            </div>

            <div className="wpv2-aside-divider" />

            <div className="wpv2-aside-total">
              <span className="wpv2-aside-total-lbl">{isEl ? 'Σύνολο' : 'Total'}</span>
              <span className="wpv2-aside-total-val">{fmtEur(total)}</span>
            </div>

            {result.bonusCredits > 0 && (
              <div className="wpv2-aside-credits">
                {isEl
                  ? <>Πιστώνεται στο wallet σου: <b>{fmtEur(result.walletCredit)}</b> ({fmtEur(result.bonusCredits)} bonus credits)</>
                  : <>Credits added to your wallet: <b>{fmtEur(result.walletCredit)}</b> ({fmtEur(result.bonusCredits)} bonus credits)</>}
              </div>
            )}

            {/* Payment method picker */}
            <div className="wpv2-paymethods">
              <div className="wpv2-paymethods-label">{isEl ? 'Τρόπος πληρωμής' : 'Payment method'}</div>
              <div className="wpv2-paymethods-grid">
                {(['card','link','transfer'] as PaymentMethod[]).map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    className={`wpv2-paymethod${paymentMethod === pm ? ' sel' : ''}`}
                    onClick={() => setPaymentMethod(pm)}
                  >
                    {pm === 'card'     && (isEl ? 'Κάρτα'        : 'Card')}
                    {pm === 'link'     && (isEl ? 'Σύνδεσμος'    : 'Payment link')}
                    {pm === 'transfer' && (isEl ? 'Έμβασμα'      : 'Bank transfer')}
                  </button>
                ))}
              </div>
              {paymentMethod === 'link' && (
                <div className="wpv2-paymethods-hint">
                  {isEl ? 'Θα σου στείλουμε σύνδεσμο πληρωμής στο email.' : 'We\'ll email you a payment link.'}
                </div>
              )}
              {paymentMethod === 'transfer' && (
                <div className="wpv2-paymethods-hint">
                  {isEl ? 'Το πλάνο θα ενεργοποιηθεί όταν λάβουμε το έμβασμα.' : 'The plan activates when we receive your transfer.'}
                </div>
              )}
            </div>

            {errMsg && (
              <div className="wpv2-aside-err">{errMsg}</div>
            )}

            <button
              className="wpv2-aside-cta"
              onClick={handleStartPlan}
              disabled={result.selectedMealCount === 0 || busy}
            >
              {busy
                ? (isEl ? 'Παρακαλώ περίμενε…' : 'Please wait…')
                : user
                  ? (isEl ? 'Συνέχεια προς πληρωμή' : 'Continue to payment')
                  : (isEl ? 'Δημιουργία λογαριασμού & πληρωμή' : 'Create account & continue')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>

            {signupOpen && !user && (
              <div className="wpv2-signup">
                <div className="wpv2-signup-h">
                  {isEl ? 'Δημιούργησε λογαριασμό για το wallet σου' : 'Create your account to receive your wallet'}
                </div>

                {signupStep === 'identity' && (
                  <>
                    <div className="wpv2-signup-field">
                      <label>{isEl ? 'Ονοματεπώνυμο' : 'Full name'}</label>
                      <input
                        type="text"
                        value={suName}
                        onChange={(e) => setSuName(e.target.value)}
                        placeholder={isEl ? 'Το όνομά σου' : 'Your name'}
                      />
                    </div>
                    <div className="wpv2-signup-field">
                      <label>Email</label>
                      <input
                        type="email"
                        value={suEmail}
                        onChange={(e) => setSuEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <button className="wpv2-signup-btn" onClick={handleSignupSendCode} disabled={!suName || !suEmail || busy}>
                      {isEl ? 'Στείλε μου κωδικό' : 'Send me a code'}
                    </button>
                  </>
                )}

                {signupStep === 'verify' && (
                  <>
                    <div className="wpv2-signup-note">
                      {isEl ? `Στείλαμε 6-ψήφιο κωδικό στο ${suEmail}` : `We sent a 6-digit code to ${suEmail}`}
                    </div>
                    <div className="wpv2-signup-field">
                      <label>{isEl ? 'Κωδικός' : 'Code'}</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={suOtp}
                        onChange={(e) => setSuOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        autoComplete="one-time-code"
                      />
                    </div>
                    <button className="wpv2-signup-btn" onClick={handleSignupVerify} disabled={suOtp.length !== 6 || busy}>
                      {isEl ? 'Επαλήθευση' : 'Verify'}
                    </button>
                    <button className="wpv2-signup-resend" type="button" onClick={() => setSignupStep('identity')}>
                      {isEl ? 'Στείλε ξανά' : 'Resend'}
                    </button>
                  </>
                )}

                {signupStep === 'phone' && (
                  <>
                    <div className="wpv2-signup-note">
                      {isEl ? '✓ Email επιβεβαιωμένο. Πρόσθεσε κινητό για τον οδηγό μας.' : '✓ Email verified. Add a mobile for our delivery driver.'}
                    </div>
                    <div className="wpv2-signup-field">
                      <label>{isEl ? 'Κινητό' : 'Mobile'}</label>
                      <input
                        type="tel"
                        value={suPhone}
                        onChange={(e) => setSuPhone(e.target.value)}
                        placeholder="+30 69..."
                      />
                    </div>
                    <button className="wpv2-signup-btn" onClick={handleSignupComplete} disabled={!suPhone || busy}>
                      {isEl ? 'Συνέχεια στην πληρωμή' : 'Continue to payment'}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="wpv2-aside-trust">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              {isEl ? 'Ασφαλής πληρωμή · Δωρεάν παράδοση Αττική & Θεσσαλονίκη' : 'Secure payment · Free delivery in Attica & Thessaloniki'}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Bank-transfer success overlay ─────────────── */}
      {bankInfo && (
        <div className="wpv2-bank-overlay" onClick={() => setBankInfo(null)}>
          <div className="wpv2-bank-card" onClick={(e) => e.stopPropagation()}>
            <h3>{isEl ? 'Πλάνο δημιουργήθηκε ✓' : 'Plan created ✓'}</h3>
            <p>
              {isEl
                ? 'Το πλάνο σου είναι σε αναμονή. Στείλε έμβασμα στα παρακάτω στοιχεία και θα ενεργοποιηθεί εντός 1 εργάσιμης ημέρας.'
                : 'Your plan is pending. Wire the amount below and it will activate within 1 business day.'}
            </p>
            <dl className="wpv2-bank-details">
              <dt>IBAN</dt>          <dd>{bankInfo.iban}</dd>
              <dt>{isEl ? 'Δικαιούχος' : 'Beneficiary'}</dt> <dd>{bankInfo.beneficiary}</dd>
              <dt>{isEl ? 'Αιτιολογία' : 'Reference'}</dt>   <dd>{bankInfo.reference}</dd>
              <dt>{isEl ? 'Ποσό'       : 'Amount'}</dt>      <dd>{fmtEur(result.amountToPay)}</dd>
            </dl>
            <button className="wpv2-bank-close" onClick={() => setBankInfo(null)}>
              {isEl ? 'Κλείσιμο' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
