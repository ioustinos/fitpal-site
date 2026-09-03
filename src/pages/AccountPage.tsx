import { useState, useEffect, useMemo } from 'react'
import PhoneInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import 'react-phone-number-input/style.css'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore, type Address } from '../store/useAuthStore'
import { makeTr } from '../lib/translations'
import { formatSlots } from '../lib/helpers'
import { MEAL_KEYS, mealLabel } from '../lib/planMeals'
import { useMenuStore } from '../store/useMenuStore'
import { Toggle } from '../components/ui/Toggle'
import { MacroIcon, MacroValuesRow } from '../components/ui/MacroDots'
import { WALLET_PLANS } from '../data/menu'
import { PAYMENT_METHODS as PAYMENT_COPY } from '../lib/paymentMethods'
import { visiblePaymentMethods, paymentCatalogEntry } from '../lib/paymentVisibility'
import { useImpersonationStore } from '../store/useImpersonationStore'
import { fetchPastWalletPlans, type PastWalletPlan } from '../lib/api/wallet'
import { COUNTRIES, DEFAULT_COUNTRY, isValidPhone, phoneLabels } from '../lib/phone'
import { showGoalProgress, goalStatus, goalPct } from '../lib/goals'
import { matchesRange, type RangePreset } from '../lib/dateRange'
import { DateRangeFilter } from '../components/shared/DateRangeFilter'
import { Pagination } from '../components/shared/Pagination'
import { PlacesAutocomplete } from '../components/ui/PlacesAutocomplete'
import { googleMapsAvailable } from '../lib/googleMaps'
import { ACCOUNT_TABS, accountTabLabel, logoutIcon, type AccountTab } from '../lib/accountNav'
import { OrderChangeRequestButton } from '../components/account/OrderChangeRequestButton'
import {
  fetchIngredientOptions,
  saveProfileAllergies,
  saveProfileAvoidedIngredients,
  type IngredientOption,
} from '../lib/api/diet'

/** WEC-169: orders list shows 50 per page; the pagination bar hides itself
 *  when the filtered list fits on one page. */
const ORDERS_PAGE_SIZE = 50

// AccountTab, the tab order, labels and icons now live in one place —
// ../lib/accountNav (ACCOUNT_TABS) — shared with the header user menu so the
// two navigations can never drift (WEC-518).

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

  // WEC-589: 'wallet' tab merged into 'subscription' — alias old deep-links
  // (/account?tab=wallet, header history, email links) onto the merged page.
  const normalizeTab = (tb: AccountTab | string | null | undefined): AccountTab =>
    (tb === 'wallet' ? 'subscription' : (tb as AccountTab)) || 'orders'
  const [tab, setTab] = useState<AccountTab>(normalizeTab(accountTab))

  useEffect(() => {
    if (accountTab) setTab(normalizeTab(accountTab))
  }, [accountTab])

  if (!user) return null

  const initials = (user.name ?? '')
    .split(' ')
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || '?'

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
          {ACCOUNT_TABS.map((tb) => (
            <button
              key={tb.key}
              className={`account-nav-item${tab === tb.key ? ' active' : ''}`}
              onClick={() => setTab(tb.key)}
            >
              {tb.icon}
              {accountTabLabel(tb.key, lang)}
            </button>
          ))}
          <button
            className="account-nav-item danger"
            onClick={handleSignOut}
          >
            {logoutIcon}
            {t('signOut')}
          </button>
        </nav>

        {/* Content */}
        <div className="account-content">
          {tab === 'orders' && <OrdersTab user={user} lang={lang} />}
          {tab === 'subscription' && <SubscriptionTab user={user} lang={lang} />}
          {tab === 'addresses' && <AddressesTab user={user} lang={lang} updateAddresses={updateAddresses} onGoToPrefs={() => setTab('prefs')} />}
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
  const t = makeTr(lang)
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
      <h2 className="tab-title">{t('acMyDetails')}</h2>
      <div className="profile-form">
        <div className="form-row">
          <label className="form-label">{t('fullName')}</label>
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
          <label className="form-label">{t('acPhone')}</label>
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
              {t('acInvalidPhone')}
            </div>
          )}
        </div>
      </div>
      <button className="btn-save-green" onClick={handleSave} disabled={saving}>
        {saving ? '...' : saved
          ? t('acSavedCheck')
          : t('saveAddr')}
      </button>

      <SetPasswordSection lang={lang} />
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Set / change password — optional, OTP-everywhere epic
─────────────────────────────────────────────────────────────────────────── */

