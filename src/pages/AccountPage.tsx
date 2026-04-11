import { useState } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { makeTr } from '../lib/translations'
import { Toggle } from '../components/ui/Toggle'

type AccountTab = 'profile' | 'addresses' | 'goals' | 'orders'

export function AccountPage() {
  const lang = useUIStore((s) => s.lang)
  const closeAccount = useUIStore((s) => s.closeAccount)
  const { user, logout, updatePrefs, updateGoals } = useAuthStore()
  const t = makeTr(lang)

  const [tab, setTab] = useState<AccountTab>('profile')

  if (!user) return null
  const tabLabels: Record<AccountTab, { el: string; en: string }> = {
    profile:   { el: 'Προφίλ', en: 'Profile' },
    addresses: { el: 'Διευθύνσεις', en: 'Addresses' },
    goals:     { el: 'Στόχοι', en: 'Goals' },
    orders:    { el: 'Παραγγελίες', en: 'Orders' },
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
        <h1 className="account-title">{lang === 'el' ? 'Ο Λογαριασμός μου' : 'My Account'}</h1>
      </div>

      <div className="account-layout">
        {/* Tab nav */}
        <nav className="account-nav">
          {(Object.keys(tabLabels) as AccountTab[]).map((k) => (
            <button
              key={k}
              className={`account-nav-item${tab === k ? ' active' : ''}`}
              onClick={() => setTab(k)}
            >
              {lang === 'el' ? tabLabels[k].el : tabLabels[k].en}
            </button>
          ))}
          <button
            className="account-nav-item danger"
            onClick={() => { logout(); closeAccount() }}
          >
            {lang === 'el' ? 'Αποσύνδεση' : 'Sign Out'}
          </button>
        </nav>

        {/* Content */}
        <div className="account-content">
          {tab === 'profile' && (
            <ProfileTab user={user} lang={lang} updatePrefs={updatePrefs} t={t} />
          )}
          {tab === 'addresses' && (
            <AddressesTab user={user} lang={lang} />
          )}
          {tab === 'goals' && (
            <GoalsTab user={user} lang={lang} updateGoals={updateGoals} />
          )}
          {tab === 'orders' && (
            <OrdersTab user={user} lang={lang} />
          )}
        </div>
      </div>
    </div>
  )
}

function ProfileTab({ user, lang, updatePrefs }: any) {
  const [prefs, setPrefs] = useState({ ...user.prefs })

  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Πληροφορίες' : 'Information'}</h2>
      <div className="profile-info-grid">
        <div className="info-row">
          <span className="info-label">{lang === 'el' ? 'Όνομα' : 'Name'}</span>
          <span className="info-val">{user.name}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Email</span>
          <span className="info-val">{user.email}</span>
        </div>
        {user.phone && (
          <div className="info-row">
            <span className="info-label">{lang === 'el' ? 'Τηλέφωνο' : 'Phone'}</span>
            <span className="info-val">{user.phone}</span>
          </div>
        )}
      </div>

      <h2 className="tab-title" style={{ marginTop: 24 }}>
        {lang === 'el' ? 'Προτιμήσεις' : 'Preferences'}
      </h2>
      <div className="prefs-list">
        <div className="extra-row">
          <span className="extra-label">{lang === 'el' ? 'Χορτοφάγος' : 'Vegetarian'}</span>
          <Toggle
            checked={prefs.vegetarian ?? false}
            onChange={(v) => { const p = { ...prefs, vegetarian: v }; setPrefs(p); updatePrefs(p) }}
          />
        </div>
        <div className="extra-row">
          <span className="extra-label">{lang === 'el' ? 'Χωρίς γλουτένη' : 'Gluten free'}</span>
          <Toggle
            checked={prefs.glutenFree ?? false}
            onChange={(v) => { const p = { ...prefs, glutenFree: v }; setPrefs(p); updatePrefs(p) }}
          />
        </div>
        <div className="extra-row">
          <span className="extra-label">{lang === 'el' ? 'Low Carb' : 'Low Carb'}</span>
          <Toggle
            checked={prefs.lowCarb ?? false}
            onChange={(v) => { const p = { ...prefs, lowCarb: v }; setPrefs(p); updatePrefs(p) }}
          />
        </div>
      </div>
    </div>
  )
}

function AddressesTab({ user, lang }: any) {
  const addresses = user.addresses ?? []
  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Αποθηκευμένες διευθύνσεις' : 'Saved addresses'}</h2>
      {addresses.length === 0 ? (
        <p className="tab-empty">{lang === 'el' ? 'Δεν υπάρχουν αποθηκευμένες διευθύνσεις.' : 'No saved addresses.'}</p>
      ) : (
        <div className="addr-list">
          {addresses.map((addr: any, i: number) => (
            <div key={i} className="addr-card readonly">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <div>
                <div className="addr-street">{addr.street}</div>
                <div className="addr-area">{addr.area}{addr.zip ? `, ${addr.zip}` : ''}</div>
                {addr.notes && <div className="addr-notes">{addr.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GoalsTab({ user, lang, updateGoals }: any) {
  const [goals, setGoals] = useState({ ...user.goals })

  const fields = [
    { key: 'calories', label: { el: 'Θερμίδες (kcal)', en: 'Calories (kcal)' } },
    { key: 'protein',  label: { el: 'Πρωτεΐνη (g)', en: 'Protein (g)' } },
    { key: 'carbs',    label: { el: 'Υδατάνθρακες (g)', en: 'Carbohydrates (g)' } },
    { key: 'fat',      label: { el: 'Λίπος (g)', en: 'Fat (g)' } },
  ]

  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Ημερήσιοι στόχοι' : 'Daily goals'}</h2>
      <div className="goals-grid">
        {fields.map(({ key, label }) => (
          <div key={key} className="form-row">
            <label className="form-label">{lang === 'el' ? label.el : label.en}</label>
            <input
              className="form-input"
              type="number"
              value={goals[key] ?? ''}
              onChange={(e) => {
                const g = { ...goals, [key]: Number(e.target.value) }
                setGoals(g)
                updateGoals(g)
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function OrdersTab({ user, lang }: any) {
  const orders = user.orders ?? []
  return (
    <div className="tab-section">
      <h2 className="tab-title">{lang === 'el' ? 'Ιστορικό παραγγελιών' : 'Order history'}</h2>
      {orders.length === 0 ? (
        <p className="tab-empty">{lang === 'el' ? 'Δεν υπάρχουν παραγγελίες.' : 'No orders yet.'}</p>
      ) : (
        orders.map((order: any) => (
          <div key={order.id} className="order-row">
            <div className="order-row-id">#{order.id}</div>
            <div className="order-row-date">{order.date}</div>
            <div className="order-row-status">{order.status}</div>
            <div className="order-row-total">€{order.total?.toFixed(2)}</div>
          </div>
        ))
      )}
    </div>
  )
}
