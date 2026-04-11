import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { DayOrderGroup } from '../shared/DayOrderGroup'
import { makeTr } from '../../lib/translations'
import { subTotal } from '../../lib/helpers'
import { WEEK_DATA } from '../../data/menu'

export function OrderSummary() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const t = makeTr(lang)

  const week = WEEK_DATA[activeWeek] ?? WEEK_DATA[0]
  const total = subTotal(cart, voucher)

  return (
    <div className="order-summary">
      <h3 className="summary-title">{t('orderSummary')}</h3>

      {week.days.map((day, i) => (
        <DayOrderGroup
          key={day.date}
          dayIndex={i}
          day={day}
          editable={false}
          showDelivery
        />
      ))}

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
