import { useEffect, useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { DayOrderGroup } from '../shared/DayOrderGroup'
import { VoucherInput } from './VoucherInput'
import { makeTr } from '../../lib/translations'
import { subTotal, activeDays, dayAmt, fmt, totalCount } from '../../lib/helpers'

/**
 * Mobile-only bottom sheet (WEC-264).
 *
 * Replaces the desktop sidebar on phones — there's no horizontal real estate
 * for a side aside, but customers absolutely need to see what they're building
 * (menu page) and what they're about to pay (checkout page). The slim FAB
 * we shipped earlier was a navigation cue, not an order overview.
 *
 * Layout:
 *   Collapsed (default): 56px bar pinned to bottom of viewport.
 *     Shows 🛒 + count + total + a chevron. Tap anywhere to expand.
 *   Expanded: slides up to ~70vh with a backdrop scrim, renders the per-day
 *     item list + voucher input + totals + the primary CTA. Tap-outside,
 *     swipe-handle, or X-button collapses.
 *
 * Two modes:
 *   - mode='menu' (default): editable item rows (qty steppers via the
 *     existing DayOrderGroup editable path), CTA = "Continue to checkout".
 *   - mode='checkout': read-only items, no CTA (the customer is already on
 *     checkout — the sheet exists purely to let them review what they're
 *     paying for; the page's submit button handles the action).
 *
 * Visibility is CSS-gated: the component renders unconditionally; CSS
 * shows it only at viewport widths ≤ 768px. Desktop continues to use
 * the existing CartSidebar / OrderSummary.
 */

interface Props {
  mode?: 'menu' | 'checkout'
}

export function MobileCartSheet({ mode = 'menu' }: Props) {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const goToCheckout = useUIStore((s) => s.goToCheckout)
  // WEC-264 v2: hide the cart sheet whenever any modal is open. Without
  // this, the bottom bar renders on top of the auth/wallet/dish modal
  // sheets and obscures their CTAs (reported by Ioustinos with the
  // login modal). Modals already have their own footer buttons, so the
  // cart isn't useful in that context.
  const openModal = useUIStore((s) => s.openModal)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const t = makeTr(lang)

  const weeks = useMenuStore((s) => s.weeks)
  const minOrder = useMenuStore((s) => s.settings.minOrder)
  const dishMap = useMenuStore((s) => s.dishMap)
  const catLookup = (id: string) => dishMap[id]?.catId
  const week = weeks[activeWeek] ?? weeks[0]

  const [expanded, setExpanded] = useState(false)
  function collapse() { setExpanded(false) }
  function toggle() { setExpanded((v) => !v) }

  // Lock body scroll while the sheet is open so the menu underneath doesn't
  // scroll away when the customer drags inside the sheet.
  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [expanded])

  // Esc-to-close — minor but every sheet pattern expects it.
  useEffect(() => {
    if (!expanded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') collapse()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const total = subTotal(cart, voucher, catLookup)
  const days = activeDays(cart)
  const rawTotal = days.reduce((sum, i) => sum + dayAmt(cart, i), 0)
  const hasItems = days.length > 0
  const cartCount = totalCount(cart)
  const canCheckout = hasItems && days.every((d) => {
    const amt = (cart[d] ?? []).reduce((s, i) => s + i.price * i.qty, 0)
    return amt >= minOrder
  })

  // Empty cart on the menu page — render a tiny pinned hint so the slot
  // never disappears (avoids layout jump when the first item is added).
  // On the checkout page an empty cart shouldn't happen (you can't get
  // there without items) but we hide rather than render junk.
  if (!hasItems && mode === 'checkout') return null

  // WEC-264 v2: hide entirely whenever any modal is open. Modals manage
  // their own bottom-aligned content (auth submit button, wallet CTA,
  // dish "Add to cart") and the bar fights with them visually.
  if (openModal) return null

  return (
    <>
      {/* Backdrop scrim — only when expanded. Click to collapse. */}
      <div
        className={`mcs-backdrop${expanded ? ' open' : ''}`}
        onClick={collapse}
        aria-hidden="true"
      />

      <div className={`mcs-sheet${expanded ? ' expanded' : ''}`} aria-label={t('cartTitle')}>
        {/* Collapsed bar — always visible at the bottom. The button form
            gives keyboard focus + accessible-name plumbing for free. */}
        <button
          type="button"
          className="mcs-bar"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls="mcs-body"
        >
          <span className="mcs-bar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <circle cx="9" cy="21" r="1"/>
              <circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
          </span>
          <span className="mcs-bar-count">
            {hasItems ? cartCount : 0}
          </span>
          <span className="mcs-bar-total">
            {hasItems ? `€${total.toFixed(2)}` : t('cartEmpty')}
          </span>
          {/* "View" hint nudges discoverability — the bar is tappable but
              the cue helps first-timers know that. Hidden when expanded. */}
          {!expanded && (
            <span className="mcs-bar-cta">
              {lang === 'el' ? 'ΑΝΟΙΓΜΑ' : 'OPEN'}
            </span>
          )}
          <span className="mcs-bar-chev" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points={expanded ? '6 15 12 9 18 15' : '6 9 12 15 18 9'}/>
            </svg>
          </span>
        </button>

        {/* Expanded body. Mounted always (cheap) but hidden by CSS when
            collapsed so the slide-down transition feels responsive.
            WEC-296: use `inert` instead of `aria-hidden` — the close button
            inside this container would otherwise be both AT-hidden AND
            focusable, which the browser correctly flags as broken. `inert`
            blocks focus AND hides from AT in one shot. */}
        <div className="mcs-body" id="mcs-body" role="region" inert={!expanded}>
          {/* Drag-handle and close — discoverable affordances at the top */}
          <div className="mcs-body-hdr">
            <span className="mcs-handle" aria-hidden="true" />
            <button type="button" className="mcs-close" onClick={collapse} aria-label="Close">×</button>
          </div>

          {!hasItems ? (
            <div className="cart-empty">
              <div className="cart-empty-title">{t('cartEmpty')}</div>
              <div className="cart-empty-sub">{t('cartEmptySub')}</div>
            </div>
          ) : (
            <>
              <div className="mcs-scroll">
                {(week?.days ?? []).map((day, i) => (
                  <DayOrderGroup
                    key={day.date}
                    dayIndex={i}
                    day={day}
                    editable={mode === 'menu'}
                    showDelivery={mode === 'checkout'}
                  />
                ))}
              </div>

              <div className="mcs-foot">
                {/* Voucher input only on menu — checkout has its own surface. */}
                {mode === 'menu' && <VoucherInput />}

                {voucher.applied && (
                  <>
                    <div className="cart-total-row" style={{ marginBottom: 6 }}>
                      <span className="cart-total-lbl" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {lang === 'el' ? 'Υποσύνολο' : 'Subtotal'}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)' }}>
                        {fmt(rawTotal)}
                      </span>
                    </div>
                    <div className="cart-total-row" style={{ marginBottom: 6 }}>
                      <span className="cart-total-lbl" style={{ color: 'var(--green-dark)', fontSize: 13 }}>
                        {t('discount')}
                      </span>
                      <span style={{ fontWeight: 900, color: 'var(--green)', fontSize: 14 }}>
                        −{fmt(rawTotal - total)}
                      </span>
                    </div>
                  </>
                )}

                <div className="cart-total-row">
                  <span className="cart-total-lbl">{t('total')}</span>
                  <span className="cart-total-amt">€{total.toFixed(2)}</span>
                </div>

                {mode === 'menu' && (
                  <button
                    type="button"
                    className="btn-checkout"
                    disabled={!canCheckout}
                    onClick={() => { collapse(); goToCheckout() }}
                  >
                    {t('checkout')} →
                  </button>
                )}

                {!canCheckout && hasItems && mode === 'menu' && (
                  <div className="min-warn">{t('minWarn')}</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
