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

export function MenuPage() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const openWalletModal = useUIStore((s) => s.openWalletModal)
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  const week = WEEK_DATA[activeWeek] ?? WEEK_DATA[0]
  const day = week.days[activeDay]
  const dishIds = day?.dishIds ?? []

  // Combine day-specific dishes + snacks (always available)
  const dayDishes = dishIds.map((id) => MENU[id]).filter(Boolean)
  const allDishes = [...dayDishes, ...SNACKS]

  const cartCount = Object.values(cart).reduce(
    (sum, items) => sum + items.reduce((s, i) => s + i.qty, 0), 0
  )

  const walletActive = user?.wallet?.active
  const walletBalance = user?.wallet?.balance ?? 0

  const weekLabel = lang === 'el' ? week.labelEl : week.labelEn

  return (
    <div className="page-wrap">
      {/* Layout wrapper matching demo.html .layout */}
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
                <div className="banner-sub">
                  {lang === 'el'
                    ? 'Φρέσκα γεύματα, καθημερινά διαφορετικά'
                    : 'Fresh meals, different every day'}
                </div>
              </div>
              <div className="banner-pills">
                <div className="banner-pill">{weekLabel}</div>
                <div className="banner-pill green">
                  {lang === 'el' ? 'Min €15 / ημέρα' : 'Min €15 / day'}
                </div>
                <div className="banner-pill">
                  {lang === 'el' ? 'Παράδοση 9:00-15:00' : 'Delivery 9:00-15:00'}
                </div>
              </div>
            </div>

            {/* Wallet promo */}
            <div className="wallet-promo" onClick={openWalletModal}>
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
                      ? <>Πλήρωσε λιγότερα, <span>φάε περισσότερα</span></>
                      : <>Pay less, <span>eat more</span></>}
                  </div>
                  <div className="wp-desc">
                    {lang === 'el'
                      ? 'Έκπτωση σε κάθε παραγγελία + bonus credits'
                      : 'Discount on every order + bonus credits'}
                  </div>
                  <div className="wp-plans-mini">
                    {WALLET_PLANS.map((plan) => (
                      <div key={plan.id} className="wp-plan-chip">
                        {plan.nameEn} <span className="wp-bonus">-{plan.discountPct}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <button className="wp-cta">
                {walletActive
                  ? (lang === 'el' ? 'Διαχείριση' : 'Manage')
                  : (lang === 'el' ? 'Δες τα πακέτα' : 'See plans')}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Day navigation */}
          <div className="day-section">
            <div className="day-section-hdr">
              <div className="section-label">
                {lang === 'el' ? 'Επέλεξε ημέρα' : 'Choose a day'}
              </div>
              <div className="week-label">{weekLabel}</div>
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

      {/* Mobile cart FAB */}
      {cartCount > 0 && (
        <button className="fab">
          <div className="fab-dot" />
          🛒 <span>{cartCount}</span> · <span>€{Object.values(cart).reduce((s, items) => s + items.reduce((ss, i) => ss + i.price * i.qty, 0), 0).toFixed(2)}</span>
        </button>
      )}
    </div>
  )
}
