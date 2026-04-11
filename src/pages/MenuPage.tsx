import { useUIStore } from '../store/useUIStore'
import { useCartStore } from '../store/useCartStore'
import { DayNav } from '../components/menu/DayNav'
import { CategoryFilter } from '../components/menu/CategoryFilter'
import { CutoffBar } from '../components/menu/CutoffBar'
import { MenuSection } from '../components/menu/MenuSection'
import { CartSidebar } from '../components/cart/CartSidebar'
import { MENU, SNACKS, WEEK_DATA } from '../data/menu'
import { makeTr } from '../lib/translations'

export function MenuPage() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const cart = useCartStore((s) => s.cart)
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

  return (
    <div className="page-wrap">
      {/* Page banner */}
      <div className="page-banner">
        <div className="banner-content">
          <h1 className="banner-title">
            {lang === 'el' ? 'Εβδομαδιαίο Μενού' : 'Weekly Menu'}
          </h1>
          <p className="banner-sub">
            {lang === 'el'
              ? 'Φρέσκα γεύματα, καθημερινά διαφορετικά'
              : 'Fresh meals, different every day'}
          </p>
        </div>
      </div>

      {/* Day navigation */}
      <DayNav />

      {/* Cutoff countdown */}
      <CutoffBar />

      {/* Category filter */}
      <CategoryFilter />

      {/* Menu + Cart layout */}
      <div className="menu-layout">
        <div className="menu-content">
          <MenuSection dishes={allDishes} dayIndex={activeDay} />
        </div>
        <CartSidebar />
      </div>

      {/* Mobile cart button */}
      {cartCount > 0 && (
        <div className="mobile-cart-btn-wrap">
          <button className="mobile-cart-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            {t('viewCart')} ({cartCount})
          </button>
        </div>
      )}
    </div>
  )
}
