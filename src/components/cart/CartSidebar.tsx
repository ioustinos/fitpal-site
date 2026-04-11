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
  const hasItems = activeDays(cart).length > 0

  function handleCheckout() {
    if (!user) { openAuthModal(); return }
    goToCheckout()
  }

  return (
    <aside className="cart-sidebar">
      <div className="cart-header">
        <h2 className="cart-title">{t('yourOrder')}</h2>
      </div>

      {!hasItems ? (
        <div className="cart-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cart-empty-icon">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
          </svg>
          <p>{lang === 'el' ? 'Η παραγγελία σου είναι άδεια' : 'Your order is empty'}</p>
          <p className="cart-empty-sub">{lang === 'el' ? 'Πρόσθεσε πιάτα από το μενού' : 'Add dishes from the menu'}</p>
        </div>
      ) : (
        <div className="cart-days">
          {week.days.map((day, i) => (
            <DayOrderGroup key={day.date} dayIndex={i} day={day} editable />
          ))}
        </div>
      )}

      {hasItems && (
        <div className="cart-footer">
          <VoucherInput />

          <div className="cart-summary">
            {voucher.applied && voucher.value != null && (
              <div className="cart-summary-row discount">
                <span>{t('discount')}</span>
                <span>{voucher.type === 'pct' ? `-${voucher.value}%` : `-€${voucher.value.toFixed(2)}`}</span>
              </div>
            )}
            <div className="cart-summary-row total">
              <span>{t('total')}</span>
              <span>€{total.toFixed(2)}</span>
            </div>
          </div>

          {total < MIN_ORDER && (
            <div className="cart-min-warning">
              {lang === 'el'
                ? `Ελάχιστη παραγγελία €${MIN_ORDER}. Χρειάζεσαι ακόμα €${(MIN_ORDER - total).toFixed(2)}`
                : `Minimum order €${MIN_ORDER}. Add €${(MIN_ORDER - total).toFixed(2)} more`}
            </div>
          )}

          <button className="btn-checkout" disabled={total < MIN_ORDER} onClick={handleCheckout}>
            {!user ? t('signInToOrder') : t('proceedToCheckout')}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}
    </aside>
  )
}
