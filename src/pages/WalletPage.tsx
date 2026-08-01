import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { calculateWalletPlan, durationDiscountPct, daysDiscountPct, mealsDiscountPct } from '../lib/wallet/calculator'
import { loadWalletSettingsFromDb } from '../lib/wallet/loadSettingsClient'
import type { WalletSettings } from '../lib/wallet/types'
import { DEFAULT_WALLET_SETTINGS, ACTIVITY_LABELS, MEAL_LABELS, lipometrisiFeeCents, LIPOMETRISI_FEE_CENTS } from '../lib/wallet/constants'
import { MealIcon } from '../components/icons/MealIcon'
import { GoalCardArt } from '../components/icons/GoalIllustration'
import type { ActivityLevel, DaysPerWeek, Goal, MealsSelection, PaymentMethod, PlanLength, Sex, MealKey } from '../lib/wallet/types'
import { purchaseWalletPlan, sendEmailOtp, verifyEmailOtp, savePhoneToProfile } from '../lib/api/walletPlan'
import { DemoDishesModal } from '../components/wallet/DemoDishesModal'
import { DietPicker, type DietSelection } from '../components/wallet/DietPicker'
import { StartDatePicker } from '../components/wallet/StartDatePicker'
import { IndicativeAddressGate, type IndicativeAddress } from '../components/wallet/IndicativeAddressGate'
import { saveProfileAllergies, saveProfileAvoidedIngredients } from '../lib/api/diet'
import { useMenuStore } from '../store/useMenuStore'
import { supabase } from '../lib/supabase'
import { MacroIcon } from '../components/ui/MacroDots'
import { CopyButton } from '../components/ui/CopyButton'
import { isValidGreekVat, vatDigits } from '../lib/vat'

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
    nameEl: 'Απώλεια Βάρους',
    nameEn: 'Weight Loss',
    descEl: 'Ισορροπημένα γεύματα με έλλειμμα θερμίδων',
    descEn: 'Balanced meals with a calorie deficit',
    img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80',
  },
  {
    id: 'maintain',
    nameEl: 'Διατήρηση Βάρους',
    nameEn: 'Weight Maintenance',
    descEl: 'Υγιεινά γεύματα για την καθημερινή ρουτίνα',
    descEn: 'Healthy meals for your daily routine',
    img: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=80',
  },
  {
    id: 'gain',
    nameEl: 'Αύξηση Μυϊκής Μάζας',
    nameEn: 'Muscle Gain',
    descEl: 'Γεύματα υψηλά σε πρωτεΐνη για δύναμη και αντοχή',
    descEn: 'High-protein meals for strength and endurance',
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

// WEC-338 follow-up — small inline SVG per activity level. Stroke-based so
// they inherit the surrounding text colour and recolour on .sel state.
function ActivityIcon({ level }: { level: ActivityLevel }) {
  const props = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const, 'aria-hidden': true,
  }
  switch (level) {
    case 'sedentary':
      return (
        <svg {...props}>
          {/* armchair — desk-bound */}
          <path d="M4 11V8a2 2 0 012-2h12a2 2 0 012 2v3" />
          <path d="M2 13a2 2 0 012-2h16a2 2 0 012 2v4H2v-4z" />
          <path d="M6 17v3M18 17v3" />
        </svg>
      )
    case 'light':
      return (
        <svg {...props}>
          {/* walking person */}
          <circle cx="13" cy="4" r="2" />
          <path d="M9 20l3-6 4 2v-5l-3-4-3 2-2 4" />
        </svg>
      )
    case 'moderate':
      return (
        <svg {...props}>
          {/* jogger */}
          <circle cx="14" cy="4" r="2" />
          <path d="M4 22l5-3 1-4-3-2 3-5 4 2 2 2 4 1" />
          <path d="M14 14l1 6" />
        </svg>
      )
    case 'active':
      return (
        <svg {...props}>
          {/* cycling */}
          <circle cx="5" cy="18" r="3" />
          <circle cx="19" cy="18" r="3" />
          <path d="M12 18l-2-6 4-2 3 4h2" />
          <circle cx="16" cy="5" r="1.5" />
        </svg>
      )
    case 'very_active':
      return (
        <svg {...props}>
          {/* dumbbell */}
          <path d="M6 8v8M3 10v4M18 8v8M21 10v4" />
          <rect x="6" y="11" width="12" height="2" rx="0.5" />
        </svg>
      )
  }
}

// MealIcon now lives in src/components/icons/MealIcon.tsx — shared component,
// Fitpal-set: coffee cup / place setting / cloche / wrapped bar. Linear,
// monochrome, currentColor. The earlier WEC-360 time-of-day (sunrise / sun
// / moon / apple) and food-based (mug / plate / bowl / apple) sets were
// stepping stones — the current art was hand-picked by Ioustinos from the
// curated icon kit.

