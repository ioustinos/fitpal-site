import { useUIStore } from '../store/useUIStore'
import { useCartStore } from '../store/useCartStore'
import { useAuthStore } from '../store/useAuthStore'
import { DayNav } from '../components/menu/DayNav'
import { CategoryFilter } from '../components/menu/CategoryFilter'
import { CutoffBar } from '../components/menu/CutoffBar'
import { MenuSection } from '../components/menu/MenuSection'
import { CartSidebar } from '../components/cart/CartSidebar'
import { MENU, SNACKS, WEEK_DATA, WALLET_PLANS } from '../data/menu'
import { makeTr } from '../lib/translations'

/** Returns "6–10 Απρ" or "6–10 Apr" from week days */
function weekDateRange(days: { date: string }[], lang: 'el' | 'en'): string {
  const first = days[0]?.date
  const last = days[days.length - 1]?.date
  if (!first || !last) return ''
  const d1 = new Date(first + 'T12:00:00')
  const d2 = new Date(last + 'T12:00:00')
  const month = d2.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { month: 'short' })
  return `${d1.getDate()}–${d2.getDate()} ${month}`
}

export function MenuPage() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const openWalletModal = useUIStore((s) => s.openWalletModal)
  const goToWalletPage = useUIStore((s) => s.goToWalletPage)
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  const week = WEEK_DATA[activeWeek] ?? WEEK_DATA[0]
  const day = week.days[activeDay]
  const dishIds = day?.dishIds ?? []

  // Combine day-specific dishes + snacks, deduplicate by ID
  const dayDishes = dishIds.map((id) => MENU[id]).filter(Boolean)
  const seen = new Set(dayDishes.map((d) => d.id))
  const allDishes = [...dayDishes, ...SNACKS.filter((s) => !seen.has(s.id))]

  const cartCount = Object.values(cart).reduce(
    (sum, items) => sum + items.reduce((s, i) => s + i.qty, 0), 0
  )

  const walletActive = user?.wallet?.active
  const walletBalance = user?.wallet?.balance ?? 0
  const dateRange = weekDateRange(week.days, lang)
  const weekWord = lang === 'el' ? 'Εβδομάδα' : 'Week'

  return (
    <div className="page-wrap">
      {/* Layout wrapper */}
      <div className="layout">
        <div className="main">

          {/* Banner Row — menu info + wallet promo */}
          <div className="banner-row">
            <div className="page-banner">
              <div className="banner-top">
                <div className="banner-heading">
                  {lang === 'el'
                    ? <>Εβδομαδιαίο <span>Μενού</span></>
                    : <>Weekly <span>Menu</span></>}
                </div>
                <div className="banner-sub">{t('sub')}</div>
              </div>
              <div className="banner-pills">
                <div className="banner-pill">{weekWord} {dateRange}</div>
                <div className="banner-pill green">{t('pillMin')}</div>
                <div className="banner-pill">{t('pillDelivery')}</div>
              </div>
            </div>

            {/* Wallet promo — matches demo layout */}
            <div className="wallet-promo" onClick={walletActive ? openWalletModal : goToWalletPage}>
              <div className="wp-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2"/>
                  <path d="M16 12h.01"/>
                  <path d="M2 10h20"/>
                </svg>
                <span>FITPAL WALLET</span>
              </div>
              {walletActive ? (
                <>
                  <div className="wp-title">
                    {lang === 'el'
                      ? <>Υπόλοιπο: <span>€{walletBalance.toFixed(2)}</span></>
                      : <>Balance: <span>€{walletBalance.toFixed(2)}</span></>}
                  </div>
                  <div className="wp-desc">
                    {lang === 'el'
                      ? `-${user?.wallet?.discountPct}% έκπτωση σε κάθε παραγγελία`
                      : `-${user?.wallet?.discountPct}% discount on every order`}
                  </div>
                </>
              ) : (
                <>
                  <div className="wp-title">
                    {lang === 'el'
                      ? <>Μηνιαία συνδρομή με <span>bonus credits</span> έως +{Math.max(...WALLET_PLANS.map(p => p.bonusPct))}%</>
                      : <>Monthly subscription with <span>bonus credits</span> up to +{Math.max(...WALLET_PLANS.map(p => p.bonusPct))}%</>}
                  </div>
                  <div className="wp-plans-mini">
                    {WALLET_PLANS.map((plan) => (
                      <div key={plan.id} className="wp-plan-chip">
                        €{plan.price} <span className="wp-arrow">→</span> <span className="wp-bonus">€{plan.credits}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <button className="wp-cta" onClick={(e) => { e.stopPropagation(); walletActive ? openWalletModal() : goToWalletPage() }}>
                {walletActive
                  ? (lang === 'el' ? 'Διαχείριση' : 'Manage')
                  : (lang === 'el' ? 'Μάθε περισσότερα' : 'Learn more')}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Day navigation */}
          <div className="day-section">
            <div className="day-section-hdr">
              <div className="section-label">{t('daylabel')}</div>
              <div className="week-label">{weekWord} {dateRange}</div>
            </div>
            <DayNav />
            <CutoffBar />
          </div>

          {/* Category filter */}
          <CategoryFilter dishes={allDishes} />

          {/* Menu grid */}
          <MenuSection dishes={allDishes} dayIndex={activeDay} />
        </div>

        {/* Sidebar */}
        <CartSidebar />
      </div>

      {/* Mobile cart FAB — hidden on desktop via CSS, taps open checkout */}
      {cartCount > 0 && (
        <button className="fab">
          <div className="fab-dot" />
          🛒 <span>{cartCount}</span> · <span>€{Object.values(cart).reduce((s, items) => s + items.reduce((ss, i) => ss + i.price * i.qty, 0), 0).toFixed(2)}</span>
        </button>
      )}
    </div>
  )
}
