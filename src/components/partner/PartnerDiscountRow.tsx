/**
 * WEC-845 — «Έκπτωση διαιτολόγου» as its own totals line (cart sidebar,
 * mobile sheet, checkout summary). Kept separate from the voucher line, like
 * the company benefit, so the customer sees who is giving what.
 */
import { fmt } from '../../lib/helpers'

export function PartnerDiscountRow({ lang, pct, amount, partnerName }: {
  lang: string; pct: number; amount: number; partnerName: string
}) {
  if (amount <= 0) return null
  const pctLabel = Number.isInteger(pct) ? String(pct) : pct.toFixed(1)
  return (
    <div className="cart-total-row cart-benefit-row" style={{ marginBottom: 6 }}>
      <span className="cart-total-lbl cart-benefit-lbl">
        {lang === 'el' ? `Έκπτωση διαιτολόγου ${pctLabel}%` : `Dietitian discount ${pctLabel}%`}
        {partnerName && <span className="cart-benefit-sub">{partnerName}</span>}
      </span>
      <span className="cart-benefit-amt">−{fmt(amount)}</span>
    </div>
  )
}
