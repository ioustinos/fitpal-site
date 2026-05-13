import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useMenuStore } from '../../store/useMenuStore'
import { dayAmt, itemVoucherDiscount } from '../../lib/helpers'
import { dayLabel } from '../../lib/datelabels'
import { CartItemRow } from '../cart/CartItemRow'
import { DayMacrosBlock } from './DayMacrosBlock'
import type { WeekDay } from '../../data/menu'
import type { DeliveryInfo } from '../../store/useCartStore'

interface DayOrderGroupProps {
  /** WEC-336: the day this block represents. The cart store is now keyed
   *  by `day.date` so we no longer need a separate dayIndex prop. */
  day: WeekDay
  /** true = cart (qty controls visible), false = read-only order summary */
  editable?: boolean
  /** show delivery address + time slot below items (used in order summary) */
  showDelivery?: boolean
}

export function DayOrderGroup({
  day,
  editable = false,
  showDelivery = false,
}: DayOrderGroupProps) {
  const lang = useUIStore((s) => s.lang)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const delivery = useCartStore((s) => s.delivery)
  const minOrder = useMenuStore((s) => s.settings.minOrder)
  // WEC-262: dish→category lookup so per-item discount allocation can
  // tell which items are in the voucher's scope.
  const dishMap = useMenuStore((s) => s.dishMap)
  const catLookup = (id: string) => dishMap[id]?.catId

  // WEC-336: cart is now keyed by ISO date string, not by day-of-week index.
  const dayDate = day.date
  const items = cart[dayDate] ?? []
  if (items.length === 0) return null

  const amt = dayAmt(cart, dayDate)
  const del: DeliveryInfo | undefined = delivery[dayDate]
  const label = dayLabel(dayDate, lang, 'long')
  const dateStr = formatDate(dayDate, lang)
  return (
    <div className="cart-day-block">
      {/* Day header */}
      <div className="cart-day-hdr">
        <span className="cart-day-name">{label} <span className="cart-day-date">{dateStr}</span></span>
        {amt < minOrder ? (
          <span className="cart-day-min-pill">
            €{amt.toFixed(2)} <span className="cart-day-min-label">/ min €{minOrder}</span>
          </span>
        ) : (
          <span className="cart-day-amt">€{amt.toFixed(2)}</span>
        )}
      </div>

      {/* Items */}
      {editable
        ? items.map((item, j) => (
            <CartItemRow key={`${dayDate}-${j}`} item={item} dayDate={dayDate} itemIndex={j} />
          ))
        : items.map((item, j) => {
            // WEC-262: per-item discount allocation. Only renders for
            // items inside the voucher's category scope (or all items
            // for unscoped vouchers — but in that case we hide the
            // per-line render to keep things calm; the totals already
            // surface the voucher discount once at the bottom).
            const perItemDisc = voucher.applied && (voucher.applicableCategoryIds?.length ?? 0) > 0
              ? itemVoucherDiscount(item, cart, voucher, catLookup)
              : 0
            return (
              <div key={j} className="summary-item">
                <span className="summary-item-name">
                  {lang === 'el' ? item.nameEl : item.nameEn}
                </span>
                <span className="summary-item-variant">
                  {lang === 'el' ? item.variantLabelEl : item.variantLabelEn}
                </span>
                <span className="summary-item-qty">×{item.qty}</span>
                <span className="summary-item-price">
                  €{(item.price * item.qty).toFixed(2)}
                  {perItemDisc > 0 && (
                    <span className="summary-item-disc"> −€{perItemDisc.toFixed(2)}</span>
                  )}
                </span>
              </div>
            )
          })}

      {/* WEC-141 / WEC-164 / WEC-165: per-day macro numbers (always) + goal
          progress bars (gated on showGoalProgress — see src/lib/goals.ts).
          Shared with checkout's OrderSummary. Cart view only here. */}
      {editable && <DayMacrosBlock dayDate={dayDate} />}

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
