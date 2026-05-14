import { useEffect } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useCartStore, reconcileCartAgainstMenu, reconcileCartAgeAndDates } from '../store/useCartStore'
import { useAuthStore } from '../store/useAuthStore'
import { useMenuStore } from '../store/useMenuStore'
import { DayNav } from '../components/menu/DayNav'
import { CategoryFilter } from '../components/menu/CategoryFilter'
import { CutoffBar } from '../components/menu/CutoffBar'
import { MenuSection } from '../components/menu/MenuSection'
import { CartSidebar } from '../components/cart/CartSidebar'
import { MobileCartSheet } from '../components/cart/MobileCartSheet'
import { BackToTopButton } from '../components/menu/BackToTopButton'
// WEC-338: WALLET_PLANS no longer referenced — banner now sells the new
// profile-driven plan rather than the deprecated 3-tier model.
// import { WALLET_PLANS } from '../data/menu'
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
  const goToWalletPage = useUIStore((s) => s.goToWalletPage)
  // WEC-348: subscribers tap the beige card → Account → Goals tab.
  const goToAccount = useUIStore((s) => s.goToAccount)
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

  // WEC-199 + WEC-336: prune persisted carts that are stale by time.
  //   1. 24h TTL — wipe everything if last touch was > 24h ago.
  //   2. Past-day pruning — drop entries whose delivery date < today.
  //
  // Runs BEFORE reconcileCartAgainstMenu — order matters. We drop stale
  // dates first, then the menu reconcile prunes missing dishes from what
  // survives. WEC-336 made the cart date-keyed, so this no longer needs
  // weeksMeta — it can run on first mount.
  useEffect(() => {
    reconcileCartAgeAndDates()
  }, [])

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

          {/* Banner row — WEC-347 + WEC-348 (final design).
              The 2-col grid is ALWAYS rendered. The left column is the
              menu banner (heading + info pills). The right column is
              the beige .sub-promo card. The card's CONTENT swaps based
              on a single signal — has the customer purchased a
              subscription plan — NOT login state, NOT wallet balance.
              The shell (size, cream paper, glyph) is identical in both
              states so the row keeps a consistent visual rhythm.

              SUBSCRIPTION PROXY — see WEC-348 description for TODO.
              We don't have a dedicated `user.subscription.active` flag
              yet; the closest signal is `user.wallet.active` from the
              Wallet v2 model (project_wallet_v2). Swap this proxy when
              we get a definitive subscription field on the user object.
          */}
          {(() => {
            const subscribed = !!walletActive
            const cardCta = subscribed
              ? () => goToAccount('goals')
              : () => goToWalletPage()
            return (
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

                <div
                  className="sub-promo"
                  onClick={cardCta}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      cardCta()
                    }
                  }}
                >
                  <svg
                    className="sub-promo-glyph"
                    viewBox="0 0 120 120"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 62a40 40 0 0080 0" />
                    <path d="M16 62h88" />
                    <path d="M60 36c-6-6-6-14 0-20 6 6 6 14 0 20z" />
                    <path d="M48 42c-8-2-12-8-10-16 8 2 12 8 10 16z" />
                    <path d="M72 42c8-2 12-8 10-16-8 2-12 8-10 16z" />
                  </svg>

                  {subscribed ? (
                    <div className="sub-promo-inner">
                      <div className="sub-promo-eyebrow">
                        <span className="sub-promo-dot" aria-hidden="true" />
                        {lang === 'el' ? 'FITPAL ΣΤΟΧΟΙ' : 'FITPAL GOALS'}
                      </div>
                      <h3 className="sub-promo-headline">
                        {lang === 'el' ? (
                          <>Οι <em>Στόχοι</em><br />μου.</>
                        ) : (
                          <>My <em>Goals</em>.</>
                        )}
                      </h3>
                      <div className="sub-promo-sub">
                        {lang === 'el'
                          ? 'Δες τη συνδρομή σου, την πρόοδό σου και τα γεύματα που σου ταιριάζουν.'
                          : 'Track your plan, your progress, and the meals that fit you.'}
                      </div>
                      <button
                        type="button"
                        className="sub-promo-cta"
                        onClick={(e) => { e.stopPropagation(); goToAccount('goals') }}
                      >
                        {lang === 'el' ? 'Δες τους στόχους μου' : 'View my goals'}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true">
                          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="sub-promo-inner">
                      <div className="sub-promo-eyebrow">
                        <span className="sub-promo-dot" aria-hidden="true" />
                        {lang === 'el' ? 'ΣΥΝΔΡΟΜΗ FITPAL' : 'FITPAL SUBSCRIPTION'}
                      </div>
                      <h3 className="sub-promo-headline">
                        {lang === 'el' ? (
                          <>Φάγε για τον<br /><em>στόχο σου</em>.</>
                        ) : (
                          <>Eat for your<br /><em>goal</em>.</>
                        )}
                      </h3>
                      <div className="sub-promo-sub">
                        {lang === 'el'
                          ? 'Εξατομικευμένο πλάνο διατροφής. Έκπτωση έως 18%.'
                          : 'A meal plan made for you. Save up to 18%.'}
                      </div>
                      <button
                        type="button"
                        className="sub-promo-cta"
                        onClick={(e) => { e.stopPropagation(); goToWalletPage() }}
                      >
                        {lang === 'el' ? 'Φτιάξε το πλάνο μου' : 'Build my plan'}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true">
                          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

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

      {/* WEC-264: mobile-only bottom-sheet cart. Replaces the old FAB —
          tap-to-expand reveals the full cart with editable qty + per-day
          totals + the Continue-to-checkout CTA, instead of routing
          straight to checkout. CSS hides this on desktop and the desktop
          sidebar above on mobile. */}
      <MobileCartSheet mode="menu" />

      {/* WEC-342: desktop-only floating Back-to-top pill. Renders inside
          the page tree but uses position:fixed so it floats over content.
          Hidden via CSS at ≤768px viewport so it doesn't fight with the
          MobileCartSheet bar at the bottom of mobile screens. */}
      <BackToTopButton />
    </div>
  )
}
