import { useState, useEffect, useMemo } from 'react'
import PhoneInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import 'react-phone-number-input/style.css'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore, type Address } from '../store/useAuthStore'
import { makeTr } from '../lib/translations'
import { formatSlots } from '../lib/helpers'
import { useMenuStore } from '../store/useMenuStore'
import { Toggle } from '../components/ui/Toggle'
import { MacroIcon, MacroValuesRow } from '../components/ui/MacroDots'
import { WALLET_PLANS } from '../data/menu'
import { COUNTRIES, DEFAULT_COUNTRY, isValidPhone, phoneLabels } from '../lib/phone'
import { showGoalProgress, goalStatus, goalPct } from '../lib/goals'
import { matchesRange, type RangePreset } from '../lib/dateRange'
import { DateRangeFilter } from '../components/shared/DateRangeFilter'
import { Pagination } from '../components/shared/Pagination'
import { PlacesAutocomplete } from '../components/ui/PlacesAutocomplete'
import { googleMapsAvailable } from '../lib/googleMaps'
import {
  fetchIngredientOptions,
  saveProfileAllergies,
  saveProfileAvoidedIngredients,
  type IngredientOption,
} from '../lib/api/diet'

/** WEC-169: orders list shows 50 per page; the pagination bar hides itself
 *  when the filtered list fits on one page. */
const ORDERS_PAGE_SIZE = 50

type AccountTab = 'orders' | 'wallet' | 'addresses' | 'goals' | 'diet' | 'prefs' | 'profile'

/* ─── SVG icon helpers ──────────────────────────────────────────────────────── */

const icons: Record<AccountTab | 'logout', React.ReactElement> = {
  orders: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h8M8 12h8M8 17h5"/>
    </svg>
  ),
  wallet: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h.01"/><path d="M2 10h20"/>
    </svg>
  ),
  addresses: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  goals: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  diet: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  prefs: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  profile: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  logout: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
}

/* macroIcons — now uses <MacroIcon> from MacroDots.tsx for consistency with menu cards */

/* ─── Main Account Page ─────────────────────────────────────────────────────── */

