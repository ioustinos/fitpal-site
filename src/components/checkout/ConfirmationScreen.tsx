import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { activeDays, dayAmt, fmt, subTotal } from '../../lib/helpers'
import { useMenuStore } from '../../store/useMenuStore'
import { dayLabel } from '../../lib/datelabels'

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Post-submit screen (WEC-135).
 *
 * UX contract:
 *  - Hero the order number — it's the single piece of info the user might
 *    need to quote back to support, so it's the visual focal point under
 *    the tick.
 *  - Email copy is soft — we say "will try to email" rather than promising
 *    delivery, because email send is best-effort today.
 *  - No PDF button — the old placeholder just logged to console. Removed
 *    until a real PDF pipeline lands.
 *  - Cart is cleared on mount so hitting Back to menu (or closing the tab)
 *    doesn't leave stale items lingering in the sidebar. We snapshot
 *    everything we need into local state FIRST, then clear, so the
 *    summary still renders after cart is reset.
 */
export function ConfirmationScreen({ orderNumber }: { orderNumber?: string }) {
  const lang = useUIStore((s) => s.lang)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const weeks = useMenuStore((s) => s.weeks)
  const clearAll = useCartStore((s) => s.clearAll)

  // Snapshot everything we need for the summary ONCE, on mount. After
  // snapshotting we clear the cart so the sidebar doesn't show stale items.
  const [snapshot] = useState(() => {
    const { cart, delivery, payment, voucher } = useCartStore.getState()
    const weekData = weeks[activeWeek] ?? weeks[0]
    return {
      cart,
      delivery,
      payment,
      voucher,
      weekData,
      total: subTotal(cart, voucher),
      activeDayIdxs: activeDays(cart),
    }
  })

  useEffect(() => {
    clearAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDone() {
    closeCheckout()
  }

  return (
    <div className="confirmation-screen">
      <div className="conf-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>

      <h2 className="conf-title">
        {lang === 'el' ? 'Η παραγγελία σου καταχωρήθηκε!' : 'Your order has been placed!'}
      </h2>

      {orderNumber && (
        <div className="conf-order-hero">
          <div className="conf-order-hero-label">
            {lang === 'el' ? 'Αριθμός παραγγελίας' : 'Order number'}
          </div>
          <div className="conf-order-hero-number">{orderNumber}</div>
        </div>
      )}

      <p className="conf-sub">
        {lang === 'el'
          ? 'Θα προσπαθήσουμε να σου στείλουμε email επιβεβαίωσης. Αν δεν το λάβεις, μη σε ανησυχήσει — η παραγγελία έχει καταχωρηθεί κανονικά.'
          : "We'll try to email you a confirmation. If it doesn't arrive, don't worry — your order is already recorded."}
      </p>

      <div className="conf-summary">
        {snapshot.activeDayIdxs.map((dayIdx) => {
          const dateISO = snapshot.weekData?.days[dayIdx]?.date ?? ''
          const dayName = dateISO ? dayLabel(dateISO, lang, 'long') : ''
          const formattedDate = formatDate(dateISO, lang)
          const delivInfo = snapshot.delivery[dayIdx]
          const timeSlot = delivInfo?.timeSlot || ''
          const street = delivInfo?.street || ''
          const area = delivInfo?.area || ''
          const items = snapshot.cart[dayIdx] || []
          const dayTotal = dayAmt(snapshot.cart, dayIdx)

          return (
            <div className="conf-day" key={dayIdx}>
              <div className="conf-day-name">
                {dayName} {formattedDate}
              </div>

              <div className="conf-day-meta">
                {timeSlot} | {street}, {area}
              </div>

              <div className="conf-day-items">
                {items.map((item, itemIdx) => {
                  const itemName = lang === 'el' ? item.nameEl : item.nameEn
                  const itemVariant = lang === 'el' ? item.variantLabelEl : item.variantLabelEn
                  const itemTotal = item.price * item.qty

                  return (
                    <div className="conf-item" key={itemIdx}>
                      <span className="conf-item-qty">{item.qty}×</span>
                      <span className="conf-item-name">
                        {itemName}
                        {itemVariant && (
                          <>
                            {' '}·{' '}
                            <span className="conf-item-variant">{itemVariant}</span>
                          </>
                        )}
                      </span>
                      <span className="conf-item-price">{fmt(itemTotal)}</span>
                    </div>
                  )
                })}
              </div>

              <div className="conf-day-amt">
                {lang === 'el' ? 'Σύνολο ημέρας' : 'Day total'}: {fmt(dayTotal)}
              </div>
            </div>
          )
        })}

        {snapshot.payment.notes && (
          <div className="conf-comment">
            "{snapshot.payment.notes}"
          </div>
        )}

        <div className="conf-total">
          <span>{lang === 'el' ? 'Σύνολο' : 'Total'}</span>
          <span>{fmt(snapshot.total)}</span>
        </div>
      </div>

      <div className="conf-actions">
        <button className="btn-conf-done" onClick={handleDone}>
          {lang === 'el' ? 'Επιστροφή στο μενού' : 'Back to menu'}
        </button>
      </div>
    </div>
  )
}
