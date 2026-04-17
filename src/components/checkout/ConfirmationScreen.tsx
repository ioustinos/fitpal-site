import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { activeDays, dayAmt, fmt, subTotal } from '../../lib/helpers'
import { useMenuStore } from '../../store/useMenuStore'

const dayLabelsEl = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή']
const dayLabelsEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}

export function ConfirmationScreen({ orderNumber }: { orderNumber?: string }) {
  const lang = useUIStore((s) => s.lang)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const activeWeek = useUIStore((s) => s.activeWeek)

  const cart = useCartStore((s) => s.cart)
  const delivery = useCartStore((s) => s.delivery)
  const payment = useCartStore((s) => s.payment)
  const voucher = useCartStore((s) => s.voucher)
  const clearAll = useCartStore((s) => s.clearAll)

  function handleDone() {
    clearAll()
    closeCheckout()
  }

  function handleDownloadPDF() {
    // Placeholder for PDF download functionality
    console.log('PDF download not yet implemented')
  }

  const activeDayIdxs = activeDays(cart)
  const weeks = useMenuStore((s) => s.weeks)
  const weekData = weeks[activeWeek] ?? weeks[0]
  const total = subTotal(cart, voucher)

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
        <div className="conf-order-number" style={{ fontSize: 15, fontWeight: 800, color: 'var(--brand)', marginBottom: 8 }}>
          {lang === 'el' ? 'Αριθμός παραγγελίας' : 'Order number'}: {orderNumber}
        </div>
      )}

      <p className="conf-sub">
        {lang === 'el'
          ? 'Θα λάβεις email επιβεβαίωσης σύντομα.'
          : "You'll receive a confirmation email shortly."}
      </p>

      <div className="conf-summary">
        {activeDayIdxs.map((dayIdx) => {
          const dayLabel = lang === 'el' ? dayLabelsEl[dayIdx] : dayLabelsEn[dayIdx]
          const dateISO = weekData?.days[dayIdx]?.date ?? ''
          const formattedDate = formatDate(dateISO, lang)
          const delivInfo = delivery[dayIdx]
          const timeSlot = delivInfo?.timeSlot || ''
          const street = delivInfo?.street || ''
          const area = delivInfo?.area || ''
          const items = cart[dayIdx] || []
          const dayTotal = dayAmt(cart, dayIdx)

          return (
            <div className="conf-day" key={dayIdx}>
              <div className="conf-day-name">
                {dayLabel} {formattedDate}
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

        {payment.notes && (
          <div className="conf-comment">
            "{payment.notes}"
          </div>
        )}

        <div className="conf-total">
          <span>{lang === 'el' ? 'Σύνολο' : 'Total'}</span>
          <span>{fmt(total)}</span>
        </div>
      </div>

      <div className="conf-actions">
        <button className="btn-conf-done" onClick={handleDone}>
          {lang === 'el' ? 'Επιστροφή στο μενού' : 'Back to menu'}
        </button>
        <button className="btn-conf-pdf" onClick={handleDownloadPDF}>
          📄 {lang === 'el' ? 'Κάνε download PDF' : 'Download PDF'}
        </button>
      </div>
    </div>
  )
}
