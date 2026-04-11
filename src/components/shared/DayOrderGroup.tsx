import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { dayAmt } from '../../lib/helpers'
import { CartItemRow } from '../cart/CartItemRow'
import type { WeekDay } from '../../data/menu'
import type { DeliveryInfo } from '../../store/useCartStore'

const DAY_LABELS_EL = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή']
const DAY_LABELS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

interface DayOrderGroupProps {
  dayIndex: number
  day: WeekDay
  /** true = cart (qty controls visible), false = read-only order summary */
  editable?: boolean
  /** show delivery address + time slot below items (used in order summary) */
  showDelivery?: boolean
}

export function DayOrderGroup({
  dayIndex,
  day,
  editable = false,
  showDelivery = false,
}: DayOrderGroupProps) {
  const lang = useUIStore((s) => s.lang)
  const cart = useCartStore((s) => s.cart)
  const delivery = useCartStore((s) => s.delivery)

  const items = cart[dayIndex] ?? []
  if (items.length === 0) return null

  const amt = dayAmt(cart, dayIndex)
  const del: DeliveryInfo | undefined = delivery[dayIndex]
  const label = lang === 'el' ? DAY_LABELS_EL[dayIndex] : DAY_LABELS_EN[dayIndex]
  const dateStr = formatDate(day.date, lang)
  return (
    <div className="cart-day-block">
      {/* Day header */}
      <div className="cart-day-hdr">
        <span className="cart-day-name">{label} <span className="cart-day-date">{dateStr}</span></span>
        <span className="cart-day-amt">{lang === 'el' ? `€${amt.toFixed(2)}` : `€${amt.toFixed(2)}`}</span>
      </div>

      {/* Items */}
      {editable
        ? items.map((item, j) => (
            <CartItemRow key={`${day.date}-${j}`} item={item} dayIndex={dayIndex} itemIndex={j} />
          ))
        : items.map((item, j) => (
            <div key={j} className="summary-item">
              <span className="summary-item-name">
                {lang === 'el' ? item.nameEl : item.nameEn}
              </span>
              <span className="summary-item-variant">
                {lang === 'el' ? item.variantLabelEl : item.variantLabelEn}
              </span>
              <span className="summary-item-qty">×{item.qty}</span>
              <span className="summary-item-price">€{(item.price * item.qty).toFixed(2)}</span>
            </div>
          ))}

      {/* Delivery info (order summary only) */}
      {showDelivery && del?.street && (
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
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}
