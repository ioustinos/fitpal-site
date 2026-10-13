/**
 * WEC-845 — «Έκπτωση διαιτολόγου» as its own totals line (cart sidebar,
 * mobile sheet, checkout summary). Kept separate from the voucher line, like
 * the company benefit, so the customer sees who is giving what.
 *
 * WEC-870: the dietitian discount and a voucher never stack — the larger one
 * applies. `superseded` = the voucher won (this line shows «not combined»);
 * `voucherDropped` > 0 = this discount won and the voucher is not applied.
 */
import { fmt } from '../../lib/helpers'

export function PartnerDiscountRow({ lang, pct, amount, partnerName, superseded = false, voucherDropped = 0 }: {
  lang: string; pct: number; amount: number; partnerName: string; superseded?: boolean; voucherDropped?: number
}) {
  if (amount <= 0 && !superseded) return null
  const el = lang === 'el'
  const pctLabel = Number.isInteger(pct) ? String(pct) : pct.toFixed(1)
  const note = superseded
    ? (el ? 'Δεν συνδυάζεται με κουπόνι — ισχύει το κουπόνι, που είναι μεγαλύτερο' : 'Not combined with a voucher — the larger voucher applies')
    : voucherDropped > 0
      ? (el ? 'Δεν συνδυάζεται με το κουπόνι — ισχύει αυτή, που είναι μεγαλύτερη' : 'Not combined with the voucher — this larger discount applies')
      : partnerName
  return (
    <div className="cart-total-row cart-benefit-row" style={{ marginBottom: 6, opacity: superseded ? 0.6 : 1 }}>
      <span className="cart-total-lbl cart-benefit-lbl">
        {el ? `Έκπτωση διαιτολόγου ${pctLabel}%` : `Dietitian discount ${pctLabel}%`}
        {note && <span className="cart-benefit-sub">{note}</span>}
      </span>
      <span className="cart-benefit-amt">{superseded ? '—' : `−${fmt(amount)}`}</span>
    </div>
  )
}
