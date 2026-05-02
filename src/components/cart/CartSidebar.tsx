import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { DayOrderGroup } from '../shared/DayOrderGroup'
import { VoucherInput } from './VoucherInput'
import { makeTr } from '../../lib/translations'
import { subTotal, activeDays, dayAmt, fmt } from '../../lib/helpers'
import { useMenuStore } from '../../store/useMenuStore'

export function CartSidebar() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const goToCheckout = useUIStore((s) => s.goToCheckout)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const t = makeTr(lang)

  const weeks = useMenuStore((s) => s.weeks)
  const minOrder = useMenuStore((s) => s.settings.minOrder)
  const week = weeks[activeWeek] ?? weeks[0]
  const total = subTotal(cart, voucher)
  const days = activeDays(cart)
  // rawTotal is the cart total BEFORE the voucher discount — needed to render
  // the subtotal row and the absolute discount amount when a voucher is
  // applied. Matches OrderSummary.tsx so both surfaces show the same numbers.
  const rawTotal = days.reduce((sum, i) => sum + dayAmt(cart, i), 0)
  const hasItems = days.length > 0
  const canCheckout = days.every((d) => {
    const amt = (cart[d] ?? []).reduce((s, i) => s + i.price * i.qty, 0)
    return amt >= minOrder
  })

  function handleCheckout() {
    goToCheckout()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-hdr">
        <div className="sidebar-title">{t('cartTitle')}</div>
        <div className="sidebar-sub">{t('cartSub')}</div>
      </div>

      <div id="cart-content" className="cart-content">
        {!hasItems ? (
          <div className="cart-empty">
            <div className="cart-empty-circle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
            </div>
            <div className="cart-empty-title">{t('cartEmpty')}</div>
            <div className="cart-empty-sub">{t('cartEmptySub')}</div>
          </div>
        ) : (
          <>
            {/* Scrollable items */}
            <div className="cart-scroll">
              {(week?.days ?? []).map((day, i) => (
                <DayOrderGroup key={day.date} dayIndex={i} day={day} editable />
              ))}
            </div>

            {/* Sticky footer */}
            <div className="cart-ftr">
              <VoucherInput />

              {/* Subtotal + absolute-amount discount when voucher is applied.
                  Mirrors OrderSummary.tsx so customers see the same breakdown
                  in the cart sidebar and the checkout summary. */}
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

              <button
                className="btn-checkout"
                disabled={!canCheckout}
                onClick={handleCheckout}
              >
                {t('checkout')} →
              </button>

              {!canCheckout && hasItems && (
                <div className="min-warn">{t('minWarn')}</div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
