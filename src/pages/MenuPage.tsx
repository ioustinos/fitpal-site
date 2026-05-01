import { useEffect } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useCartStore, reconcileCartAgainstMenu } from '../store/useCartStore'
import { useAuthStore } from '../store/useAuthStore'
import { useMenuStore } from '../store/useMenuStore'
import { DayNav } from '../components/menu/DayNav'
import { CategoryFilter } from '../components/menu/CategoryFilter'
import { CutoffBar } from '../components/menu/CutoffBar'
import { MenuSection } from '../components/menu/MenuSection'
import { CartSidebar } from '../components/cart/CartSidebar'
import { WALLET_PLANS } from '../data/menu'
import { makeTr } from '../lib/translations'
import FpLoader from '../components/ui/FpLoader'

/** Returns "6 – 10 Απρ" or "6 – 10 Apr" from week days */
function weekDateRange(days: { date: string }[], lang: 'el' | 'en'): string {
  const first = days[0]?.date
  const last = days[days.length - 1]?.date
  if (!first || !last) return ''
  const d1 = new Date(first + 'T12:00:00')
  const d2 = new Date(last + 'T12:00:00')
  const month = d2.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { month: 'short' })
  return `${d1.getDate()} – ${d2.getDate()} ${month}`
}

export function MenuPage() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const openWalletModal = useUIStore((s) => s.openWalletModal)
  const goToWalletPage = useUIStore((s) => s.goToWalletPage)
  const goToCheckout = useUIStore((s) => s.goToCheckout)
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  // ── Supabase menu data ──
  const weeksMeta = useMenuStore((s) => s.weeksMeta)
  const weeks = useMenuStore((s) => s.weeks)
  const loadedWeekIds = useMenuStore((s) => s.loadedWeekIds)
  const weekLoading = useMenuStore((s) => s.weekLoading)
  const dishMap = useMenuStore((s) => s.dishMap)
  const isLoading = useMenuStore((s) => s.isLoading)
  const menuError = useMenuStore((s) => s.error)
  const loadMenu = useMenuStore((s) => s.load)

  useEffect(() => { loadMenu() }, [loadMenu])

  const week = weeks[activeWeek] ?? weeks[0]
  const weekMetaForRange = weeksMeta[activeWeek] ?? weeksMeta[0]
  const day = week?.days[activeDay]
  const dishIds = day?.dishIds ?? []

  // Resolve dish IDs → full Dish objects (active day only — for the menu grid)
  const allDishes = dishIds.map((id) => dishMap[id]).filter(Boolean)

  // WEC-180: prune any persisted cart items that reference dishes no
  // longer in the live menu. Runs after the menu loads.
  //
  // CRITICAL: we reconcile against `dishMap` (the GLOBAL lookup of every
  // dish across every loaded week/day), NOT against `allDishes` which is
  // only the current day's dishes. Earlier version of this hook used
  // allDishes — so switching from Monday to Tuesday made every Monday
  // cart item "look unavailable" and got dropped. Wiped real customer
  // carts. Fixed 2026-05-01.
  const dishMapSize = Object.keys(dishMap).length
  useEffect(() => {
    if (dishMapSize === 0) return
    const ids = new Set(Object.keys(dishMap))
    reconcileCartAgainstMenu(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dishMapSize])

  // Active week's dish content still loading?
  const activeWeekId = weeksMeta[activeWeek]?.id
  const activeWeekLoading =
    !!activeWeekId && !loadedWeekIds.has(activeWeekId) && !!weekLoading[activeWeekId]

  const cartCount = Object.values(cart).reduce(
    (sum, items) => sum + items.reduce((s, i) => s + i.qty, 0), 0
  )

  const walletActive = user?.wallet?.active
  const walletBalance = user?.wallet?.balance ?? 0
  const dateRange = weekMetaForRange ? weekDateRange(weekMetaForRange.days, lang) : ''
  const weekWord = lang === 'el' ? 'Εβδομάδα' : 'Week'

  // ── Loading / error states ──
  if (isLoading) {
    return (
      <div className="page-wrap">
        <div className="layout">
          <div className="main">
            <FpLoader label={lang === 'el' ? 'Φόρτωση μενού…' : 'Loading menu…'} />
          </div>
        </div>
      </div>
    )
  }

  if (menuError) {
    return (
      <div className="page-wrap">
        <div className="layout">
          <div className="main">
            <div className="menu-empty">
              <div className="menu-empty-text">
                {lang === 'el' ? 'Σφάλμα φόρτωσης μενού' : 'Error loading menu'}
              </div>
              <div className="menu-empty-text" style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                {menuError}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

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
                      ? `+${user?.wallet?.bonusPct ?? 0}% bonus credits`
                      : `+${user?.wallet?.bonusPct ?? 0}% bonus credits`}
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
                      ? <>Μηνιαία συνδρομή με bonus credits έως +{Math.max(...WALLET_PLANS.map(p => p.bonusPct))}%</>
                      : <>Monthly subscription with bonus credits up to +{Math.max(...WALLET_PLANS.map(p => p.bonusPct))}%</>}
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

          {/* Day navigation — compact horizontally-scrollable day strip with
              the cutoff countdown stacked just underneath. Reverted from the
              WEC-166 v2 full-width-card + inline-cutoff experiment: the big
              cards stole visual focus from the food, and the inline cutoff
              was more visually broken than the simple stack. */}
          <div className="day-section">
            <div className="day-section-hdr">
              <div className="section-label">{t('daylabel')}</div>
              <div className="week-label">{dateRange}</div>
            </div>
            <DayNav />
            <CutoffBar />
          </div>

          {/* Category filter + thin intake strip share one sticky group.
              WEC-166 v2: the fat intake panel was getting scrolled past as
              the user browsed, so we swapped it for a 1-line strip that
              sticks just under the category pills at the top of the menu
              grid — visible at all times, low-attention. */}
          {!activeWeekLoading && <CategoryFilter dishes={allDishes} />}
          {/* DayIntakePanel removed 2026-04-30 — goal tracking lives only
              in the cart sidebar + checkout summary now. The menu page
              stays focused on browsing; macros surface when the customer
              starts building an order. */}

          {/* Menu grid (or loader while active week lazy-loads) */}
          {activeWeekLoading ? (
            <FpLoader label={lang === 'el' ? 'Φόρτωση μενού…' : 'Loading menu…'} />
          ) : (
            <MenuSection dishes={allDishes} dayIndex={activeDay} />
          )}
        </div>

        {/* Sidebar */}
        <CartSidebar />
      </div>

      {/* Mobile cart FAB — hidden on desktop via CSS, taps open checkout.
          WEC-136: wired the onClick that was missing — the button did
          nothing on tap, which is the exact kind of dead affordance that
          erodes trust on mobile. */}
      {cartCount > 0 && (
        <button
          className="fab"
          onClick={goToCheckout}
          aria-label={lang === 'el' ? 'Πλοηγήσου στο checkout' : 'Go to checkout'}
        >
          <div className="fab-dot" />
          🛒 <span>{cartCount}</span> · <span>€{Object.values(cart).reduce((s, items) => s + items.reduce((ss, i) => ss + i.price * i.qty, 0), 0).toFixed(2)}</span>
        </button>
      )}
    </div>
  )
}
