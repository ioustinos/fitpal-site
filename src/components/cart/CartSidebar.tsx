import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { DayOrderGroup } from '../shared/DayOrderGroup'
import { VoucherInput } from './VoucherInput'
import { makeTr } from '../../lib/translations'
import { subTotal, activeDays, MIN_ORDER } from '../../lib/helpers'
import { WEEK_DATA } from '../../data/menu'

export function CartSidebar() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const goToCheckout = useUIStore((s) => s.goToCheckout)
  const openAuthModal = useUIStore((s) => s.openAuthModal)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  const week = WEEK_DATA[activeWeek] ?? WEEK_DATA[0]
  const total = subTotal(cart, voucher)
  const days = activeDays(cart)
  const hasItems = days.length > 0
  const canCheckout = days.every((d) => {
    const amt = (cart[d] ?? []).reduce((s, i) => s + i.price * i.qty, 0)
    return amt >= MIN_ORDER
  })

  function handleCheckout() {
    if (!user) { openAuthModal(); return }
    goToCheckout()
  }

  return (
    <aside className="sidebar">
      <div className="cart-header">
        <h2 className="cart-title">{t('yourOrder')}</h2>
      </div>

      <div id="cart-content" className="cart-content">
        {!hasItems ? (
          <div className="cart-empty">
            <div className="cart-empty-img">🛒</div>
            <div className="cart-empty-title">
              {lang === 'el' ? 'Η παραγγελία σου είναι άδεια' : 'Your order is empty'}
            </div>
            <div className="cart-empty-sub">
              {lang === 'el' ? 'Πρόσθεσε πιάτα από το μενού' : 'Add dishes from the menu'}
            </div>
          </div>
        ) : (
          <>
            {/* Scrollable items */}
            <div className="cart-scroll">
              {week.days.map((day, i) => (
                <DayOrderGroup key={day.date} dayIndex={i} day={day} editable />
              ))}
            </div>

            {/* Sticky footer */}
            <div className="cart-ftr">
              <VoucherInput />

              {/* Voucher discount line */}
              {voucher.applied && voucher.value != null && (
                <div className="cart-total-row" style={{ marginBottom: 6 }}>
                  <span className="cart-total-lbl" style={{ color: 'var(--green-dark)', fontSize: 13 }}>
                    {t('discount')}
                  </span>
                  <span style={{ fontWeight: 900, color: 'var(--green)', fontSize: 14 }}>
                    {voucher.type === 'pct' ? `-${voucher.value}%` : `-€${voucher.value.toFixed(2)}`}
                  </span>
                </div>
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
                {!user ? t('signInToOrder') : t('checkout')} →
              </button>

              {!canCheckout && hasItems && (
                <div className="min-warn">
                  {lang === 'el'
                    ? `Ελάχιστη παραγγελία €${MIN_ORDER} ανά ημέρα`
                    : `Minimum order €${MIN_ORDER} per day`}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