const FREQ_CARDS: Array<{ id: DaysPerWeek; nameEl: string; nameEn: string; subEl: string; subEn: string }> = [
  { id: 4, nameEl: '4 ημέρες', nameEn: '4 days', subEl: 'Δευ–Πεμ',         subEn: 'Mon–Thu' },
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
  // Dietitian management is mandatory (the section-10 card is locked on), so
  // the value is fixed — no setter needed.
  const [dieticianManaged] = useState(DEFAULTS.dieticianManaged)
  // WEC-360: optional body-fat measurement (λιπομέτρηση). Selectable, but the
  // price + total-integration are intentionally NOT wired yet — pending a
  // confirmed price from Ioustinos and server-side support. UI-only for now.
  const [bodyFat, setBodyFat] = useState(false)

  // WEC-360: receipt (απόδειξη) vs invoice (τιμολόγιο) — mirrors the regular
  // checkout's ExtrasSection. invoice=false → plain receipt. invoice=true →
  // collect company/name + 9-digit Greek VAT (validated via src/lib/vat).
  const [wantInvoice, setWantInvoice] = useState(false)
  const [invoiceName, setInvoiceName] = useState('')
  const [invoiceVat, setInvoiceVat] = useState('')
  const vatBad = wantInvoice && invoiceVat.length > 0 && (invoiceVat.length !== 9 || !isValidGreekVat(invoiceVat))

  /* ── Live wallet settings (WEC-433) ──────────────────────────
     Fetched once on mount from the public `settings` table. While loading
     we use the bundled DEFAULT_WALLET_SETTINGS so the page renders
     immediately; the real values arrive within one round-trip and the
     `useMemo` below re-runs.
     Server is the authoritative pricing point — this just keeps the
     customer-visible preview honest. */
  const [walletSettings, setWalletSettings] = useState<WalletSettings>(DEFAULT_WALLET_SETTINGS)
  useEffect(() => {
    let cancelled = false
    void loadWalletSettingsFromDb().then((s) => { if (!cancelled) setWalletSettings(s) })
    return () => { cancelled = true }
  }, [])

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
  }, walletSettings), [sex, age, heightCm, weightKg, activity, goal, meals, planLength, daysPerWeek, dieticianManaged, walletSettings])

  /* ── Payment method (default card; transfer shows bank info) ─ */
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')

  /* ── Inline signup state ───────────────────────────────────── */
  // WEC-338: collapsed from 3 steps to 2 — phone is collected on the
  // identity screen alongside name + email, so the OTP-verify step is the
  // final form action before purchase.
  // WEC-582: subscription-wizard "demo dishes" showcase popup.
  const [demoOpen, setDemoOpen] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)
  const [signupStep, setSignupStep] = useState<'identity' | 'verify'>('identity')
  const [suName, setSuName] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [suOtp, setSuOtp] = useState('')
  const [suPhone, setSuPhone] = useState('')

  /* ── WEC-338: diet, start date, indicative address ──────────── */
  const [diet, setDiet] = useState<DietSelection>({ allergies: {}, ingredients: {} })
  const [startDate, setStartDate] = useState<string | null>(null)
  const [indAddr, setIndAddr] = useState<IndicativeAddress>({ street: '', area: '', zip: '' })
  const [indAddrInZone, setIndAddrInZone] = useState(false)

  /* Memoise the validity callback so the gate doesn't fire onValidityChange
     on every parent re-render. */
  const handleAddrValidity = useCallback((v: boolean) => setIndAddrInZone(v), [])

  /* Hydrate diet from the signed-in user's existing prefs (WEC-250 catalogue
     gives us allergy labels; ingredient labels we look up on demand because
     useMenuStore only ships the dish→ingredient maps, not the names). */
  const dietCatalog = useMenuStore((s) => s.dietCatalog)
  useEffect(() => {
    if (!user || !dietCatalog) return
    const allergyIds = user.diet?.allergyIds ?? []
    const ingIds = user.diet?.avoidedIngredientIds ?? []
    if (allergyIds.length === 0 && ingIds.length === 0) return

    // Allergies: labels come straight from the catalogue.
    const allergyMap: DietSelection['allergies'] = {}
    for (const aId of allergyIds) {
      const def = dietCatalog.allergies.find((a) => a.id === aId)
      if (def) allergyMap[aId] = { nameEl: def.nameEl, nameEn: def.nameEn }
    }

    // Ingredient labels aren't pre-loaded; one round-trip is fine.
    let cancelled = false
    void (async () => {
      let ingMap: DietSelection['ingredients'] = {}
      if (ingIds.length > 0) {
        const { data } = await supabase
          .from('ingredients')
          .select('id, name_el, name_en')
          .in('id', ingIds)
        if (!cancelled && data) {
          ingMap = Object.fromEntries(
            (data as Array<{ id: string; name_el: string; name_en: string | null }>).map((r) => [
              r.id,
              { nameEl: r.name_el, nameEn: r.name_en },
            ]),
          )
        }
      }
      if (!cancelled) setDiet({ allergies: allergyMap, ingredients: ingMap })
    })()
    return () => { cancelled = true }
  }, [user, dietCatalog])

  /* ── Async/error state ─────────────────────────────────────── */
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [bankInfo, setBankInfo] = useState<{ iban: string; beneficiary: string; reference: string } | null>(null)
  // WEC-554: cash (Αντικαταβολή) success overlay — "pay on first delivery".
  const [cashInfo, setCashInfo] = useState<{ reference: string } | null>(null)

  // WEC-508: the coupon input that lived here was a dead stub — value never
  // read, Apply had no onClick, the server accepted no voucher field. Removed
  // rather than left misleading customers into typing codes that do nothing.
  // Re-add TOGETHER with the full money path (client apply + server validation
  // against vouchers/voucher_uses + reduced Viva charge + stacking policy vs
  // the plan-length discount) — design questions tracked on WEC-508.

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
      // WEC-553: send the λιπομέτρηση flag; the server prices it (never trusts client).
      services: { dieticianManaged, bodyFatMeasurement: bodyFat },
    }
  }

  /** Persist diet prefs (allergies + avoided ingredients) for the signed-in user.
   *  Fire-and-forget — errors are non-fatal (user can re-save from Account → Preferences). */
  async function persistDiet(userId: string) {
    const allergyIds = Object.keys(diet.allergies)
    const ingIds = Object.keys(diet.ingredients)
    try {
      await Promise.all([
        saveProfileAllergies(userId, allergyIds),
        saveProfileAvoidedIngredients(userId, ingIds),
      ])
    } catch {
      // Non-fatal — purchase should still proceed.
    }
  }

  /** WEC-433: server-side quote → confirm-price modal state.
   *  Customer sees `result.priceTotal` from the client-side calculator
   *  (using fetched settings). Before redirecting to Viva we hit the
   *  authoritative server quote. If the cents differ at all, we surface
   *  the new figure and require an explicit re-click so the customer
   *  never gets a surprise charge. */
  const [priceConfirm, setPriceConfirm] = useState<{ serverCents: number; clientCents: number } | null>(null)

  /** Fire the real /api/wallet-plan-purchase call. Assumes a session exists. */
  async function startPurchase(opts: { skipQuoteCheck?: boolean } = {}) {
    setBusy(true)
    setErrMsg(null)
    try {
      // Persist diet prefs in parallel with the purchase call so a slow
      // diet write doesn't add user-visible latency.
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess?.session?.user?.id
      if (uid) void persistDiet(uid)

      // WEC-433: server-side quote-before-submit safety net. Skip on the
      // second click (the modal's "Confirm" button) so the customer can
      // proceed once they've acknowledged the new price.
      if (!opts.skipQuoteCheck) {
        try {
          const qRes = await fetch('/api/wallet-plan-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildInput()),
          })
          if (qRes.ok) {
            // wallet-plan-quote returns { result: WalletCalcResult, config: {...} }
            // where result.priceTotal is the total in EUROS (not cents).
            const q = await qRes.json() as { result?: { priceTotal?: number } }
            const serverCents = Math.round((q.result?.priceTotal ?? 0) * 100)
            const clientCents = Math.round(result.priceTotal * 100)
            if (serverCents > 0 && Math.abs(serverCents - clientCents) > 1) {
              setPriceConfirm({ serverCents, clientCents })
              setBusy(false)
              return
            }
          }
          // Quote endpoint failed — fall through. submit-order will recompute
          // server-side anyway; we'd rather let the customer pay than block
          // them on a transient API hiccup.
        } catch {
          /* network error — fall through */
        }
      }

      const { data, error } = await purchaseWalletPlan({ ...buildInput(), paymentMethod, lang })
      if (error || !data) { setErrMsg(error ?? 'Purchase failed'); return }

      if (data.paymentMethod === 'transfer') {
        setBankInfo(data.bankInstructions)
        // Refresh user so UI sees the pending wallet plan in account history
        if (user) refreshUser(user.id)
        return
      }
      // WEC-554: cash (Αντικαταβολή) — no redirect, no bank details; show the
      // "pay on first delivery" confirmation. Plan stays pending until admin
      // marks it paid when the courier collects.
      if (data.paymentMethod === 'cash') {
        setCashInfo({ reference: data.reference })
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
    if (result.selectedMealCount < 2) return // WEC-551 O1 — min 2 meals
    if (!indAddrInZone) return
    setErrMsg(null)
    if (!user) {
      setSignupOpen(true)
      return
    }
    void startPurchase()
  }

  // WEC-338: identity step now also requires phone — we collect everything
  // in one shot, then OTP-verify. Saves a step over the prior 3-step flow.
  async function handleSignupSendCode() {
    if (!suEmail || !suName || !suPhone) return
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
    if (!ok) { setBusy(false); setErrMsg(error ?? 'Invalid code'); return }

    // OTP verified — write phone to profile, then refresh + purchase.
    // savePhoneToProfile is idempotent; failure here shouldn't block the
    // purchase (user can fix the phone later from Account → Profile).
    const phoneRes = await savePhoneToProfile(suPhone.trim())
    if (!phoneRes.ok) {
      // eslint-disable-next-line no-console
      console.warn('[wallet signup] phone save failed:', phoneRes.error)
    }

    // Refresh user so the auth-required purchase call sees us as logged in.
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) await refreshUser(session.user.id)

    setBusy(false)
    setSignupOpen(false)
    void startPurchase()
  }

  /* ── Derived sidebar values ────────────────────────────────── */
  const subtotal = result.periodPriceBeforeDiscount
  const discountAmt = subtotal - result.amountToPay
  // WEC-553: λιπομέτρηση add-on fee (€ euros) — charged on top of the plan.
  const lipoFee = lipometrisiFeeCents(planLength, bodyFat) / 100
  const total = result.amountToPay + lipoFee
  const goalCard = GOAL_CARDS.find((g) => g.id === goal)!

  // WEC-583: discount split (display-only, config-driven — see calculator.ts).
  // duration + days + meals === result.discountPct (pre-clamp).
  const durPct = Math.round(durationDiscountPct(walletSettings, planLength) * 100)
  const dayPct = Math.round(daysDiscountPct(walletSettings, planLength, daysPerWeek) * 100)
  const mealPct = Math.round(mealsDiscountPct(walletSettings, result.selectedMealCount) * 100)
  // Which selected meals earn the meals-count bonus: the 3rd/4th selected (in a
  // fixed order), so the per-option badges sum to the total meals component.
  const mealStepPct = Math.round((walletSettings.mealsExtraDiscount ?? 0.02) * 100)
  const earningMeals = (() => {
    const set = new Set<MealKey>()
    let seen = 0
    for (const m of ['breakfast', 'lunch', 'dinner', 'snack'] as MealKey[]) {
      if (meals[m]) { seen++; if (seen > 2) set.add(m) }
    }
    return set
  })()

  /* ════════════════════════════════════════════════════════════ */
  return (
    <div className="wpv2-page">

      {/* WEC-582: demo-dishes showcase popup (opened from either «Δες μερικά πιάτα» CTA) */}
      <DemoDishesModal open={demoOpen} onClose={() => setDemoOpen(false)} isEl={isEl} />

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
        <button className="wpv2-h-cta" onClick={() => setDemoOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l18-7-7 18-2-8-9-3z"/>
          </svg>
          {isEl ? 'Δες μερικά πιάτα από το μενού μας' : 'See some dishes from our menu'}
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
                  <GoalCardArt goal={g.id} />
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
                  {isEl ? 'Πες μας λίγα λόγια για σένα' : 'Tell us a little about you'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Για να υπολογίσει η Διαιτολογική μας ομάδα με ακρίβεια τις διατροφικές σου ανάγκες.' : 'So our dietitian team can calculate your nutritional needs accurately.'}
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
                  {/* WEC-360: dropped 'very_active' — 4 tiers now (dietitian feedback). */}
                  {(['sedentary', 'light', 'moderate', 'active'] as ActivityLevel[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`wpv2-activity-opt${activity === a ? ' sel' : ''}`}
                      onClick={() => setActivity(a)}
                    >
                      <div className="wpv2-activity-ico"><ActivityIcon level={a} /></div>
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
                  {isEl ? 'Οι διατροφικές σου ανάγκες σύμφωνα με τους Διαιτολόγους μας' : 'Your nutritional needs, per our dietitians'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Υπολογίζονται από τον στόχο σου και τα ανθρωπομετρικά σου χαρακτηριστικά.' : 'Calculated from your goal and your anthropometric data.'}
                </div>
              </div>
            </div>

            {/* WEC-338 follow-up: kcal + 3 macros now share a single row.
                kcal gets ~33% of the width (1.5fr), each macro ~22% (1fr). */}
            <div className="wpv2-nutrition-row">
              <div className="wpv2-nutri kcal">
                <div className="wpv2-nutri-ico"><MacroIcon type="cal" /></div>
                <div className="wpv2-nutri-label">{isEl ? 'ΗΜΕΡΗΣΙΑ ΕΝΕΡΓΕΙΑ' : 'DAILY ENERGY'}</div>
                <div className="wpv2-nutri-val">
                  {result.dailyKcal}<small>kcal</small>
                </div>
                <div className="wpv2-nutri-sub">{isEl ? 'ανά ημέρα' : 'per day'}</div>
              </div>
              <div className="wpv2-nutri carbs">
                <div className="wpv2-nutri-ico"><MacroIcon type="carb" /></div>
                <div className="wpv2-nutri-label">{isEl ? 'ΥΔ/ΚΕΣ' : 'CARBS'}</div>
                <div className="wpv2-nutri-val">{result.macroSplitPct.c}<small>%</small></div>
                <div className="wpv2-nutri-bar">
                  <div className="wpv2-nutri-bar-fill" style={{ width: `${result.macroSplitPct.c}%` }} />
                </div>
                <div className="wpv2-nutri-sub">{result.macroGramsPerDay.c} g</div>
              </div>
              <div className="wpv2-nutri protein">
                <div className="wpv2-nutri-ico"><MacroIcon type="pro" /></div>
                <div className="wpv2-nutri-label">{isEl ? 'ΠΡΩΤ.' : 'PROTEIN'}</div>
                <div className="wpv2-nutri-val">{result.macroSplitPct.p}<small>%</small></div>
                <div className="wpv2-nutri-bar">
                  <div className="wpv2-nutri-bar-fill" style={{ width: `${result.macroSplitPct.p}%` }} />
                </div>
                <div className="wpv2-nutri-sub">{result.macroGramsPerDay.p} g</div>
              </div>
              <div className="wpv2-nutri fat">
                <div className="wpv2-nutri-ico"><MacroIcon type="fat" /></div>
                <div className="wpv2-nutri-label">{isEl ? 'ΛΙΠΑΡΑ' : 'FAT'}</div>
                <div className="wpv2-nutri-val">{result.macroSplitPct.f}<small>%</small></div>
                <div className="wpv2-nutri-bar">
                  <div className="wpv2-nutri-bar-fill" style={{ width: `${result.macroSplitPct.f}%` }} />
                </div>
                <div className="wpv2-nutri-sub">{result.macroGramsPerDay.f} g</div>
              </div>
            </div>

            {/* WEC-360: scientific-credibility footnote. Cites the ACTUAL
                equation the calculator uses (Mifflin-St Jeor — see
                src/lib/wallet/calculator.ts), not Schofield. */}
            <p className="wpv2-nutri-footnote">
              {isEl
                ? '* Για τον υπολογισμό του Βασικού Μεταβολικού Ρυθμού χρησιμοποιήθηκε η εξίσωση Mifflin-St Jeor.'
                : '* Basal Metabolic Rate is calculated using the Mifflin-St Jeor equation.'}
            </p>
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
                    <span className="wpv2-meal-ico"><MealIcon meal={m} /></span>
                    <span className="wpv2-meal-text">
                      <span className="wpv2-meal-name">{MEAL_LABELS[m][lang]}</span>
                      <span className="wpv2-meal-kcal">{result.perMeal[m].kcal} kcal</span>
                    </span>
                    {/* WEC-583: this meal earns the extra-meals discount (3rd/4th selected). */}
                    {earningMeals.has(m) && mealStepPct > 0 && <span className="wpv2-meal-disc">+{mealStepPct}%</span>}
                  </button>
                )
              })}
            </div>
            {result.selectedMealCount < 2 ? (
              // WEC-551 O1 — a plan needs at least 2 meals/day to be worthwhile.
              <div className="wpv2-meals-warn">{isEl ? 'Διάλεξε τουλάχιστον 2 γεύματα.' : 'Pick at least 2 meals.'}</div>
            ) : (() => {
              // Sum kcal across selected meals, then % of the user's daily target.
              const selectedKcal = (['breakfast', 'lunch', 'dinner', 'snack'] as MealKey[])
                .filter((m) => meals[m])
                .reduce((sum, m) => sum + result.perMeal[m].kcal, 0)
              const pct = result.dailyKcal > 0
                ? Math.round((selectedKcal / result.dailyKcal) * 100)
                : 0
              // WEC-552/583: extra-meals discount incentive (config-driven).
              const extraMealPct = mealPct
              return (
                <div className="wpv2-meals-summary">
                  {isEl
                    ? <>{selectedKcal} kcal · <strong>{pct}%</strong> των ημερήσιων αναγκών σου</>
                    : <>{selectedKcal} kcal · <strong>{pct}%</strong> of your daily intake</>}
                  {extraMealPct > 0 && (
                    <span className="wpv2-meals-discount">
                      {isEl ? <> · <strong>−{extraMealPct}%</strong> για επιπλέον γεύματα</> : <> · <strong>−{extraMealPct}%</strong> for extra meals</>}
                    </span>
                  )}
                </div>
              )
            })()}
          </section>

          {/* SECTION 5 · Frequency */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">5</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Πόσο συχνά θέλεις τα Fitpal Meals να φροντίζουν τη διατροφή σου;' : 'How often should Fitpal Meals take care of your nutrition?'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl ? 'Επίλεξε πόσες ημέρες την εβδομάδα θέλεις να λαμβάνεις τα γεύματά σου.' : 'How many days a week do you want delivery.'}
                </div>
              </div>
            </div>
            <div className="wpv2-freq">
              {FREQ_CARDS.map((f) => {
                // WEC-583: days/week discount component for this card (config-driven).
                const dPct = Math.round(daysDiscountPct(walletSettings, planLength, f.id) * 100)
                return (
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
                    {dPct > 0 && <span className="wpv2-freq-disc">+{dPct}%</span>}
                  </button>
                )
              })}
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
                // WEC-583: show ONLY the duration component here (no longer the
                // blended duration+days value). Days/meals are shown where earned.
                const disc = durationDiscountPct(walletSettings, pl.id)
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
                    {/* WEC-360: free-delivery incentive on the longer plans. */}
                    {(pl.id === '1mo' || pl.id === '3mo') && (
                      <div className="wpv2-length-perk">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                        </svg>
                        {isEl ? 'Δωρεάν Μεταφορικά' : 'Free delivery'}
                      </div>
                    )}
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

          {/* SECTION 7 · Allergies + disliked ingredients (WEC-338) */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">7</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Αλλεργίες & Υλικά που αποφεύγεις' : 'Allergies & ingredients you avoid'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl
                    ? 'Γράψε μας τα υλικά που δεν καταναλώνεις κι εμείς θα τα αποκλείσουμε από τα γεύματά σου.'
                    : 'Tell us the ingredients you don\'t eat and we\'ll exclude them from your meals.'}
                </div>
              </div>
            </div>
            <DietPicker lang={lang} value={diet} onChange={setDiet} />
          </section>

          {/* SECTION 8 · When to start (WEC-338) */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">8</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Πότε θέλεις να ξεκινήσεις;' : 'When would you like to start?'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl
                    ? 'Επίλεξε την πρώτη ημέρα που θα λάβεις τα γεύματά σου.'
                    : 'Pick the first day you would like deliveries.'}
                </div>
              </div>
            </div>
            <StartDatePicker lang={lang} value={startDate} onChange={setStartDate} />
          </section>

          {/* SECTION 9 · Indicative delivery address (WEC-338) */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">9</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Διεύθυνση Παράδοσης — Στα Fitpal Meals παραδίδουμε καθημερινά!' : 'Delivery address — Fitpal Meals delivers daily!'}
                </div>
                <div className="wpv2-section-sub">
                  {/* WEC-551 O5 — clarify the Τ.Κ. is only a zone check and the
                      real delivery address is chosen (and changeable) per day. */}
                  {isEl
                    ? 'Χρειαζόμαστε τον Τ.Κ. σου μόνο για να επιβεβαιώσουμε ότι παραδίδουμε στην περιοχή σου. Την ακριβή διεύθυνση την ορίζεις — και μπορείς να την αλλάζεις — για κάθε παράδοση ξεχωριστά.'
                    : 'We only need your postcode to confirm we deliver in your area. You set the exact address — and can change it — for each delivery separately.'}
                </div>
              </div>
            </div>
            <IndicativeAddressGate
              lang={lang}
              value={indAddr}
              onChange={setIndAddr}
              onValidityChange={handleAddrValidity}
            />
          </section>

          {/* SECTION 10 · Services (WEC-338 — moved last; dietician-managed
              is currently mandatory, so the card is shown for visibility
              but click is disabled and selection is forced on). */}
          <section className="wpv2-section">
            <div className="wpv2-section-head">
              <span className="wpv2-section-num">10</span>
              <div>
                <div className="wpv2-section-title">
                  {isEl ? 'Υπηρεσίες' : 'Services'}
                </div>
                <div className="wpv2-section-sub">
                  {isEl
                    ? 'Η διαχείριση από τη Διαιτολογική μας ομάδα περιλαμβάνεται. Πρόσθεσε προαιρετικές υπηρεσίες.'
                    : 'Dietitian-team management is included. Add optional extras.'}
                </div>
              </div>
            </div>
            <div className="wpv2-services">
              {/* Included, mandatory — dietitian-team management. */}
              <button
                type="button"
                className="wpv2-service sel locked"
                disabled
                aria-disabled="true"
                title={isEl ? 'Περιλαμβάνεται στο πλάνο' : 'Included in your plan'}
              >
                <span className="wpv2-service-cb">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <div className="wpv2-service-body">
                  <div className="wpv2-service-name">
                    {isEl ? 'Διαχείριση από την Διαιτολογική μας ομάδα' : 'Managed by our dietitian team'}
                  </div>
                  <div className="wpv2-service-desc">
                    {isEl
                      ? 'Εντός 1 εργάσιμης ημέρας θα σε καλέσουμε και χτίζουμε εβδομαδιαία τα γεύματά σου — χωρίς κόπο.'
                      : "We'll call you within 1 business day and build your meals each week — zero effort."}
                  </div>
                </div>
                <div className="wpv2-service-price">
                  <span className="wpv2-service-included">
                    {isEl ? 'Περιλαμβάνεται' : 'Included'}
                  </span>
                </div>
              </button>

              {/* WEC-360 + WEC-553: optional body-fat measurement (λιπομέτρηση),
                  now priced (€29 for 2w/1mo, €87 for 3mo) and added to the total. */}
              <button
                type="button"
                className={`wpv2-service${bodyFat ? ' sel' : ''}`}
                onClick={() => setBodyFat((v) => !v)}
              >
                <span className="wpv2-service-cb">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <div className="wpv2-service-body">
                  <div className="wpv2-service-name">
                    {isEl ? 'Λιπομέτρηση' : 'Body-fat measurement'}
                  </div>
                  <div className="wpv2-service-desc">
                    {/* WEC-551 O6 — note the measurement can happen at our
                        premises or the customer's. */}
                    {isEl
                      ? 'Μέτρηση σύστασης σώματος από τη Διαιτολογική μας ομάδα — στον χώρο μας ή στον δικό σου — για ακριβέστερη παρακολούθηση.'
                      : 'Body-composition measurement by our dietitian team — at our place or yours — for more accurate tracking.'}
                  </div>
                </div>
                <div className="wpv2-service-price">
                  {/* WEC-553: show the actual add-on price for the chosen plan length. */}
                  +{fmtEur(LIPOMETRISI_FEE_CENTS[planLength] / 100)}
                </div>
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

            <button className="wpv2-aside-menu-cta" onClick={() => setDemoOpen(true)}>
              <div className="wpv2-aside-menu-cta-l">
                <span className="wpv2-aside-menu-cta-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11l18-7-7 18-2-8-9-3z"/>
                  </svg>
                </span>
                <div className="wpv2-aside-menu-cta-text">
                  {isEl ? 'Δες μερικά πιάτα από το μενού μας' : 'See some dishes from our menu'}
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
              {/* WEC-583: discount split — show which dimensions earned it. */}
              {result.discountPct > 0 && (durPct > 0 || dayPct > 0 || mealPct > 0) && (
                <div className="wpv2-aside-discbreak">
                  {[
                    { pct: durPct, el: 'Διάρκεια', en: 'Duration' },
                    { pct: dayPct, el: 'Ημέρες', en: 'Days' },
                    { pct: mealPct, el: 'Γεύματα', en: 'Meals' },
                  ].filter((x) => x.pct > 0).map((x, i, arr) => (
                    <span key={x.en} className="wpv2-discbreak-item">
                      {isEl ? x.el : x.en} −{x.pct}%{i < arr.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </div>
              )}
              {result.discountPct > 0 && (
                <div className="wpv2-aside-row discount">
                  <span className="wpv2-aside-row-lbl">{isEl ? 'Συνολική έκπτωση' : 'Total discount'} ({Math.round(result.discountPct * 100)}%)</span>
                  <span className="wpv2-aside-row-val">−{fmtEur(discountAmt)}</span>
                </div>
              )}
              {/* WEC-553: λιπομέτρηση add-on charged on top of the plan. */}
              {lipoFee > 0 && (
                <div className="wpv2-aside-row">
                  <span className="wpv2-aside-row-lbl">{isEl ? 'Λιπομέτρηση' : 'Body-fat measurement'}</span>
                  <span className="wpv2-aside-row-val">+{fmtEur(lipoFee)}</span>
                </div>
              )}
            </div>

            {/* WEC-508: coupon field removed — it was a non-functional stub
                (no handler, no server support). Restore only with the full
                voucher money-path; see the ticket for the open design points. */}

            <div className="wpv2-aside-divider" />

            <div className="wpv2-aside-total">
              <span className="wpv2-aside-total-lbl">{isEl ? 'Σύνολο' : 'Total'}</span>
              <span className="wpv2-aside-total-val">{fmtEur(total)}</span>
            </div>

            {/* WEC-551 O9 — removed the "Πληρώνεις €X … δηλαδή €Z δώρο"
                credits blurb per owner feedback (confusing next to the total). */}

            {/* Payment method picker — WEC-554/O10: plural label + Αντικαταβολή,
                O13: trio wording (Χρεωστική/πιστωτική κάρτα, Αντικαταβολή,
                Τραπεζική κατάθεση). */}
            <div className="wpv2-paymethods">
              <div className="wpv2-paymethods-label">{isEl ? 'Τρόποι πληρωμής' : 'Payment methods'}</div>
              <div className="wpv2-paymethods-grid">
                {(['card','cash','transfer','link'] as PaymentMethod[]).map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    className={`wpv2-paymethod${paymentMethod === pm ? ' sel' : ''}`}
                    onClick={() => setPaymentMethod(pm)}
                  >
                    {pm === 'card'     && (isEl ? 'Χρεωστική/πιστωτική κάρτα' : 'Debit/credit card')}
                    {pm === 'cash'     && (isEl ? 'Αντικαταβολή'             : 'Cash on delivery')}
                    {pm === 'transfer' && (isEl ? 'Τραπεζική κατάθεση'       : 'Bank transfer')}
                    {pm === 'link'     && (isEl ? 'Link πληρωμής αργότερα'   : 'Payment link later')}
                  </button>
                ))}
              </div>
              {paymentMethod === 'cash' && (
                <div className="wpv2-paymethods-hint">
                  {isEl
                    ? 'Θα πληρώσεις με μετρητά στον διανομέα κατά την πρώτη παράδοση. Το πλάνο ενεργοποιείται μόλις εισπραχθεί.'
                    : 'Pay the courier in cash on your first delivery. The plan activates once collected.'}
                </div>
              )}
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

            {/* WEC-360 — receipt vs invoice (mirrors checkout ExtrasSection). */}
            <div className="wpv2-invoice">
              <div className="wpv2-invoice-toggle">
                <span className="wpv2-invoice-toggle-lbl">{isEl ? 'Παραστατικό' : 'Document'}</span>
                <div className="wpv2-seg">
                  <button
                    type="button"
                    className={`wpv2-seg-opt${!wantInvoice ? ' sel' : ''}`}
                    onClick={() => setWantInvoice(false)}
                  >{isEl ? 'Απόδειξη' : 'Receipt'}</button>
                  <button
                    type="button"
                    className={`wpv2-seg-opt${wantInvoice ? ' sel' : ''}`}
                    onClick={() => setWantInvoice(true)}
                  >{isEl ? 'Τιμολόγιο' : 'Invoice'}</button>
                </div>
              </div>
              {wantInvoice && (
                <div className="wpv2-invoice-fields">
                  <input
                    type="text"
                    className="wpv2-invoice-input"
                    placeholder={isEl ? 'Επωνυμία / Όνομα' : 'Company / Name'}
                    value={invoiceName}
                    onChange={(e) => setInvoiceName(e.target.value)}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={9}
                    className={`wpv2-invoice-input${vatBad ? ' bad' : ''}`}
                    placeholder={isEl ? 'ΑΦΜ' : 'VAT number'}
                    value={invoiceVat}
                    onChange={(e) => setInvoiceVat(vatDigits(e.target.value))}
                    aria-invalid={vatBad || undefined}
                  />
                  {vatBad && (
                    <div className="wpv2-invoice-err">
                      {invoiceVat.length !== 9
                        ? (isEl ? 'Το ΑΦΜ πρέπει να έχει 9 ψηφία' : 'VAT must be 9 digits')
                        : (isEl ? 'Μη έγκυρο ΑΦΜ — έλεγξε τα ψηφία' : 'Invalid VAT — check the digits')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {errMsg && (
              <div className="wpv2-aside-err">{errMsg}</div>
            )}

            <button
              className="wpv2-aside-cta"
              onClick={handleStartPlan}
              disabled={result.selectedMealCount < 2 || !indAddrInZone || busy}
              title={
                !indAddrInZone
                  ? (isEl ? 'Συμπλήρωσε έναν Τ.Κ. εντός ζώνης παράδοσης' : 'Enter a postcode within our delivery zone')
                  : undefined
              }
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
            {!indAddrInZone && (
              <div className="wpv2-aside-hint">
                {isEl
                  ? 'Συμπλήρωσε έγκυρο Τ.Κ. στην ενότητα 10 για να συνεχίσεις.'
                  : 'Add a valid postcode in section 10 to continue.'}
              </div>
            )}

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
                        autoComplete="name"
                      />
                    </div>
                    <div className="wpv2-signup-field">
                      <label>Email</label>
                      <input
                        type="email"
                        value={suEmail}
                        onChange={(e) => setSuEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                    </div>
                    <div className="wpv2-signup-field">
                      <label>{isEl ? 'Κινητό' : 'Mobile'}</label>
                      <input
                        type="tel"
                        value={suPhone}
                        onChange={(e) => setSuPhone(e.target.value)}
                        placeholder="+30 69..."
                        autoComplete="tel"
                      />
                    </div>
                    <button
                      className="wpv2-signup-btn"
                      onClick={handleSignupSendCode}
                      disabled={!suName || !suEmail || !suPhone || busy}
                    >
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
                      {isEl ? 'Επαλήθευση & πληρωμή' : 'Verify & continue'}
                    </button>
                    <button className="wpv2-signup-resend" type="button" onClick={() => setSignupStep('identity')}>
                      {isEl ? 'Στείλε ξανά' : 'Resend'}
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
              {/* WEC-556 O17 — copy buttons on the two values people paste into
                  their banking app: the IBAN and the payment reference. */}
              <dt>IBAN</dt>          <dd className="bank-info-copyrow"><span>{bankInfo.iban}</span><CopyButton value={bankInfo.iban} lang={lang} ariaLabel={isEl ? 'Αντιγραφή IBAN' : 'Copy IBAN'} /></dd>
              <dt>{isEl ? 'Δικαιούχος' : 'Beneficiary'}</dt> <dd>{bankInfo.beneficiary}</dd>
              <dt>{isEl ? 'Αιτιολογία' : 'Reference'}</dt>   <dd className="bank-info-copyrow"><span>{bankInfo.reference}</span><CopyButton value={bankInfo.reference} lang={lang} ariaLabel={isEl ? 'Αντιγραφή αιτιολογίας' : 'Copy reference'} /></dd>
              <dt>{isEl ? 'Ποσό'       : 'Amount'}</dt>      <dd>{fmtEur(total)}</dd>
            </dl>
            {/* WEC-551 O7 — post-purchase reassurance: the dietitian team calls. */}
            <p className="wpv2-bank-promise">
              {isEl
                ? 'Θα σε καλέσουμε εντός 1 εργάσιμης ημέρας για να χτίσουμε μαζί τα γεύματά σου — χωρίς κόπο.'
                : "We'll call you within 1 business day to build your meals together — zero effort."}
            </p>
            <button className="wpv2-bank-close" onClick={() => setBankInfo(null)}>
              {isEl ? 'Κλείσιμο' : 'Close'}
            </button>
          </div>
        </div>
      )}

      {/* WEC-554: cash (Αντικαταβολή) success overlay — no bank details. */}
      {cashInfo && (
        <div className="wpv2-bank-overlay" onClick={() => setCashInfo(null)}>
          <div className="wpv2-bank-card" onClick={(e) => e.stopPropagation()}>
            <h3>{isEl ? 'Πλάνο δημιουργήθηκε ✓' : 'Plan created ✓'}</h3>
            <p>
              {isEl
                ? 'Θα πληρώσεις με μετρητά (αντικαταβολή) στον διανομέα κατά την πρώτη σου παράδοση. Το πλάνο σου είναι σε αναμονή και ενεργοποιείται μόλις εισπραχθεί το ποσό.'
                : 'You’ll pay in cash (on delivery) to the courier on your first delivery. Your plan is pending and activates once the amount is collected.'}
            </p>
            <dl className="wpv2-bank-details">
              <dt>{isEl ? 'Κωδικός' : 'Reference'}</dt>
              <dd className="bank-info-copyrow"><span>{cashInfo.reference}</span><CopyButton value={cashInfo.reference} lang={lang} ariaLabel={isEl ? 'Αντιγραφή κωδικού' : 'Copy reference'} /></dd>
              <dt>{isEl ? 'Ποσό' : 'Amount'}</dt> <dd>{fmtEur(total)}</dd>
            </dl>
            {/* WEC-551 O7 — post-purchase reassurance: the dietitian team calls. */}
            <p className="wpv2-bank-promise">
              {isEl
                ? 'Θα σε καλέσουμε εντός 1 εργάσιμης ημέρας για να χτίσουμε μαζί τα γεύματά σου — χωρίς κόπο.'
                : "We'll call you within 1 business day to build your meals together — zero effort."}
            </p>
            <button className="wpv2-bank-close" onClick={() => setCashInfo(null)}>
              {isEl ? 'Κλείσιμο' : 'Close'}
            </button>
          </div>
        </div>
      )}

      {/* WEC-433: server quote-confirm modal — appears only if the server
          authoritative price differs from what the calculator showed (e.g.
          admin edited pricing between page-load and submit). Customer must
          re-click to proceed. */}
      {priceConfirm && (
        <div
          className="wpv2-bank-overlay"
          onClick={() => { setPriceConfirm(null); setBusy(false) }}
          style={{ zIndex: 1000 }}
        >
          <div
            className="wpv2-bank-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440, padding: 28 }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>
              {isEl ? 'Η τιμή ενημερώθηκε' : 'Price updated'}
            </h3>
            <p style={{ margin: '0 0 16px', color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>
              {isEl
                ? <>Η τιμή του πλάνου σου άλλαξε. Νέα τιμή: <strong>€{(priceConfirm.serverCents / 100).toFixed(2)}</strong> (εμφανιζόταν €{(priceConfirm.clientCents / 100).toFixed(2)}). Συνεχίζοντας θα χρεωθείς το νέο ποσό.</>
                : <>The plan price has changed. New total: <strong>€{(priceConfirm.serverCents / 100).toFixed(2)}</strong> (was €{(priceConfirm.clientCents / 100).toFixed(2)}). Continuing charges the new amount.</>}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="wpv2-bank-close"
                onClick={() => { setPriceConfirm(null); setBusy(false) }}
                style={{ background: '#e5e7eb', color: '#374151' }}
              >
                {isEl ? 'Άκυρο' : 'Cancel'}
              </button>
              <button
                className="wpv2-bank-close"
                onClick={() => { setPriceConfirm(null); void startPurchase({ skipQuoteCheck: true }) }}
              >
                {isEl ? 'Συνέχεια πληρωμής' : 'Continue to payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
