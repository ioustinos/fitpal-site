import { useState, useEffect } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore, type Address, type MacroRange } from '../store/useAuthStore'
import { makeTr } from '../lib/translations'
import { formatSlots } from '../lib/helpers'
import { useMenuStore } from '../store/useMenuStore'
import { Toggle } from '../components/ui/Toggle'
import { MacroIcon } from '../components/ui/MacroDots'
import { WALLET_PLANS } from '../data/menu'

type AccountTab = 'orders' | 'wallet' | 'addresses' | 'goals' | 'prefs' | 'profile'

/* ─── SVG icon helpers ──────────────────────────────────────────────────────── */

const icons: Record<AccountTab | 'logout', JSX.Element> = {
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
  const accountTab = useUIStore((s) => s.accountTab)
  const { user, logout, updatePrefs, updateGoals, updateAddresses } = useAuthStore()
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
            onClick={() => { logout(); closeAccount() }}
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
  const [name, setName] = useState(user.name ?? '')
  const [email] = useState(user.email ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const { updateProfile } = await import('../lib/api/auth')
    const { error } = await updateProfile(user.id, { name, phone })
    if (!error) {
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
          <input className="form-input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} disabled style={{ opacity: 0.6 }} />
        </div>
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Τηλέφωνο' : 'Phone'}</label>
          <input className="form-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <button className="btn-save-green" onClick={handleSave} disabled={saving}>
        {saving ? '...' : saved
          ? (lang === 'el' ? '✓ Αποθηκεύτηκε' : '✓ Saved')
          : (lang === 'el' ? 'Αποθήκευση' : 'Save')}
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WEC-81 — PREFERENCES TAB (per-day delivery, payment, dietary)
═══════════════════════════════════════════════════════════════════════════════ */

function PrefsTab({ user, lang, updatePrefs }: any) {
  const t = makeTr(lang)
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
    const { updateAddress } = await import('../lib/api/auth')
    const { error } = await updateAddress(id, form)
    if (!error) {
      updateAddresses(addresses.map(a => a.id === id ? { ...a, ...form } : a))
      setEditing(null)
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

  const renderForm = (isNew: boolean, onSave: () => void) => (
    <div className="addr-form">
      <div className="addr-form-row">
        <div className="form-row">
          <label className="form-label">{lang === 'el' ? 'Ετικέτα' : 'Label'}</label>
          <input className="form-input" placeholder={lang === 'el' ? 'π.χ. Σπίτι' : 'e.g. Home'}
            value={lang === 'el' ? form.labelEl : form.labelEn}
            onChange={(e) => setForm({ ...form, [lang === 'el' ? 'labelEl' : 'labelEn']: e.target.value })}
          />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">{lang === 'el' ? 'Οδός & Αριθμός' : 'Street & Number'}</label>
        <input className="form-input" placeholder={lang === 'el' ? 'π.χ. Λεωφ. Κηφισίας 45' : 'e.g. 45 Kifisias Ave'}
          value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
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
            <div key={addr.id} className="addr-card">
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

      {/* ── Intake History from past orders ── */}
      {goals.enabled && user.orders && user.orders.length > 0 && (
        <IntakeHistory user={user} goals={goals} lang={lang} t={t} />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════════
   INTAKE HISTORY — macro tracking from past orders inside Goals tab
═══════════════════════════════════════════════════════════════════════════════ */

/** Returns 'ok' | 'below' | 'above' | null based on value vs goal range */
function goalStatus(key: string, value: number, goals: any): string | null {
  if (!goals?.enabled) return null
  // Map from order data keys to goal keys
  const goalKeyMap: Record<string, string> = { cal: 'calories', protein: 'protein', carbs: 'carbs', fat: 'fat' }
  const gKey = goalKeyMap[key] ?? key
  const g = goals[gKey]
  if (!g || typeof g !== 'object') return null
  if (g.min && value < g.min) return 'below'
  if (g.max && value > g.max) return 'above'
  if (g.min || g.max) return 'ok'
  return null
}

/** Returns progress percentage (0–120) relative to goal max */
function goalPct(key: string, value: number, goals: any): number {
  if (!goals?.enabled) return 0
  const goalKeyMap: Record<string, string> = { cal: 'calories', protein: 'protein', carbs: 'carbs', fat: 'fat' }
  const gKey = goalKeyMap[key] ?? key
  const g = goals[gKey]
  if (!g || typeof g !== 'object' || !g.max) return 0
  return Math.min(120, Math.round((value / g.max) * 100))
}

/* miniBarIcons — now uses <MacroIcon> from MacroDots.tsx */

function IntakeHistory({ user, goals, lang, t }: { user: any; goals: any; lang: 'el' | 'en'; t: (k: string) => string }) {
  const orders = user.orders ?? []

  return (
    <div className="intake-history">
      <h3 className="tab-subtitle" style={{ marginTop: 32 }}>{t('goalIntakeHistory')}</h3>
      {orders.map((order: any) => {
        const dateLbl = new Date(order.date + (order.date.includes('T') ? '' : 'T12:00:00'))
          .toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        const isActive = order.status === 'active'

        return (
          <div key={order.id} className="intake-order-card">
            <div className="intake-order-hdr">
              <span>{order.id} — {dateLbl}</span>
              <span className={`order-status-badge${isActive ? ' active' : ''}`}>
                {isActive ? (lang === 'el' ? 'Ενεργή' : 'Active') : (lang === 'el' ? 'Παραδόθηκε' : 'Delivered')}
              </span>
            </div>
            {order.childOrders?.map((child: any, ci: number) => {
              const m = child.macros ?? { cal: 0, protein: 0, carbs: 0, fat: 0 }
              const dayName = lang === 'el' ? child.dayLabel : child.dayLabelEn
              const bars: Array<{ k: string; v: number; icon: JSX.Element }> = [
                { k: 'cal', v: m.cal, icon: <MacroIcon type="cal" /> },
                { k: 'protein', v: m.protein, icon: <MacroIcon type="pro" /> },
                { k: 'carbs', v: m.carbs, icon: <MacroIcon type="carb" /> },
                { k: 'fat', v: m.fat, icon: <MacroIcon type="fat" /> },
              ]
              return (
                <div key={ci} className="intake-day-row">
                  <div className="intake-day-name">{dayName}</div>
                  <div className="intake-bars">
                    {bars.map((b) => {
                      const s = goalStatus(b.k, b.v, goals)
                      const pct = goalPct(b.k, b.v, goals)
                      return (
                        <div key={b.k} className="intake-mini-bar">
                          {b.icon}
                          <div className="intake-mini-track">
                            <div
                              className={`intake-mini-fill ${s ?? 'none'}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <div className="intake-mini-val">{b.v}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
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

  const toggleDay = (key: string) => setExpandedDays(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Οι Παραγγελίες μου' : 'My Orders'}</h2>
      {orders.length === 0 ? (
        <p className="tab-empty">{lang === 'el' ? 'Δεν υπάρχουν παραγγελίες.' : 'No orders yet.'}</p>
      ) : (
        <div className="orders-list">
          {orders.map((order: any) => {
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
                      {new Date(order.date + 'T12:00:00').toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
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
                              {/* Macro summary cards */}
                              {child.macros && (
                                <div className="order-macros-row">
                                  <div className="order-macro-card cal">
                                    <div className="order-macro-icon cal"><MacroIcon type="cal" /></div>
                                    <span className="order-macro-label">{lang === 'el' ? 'Θερμίδες' : 'Calories'}</span>
                                    <span className="order-macro-val">{child.macros.cal}</span>
                                  </div>
                                  <div className="order-macro-card carbs">
                                    <div className="order-macro-icon carbs"><MacroIcon type="carb" /></div>
                                    <span className="order-macro-label">{lang === 'el' ? 'Υδατάνθρακες' : 'Carbs'}</span>
                                    <span className="order-macro-val">{child.macros.carbs}<small>g</small></span>
                                  </div>
                                  <div className="order-macro-card protein">
                                    <div className="order-macro-icon protein"><MacroIcon type="pro" /></div>
                                    <span className="order-macro-label">{lang === 'el' ? 'Πρωτεΐνη' : 'Protein'}</span>
                                    <span className="order-macro-val">{child.macros.protein}<small>g</small></span>
                                  </div>
                                  <div className="order-macro-card fat">
                                    <div className="order-macro-icon fat"><MacroIcon type="fat" /></div>
                                    <span className="order-macro-label">{lang === 'el' ? 'Λιπαρά' : 'Fat'}</span>
                                    <span className="order-macro-val">{child.macros.fat}<small>g</small></span>
                                  </div>
                                </div>
                              )}

                              {/* Items */}
                              <div className="order-child-items">
                              {child.items?.map((item: any, ii: number) => (
                                <div key={ii} className="order-item-row">
                                  {/* Quantity badge on far left */}
                                  <span className="order-item-qty-badge">{item.qty}x</span>

                                  <div className="order-item-left">
                                    <span className="order-item-name">{lang === 'el' ? item.nameEl : item.nameEn}</span>
                                    {item.variantDetail && (
                                      <span className="order-item-variant-detail">{item.variantDetail}</span>
                                    )}
                                    {(item.descEl || item.descEn) && (
                                      <span className="order-item-desc">{lang === 'el' ? item.descEl : item.descEn}</span>
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
    </div>
  )
}