export function AccountPage() {
  const lang = useUIStore((s) => s.lang)
  const closeAccount = useUIStore((s) => s.closeAccount)
  const goToMenu = useUIStore((s) => s.goToMenu)
  const accountTab = useUIStore((s) => s.accountTab)
  const { user, logout, updatePrefs, updateGoals, updateAddresses } = useAuthStore()

  // WEC-141: sign out always lands on the menu (same contract as the header).
  const handleSignOut = async () => {
    await logout()
    goToMenu()
  }
  const t = makeTr(lang)

  const [tab, setTab] = useState<AccountTab>((accountTab as AccountTab) || 'orders')

  useEffect(() => {
    if (accountTab) setTab(accountTab as AccountTab)
  }, [accountTab])

  if (!user) return null

  const initials = (user.name ?? '')
    .split(' ')
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || '?'

  const tabLabels: Record<AccountTab, { el: string; en: string }> = {
    orders:    { el: 'Παραγγελίες', en: 'Orders' },
    wallet:    { el: 'Πορτοφόλι', en: 'Wallet' },
    addresses: { el: 'Διευθύνσεις', en: 'Addresses' },
    goals:     { el: 'Στόχοι', en: 'Goals' },
    diet:      { el: 'Διατροφή', en: 'Diet' },
    prefs:     { el: 'Προτιμήσεις', en: 'Preferences' },
    profile:   { el: 'Στοιχεία', en: 'Details' },
  }

  return (
    <div className="account-page">
      <div className="account-header">
        <button className="btn-back-plain" onClick={closeAccount}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {t('backToMenu')}
        </button>
      </div>

      {/* User avatar card */}
      <div className="account-avatar-card">
        <div className="avatar-circle">{initials}</div>
        <div className="avatar-info">
          <div className="avatar-name">{user.name}</div>
          <div className="avatar-email">{user.email}</div>
        </div>
      </div>

      <div className="account-layout">
        {/* Tab nav with icons */}
        <nav className="account-nav">
          {(Object.keys(tabLabels) as AccountTab[]).map((k) => (
            <button
              key={k}
              className={`account-nav-item${tab === k ? ' active' : ''}`}
              onClick={() => setTab(k)}
            >
              {icons[k]}
              {lang === 'el' ? tabLabels[k].el : tabLabels[k].en}
            </button>
          ))}
          <button
            className="account-nav-item danger"
            onClick={handleSignOut}
          >
            {icons.logout}
            {lang === 'el' ? 'Αποσύνδεση' : 'Sign Out'}
          </button>
        </nav>

        {/* Content */}
        <div className="account-content">
          {tab === 'orders' && <OrdersTab user={user} lang={lang} />}
          {tab === 'wallet' && <WalletTab user={user} lang={lang} />}
          {tab === 'addresses' && <AddressesTab user={user} lang={lang} updateAddresses={updateAddresses} />}
          {tab === 'goals' && <GoalsTab user={user} lang={lang} updateGoals={updateGoals} />}
          {tab === 'diet' && <DietTab user={user} lang={lang} />}
          {tab === 'prefs' && <PrefsTab user={user} lang={lang} updatePrefs={updatePrefs} />}
          {tab === 'profile' && <ProfileTab user={user} lang={lang} />}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-77 — PROFILE TAB (editable fields + save)
═══════════════════════════════════════════════════════════════════════════════ */

function ProfileTab({ user, lang }: any) {
  const setUser = useAuthStore((s) => s.setUser)
  const [name, setName] = useState(user.name ?? '')
  const [email] = useState(user.email ?? '')
  const [phone, setPhone] = useState<string>(user.phone ?? '')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attemptedSave, setAttemptedSave] = useState(false)

  // Same curated country list + GR default as checkout (WEC-130)
  const countries = useMemo(() => COUNTRIES, [])
  const labels = useMemo(() => phoneLabels(lang), [lang])

  // Phone is optional at the field level but must be valid E.164 when present.
  // Name is required.
  const nameInvalid = attemptedSave && !name.trim()
  const phoneInvalid = attemptedSave && !!phone && !isValidPhone(phone)
  const canSave = !!name.trim() && (!phone || isValidPhone(phone))

  const handleSave = async () => {
    setAttemptedSave(true)
    if (!canSave) return
    setSaving(true)
    const { updateProfile } = await import('../lib/api/auth')
    const { error } = await updateProfile(user.id, { name, phone })
    if (!error) {
      // Keep the in-memory store in sync so header/avatar/checkout prefill all update
      setUser({ ...user, name, phone })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Τα Στοιχεία μου' : 'My Details'}</h2>
      <div className="profile-form">
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Ονοματεπώνυμο' : 'Full Name'}</label>
          <input
            className={`form-input${nameInvalid ? ' is-invalid' : ''}`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            aria-invalid={nameInvalid || undefined}
          />
        </div>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} disabled style={{ opacity: 0.6 }} />
        </div>
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Τηλέφωνο' : 'Phone'}</label>
          <PhoneInput
            className={`co-phone-input${phoneInvalid ? ' is-invalid' : ''}`}
            international
            defaultCountry={DEFAULT_COUNTRY}
            countries={countries}
            labels={labels}
            flags={flags}
            countryCallingCodeEditable={false}
            value={phone || undefined}
            onChange={(v) => setPhone(v ?? '')}
            placeholder="69X XXX XXXX"
            autoComplete="tel"
          />
          {phoneInvalid && (
            <div className="form-hint form-hint-error">
              {lang === 'el' ? 'Μη έγκυρος αριθμός τηλεφώνου' : 'Invalid phone number'}
            </div>
          )}
        </div>
      </div>
      <button className="btn-save-green" onClick={handleSave} disabled={saving}>
        {saving ? '...' : saved
          ? (lang === 'el' ? '✓ Αποθηκεύτηκε' : '✓ Saved')
          : (lang === 'el' ? 'Αποθήκευση' : 'Save')}
      </button>

      <SetPasswordSection lang={lang} />
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Set / change password — optional, OTP-everywhere epic
─────────────────────────────────────────────────────────────────────────── */

function SetPasswordSection({ lang }: { lang: 'el' | 'en' }) {
  const isEl = lang === 'el'
  const [open, setOpen] = useState(false)
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function handleSave() {
    setMsg(null)
    if (pwd.length < 6) {
      setMsg({ type: 'err', text: isEl ? 'Τουλάχιστον 6 χαρακτήρες' : 'At least 6 characters' })
      return
    }
    if (pwd !== pwd2) {
      setMsg({ type: 'err', text: isEl ? 'Οι κωδικοί δεν ταιριάζουν' : 'Passwords do not match' })
      return
    }
    setBusy(true)
    const { updatePassword } = await import('../lib/api/auth')
    const { ok, error } = await updatePassword(pwd)
    setBusy(false)
    if (!ok) { setMsg({ type: 'err', text: error ?? 'Could not save password' }); return }
    setMsg({ type: 'ok', text: isEl ? '✓ Ο κωδικός αποθηκεύτηκε' : '✓ Password saved' })
    setPwd(''); setPwd2('')
    setTimeout(() => setMsg(null), 3000)
  }

  return (
    <div className="set-password-section">
      <div className="set-password-head">
        <div>
          <div className="set-password-title">
            {isEl ? 'Κωδικός σύνδεσης' : 'Sign-in password'}
          </div>
          <div className="set-password-desc">
            {isEl
              ? 'Προαιρετικός. Με κωδικό συνδέεσαι ταχύτερα από συσκευή που σε θυμάται.'
              : 'Optional. Lets you sign in faster on devices that remember you.'}
          </div>
        </div>
        {!open && (
          <button className="btn-link-green" type="button" onClick={() => setOpen(true)}>
            {isEl ? 'Ορισμός / αλλαγή' : 'Set / change'}
          </button>
        )}
      </div>

      {open && (
        <div className="set-password-form">
          <div className="form-row">
            <label className="form-label">{isEl ? 'Νέος κωδικός' : 'New password'}</label>
            <input
              className="form-input"
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              placeholder="••••••••"
            />
          </div>
          <div className="form-row">
            <label className="form-label">{isEl ? 'Επιβεβαίωση' : 'Confirm'}</label>
            <input
              className="form-input"
              type="password"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              placeholder="••••••••"
            />
          </div>
          {msg && (
            <div className={msg.type === 'err' ? 'auth-error' : 'set-password-ok'}>
              {msg.text}
            </div>
          )}
          <div className="set-password-actions">
            <button className="btn-save-green" type="button" onClick={handleSave} disabled={busy || !pwd || !pwd2}>
              {busy ? '...' : (isEl ? 'Αποθήκευση' : 'Save')}
            </button>
            <button
              className="btn-link-muted"
              type="button"
              onClick={() => { setOpen(false); setPwd(''); setPwd2(''); setMsg(null) }}
            >
              {isEl ? 'Άκυρο' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-81 — PREFERENCES TAB (per-day delivery, payment, dietary)
═══════════════════════════════════════════════════════════════════════════════ */

function PrefsTab({ user, lang, updatePrefs }: any) {
  const t = makeTr(lang)
  const setLang = useUIStore((s) => s.setLang)
  const addresses = user.addresses ?? []
  const [prefs, setPrefs] = useState({ ...user.prefs })
  const [saved, setSaved] = useState(false)

  const storeSlots = useMenuStore((s) => s.timeSlots)
  const timeSlots = formatSlots(storeSlots)
  const days = [
    { key: 0, el: 'Δευτέρα', en: 'Monday' },
    { key: 1, el: 'Τρίτη', en: 'Tuesday' },
    { key: 2, el: 'Τετάρτη', en: 'Wednesday' },
    { key: 3, el: 'Πέμπτη', en: 'Thursday' },
    { key: 4, el: 'Παρασκευή', en: 'Friday' },
  ]

  const paymentMethods = [
    { id: 'cash', el: 'Αντικαταβολή', en: 'Cash' },
    { id: 'card', el: 'Κάρτα', en: 'Card' },
    { id: 'wallet', el: 'Πορτοφόλι', en: 'Wallet' },
    { id: 'bank', el: 'Τράπεζα', en: 'Bank' },
  ]

  const setDayAddr = (dayIdx: number, addrId: string) => {
    const p = { ...prefs, dayAddress: { ...prefs.dayAddress, [dayIdx]: addrId } }
    setPrefs(p)
  }
  const setDaySlot = (dayIdx: number, slot: string) => {
    const p = { ...prefs, slots: { ...prefs.slots, [dayIdx]: slot } }
    setPrefs(p)
  }

  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const { savePrefs } = await import('../lib/api/auth')
    const { error } = await savePrefs(user.id, prefs)
    if (!error) {
      updatePrefs(prefs)
      // If the saved default language differs from the current UI language,
      // reflect it in the header toggle right away. Without this, users who
      // change their default to EN and hit save would still see the EL UI
      // until they reload.
      if ((prefs.lang === 'el' || prefs.lang === 'en') && prefs.lang !== lang) {
        setLang(prefs.lang)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  return (
    <div className="tab-section">
      <h2 className="tab-title">{t('preferences')}</h2>

      {/* Per-day delivery */}
      <div className="prefs-section-card">
        <div className="prefs-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <div>
            <div className="prefs-section-title">{t('prefDelivery')}</div>
            <div className="prefs-section-desc">{t('prefDeliveryDesc')}</div>
          </div>
        </div>
        <div className="prefs-day-grid">
          {days.map((d) => (
            <div key={d.key} className="prefs-day-row">
              <span className="prefs-day-label">{lang === 'el' ? d.el : d.en}</span>
              <select
                className="prefs-select"
                value={prefs.dayAddress?.[d.key] ?? ''}
                onChange={(e) => setDayAddr(d.key, e.target.value)}
              >
                <option value="">{t('prefNoAddr')}</option>
                {addresses.map((a: Address) => (
                  <option key={a.id} value={a.id}>{lang === 'el' ? a.labelEl : a.labelEn}</option>
                ))}
              </select>
              <select
                className="prefs-select"
                value={prefs.slots?.[d.key] ?? ''}
                onChange={(e) => setDaySlot(d.key, e.target.value)}
              >
                <option value="">{t('prefNoSlot')}</option>
                {timeSlots.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Payment preference */}
      <div className="prefs-section-card">
        <div className="prefs-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
          </svg>
          <div>
            <div className="prefs-section-title">{t('prefPayment')}</div>
            <div className="prefs-section-desc">{t('prefPaymentDesc')}</div>
          </div>
        </div>
        <div className="prefs-payment-grid">
          {paymentMethods.map((pm) => (
            <button
              key={pm.id}
              className={`prefs-payment-btn${prefs.paymentMethod === pm.id ? ' active' : ''}`}
              onClick={() => setPrefs({ ...prefs, paymentMethod: pm.id })}
            >
              {lang === 'el' ? pm.el : pm.en}
            </button>
          ))}
        </div>
      </div>

      {/* Dietary toggles */}
      <div className="prefs-section-card">
        <div className="prefs-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
          </svg>
          <div>
            <div className="prefs-section-title">{lang === 'el' ? 'Διατροφικές Προτιμήσεις' : 'Dietary Preferences'}</div>
          </div>
        </div>
        <div className="prefs-list">
          <div className="extra-row">
            <span className="extra-label">{lang === 'el' ? 'Χορτοφάγος' : 'Vegetarian'}</span>
            <Toggle
              checked={prefs.vegetarian ?? false}
              onChange={(v) => setPrefs({ ...prefs, vegetarian: v })}
            />
          </div>
          <div className="extra-row">
            <span className="extra-label">{lang === 'el' ? 'Χωρίς γλουτένη' : 'Gluten free'}</span>
            <Toggle
              checked={prefs.glutenFree ?? false}
              onChange={(v) => setPrefs({ ...prefs, glutenFree: v })}
            />
          </div>
          <div className="extra-row">
            <span className="extra-label">{lang === 'el' ? 'Low Carb' : 'Low Carb'}</span>
            <Toggle
              checked={prefs.lowCarb ?? false}
              onChange={(v) => setPrefs({ ...prefs, lowCarb: v })}
            />
          </div>
        </div>
      </div>

      {/* Language preference (WEC-141) */}
      <div className="prefs-section-card">
        <div className="prefs-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/>
          </svg>
          <div>
            <div className="prefs-section-title">
              {lang === 'el' ? 'Γλώσσα' : 'Language'}
            </div>
            <div className="prefs-section-desc">
              {lang === 'el'
                ? 'Η προεπιλεγμένη γλώσσα για όταν συνδέεσαι.'
                : 'Default language when you sign in.'}
            </div>
          </div>
        </div>
        <div className="prefs-payment-grid">
          <button
            type="button"
            className={`prefs-payment-btn${prefs.lang === 'el' ? ' active' : ''}`}
            onClick={() => setPrefs({ ...prefs, lang: 'el' })}
          >
            Ελληνικά
          </button>
          <button
            type="button"
            className={`prefs-payment-btn${prefs.lang === 'en' ? ' active' : ''}`}
            onClick={() => setPrefs({ ...prefs, lang: 'en' })}
          >
            English
          </button>
        </div>
      </div>

      {/* Goal tracking toggle */}
      <div className="prefs-section-card">
        <div className="prefs-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
          </svg>
          <div>
            <div className="prefs-section-title">{t('prefGoalTracking')}</div>
            <div className="prefs-section-desc">{t('prefGoalTrackingDesc')}</div>
          </div>
        </div>
        <div className="prefs-list">
          <div className="extra-row">
            <span className="extra-label">{lang === 'el' ? 'Ενεργοποίηση στη σελίδα' : 'Enable on page'}</span>
            <Toggle
              checked={prefs.goalTracking ?? false}
              onChange={(v) => setPrefs({ ...prefs, goalTracking: v })}
            />
          </div>
        </div>
      </div>

      <button className="btn-save-green" onClick={handleSave} disabled={saving}>
        {saving ? '...' : saved ? (lang === 'el' ? '✓ Αποθηκεύτηκαν' : '✓ Saved') : (lang === 'el' ? 'Αποθήκευση' : 'Save')}
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WALLET TAB (unchanged — already matches demo)
═══════════════════════════════════════════════════════════════════════════════ */

function WalletTab({ user, lang }: any) {
  const wallet = user.wallet
  const goToWalletPage = useUIStore((s) => s.goToWalletPage)
  const closeAccount = useUIStore((s) => s.closeAccount)

  if (!wallet?.active) {
    return (
      <div className="tab-section">
        <h2 className="tab-title">Fitpal Wallet</h2>
        <div className="aw-empty">
          <div className="aw-empty-icon">👛</div>
          <div className="aw-empty-title">
            {lang === 'el' ? 'Δεν έχεις ακόμα πορτοφόλι' : "You don't have a wallet yet"}
          </div>
          <div className="aw-empty-desc">
            {lang === 'el'
              ? 'Ξεκίνα μια συνδρομή και κέρδισε bonus credits σε κάθε αναπλήρωση!'
              : 'Start a subscription and earn bonus credits on every top-up!'}
          </div>
          <button className="aw-btn aw-btn-topup" onClick={() => { closeAccount(); setTimeout(() => goToWalletPage(), 300) }}>
            {lang === 'el' ? 'Ξεκίνα τη συνδρομή →' : 'Start subscription →'}
          </button>
        </div>
      </div>
    )
  }

  const plan = WALLET_PLANS.find(p => p.id === wallet.planId)
  const renewDate = wallet.nextRenewal
    ? new Date(wallet.nextRenewal + 'T12:00:00').toLocaleDateString(
        lang === 'el' ? 'el-GR' : 'en-GB',
        { day: 'numeric', month: 'short', year: 'numeric' }
      )
    : null
  const baseBalance = wallet.baseBalance ?? wallet.balance
  const bonusBalance = wallet.bonusBalance ?? 0

  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Πορτοφόλι Fitpal' : 'Fitpal Wallet'}</h2>
      <div className="acct-wallet-card">
        <div className="aw-label">{lang === 'el' ? 'Διαθέσιμο υπόλοιπο' : 'Available balance'}</div>
        <div className="aw-balance">€{wallet.balance.toFixed(2)}</div>
        <div className="aw-detail">
          {lang === 'el'
            ? `Βάση: €${baseBalance.toFixed(2)} · Bonus: €${bonusBalance.toFixed(2)}`
            : `Base: €${baseBalance.toFixed(2)} · Bonus: €${bonusBalance.toFixed(2)}`}
        </div>
        <div className="aw-plan-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
            <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h.01"/><path d="M2 10h20"/>
          </svg>
          {plan ? (lang === 'el' ? plan.nameEl : plan.nameEn) : wallet.planId} · {wallet.autoRenew
            ? (lang === 'el' ? 'Αυτόματη ανανέωση' : 'Auto-renewal')
            : (lang === 'el' ? 'Χειροκίνητη ανανέωση' : 'Manual renewal')}
        </div>
        {renewDate && (
          <div className="aw-detail" style={{ marginTop: 6 }}>
            {lang === 'el' ? `Επόμενη ανανέωση: ${renewDate}` : `Next renewal: ${renewDate}`}
          </div>
        )}
        <div className="aw-actions">
          <button className="aw-btn aw-btn-topup">{lang === 'el' ? 'Αναπλήρωση' : 'Top up'}</button>
          <button className="aw-btn aw-btn-manage" onClick={() => { closeAccount(); setTimeout(() => goToWalletPage(), 300) }}>
            {lang === 'el' ? 'Αλλαγή πλάνου' : 'Change plan'}
          </button>
        </div>
      </div>
      <div className="aw-history">
        <div className="aw-history-title">{lang === 'el' ? 'Ιστορικό συναλλαγών' : 'Transaction history'}</div>
        {wallet.transactions && wallet.transactions.length > 0 ? (
          wallet.transactions.map((tx: any, i: number) => {
            const isCredit = tx.type === 'credit' || tx.amount > 0
            const txDate = new Date(tx.date + 'T12:00:00').toLocaleDateString(
              lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
            return (
              <div key={i} className="aw-tx">
                <div className={`aw-tx-icon ${isCredit ? 'credit' : 'debit'}`}>{isCredit ? '💰' : '🛒'}</div>
                <div className="aw-tx-info">
                  <div className="aw-tx-desc">{lang === 'el' ? tx.descEl : tx.descEn}</div>
                  <div className="aw-tx-date">{txDate}</div>
                </div>
                <div className={`aw-tx-amt ${isCredit ? 'credit' : 'debit'}`}>
                  {isCredit ? '+' : ''}€{Math.abs(tx.amount).toFixed(2)}
                </div>
              </div>
            )
          })
        ) : (
          <div className="aw-empty-txns">{lang === 'el' ? 'Δεν υπάρχουν συναλλαγές ακόμα' : 'No transactions yet'}</div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-79 — ADDRESSES TAB (labels, edit/delete, add form)
═══════════════════════════════════════════════════════════════════════════════ */

function AddressesTab({ user, lang, updateAddresses }: any) {
  const addresses: Address[] = user.addresses ?? []
  const [editing, setEditing] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const emptyAddr: Omit<Address, 'id'> = { labelEl: '', labelEn: '', street: '', area: '', zip: '', floor: '', doorbell: '', notes: '' }
  const [form, setForm] = useState(emptyAddr)

  const handleDelete = async (id: string) => {
    const msg = lang === 'el'
      ? 'Είστε σίγουροι ότι θέλετε να διαγράψετε αυτή τη διεύθυνση;'
      : 'Are you sure you want to delete this address?'
    if (!window.confirm(msg)) return
    setSaving(true)
    // Legacy local-only addresses (`'a' + Date.now()` ids from the old
    // checkout flow) aren't in Supabase — just drop them from local state.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    if (!isUuid) {
      updateAddresses(addresses.filter(a => a.id !== id))
      setSaving(false)
      return
    }
    const { deleteAddress } = await import('../lib/api/auth')
    const { error } = await deleteAddress(id)
    if (!error) {
      updateAddresses(addresses.filter(a => a.id !== id))
    }
    setSaving(false)
  }

  const handleEdit = (addr: Address) => {
    setEditing(addr.id)
    setForm({ labelEl: addr.labelEl, labelEn: addr.labelEn, street: addr.street, area: addr.area, zip: addr.zip ?? '', floor: addr.floor ?? '', doorbell: addr.doorbell ?? '', notes: addr.notes ?? '' })
  }

  const handleSaveEdit = async (id: string) => {
    setSaving(true)
    const { updateAddress, insertAddress } = await import('../lib/api/auth')
    // Self-heal legacy addresses that were created via the old checkout
    // "Save to my addresses" flow with a local `'a' + Date.now()` id —
    // those never made it to Supabase, so an UPDATE crashes with
    // `invalid input syntax for type uuid`. If the id isn't a real UUID,
    // INSERT a fresh row and swap the local entry.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    if (!isUuid) {
      const { data, error } = await insertAddress(user.id, form)
      if (!error && data) {
        updateAddresses(addresses.map(a => a.id === id ? data : a))
        setEditing(null)
      } else {
        window.alert(
          lang === 'el'
            ? `Σφάλμα αποθήκευσης: ${error}`
            : `Save failed: ${error}`,
        )
      }
      setSaving(false)
      return
    }
    const { error } = await updateAddress(id, form)
    if (!error) {
      updateAddresses(addresses.map(a => a.id === id ? { ...a, ...form } : a))
      setEditing(null)
    } else {
      // Surface the supabase error — silent failure was the WEC-134 bug
      // report. Most commonly RLS or zip-constraint; the raw message is
      // still the most useful signal for a one-user app.
      window.alert(
        lang === 'el'
          ? `Σφάλμα αποθήκευσης: ${error}`
          : `Save failed: ${error}`,
      )
    }
    setSaving(false)
  }

  const handleAdd = async () => {
    setSaving(true)
    const { insertAddress } = await import('../lib/api/auth')
    const { data, error } = await insertAddress(user.id, form)
    if (!error && data) {
      updateAddresses([...addresses, data])
      setForm(emptyAddr)
      setShowAdd(false)
    }
    setSaving(false)
  }

  const renderForm = (_isNew: boolean, onSave: () => void) => (
    <div className="addr-form">
      <div className="addr-form-row">
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Ετικέτα' : 'Label'}</label>
          {/* WEC-134: title-size input so the user feels they're naming
              the address rather than filling a side field. */}
          <input
            className="form-input form-input-title"
            placeholder={lang === 'el' ? 'π.χ. Σπίτι, Γραφείο, Γιαγιά' : 'e.g. Home, Office, Grandma'}
            value={lang === 'el' ? form.labelEl : form.labelEn}
            onChange={(e) => setForm({ ...form, [lang === 'el' ? 'labelEl' : 'labelEn']: e.target.value })}
          />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">{lang === 'el' ? 'Οδός & Αριθμός' : 'Street & Number'}</label>
        {googleMapsAvailable() ? (
          <PlacesAutocomplete
            className="form-input"
            value={form.street}
            onChange={(v) => setForm({ ...form, street: v })}
            onSelect={(p) => setForm({
              ...form,
              street: p.street || form.street,
              area: p.area || form.area,
              zip: p.zip || form.zip,
            })}
            placeholder={lang === 'el' ? 'π.χ. Λεωφ. Κηφισίας 45' : 'e.g. 45 Kifisias Ave'}
            country="gr"
          />
        ) : (
          <input className="form-input" placeholder={lang === 'el' ? 'π.χ. Λεωφ. Κηφισίας 45' : 'e.g. 45 Kifisias Ave'}
            value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
        )}
      </div>
      <div className="addr-form-2col">
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Τ.Κ.' : 'Postcode'}</label>
          <input className="form-input" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Πόλη' : 'City'}</label>
          <input className="form-input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </div>
      </div>
      <div className="addr-form-2col">
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Όροφος' : 'Floor'}</label>
          <input className="form-input" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Κουδούνι' : 'Doorbell'}</label>
          <input className="form-input" value={form.doorbell} onChange={(e) => setForm({ ...form, doorbell: e.target.value })} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">{lang === 'el' ? 'Σημειώσεις παράδοσης' : 'Delivery notes'}</label>
        <input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <div className="addr-form-actions">
        <button className="btn-save-green" onClick={onSave} disabled={saving}>
          {saving ? '...' : (lang === 'el' ? 'Αποθήκευση' : 'Save')}
        </button>
        <button className="btn-cancel" onClick={() => { setEditing(null); setShowAdd(false) }} disabled={saving}>
          {lang === 'el' ? 'Ακύρωση' : 'Cancel'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Οι Διευθύνσεις μου' : 'My Addresses'}</h2>
      {addresses.length === 0 && !showAdd ? (
        <p className="tab-empty">{lang === 'el' ? 'Δεν υπάρχουν αποθηκευμένες διευθύνσεις.' : 'No saved addresses.'}</p>
      ) : (
        <div className="addr-list">
          {addresses.map((addr) => (
            <div key={addr.id} className={`addr-card${editing === addr.id ? ' editing' : ''}`}>
              {editing === addr.id ? (
                renderForm(false, () => handleSaveEdit(addr.id))
              ) : (
                <div className="addr-card-layout">
                  <div className="addr-card-left">
                    <span className="addr-label-tag">{lang === 'el' ? addr.labelEl : addr.labelEn}</span>
                    <div className="addr-detail-grid">
                      <div className="addr-detail-row">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        <span>{addr.street}, {addr.zip} {addr.area}</span>
                      </div>
                      {(addr.floor || addr.doorbell) && (
                        <div className="addr-detail-row">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h6M3 15h6"/></svg>
                          <span>
                            {addr.floor && <>{lang === 'el' ? 'Όροφος' : 'Floor'}: {addr.floor}</>}
                            {addr.floor && addr.doorbell && ' · '}
                            {addr.doorbell && <>{lang === 'el' ? 'Κουδούνι' : 'Doorbell'}: {addr.doorbell}</>}
                          </span>
                        </div>
                      )}
                      {addr.notes && (
                        <div className="addr-detail-row">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                          <span className="addr-notes-text">{addr.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="addr-card-actions">
                    <button className="addr-action-btn" onClick={() => handleEdit(addr)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      {lang === 'el' ? 'Επεξεργασία' : 'Edit'}
                    </button>
                    <button className="addr-action-btn danger" onClick={() => handleDelete(addr.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                      {lang === 'el' ? 'Διαγραφή' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd ? (
        <div className="addr-card new-addr-card">
          <h3 className="addr-new-title">{lang === 'el' ? '+ Νέα Διεύθυνση' : '+ New Address'}</h3>
          {renderForm(true, handleAdd)}
        </div>
      ) : (
        <button className="btn-add-addr" onClick={() => { setForm(emptyAddr); setShowAdd(true) }}>
          {lang === 'el' ? '+ Νέα Διεύθυνση' : '+ New Address'}
        </button>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-80 — GOALS TAB (toggle, min/max, icons, save)
═══════════════════════════════════════════════════════════════════════════════ */

function GoalsTab({ user, lang, updateGoals }: any) {
  const t = makeTr(lang)
  const [goals, setGoals] = useState({ ...user.goals })
  const [saved, setSaved] = useState(false)

  const getRange = (val: any): { min: number; max: number } => {
    if (typeof val === 'object' && val !== null) return { min: val.min ?? 0, max: val.max ?? 0 }
    return { min: 0, max: val ?? 0 }
  }

  const setRange = (key: string, field: 'min' | 'max', value: number) => {
    const cur = getRange(goals[key])
    setGoals({ ...goals, [key]: { ...cur, [field]: value } })
  }

  const fields = [
    { key: 'calories', css: 'cal', label: t('goalCalories'), unit: 'kcal', icon: <MacroIcon type="cal" /> },
    { key: 'protein', css: 'prot', label: t('goalProtein'), unit: 'g', icon: <MacroIcon type="pro" /> },
    { key: 'carbs', css: 'carb', label: t('goalCarbs'), unit: 'g', icon: <MacroIcon type="carb" /> },
    { key: 'fat', css: 'fat', label: t('goalFat'), unit: 'g', icon: <MacroIcon type="fat" /> },
  ]

  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const { saveGoals } = await import('../lib/api/auth')
    const { error } = await saveGoals(user.id, goals)
    if (!error) {
      updateGoals(goals)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  return (
    <div className="tab-section">
      <h2 className="tab-title">{t('goals')}</h2>

      {/* Enable toggle */}
      <div className="goals-enable-row">
        <Toggle
          checked={goals.enabled ?? false}
          onChange={(v) => setGoals({ ...goals, enabled: v })}
        />
        <div>
          <div className="goals-enable-label">{lang === 'el' ? 'Ενεργοποίηση στόχων' : 'Enable goals'}</div>
          <div className="goals-enable-desc">{t('goalsDesc')}</div>
        </div>
      </div>

      {/* Macro range cards */}
      <div className="goals-cards-grid">
        {fields.map(({ key, css, label, unit, icon }) => {
          const range = getRange(goals[key])
          return (
            <div key={key} className={`goal-card${goals.enabled ? '' : ' disabled'}`}>
              <div className="goal-card-header">
                <span className={`goal-card-icon ${css}`}>{icon}</span>
                <span className="goal-card-label">{label}</span>
                <span className="goal-card-unit">{unit}</span>
              </div>
              <div className="goal-card-inputs">
                <div className="goal-input-group">
                  <span className="goal-input-label">{t('goalMin')}</span>
                  <input
                    className="form-input goal-input"
                    type="number"
                    value={range.min || ''}
                    disabled={!goals.enabled}
                    onChange={(e) => setRange(key, 'min', Number(e.target.value))}
                  />
                </div>
                <div className="goal-input-group">
                  <span className="goal-input-label">{t('goalMax')}</span>
                  <input
                    className="form-input goal-input"
                    type="number"
                    value={range.max || ''}
                    disabled={!goals.enabled}
                    onChange={(e) => setRange(key, 'max', Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <button className="btn-save-green" onClick={handleSave} disabled={saving}>
        {saving ? '...' : saved ? (lang === 'el' ? '✓ Αποθηκεύτηκαν' : '✓ Saved') : (lang === 'el' ? 'Αποθήκευση' : 'Save')}
      </button>

      {/* ── Intake history — always visible for users with orders (WEC-80
            revised). Goal progress bars render INSIDE GoalsHistory only when
            both prefs.goalTracking and goals.enabled are true. Without those,
            the same daily breakdown shows as intake-only (dish-card style
            macros, no bars). The bare intake view is useful on its own —
            users who haven't defined goals still want to see what they ate. */}
      {user.orders && user.orders.length > 0 && (
        <GoalsHistory user={user} goals={goals} lang={lang} t={t as (k: string) => string} />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-168 — GOALS HISTORY
   Buckets child_orders by delivery_date (merging same-day orders), splits
   past vs forecast (delivery date ≥ today), and exposes date-range filters
   + pagination. Uses shared goalStatus/goalPct from src/lib/goals.ts so the
   colouring matches cart / checkout / orders.
═══════════════════════════════════════════════════════════════════════════════ */

const HISTORY_PAGE_SIZE = 50

interface DayBucket {
  date: string   // YYYY-MM-DD
  macros: { cal: number; protein: number; carbs: number; fat: number }
  orderIds: string[]
  forecast: boolean
}

function bucketChildOrdersByDay(orders: any[], todayIso: string): DayBucket[] {
  const byDate = new Map<string, DayBucket>()
  for (const o of orders) {
    for (const ch of o.childOrders ?? []) {
      const date = ch.deliveryDate
      if (!date) continue
      const m = ch.macros ?? { cal: 0, protein: 0, carbs: 0, fat: 0 }
      const b = byDate.get(date) ?? {
        date,
        macros: { cal: 0, protein: 0, carbs: 0, fat: 0 },
        orderIds: [] as string[],
        forecast: date >= todayIso,
      }
      b.macros.cal     += m.cal     ?? 0
      b.macros.protein += m.protein ?? 0
      b.macros.carbs   += m.carbs   ?? 0
      b.macros.fat     += m.fat     ?? 0
      if (!b.orderIds.includes(o.id)) b.orderIds.push(o.id)
      byDate.set(date, b)
    }
  }
  // Newest first — users expect recent days at the top.
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1))
}

function GoalsHistory({ user, goals, lang, t }: { user: any; goals: any; lang: 'el' | 'en'; t: (k: string) => string }) {
  const orders = user.orders ?? []

  // WEC-80 revised: goal progress visualization is the *secondary* layer.
  // It only shows when the user has opted into goal tracking (prefs flag)
  // AND has enabled goals with actual min/max values defined. Either flag
  // off means we strip the bars and render intake-only — same data, lighter
  // visual weight, no goal coloring.
  const showGoalBars: boolean = !!(user.prefs?.goalTracking && goals?.enabled)

  const [rangePreset, setRangePreset] = useState<RangePreset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [page, setPage] = useState(1)

  // "Today" as a YYYY-MM-DD local string — cheap, and used both to split
  // forecast vs past and as the filter-anchor below.
  const todayIso = useMemo(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }, [])

  const buckets = useMemo(() => bucketChildOrdersByDay(orders, todayIso), [orders, todayIso])

  const filteredBuckets = useMemo(() => {
    return buckets.filter((b) =>
      // Anchor-at-noon so matchesRange's time bounds line up with local
      // midnight-to-midnight windows for both presets and custom.
      matchesRange(new Date(b.date + 'T12:00:00'), rangePreset, customFrom, customTo),
    )
  }, [buckets, rangePreset, customFrom, customTo])

  // Aggregates — separated so the UI can show "past" vs "forecast" averages
  // honestly (averaging a 0-delivered forecast into past data would look like
  // a crash in intake).
  const pastBuckets = filteredBuckets.filter((b) => !b.forecast)
  const forecastBuckets = filteredBuckets.filter((b) => b.forecast)

  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0
  const pastAvg = {
    cal:     avg(pastBuckets.map((b) => b.macros.cal)),
    protein: avg(pastBuckets.map((b) => b.macros.protein)),
    carbs:   avg(pastBuckets.map((b) => b.macros.carbs)),
    fat:     avg(pastBuckets.map((b) => b.macros.fat)),
  }

  const pageCount = Math.max(1, Math.ceil(filteredBuckets.length / HISTORY_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount)
  const pageItems = filteredBuckets.slice(
    (clampedPage - 1) * HISTORY_PAGE_SIZE,
    clampedPage * HISTORY_PAGE_SIZE,
  )

  function setPreset(p: RangePreset) { setRangePreset(p); setPage(1) }
  function setFrom(v: string) { setCustomFrom(v); setPage(1) }
  function setTo(v: string) { setCustomTo(v); setPage(1) }

  const summaryText = forecastBuckets.length > 0
    ? (lang === 'el'
        ? `${pastBuckets.length} ημέρες · ${forecastBuckets.length} πρόβλεψη`
        : `${pastBuckets.length} days · ${forecastBuckets.length} forecast`)
    : (pastBuckets.length === 1
        ? (lang === 'el' ? '1 ημέρα' : '1 day')
        : (lang === 'el' ? `${pastBuckets.length} ημέρες` : `${pastBuckets.length} days`))

  const macroBars: Array<{ k: 'cal' | 'protein' | 'carbs' | 'fat'; icon: React.ReactElement; short: { el: string; en: string } }> = [
    { k: 'cal',     icon: <MacroIcon type="cal" />,  short: { el: 'Θερμ.', en: 'Cal'  } },
    { k: 'protein', icon: <MacroIcon type="pro" />,  short: { el: 'Πρωτ.', en: 'P'    } },
    { k: 'carbs',   icon: <MacroIcon type="carb" />, short: { el: 'Υδατ.', en: 'C'    } },
    { k: 'fat',     icon: <MacroIcon type="fat" />,  short: { el: 'Λιπ.',  en: 'F'    } },
  ]

  return (
    <div className="goals-history" style={{ marginTop: 32 }}>
      <h3 className="tab-subtitle">
        {showGoalBars
          ? t('goalIntakeHistory')
          : (lang === 'el' ? 'Διατροφική πρόσληψη' : 'Nutritional intake')}
      </h3>

      <DateRangeFilter
        preset={rangePreset}
        from={customFrom}
        to={customTo}
        onPresetChange={setPreset}
        onFromChange={setFrom}
        onToChange={setTo}
        summary={summaryText}
      />

      {/* Aggregates — reuses the same macro card look as order detail so the
          user sees familiar pastel blocks. Uses PAST-only data so a future
          zero-intake forecast day doesn't skew the average. */}
      {pastBuckets.length > 0 && (
        <div className="goals-history-avg">
          <div className="gha-title">
            {lang === 'el'
              ? `Μέσος όρος / ημέρα · ${pastBuckets.length} ${pastBuckets.length === 1 ? 'ημέρα' : 'ημέρες'}`
              : `Average per day · ${pastBuckets.length} ${pastBuckets.length === 1 ? 'day' : 'days'}`}
          </div>
          <div className="order-macros-row">
            {macroBars.map(({ k, icon }) => {
              const val = pastAvg[k]
              // WEC-80 revised: status + pct only drive UI when bars are on.
              const s = showGoalBars ? goalStatus(k, val, goals) : undefined
              const pct = showGoalBars ? goalPct(k, val, goals) : 0
              const label = lang === 'el'
                ? { cal: 'Θερμίδες', protein: 'Πρωτεΐνη', carbs: 'Υδατάνθρακες', fat: 'Λιπαρά' }[k]
                : { cal: 'Calories', protein: 'Protein',  carbs: 'Carbs',       fat: 'Fat'    }[k]
              const unit = k === 'cal' ? '' : 'g'
              const cls = k === 'cal' ? 'cal' : k === 'protein' ? 'protein' : k === 'carbs' ? 'carbs' : 'fat'
              return (
                <div
                  key={k}
                  className={`order-macro-card ${cls}`}
                  {...(s ? { 'data-goal-status': s } : {})}
                >
                  <div className={`order-macro-icon ${cls}`}>{icon}</div>
                  <span className="order-macro-label">{label}</span>
                  <span className="order-macro-val">{val}{unit && <small>{unit}</small>}</span>
                  {showGoalBars && (
                    <div className="order-macro-bar">
                      <div className="order-macro-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Daily rows */}
      {filteredBuckets.length === 0 ? (
        <p className="tab-empty" style={{ marginTop: 12 }}>
          {lang === 'el' ? 'Κανένα δεδομένο στο επιλεγμένο διάστημα.' : 'No data in the selected range.'}
        </p>
      ) : (
        <div className="goals-history-list">
          {pageItems.map((b) => {
            const dateLabel = new Date(b.date + 'T12:00:00').toLocaleDateString(
              lang === 'el' ? 'el-GR' : 'en-GB',
              { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
            )
            return (
              <div key={b.date} className={`gh-row${b.forecast ? ' forecast' : ''} intake-primary`}>
                <div className="gh-day">
                  <span className="gh-day-date">{dateLabel}</span>
                  {b.forecast && (
                    <span className="gh-forecast-pill">
                      {lang === 'el' ? 'Πρόβλεψη' : 'Forecast'}
                    </span>
                  )}
                </div>
                {/* WEC-80 revised: the macro pills are now the primary
                    readout in both modes. Dish-card style. The optional
                    bars row sits underneath the pills, aligned to the same
                    4-column grid, only when showGoalBars is on. */}
                <div className="day-intake">
                  <MacroValuesRow
                    cal={b.macros.cal}
                    pro={b.macros.protein}
                    carb={b.macros.carbs}
                    fat={b.macros.fat}
                    labels={{
                      kcal: lang === 'el' ? 'Θερμίδες' : 'Calories',
                      pro:  lang === 'el' ? 'Πρωτ.'    : 'Protein',
                      carb: lang === 'el' ? 'Υδατ.'    : 'Carbs',
                      fat:  lang === 'el' ? 'Λιπαρά'   : 'Fat',
                    }}
                  />
                  {showGoalBars && (
                    <div className="day-intake-bars">
                      {macroBars.map((mb) => {
                        const v = b.macros[mb.k]
                        const s = goalStatus(mb.k, v, goals)
                        const pct = goalPct(mb.k, v, goals)
                        return (
                          <div key={mb.k} className={`dib-bar dib-${s}`}>
                            <div className="dib-bar-track">
                              <div className="dib-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Pagination page={clampedPage} pageCount={pageCount} onChange={setPage} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-78 — ORDERS TAB (rich cards, per-day breakdown, macros)
═══════════════════════════════════════════════════════════════════════════════ */

function OrdersTab({ user, lang }: any) {
  const orders = user.orders ?? []
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})

  // WEC-169: date filter + pagination. Filter runs on the order's created_at
  // (stored as `order.date`). Pagination drops to 50/page and hides when
  // the filtered set fits on one page.
  const [rangePreset, setRangePreset] = useState<RangePreset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [page, setPage] = useState(1)

  const toggleDay = (key: string) => setExpandedDays(prev => ({ ...prev, [key]: !prev[key] }))

  const filtered = useMemo(() => {
    return (orders as any[]).filter((o) =>
      matchesRange(o.date, rangePreset, customFrom, customTo),
    )
  }, [orders, rangePreset, customFrom, customTo])

  const pageCount = Math.max(1, Math.ceil(filtered.length / ORDERS_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount)
  const pageOrders = filtered.slice(
    (clampedPage - 1) * ORDERS_PAGE_SIZE,
    clampedPage * ORDERS_PAGE_SIZE,
  )

  // Any filter change → rewind to page 1 so the user doesn't land on a
  // non-existent page after the result set shrinks.
  function setPreset(p: RangePreset) { setRangePreset(p); setPage(1) }
  function setFrom(v: string) { setCustomFrom(v); setPage(1) }
  function setTo(v: string) { setCustomTo(v); setPage(1) }

  const summary = filtered.length === 1
    ? (lang === 'el' ? '1 παραγγελία' : '1 order')
    : (lang === 'el' ? `${filtered.length} παραγγελίες` : `${filtered.length} orders`)

  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Οι Παραγγελίες μου' : 'My Orders'}</h2>
      {orders.length === 0 ? (
        <p className="tab-empty">{lang === 'el' ? 'Δεν υπάρχουν παραγγελίες.' : 'No orders yet.'}</p>
      ) : (
        <>
          <DateRangeFilter
            preset={rangePreset}
            from={customFrom}
            to={customTo}
            onPresetChange={setPreset}
            onFromChange={setFrom}
            onToChange={setTo}
            summary={summary}
          />
          {filtered.length === 0 ? (
            <p className="tab-empty">{lang === 'el' ? 'Καμία παραγγελία στο επιλεγμένο διάστημα.' : 'No orders in the selected range.'}</p>
          ) : (
        <div className="orders-list">
          {pageOrders.map((order: any) => {
            const isOpen = expanded === order.id
            const isActive = order.status === 'active'
            const totalDays = order.childOrders?.length ?? 0
            const totalItems = order.childOrders?.reduce((sum: number, c: any) => sum + (c.items?.length ?? 0), 0) ?? 0
            const statusLabel = lang === 'el' ? order.statusEl : order.statusEn
            const paymentLabel = lang === 'el' ? order.paymentEl : order.paymentEn

            return (
              <div key={order.id} className={`order-card${isOpen ? ' open' : ''}${isActive ? ' active' : ''}`}>
                {/* Order header */}
                <button className="order-card-header" onClick={() => setExpanded(isOpen ? null : order.id)}>
                  <div className="order-card-left">
                    <span className="order-card-id">{order.id}</span>
                    <span className="order-card-date">
                      {/* WEC-139: order.date is a full ISO timestamp (created_at).
                          The mock shape was 'YYYY-MM-DD' and the old concat would
                          corrupt timestamps into 'NaN' dates. Parse directly. */}
                      {new Date(order.date + (order.date.includes('T') ? '' : 'T12:00:00')).toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="order-card-right">
                    <span className={`order-status-badge${isActive ? ' active' : ''}`}>{statusLabel}</span>
                    <span className="order-card-total">€{order.total?.toFixed(2)}</span>
                    <svg className={`order-acc-arrow${isOpen ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {/* Summary line */}
                {isOpen && (
                  <div className="order-card-body">
                    <div className="order-summary-line">
                      <span>📅 {totalDays} {lang === 'el' ? 'ημέρες' : 'days'}</span>
                      <span>·</span>
                      <span>🍽 {totalItems} {lang === 'el' ? 'πιάτα' : 'dishes'}</span>
                      <span>·</span>
                      <span>💳 {paymentLabel}</span>
                    </div>

                    {isActive && (
                      <button className="btn-change-request">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        {lang === 'el' ? 'Αίτημα αλλαγής' : 'Request change'}
                      </button>
                    )}

                    {/* Per-day sections */}
                    {order.childOrders?.map((child: any, ci: number) => {
                      const dayKey = `${order.id}-${ci}`
                      const dayOpen = expandedDays[dayKey] !== false // default open
                      return (
                        <div key={ci} className="order-day-section">
                          <button className="order-day-header" onClick={() => toggleDay(dayKey)}>
                            <div className="order-day-left">
                              <span className="order-day-label">{lang === 'el' ? child.dayLabel : child.dayLabelEn}</span>
                              <span className="order-day-meta">{child.address}  {child.timeSlot}</span>
                            </div>
                            <div className="order-day-right">
                              <span className="order-day-subtotal">€{child.subtotal?.toFixed(2)}</span>
                              <svg className={`order-acc-arrow${dayOpen ? ' open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 12 15 18 9"/>
                              </svg>
                            </div>
                          </button>

                          {dayOpen && (
                            <div className="order-day-body">
                              {/* Macro summary cards.
                                  WEC-167: when goal tracking is on, each card gets a
                                  thin progress bar anchored to the user's configured
                                  max (falling back to min) with status colouring
                                  shared with the cart/checkout surfaces. */}
                              {child.macros && (() => {
                                const withBars = showGoalProgress(user)
                                const cells: Array<{
                                  cls: string
                                  key: 'cal' | 'protein' | 'carbs' | 'fat'
                                  icon: 'cal' | 'pro' | 'carb' | 'fat'
                                  label: string
                                  val: number
                                  unit?: string
                                }> = [
                                  { cls: 'cal',     key: 'cal',     icon: 'cal',  label: lang === 'el' ? 'Θερμίδες' : 'Calories',     val: child.macros.cal },
                                  { cls: 'carbs',   key: 'carbs',   icon: 'carb', label: lang === 'el' ? 'Υδατάνθρακες' : 'Carbs',   val: child.macros.carbs,   unit: 'g' },
                                  { cls: 'protein', key: 'protein', icon: 'pro',  label: lang === 'el' ? 'Πρωτεΐνη' : 'Protein',     val: child.macros.protein, unit: 'g' },
                                  { cls: 'fat',     key: 'fat',     icon: 'fat',  label: lang === 'el' ? 'Λιπαρά' : 'Fat',           val: child.macros.fat,     unit: 'g' },
                                ]
                                return (
                                  <div className={`order-macros-row${withBars ? '' : ' order-macros-row--numbers-only'}`}>
                                    {cells.map((c) => {
                                      const s = withBars ? goalStatus(c.key, c.val, user?.goals) : 'none'
                                      const pct = withBars ? goalPct(c.key, c.val, user?.goals) : 0
                                      return (
                                        <div key={c.key} className={`order-macro-card ${c.cls}`} data-goal-status={s}>
                                          <div className={`order-macro-icon ${c.cls}`}><MacroIcon type={c.icon} /></div>
                                          <span className="order-macro-label">{c.label}</span>
                                          <span className="order-macro-val">{c.val}{c.unit && <small>{c.unit}</small>}</span>
                                          {withBars && (
                                            <div className="order-macro-bar">
                                              <div className="order-macro-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              })()}

                              {/* Items */}
                              <div className="order-child-items">
                              {child.items?.map((item: any, ii: number) => (
                                <div key={ii} className="order-item-row">
                                  {/* Quantity badge on far left */}
                                  <span className="order-item-qty-badge">{item.qty}x</span>

                                  <div className="order-item-left">
                                    <span className="order-item-name">{lang === 'el' ? item.nameEl : item.nameEn}</span>
                                    {item.variantDetail && (
                                      <span className="order-item-variant-detail">
                                        {lang === 'el' ? item.variantDetail : (item.variant || item.variantDetail)}
                                      </span>
                                    )}
                                    {item.comment && (
                                      <span className="order-item-comment">"{item.comment}"</span>
                                    )}
                                  </div>
                                  <div className="order-item-right">
                                    <div className="order-item-macros-pills">
                                      <span className="macro-pill cal"><MacroIcon type="cal" /> {item.macros?.cal}</span>
                                      <span className="macro-pill carbs"><MacroIcon type="carb" /> {item.macros?.carbs}g</span>
                                      <span className="macro-pill protein"><MacroIcon type="pro" /> {item.macros?.protein}g</span>
                                      <span className="macro-pill fat"><MacroIcon type="fat" /> {item.macros?.fat}g</span>
                                    </div>
                                    <span className="order-item-price">€{item.price?.toFixed(2)}</span>
                                  </div>
                                </div>
                              ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
          )}
          <Pagination page={clampedPage} pageCount={pageCount} onChange={setPage} />
        </>
      )}
    </div>
  )
}

/* ─── Diet tab (WEC-250) ────────────────────────────────────────────────────
 * Allergies + avoided ingredients. The dish modal + menu cards highlight
 * matches against this user-defined set when the customer is signed in.
 * Allergies fan out through ingredient_allergies — i.e. flagging "Milk"
 * marks every dish whose recipe contains a milk-bearing ingredient.
 * Avoided ingredients are direct (no allergy indirection): a literal
 * "don't show me dishes with X" list.
 */
function DietTab({ user, lang }: { user: any; lang: 'el' | 'en' }) {
  const isEl = lang === 'el'
  const dietCatalog = useMenuStore((s) => s.dietCatalog)
  const updateDiet = useAuthStore((s) => s.updateDiet)

  // Local mirror of the user's diet so the form is editable without round-tripping.
  const initialAllergies: string[] = user.diet?.allergyIds ?? []
  const initialAvoided: string[] = user.diet?.avoidedIngredientIds ?? []
  const [allergyIds, setAllergyIds] = useState<string[]>(initialAllergies)
  const [avoidedIds, setAvoidedIds] = useState<string[]>(initialAvoided)
  useEffect(() => { setAllergyIds(user.diet?.allergyIds ?? []) }, [user.diet?.allergyIds])
  useEffect(() => { setAvoidedIds(user.diet?.avoidedIngredientIds ?? []) }, [user.diet?.avoidedIngredientIds])

  const [ingredientOptions, setIngredientOptions] = useState<IngredientOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(true)
  useEffect(() => {
    fetchIngredientOptions().then((res) => {
      setIngredientOptions(res.data)
      setOptionsLoading(false)
    })
  }, [])

  const [search, setSearch] = useState('')
  const [savingMsg, setSavingMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const dirty =
    JSON.stringify([...allergyIds].sort()) !== JSON.stringify([...initialAllergies].sort()) ||
    JSON.stringify([...avoidedIds].sort()) !== JSON.stringify([...initialAvoided].sort())

  const allergies = dietCatalog?.allergies ?? []
  const avoidedSet = new Set(avoidedIds)

  // Filter ingredient suggestions on the search input. Only show 20 to keep
  // the list manageable; the user can refine the query if they don't see
  // what they want.
  const ingredientMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return ingredientOptions
      .filter((i) => !avoidedSet.has(i.id))
      .filter((i) =>
        i.nameEl.toLowerCase().includes(q) ||
        (i.nameEn ?? '').toLowerCase().includes(q),
      )
      .slice(0, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, ingredientOptions, avoidedIds.length])

  function toggleAllergy(id: string) {
    setAllergyIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    )
  }
  function addAvoided(id: string) {
    setAvoidedIds((curr) => (curr.includes(id) ? curr : [...curr, id]))
    setSearch('')
  }
  function removeAvoided(id: string) {
    setAvoidedIds((curr) => curr.filter((x) => x !== id))
  }

  async function save() {
    setSavingMsg(null); setErr(null)
    const [a, b] = await Promise.all([
      saveProfileAllergies(user.id, allergyIds),
      saveProfileAvoidedIngredients(user.id, avoidedIds),
    ])
    if (a.error || b.error) { setErr(a.error ?? b.error ?? 'Save failed'); return }
    updateDiet({ allergyIds: [...allergyIds], avoidedIngredientIds: [...avoidedIds] })
    setSavingMsg(isEl ? 'Αποθηκεύτηκε.' : 'Saved.')
    setTimeout(() => setSavingMsg(null), 1800)
  }

  const ingredientNameById = useMemo(() => {
    const m = new Map<string, IngredientOption>()
    for (const i of ingredientOptions) m.set(i.id, i)
    return m
  }, [ingredientOptions])

  return (
    <div className="tab-pane">
      <div className="tab-head">
        <h2>{isEl ? 'Διατροφή & αλλεργίες' : 'Diet & allergies'}</h2>
        <p className="tab-sub">
          {isEl
            ? 'Επίλεξε τις αλλεργίες σου και συγκεκριμένα συστατικά που δεν θέλεις να καταναλώνεις. Θα σου επισημαίνουμε διακριτικά τα πιάτα που σε αφορούν.'
            : 'Pick your allergies and any ingredients you want to avoid. We will flag matching dishes for you discreetly.'}
        </p>
      </div>

      {err && <div className="acc-error-banner">{err}</div>}
      {savingMsg && <div className="acc-info-banner">{savingMsg}</div>}

      {/* Allergies */}
      <section className="diet-section">
        <h3>{isEl ? 'Αλλεργίες' : 'Allergies'}</h3>
        <p className="diet-section-sub">
          {isEl
            ? 'Οι αλλεργίες συνδέονται με συστατικά — όταν διαλέξεις μια αλλεργία, επισημαίνουμε κάθε πιάτο που περιέχει συστατικά αυτής της κατηγορίας.'
            : 'Allergies are tied to ingredients — picking one flags every dish whose recipe contains matching ingredients.'}
        </p>
        {allergies.length === 0 ? (
          <div className="diet-empty">
            {isEl
              ? 'Δεν υπάρχουν διαθέσιμες αλλεργίες ακόμα.'
              : 'No allergies configured yet.'}
          </div>
        ) : (
          <div className="diet-allergy-grid">
            {allergies.map((a) => {
              const checked = allergyIds.includes(a.id)
              return (
                <label key={a.id} className={`diet-allergy-chip${checked ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAllergy(a.id)}
                  />
                  <span>{isEl ? a.nameEl : (a.nameEn ?? a.nameEl)}</span>
                </label>
              )
            })}
          </div>
        )}
      </section>

      {/* Avoided ingredients */}
      <section className="diet-section">
        <h3>{isEl ? 'Συστατικά προς αποφυγή' : 'Ingredients to avoid'}</h3>
        <p className="diet-section-sub">
          {isEl
            ? 'Συγκεκριμένα συστατικά που δεν θέλεις στο πιάτο σου (γεύση, θρησκευτικοί λόγοι, ό,τι άλλο).'
            : 'Specific ingredients you do not want on your plate (taste, religious reasons, anything else).'}
        </p>

        {avoidedIds.length > 0 && (
          <div className="diet-chips" style={{ marginBottom: 10 }}>
            {avoidedIds.map((id) => {
              const i = ingredientNameById.get(id)
              const label = i ? (isEl ? i.nameEl : (i.nameEn ?? i.nameEl)) : id
              return (
                <button
                  key={id}
                  type="button"
                  className="diet-chip"
                  onClick={() => removeAvoided(id)}
                  title={isEl ? 'Αφαίρεση' : 'Remove'}
                >
                  {label}
                  <span aria-hidden="true" style={{ marginLeft: 6 }}>×</span>
                </button>
              )
            })}
          </div>
        )}

        <input
          className="form-input"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isEl ? 'Αναζήτησε συστατικό…' : 'Search for an ingredient…'}
          disabled={optionsLoading}
        />
        {search.trim() && (
          <div className="diet-suggestions">
            {ingredientMatches.length === 0 ? (
              <div className="diet-empty" style={{ marginTop: 8 }}>
                {isEl ? 'Δεν βρέθηκε κανένα συστατικό.' : 'No ingredients matched.'}
              </div>
            ) : (
              ingredientMatches.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="diet-suggestion"
                  onClick={() => addAvoided(i.id)}
                >
                  + {isEl ? i.nameEl : (i.nameEn ?? i.nameEl)}
                </button>
              ))
            )}
          </div>
        )}
      </section>

      <div className="tab-actions">
        {/* WEC-344: was `.btn-save` — a small grey/transparent pill that
            looked disabled. The other tabs (Profile, Preferences, Goals)
            use `.btn-save-green` for their primary save action. Bringing
            this in line so customers immediately recognise it as the
            CTA. The disabled state at !dirty inherits the same grey
            treatment from .btn-save-green's :disabled selector. */}
        <button className="btn-save-green" disabled={!dirty} onClick={save}>
          {savingMsg
            ? '...'
            : (isEl ? 'Αποθήκευση' : 'Save')}
        </button>
        {err && <div className="tab-err" role="alert">{err}</div>}
      </div>
    </div>
  )
}
