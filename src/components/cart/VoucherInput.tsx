import { useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { makeTr } from '../../lib/translations'
import { activeDays, dayAmt, voucherInactive } from '../../lib/helpers'

export function VoucherInput() {
  const lang = useUIStore((s) => s.lang)
  const voucher = useCartStore((s) => s.voucher)
  const applyVoucher = useCartStore((s) => s.applyVoucher)
  const removeVoucher = useCartStore((s) => s.removeVoucher)
  const voucherLoading = useCartStore((s) => s.voucherLoading)
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  // Calculate raw cart total for voucher validation
  const rawTotal = activeDays(cart).reduce((sum, i) => sum + dayAmt(cart, i), 0)

  async function handleApply() {
    const result = await applyVoucher(code.trim().toUpperCase(), rawTotal, user?.id)
    if (!result.ok) {
      setError(result.error ?? (lang === 'el' ? 'Μη έγκυρο κουπόνι' : 'Invalid voucher code'))
    } else {
      setCode('')
      setError('')
    }
  }

  if (voucher.applied && voucher.code) {
    // Gate by min_order — when cart shrinks below the voucher's minimum,
    // we keep the chip visible (so the user knows they applied it) but
    // mark it inactive and explain why. Discount is NOT applied to the
    // total in this state — see helpers.ts subTotal().
    const inactive = voucherInactive(cart, voucher)
    return (
      <div>
        <div className={`voucher-applied${inactive ? ' inactive' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>{voucher.code}</span>
          {voucher.type === 'pct' && <span className="voucher-val">-{voucher.value}%</span>}
          {voucher.type === 'fixed' && <span className="voucher-val">-€{voucher.value?.toFixed(2)}</span>}
          <button className="voucher-remove" onClick={removeVoucher}>✕</button>
        </div>
        {inactive && voucher.minOrder != null && (
          <div className="voucher-inactive-warn">
            {lang === 'el'
              ? `Το κουπόνι ισχύει για παραγγελίες ≥ €${voucher.minOrder.toFixed(2)}. Πρόσθεσε ${(voucher.minOrder - rawTotal).toFixed(2)}€ ακόμα για να εφαρμοστεί.`
              : `Voucher requires orders ≥ €${voucher.minOrder.toFixed(2)}. Add €${(voucher.minOrder - rawTotal).toFixed(2)} more to apply.`}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="voucher-row">
      <input
        className="voucher-input"
        placeholder={t('voucherPlaceholder')}
        value={code}
        onChange={(e) => { setCode(e.target.value); setError('') }}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <button className="voucher-btn" onClick={handleApply} disabled={!code.trim() || voucherLoading}>
        {voucherLoading ? '...' : t('apply')}
      </button>
      {error && <div className="voucher-error">{error}</div>}
    </div>
  )
}