function SetPasswordSection({ lang }: { lang: 'el' | 'en' }) {
  const t = makeTr(lang)
  const [open, setOpen] = useState(false)
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function handleSave() {
    setMsg(null)
    if (pwd.length < 6) {
      setMsg({ type: 'err', text: t('acPwdMin6') })
      return
    }
    if (pwd !== pwd2) {
      setMsg({ type: 'err', text: t('acPwdMismatch') })
      return
    }
    setBusy(true)
    const { updatePassword } = await import('../lib/api/auth')
    const { ok, error } = await updatePassword(pwd)
    setBusy(false)
    if (!ok) { setMsg({ type: 'err', text: error ?? 'Could not save password' }); return }
    setMsg({ type: 'ok', text: t('acPwdSaved') })
    setPwd(''); setPwd2('')
    setTimeout(() => setMsg(null), 3000)
  }

  return (
    <div className="set-password-section">
      <div className="set-password-head">
        <div>
          <div className="set-password-title">
            {t('acSignInPassword')}
          </div>
          <div className="set-password-desc">
            {t('acSignInPasswordDesc')}
          </div>
        </div>
        {!open && (
          <button className="btn-link-green" type="button" onClick={() => setOpen(true)}>
            {t('acSetChange')}
          </button>
        )}
      </div>

      {open && (
        <div className="set-password-form">
          <div className="form-row">
            <label className="form-label">{t('acNewPassword')}</label>
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
            <label className="form-label">{t('acConfirm')}</label>
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
              {busy ? '...' : t('saveAddr')}
            </button>
            <button
              className="btn-link-muted"
              type="button"
              onClick={() => { setOpen(false); setPwd(''); setPwd2(''); setMsg(null) }}
            >
              {t('acCancelShort')}
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

  // WEC-588: payment options now come from the admin visibility settings (the
  // same `paymentMethodVisibility` map checkout uses) instead of a hardcoded
  // list — a method turned off at /admin/payments no longer appears here. Admin
  // flags apply while an admin is impersonating; otherwise the public flags.
  // Compact `short*` labels from the shared payment-methods source.
  const visibility = useMenuStore((s) => s.settings.paymentMethodVisibility)
  const isImpersonating = useImpersonationStore((s) => s.active)
  const visibleMethods = visiblePaymentMethods(visibility, { isImpersonating }).map(
    (m) => ({ id: m.id, el: PAYMENT_COPY[m.id].shortEl, en: PAYMENT_COPY[m.id].shortEn }),
  )
  // Edge case: a saved preference that's no longer visible stays shown (selected)
  // but flagged — we never silently rewrite the stored value; the server keeps
  // accepting it.
  const savedMethod: string | undefined = prefs.paymentMethod
  const savedHiddenEntry = savedMethod && !visibleMethods.some((m) => m.id === savedMethod)
    ? paymentCatalogEntry(savedMethod)
    : undefined
  const savedHidden = savedHiddenEntry
    ? { id: savedHiddenEntry.id, el: PAYMENT_COPY[savedHiddenEntry.id].shortEl, en: PAYMENT_COPY[savedHiddenEntry.id].shortEn }
    : null

  // WEC-513: functional updates so editing a day-pref doesn't clobber an unsaved
  // payment-method / language change captured in a stale `prefs` closure.
  const setDayAddr = (dayIdx: number, addrId: string) => {
    setPrefs((prev: any) => ({ ...prev, dayAddress: { ...prev.dayAddress, [dayIdx]: addrId } }))
  }
  const setDaySlot = (dayIdx: number, slot: string) => {
    setPrefs((prev: any) => ({ ...prev, slots: { ...prev.slots, [dayIdx]: slot } }))
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
          {visibleMethods.map((pm) => (
            <button
              key={pm.id}
              className={`prefs-payment-btn${prefs.paymentMethod === pm.id ? ' active' : ''}`}
              onClick={() => setPrefs((prev: any) => ({ ...prev, paymentMethod: pm.id }))}
            >
              {lang === 'el' ? pm.el : pm.en}
            </button>
          ))}
          {/* WEC-588: saved-but-hidden preference — kept selectable + flagged. */}
          {savedHidden && (
            <button
              key={savedHidden.id}
              className={`prefs-payment-btn unavailable${prefs.paymentMethod === savedHidden.id ? ' active' : ''}`}
              title={lang === 'el' ? 'Δεν είναι πλέον διαθέσιμο' : 'No longer available'}
              onClick={() => setPrefs((prev: any) => ({ ...prev, paymentMethod: savedHidden.id }))}
            >
              {lang === 'el' ? savedHidden.el : savedHidden.en}{' '}
              <span className="prefs-payment-flag">{lang === 'el' ? '(μη διαθέσιμο)' : '(unavailable)'}</span>
            </button>
          )}
          {visibleMethods.length === 0 && !savedHidden && (
            <span className="prefs-empty">{lang === 'el' ? 'Καμία διαθέσιμη μέθοδος πληρωμής.' : 'No payment methods available.'}</span>
          )}
        </div>
      </div>

      {/* Dietary preference toggles (vegetarian / gluten-free / low-carb)
          removed: deprecated. They were persisted to user_prefs but never read
          by the app, Klaviyo, or Airtable. The live dietary feature is the
          Diet tab (allergies + avoided ingredients, WEC-250). */}

      {/* Language preference (WEC-141) */}
      <div className="prefs-section-card">
        <div className="prefs-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/>
          </svg>
          <div>
            <div className="prefs-section-title">
              {t('languageLbl')}
            </div>
            <div className="prefs-section-desc">
              {t('acLangDefaultDesc')}
            </div>
          </div>
        </div>
        <div className="prefs-payment-grid">
          <button
            type="button"
            className={`prefs-payment-btn${prefs.lang === 'el' ? ' active' : ''}`}
            onClick={() => setPrefs((prev: any) => ({ ...prev, lang: 'el' }))}
          >
            Ελληνικά
          </button>
          <button
            type="button"
            className={`prefs-payment-btn${prefs.lang === 'en' ? ' active' : ''}`}
            onClick={() => setPrefs((prev: any) => ({ ...prev, lang: 'en' }))}
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
            <span className="extra-label">{t('acEnableOnPage')}</span>
            <Toggle
              checked={prefs.goalTracking ?? false}
              onChange={(v) => setPrefs((prev: any) => ({ ...prev, goalTracking: v }))}
            />
          </div>
        </div>
      </div>

      <button className="btn-save-green" onClick={handleSave} disabled={saving}>
        {saving ? '...' : saved ? t('acSavedCheckPlural') : t('saveAddr')}
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WALLET TAB (unchanged — already matches demo)
═══════════════════════════════════════════════════════════════════════════════ */

// WEC-589: WalletTab removed — its balance card + transaction history were
// merged into SubscriptionTab (the «Συνδρομή & Πορτοφόλι» page).

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-79 — ADDRESSES TAB (labels, edit/delete, add form)
═══════════════════════════════════════════════════════════════════════════════ */

function AddressesTab({ user, lang, updateAddresses, onGoToPrefs }: any) {
  const t = makeTr(lang)
  const addresses: Address[] = user.addresses ?? []
  const [editing, setEditing] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const emptyAddr: Omit<Address, 'id'> = { labelEl: '', labelEn: '', street: '', area: '', zip: '', floor: '', doorbell: '', notes: '' }
  const [form, setForm] = useState(emptyAddr)

  const handleDelete = async (id: string) => {
    const msg = t('acConfirmDeleteAddress')
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
          <label className="form-label">{t('acLabel')}</label>
          {/* WEC-134: title-size input so the user feels they're naming
              the address rather than filling a side field. */}
          <input
            className="form-input form-input-title"
            placeholder={t('acLabelPlaceholder')}
            value={lang === 'el' ? form.labelEl : form.labelEn}
            onChange={(e) => setForm({ ...form, [lang === 'el' ? 'labelEl' : 'labelEn']: e.target.value })}
          />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">{t('street')}</label>
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
            placeholder={t('acStreetPlaceholder')}
            country="gr"
          />
        ) : (
          <input className="form-input" placeholder={t('acStreetPlaceholder')}
            value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
        )}
      </div>
      <div className="addr-form-2col">
        <div className="form-row">
          <label className="form-label">{t('acPostcodeDotted')}</label>
          <input className="form-input" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">{t('city')}</label>
          <input className="form-input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </div>
      </div>
      <div className="addr-form-2col">
        <div className="form-row">
          <label className="form-label">{t('floor')}</label>
          <input className="form-input" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
        </div>
        <div className="form-row">
          <label className="form-label">{t('doorbell')}</label>
          <input className="form-input" value={form.doorbell} onChange={(e) => setForm({ ...form, doorbell: e.target.value })} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">{t('acDeliveryNotes')}</label>
        <input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <div className="addr-form-actions">
        <button className="btn-save-green" onClick={onSave} disabled={saving}>
          {saving ? '...' : t('saveAddr')}
        </button>
        <button className="btn-cancel" onClick={() => { setEditing(null); setShowAdd(false) }} disabled={saving}>
          {t('acCancel')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="tab-section">
      <h2 className="tab-title">{t('acMyAddresses')}</h2>
      {/* WEC-210: discoverability affordance. Saved addresses are only
          auto-selected at checkout via per-weekday preferences (user_day_prefs).
          Per Ioustinos's 2026-06-27 decision we do NOT introduce a separate
          default-address setting; instead we point the user to the Preferences
          tab to set the address/time per weekday in the proper place. */}
      <button
        type="button"
        className="addr-prefs-link"
        onClick={onGoToPrefs}
        style={{
          background: 'none', border: 'none', padding: 0, marginBottom: 14,
          color: 'var(--green)', cursor: 'pointer', font: 'inherit', textAlign: 'left',
        }}
      >
        {t('acAddrPrefsLink')}
      </button>
      {addresses.length === 0 && !showAdd ? (
        <p className="tab-empty">{t('acNoSavedAddresses')}</p>
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
                            {addr.floor && <>{t('floor')}: {addr.floor}</>}
                            {addr.floor && addr.doorbell && ' · '}
                            {addr.doorbell && <>{t('doorbell')}: {addr.doorbell}</>}
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
                      {t('acEdit')}
                    </button>
                    <button className="addr-action-btn danger" onClick={() => handleDelete(addr.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                      {t('acDelete')}
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
          <h3 className="addr-new-title">{t('newAddress')}</h3>
          {renderForm(true, handleAdd)}
        </div>
      ) : (
        <button className="btn-add-addr" onClick={() => { setForm(emptyAddr); setShowAdd(true) }}>
          {t('newAddress')}
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

      {/* WEC-684: when the customer has a plan, the goal values were auto-filled
          from it (±5%). Say so, so they're not mistaken for junk / hand-typed. */}
      {!!user.wallet?.planId && (
        <p style={{ margin: '-4px 0 14px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          {lang === 'el'
            ? 'Οι στόχοι υπολογίστηκαν αυτόματα από το πλάνο σου (±5%). Μπορείς να τους αλλάξεις όποτε θες.'
            : 'These goals were auto-calculated from your plan (±5%). You can change them anytime.'}
        </p>
      )}

      {/* Enable toggle */}
      <div className="goals-enable-row">
        <Toggle
          checked={goals.enabled ?? false}
          onChange={(v) => setGoals({ ...goals, enabled: v })}
        />
        <div>
          <div className="goals-enable-label">{t('acEnableGoals')}</div>
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
        {saving ? '...' : saved ? t('acSavedCheckPlural') : t('saveAddr')}
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
        ? t('acOneDay')
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
          : t('acNutritionalIntake')}
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
          {t('acNoDataInRange')}
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
                      {t('acForecast')}
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
                      kcal: t('goalCalories'),
                      pro:  t('acProteinAbbr'),
                      carb: t('acCarbsAbbr'),
                      fat:  t('acFatLong'),
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
  const t = makeTr(lang)
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
    ? t('acOneOrder')
    : (lang === 'el' ? `${filtered.length} παραγγελίες` : `${filtered.length} orders`)

  return (
    <div className="tab-section">
      <h2 className="tab-title">{t('myOrders')}</h2>
      {orders.length === 0 ? (
        <p className="tab-empty">{t('acNoOrdersYet')}</p>
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
            <p className="tab-empty">{t('acNoOrdersInRange')}</p>
          ) : (
        <div className="orders-list">
          {pageOrders.map((order: any) => {
            const isOpen = expanded === order.id
            const totalDays = order.childOrders?.length ?? 0
            const totalItems = order.childOrders?.reduce((sum: number, c: any) => sum + (c.items?.length ?? 0), 0) ?? 0
            const statusLabel = lang === 'el' ? order.statusEl : order.statusEn
            const paymentLabel = lang === 'el' ? order.paymentEl : order.paymentEn

            return (
              <div key={order.id} className={`order-card${isOpen ? ' open' : ''}${order.statusRaw ? ' st-' + order.statusRaw : ''}`}>
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
                    <span className={`order-status-badge${order.statusRaw ? ' st-' + order.statusRaw : ''}`}>{statusLabel}</span>
                    <span className="order-card-total">{order.total?.toFixed(2)} €</span>
                    <svg className={`order-acc-arrow${isOpen ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {/* Summary line */}
                {isOpen && (
                  <div className="order-card-body">
                    <div className="order-summary-line">
                      {/* WEC-514: SVG icons (house style) + count-aware Greek plural */}
                      <span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        {' '}{totalDays} {totalDays === 1 ? t('acDay') : t('acDays')}
                      </span>
                      <span>·</span>
                      <span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><path d="M3 2v7a2 2 0 002 2 2 2 0 002-2V2M5 11v11"/><path d="M17 2a4 4 0 00-2 7v13"/></svg>
                        {' '}{totalItems} {totalItems === 1 ? t('acDish') : t('acDishes')}
                      </span>
                      <span>·</span>
                      <span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                        {' '}{paymentLabel}
                      </span>
                    </div>

                    {/* WEC-557: change-request UI is the <OrderChangeRequestButton/>
                        rendered below (modal + reason + details). The old inline
                        placeholder button here was dead (no onClick) — removed. */}

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
                              <span className="order-day-subtotal">{child.subtotal?.toFixed(2)} €</span>
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
                                  { cls: 'cal',     key: 'cal',     icon: 'cal',  label: t('goalCalories'),     val: child.macros.cal },
                                  { cls: 'carbs',   key: 'carbs',   icon: 'carb', label: t('goalCarbs'),   val: child.macros.carbs,   unit: 'g' },
                                  { cls: 'protein', key: 'protein', icon: 'pro',  label: t('goalProtein'),     val: child.macros.protein, unit: 'g' },
                                  { cls: 'fat',     key: 'fat',     icon: 'fat',  label: t('acFatLong'),           val: child.macros.fat,     unit: 'g' },
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
                                    <span className="order-item-price">{item.price?.toFixed(2)} €</span>
                                  </div>
                                </div>
                              ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  {/* WEC-557 — «Αίτημα αλλαγής» for still-actionable orders. */}
                  <OrderChangeRequestButton
                    orderId={order.orderId}
                    orderStatusRaw={order.statusRaw}
                    userId={user.id}
                    lang={lang}
                  />
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
  const t = makeTr(lang)
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
    setSavingMsg(t('acSavedDot'))
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
        <h2>{t('acDietAllergiesTitle')}</h2>
        <p className="tab-sub">
          {t('acDietAllergiesSub')}
        </p>
      </div>

      {err && <div className="acc-error-banner">{err}</div>}
      {savingMsg && <div className="acc-info-banner">{savingMsg}</div>}

      {/* Allergies */}
      <section className="diet-section">
        <h3>{t('acAllergies')}</h3>
        <p className="diet-section-sub">
          {t('acAllergiesSub')}
        </p>
        {allergies.length === 0 ? (
          <div className="diet-empty">
            {t('acNoAllergiesConfigured')}
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
        <h3>{t('acIngredientsToAvoid')}</h3>
        <p className="diet-section-sub">
          {t('acIngredientsToAvoidSub')}
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
                  title={t('voucherRemove')}
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
          placeholder={t('acSearchIngredient')}
          disabled={optionsLoading}
        />
        {search.trim() && (
          <div className="diet-suggestions">
            {ingredientMatches.length === 0 ? (
              <div className="diet-empty" style={{ marginTop: 8 }}>
                {t('acNoIngredientsMatched')}
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
            : t('saveAddr')}
        </button>
        {err && <div className="tab-err" role="alert">{err}</div>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-349 — SUBSCRIPTION TAB
   Plan composition, discounts, dates, and a wallet-balance summary that
   links to the existing Wallet tab for the money side of things.

   This tab is the "what plan did I buy" view. The Wallet tab next to it
   is the "where is my money" view. Two distinct concerns, both kept.

   Source-of-truth caveats (see WEC-349 description):
   - user.wallet exposes: planId, planEl, planEn, balance, baseBalance,
     bonusBalance, bonusPct, autoRenew, nextRenewal, monthlyAmount,
     creditAmount, transactions, adminManaged.
   - Not yet exposed from wallet_plans (rendered as "—" placeholders):
     created_at (start date), bonus_expires_at, frequency enum,
     people count, days_per_week, meal_breakfast/lunch/dinner flags,
     bonus_amount (vs the percentage).
   Followup: extend fetchWallet() to join wallet_plans → swap the
   placeholders for real fields, one prop at a time. The placeholders
   are explicitly "—" so the gap is visible during dogfooding.
═══════════════════════════════════════════════════════════════════════════════ */

function SubscriptionTab({ user, lang }: any) {
  // WEC-589: merged Συνδρομή + Πορτοφόλι into one page. Layout top→bottom:
  // hero (plan) · promoted balance card · plan composition/pricing · initial
  // purchase · transaction history (Κινήσεις) · past plans · help footer.
  const wallet = user.wallet
  const goToWalletPage = useUIStore((s) => s.goToWalletPage)
  const closeAccount = useUIStore((s) => s.closeAccount)
  const isEl = lang === 'el'
  const t = makeTr(lang)

  // Past (non-active) plans — lazy-loaded when the section is expanded.
  const [pastOpen, setPastOpen] = useState(false)
  const [pastPlans, setPastPlans] = useState<PastWalletPlan[] | null>(null)
  const [pastLoading, setPastLoading] = useState(false)
  const togglePast = async () => {
    if (pastPlans !== null) { setPastOpen((o) => !o); return }
    setPastLoading(true)
    const { data } = await fetchPastWalletPlans(user.id, wallet?.planId)
    setPastPlans(data ?? [])
    setPastLoading(false)
    setPastOpen(true)
  }

  const pageTitle = isEl ? 'Συνδρομή & Πορτοφόλι' : 'Subscription & Wallet'

  // No wallet at all → subscription empty state (build your plan).
  if (!wallet?.active) {
    return (
      <div className="tab-section">
        <h2 className="tab-title">{pageTitle}</h2>
        <div className="aw-empty">
          <div className="aw-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
          </div>
          <div className="aw-empty-title">{t('acNoSubscriptionYet')}</div>
          <div className="aw-empty-desc">{t('acNoSubscriptionDesc')}</div>
          <button className="aw-btn aw-btn-topup" onClick={() => { closeAccount(); setTimeout(() => goToWalletPage(), 300) }}>
            {t('acBuildYourPlan')}
          </button>
        </div>
      </div>
    )
  }

  const hasPlan = !!wallet.planId
  const legacyPlan = WALLET_PLANS.find((p) => p.id === wallet.planId)
  const planName =
    (isEl ? wallet.planEl : wallet.planEn) ??
    (legacyPlan ? (isEl ? legacyPlan.nameEl : legacyPlan.nameEn) : undefined) ??
    t('acSubscriptionFallback')

  const fmtDate = (iso?: string | null) => {
    if (!iso) return null
    return new Date(iso + 'T12:00:00').toLocaleDateString(isEl ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const renewDate = fmtDate(wallet.nextRenewal)
  const eur = (n: number | undefined | null) => (typeof n === 'number' ? `${n.toFixed(2)} €` : '—')
  const pct = (n: number | undefined | null) => (typeof n === 'number' ? `+${n}%` : '—')

  const baseBalance = wallet.baseBalance ?? wallet.balance
  const bonusBalance = wallet.bonusBalance ?? 0
  const bonusPctValue = wallet.bonusPct ?? (legacyPlan?.bonusPct ?? null)
  const cycleCost = wallet.monthlyAmount ?? legacyPlan?.price ?? null
  // WEC-510: total credits = base + bonus (never re-apply bonus %).
  const cycleCredits = (wallet.baseBalance != null || wallet.bonusBalance != null)
    ? (wallet.baseBalance ?? 0) + (wallet.bonusBalance ?? 0)
    : (wallet.creditAmount ?? legacyPlan?.credits ?? null)

  const TODO_DASH = '—'
  const startDateStr = fmtDate(wallet.startDate)
  const bonusExpiresStr = fmtDate(wallet.bonusExpiresAt)
  // WEC-686: use the shared helper so Σνακ is never dropped again (three
  // hand-rolled copies had missed it). Map the wallet.meals shape → helper keys.
  const selectedMeals = wallet.meals
    ? MEAL_KEYS.filter((k) => wallet.meals![k]).map((k) => ({ key: k, label: mealLabel(k, lang) }))
    : []

  return (
    <div className="tab-section">
      <h2 className="tab-title">{pageTitle}</h2>

      {/* 1. HERO — plan name + active badge + key dates (plan only) */}
      {hasPlan && (
        <div className="subs-hero">
          <div className="subs-hero-top">
            <div className="subs-hero-name">{planName}</div>
            <span className="subs-status subs-status-active">
              <span className="subs-status-dot" />
              {t('acActive')}
            </span>
          </div>
          <div className="subs-hero-meta">
            <div className="subs-meta-item">
              <span className="subs-meta-label">{t('acStart')}</span>
              <span className="subs-meta-value">{startDateStr ?? TODO_DASH}</span>
            </div>
            <div className="subs-meta-divider" aria-hidden />
            <div className="subs-meta-item">
              <span className="subs-meta-label">{t('acNextRenewal')}</span>
              <span className="subs-meta-value">{renewDate ?? TODO_DASH}</span>
            </div>
            <div className="subs-meta-divider" aria-hidden />
            <div className="subs-meta-item">
              <span className="subs-meta-label">{t('acBonusExpires')}</span>
              <span className="subs-meta-value">{bonusExpiresStr ?? TODO_DASH}</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Live balance card (promoted) — rendered ONCE here */}
      <div className="acct-wallet-card">
        <div className="aw-label">{t('acAvailableBalance')}</div>
        <div className="aw-balance">{wallet.balance.toFixed(2)} €</div>
        <div className="aw-detail">
          {isEl
            ? `Βάση: ${baseBalance.toFixed(2)} € · Bonus: ${bonusBalance.toFixed(2)} €`
            : `Base: ${baseBalance.toFixed(2)} € · Bonus: ${bonusBalance.toFixed(2)} €`}
        </div>
        {hasPlan && renewDate && (
          <div className="aw-detail" style={{ marginTop: 6 }}>
            {isEl ? `Επόμενη ανανέωση: ${renewDate}` : `Next renewal: ${renewDate}`}
          </div>
        )}
      </div>

      {/* 3. TWO-COL GRID: composition + pricing (plan only) */}
      {hasPlan && (
        <div className="subs-grid">
          <div className="subs-card">
            <div className="subs-card-title">{t('acPlanComposition')}</div>
            <div className="subs-rows">
              <div className="subs-row">
                <span className="subs-row-key">{t('acMeals')}</span>
                <span className="subs-row-val">
                  {selectedMeals.length > 0
                    ? selectedMeals.map((m) => (<span key={m.key} className="subs-pill">{m.label}</span>))
                    : <span className="subs-pill subs-pill-dim">{TODO_DASH}</span>}
                </span>
              </div>
              <div className="subs-row">
                <span className="subs-row-key">{t('acPeople')}</span>
                <span className="subs-row-val">{wallet.people ?? TODO_DASH}</span>
              </div>
              <div className="subs-row">
                <span className="subs-row-key">{t('acDaysPerWeek')}</span>
                <span className="subs-row-val">{wallet.daysPerWeek ?? TODO_DASH}</span>
              </div>
            </div>
          </div>

          <div className="subs-card">
            <div className="subs-card-title">{t('acPricingBonus')}</div>
            <div className="subs-rows">
              <div className="subs-row">
                <span className="subs-row-key">{t('acCycleCost')}</span>
                <span className="subs-row-val">{eur(cycleCost)}</span>
              </div>
              <div className="subs-row">
                <span className="subs-row-key">{t('acBonus')}</span>
                <span className="subs-row-val subs-emph">{pct(bonusPctValue)}</span>
              </div>
              <div className="subs-row">
                <span className="subs-row-key">{t('acTotalCredits')}</span>
                <span className="subs-row-val">{eur(cycleCredits)}</span>
              </div>
              <div className="subs-row">
                <span className="subs-row-key">{t('acAutoRenew')}</span>
                <span className="subs-row-val">{wallet.autoRenew ? t('acYes') : t('acNo')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Αρχική αγορά (initial purchase) — plan only */}
      {hasPlan && (
        <div className="subs-card subs-initial">
          <div className="subs-card-title">{isEl ? 'Αρχική αγορά' : 'Initial purchase'}</div>
          <div className="subs-rows">
            <div className="subs-row">
              <span className="subs-row-key">{isEl ? 'Ποσό αγοράς' : 'Amount paid'}</span>
              <span className="subs-row-val">{eur(wallet.purchaseAmount)}</span>
            </div>
            <div className="subs-row">
              <span className="subs-row-key">{isEl ? 'Δώρο (bonus)' : 'Bonus credit'}</span>
              <span className="subs-row-val subs-emph">
                {typeof wallet.purchaseBonus === 'number' && wallet.purchaseBonus > 0 ? `+${eur(wallet.purchaseBonus)}` : '—'}
              </span>
            </div>
            <div className="subs-row">
              <span className="subs-row-key">{isEl ? 'Συνολικό αρχικό υπόλοιπο' : 'Total initial balance'}</span>
              <span className="subs-row-val subs-emph">{eur(wallet.purchaseCredit)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 5. Κινήσεις — transaction history (moved from the old Wallet tab) */}
      <div className="aw-history">
        <div className="aw-history-title">{t('acTransactionHistory')}</div>
        {wallet.transactions && wallet.transactions.length > 0 ? (
          wallet.transactions.map((tx: any, i: number) => {
            const isCredit = tx.type === 'credit'
            const txDate = new Date(tx.date + 'T12:00:00').toLocaleDateString(isEl ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
            return (
              <div key={i} className="aw-tx">
                <div className={`aw-tx-icon ${isCredit ? 'credit' : 'debit'}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    {isCredit
                      ? <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>
                      : <line x1="5" y1="12" x2="19" y2="12"/>}
                  </svg>
                </div>
                <div className="aw-tx-info">
                  <div className="aw-tx-desc">{isEl ? tx.descEl : tx.descEn}</div>
                  <div className="aw-tx-date">{txDate}</div>
                </div>
                <div className={`aw-tx-amt ${isCredit ? 'credit' : 'debit'}`}>
                  {isCredit ? '+' : '−'}{Math.abs(tx.amount).toFixed(2)} €
                </div>
              </div>
            )
          })
        ) : (
          <div className="aw-empty-txns">{t('acNoTransactions')}</div>
        )}
      </div>

      {/* 6. Προηγούμενα πλάνα — past plans (WEC-349 gap), lazy on expand */}
      <div className="subs-card subs-past">
        <button type="button" className="subs-past-toggle" onClick={togglePast} aria-expanded={pastOpen}>
          <span>{isEl ? 'Προηγούμενα πλάνα' : 'Past plans'}</span>
          <svg className={`subs-past-chev${pastOpen ? ' open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {pastOpen && (
          pastLoading
            ? <div className="subs-past-msg">{isEl ? 'Φόρτωση…' : 'Loading…'}</div>
            : (pastPlans && pastPlans.length > 0)
              ? <div className="subs-past-list">
                  {pastPlans.map((pp) => (
                    <div key={pp.id} className="subs-past-row">
                      <div className="subs-past-main">
                        <span className="subs-past-name">{isEl ? pp.labelEl : pp.labelEn}</span>
                        <span className="subs-past-date">{fmtDate(pp.createdAt) ?? '—'}</span>
                      </div>
                      <div className="subs-past-nums">
                        <span className="subs-past-paid">{eur(pp.amountPaid)}</span>
                        <span className="subs-past-credits">{isEl ? 'credits' : 'credits'} {eur(pp.credits)}</span>
                        {pp.paymentStatus && pp.paymentStatus !== 'paid' && (
                          <span className="subs-past-status">{pp.paymentStatus}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              : <div className="subs-past-msg">{isEl ? 'Δεν υπάρχουν προηγούμενα πλάνα.' : 'No past plans yet.'}</div>
        )}
      </div>

      {/* 7. Help footer */}
      <div className="subs-help">
        {t('acSubsHelpContact')}
        <a href="mailto:support@fitpal.gr">support@fitpal.gr</a>.
      </div>
    </div>
  )
}
