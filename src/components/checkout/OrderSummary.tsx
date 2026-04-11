import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { makeTr } from '../../lib/translations'
import { subTotal, dayAmt } from '../../lib/helpers'
import { WEEK_DATA } from '../../data/menu'

export function OrderSummary() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const delivery = useCartStore((s) => s.delivery)
  const t = makeTr(lang)

  const week = WEEK_DATA[activeWeek] ?? WEEK_DATA[0]
  const days = week.days
  const dayLabelsEl = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή']
  const dayLabelsEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

  const total = subTotal(cart, voucher)

  return (
    <div className="order-summary">
      <h3 className="summary-title">{t('orderSummary')}</h3>

      {days.map((day, i) => {
        const items = cart[i] ?? []
        if (items.length === 0) return null
        const amt = dayAmt(cart, i)
        const del = delivery[i]
        const label = lang === 'el' ? dayLabelsEl[i] : dayLabelsEn[i]

        return (
          <div key={day.date} className="summary-day">
            <div className="summary-day-header">
              <span className="summary-day-name">{label}</span>
              <span className="summary-day-amt">€{amt.toFixed(2)}</span>
            </div>
            <div className="summary-day-items">
              {items.map((item, j) => (
                <div key={j} className="summary-item">
                  <span>{lang === 'el' ? item.nameEl : item.nameEn}</span>
                  <span className="summary-item-variant">
                    {lang === 'el' ? item.variantLabelEl : item.variantLabelEn}
                  </span>
                  <span className="summary-item-qty">×{item.qty}</span>
                  <span className="summary-item-price">€{(item.price * item.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
            {del?.street && (
              <div className="summary-delivery">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                {del.street}, {del.area}
                {del.timeSlot && ` • ${del.timeSlot}`}
              </div>
            )}
          </div>
        )
      })}

      <div className="summary-total-row">
        {voucher.applied && (
          <div className="summary-row discount">
            <span>{t('discount')}</span>
            <span>{voucher.type === 'pct' ? `-${voucher.value}%` : `-€${voucher.value?.toFixed(2)}`}</span>
          </div>
        )}
        <div className="summary-row total">
          <span>{t('total')}</span>
          <span>€{total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}
