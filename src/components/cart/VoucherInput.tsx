import { useEffect, useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { makeTr } from '../../lib/translations'
import { activeDays, dayAmt } from '../../lib/helpers'

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

  // When the cart shrinks below the voucher's min_order after the voucher
  // was already applied, drop it and surface the same error message the
  // server returns at apply-time. The user can re-apply once the cart
  // gets back above the minimum. This matches the regular validation path
  // — no new UI, just the existing voucher-error message.
  useEffect(() => {
    // [TEMP DEBUG] tracing this whole chain to figure out why the auto-
    // remove on cart-shrink isn't firing in localhost. Remove once verified.
    // eslint-disable-next-line no-console
    console.log('[voucher useEffect]', {
      applied: voucher.applied,
      code: voucher.code,
      minOrder: voucher.minOrder,
      rawTotal,
      cartKeys: Object.keys(cart),
    })
    if (!voucher.applied) {
      // eslint-disable-next-line no-console
      console.log('[voucher useEffect] bail: not applied')
      return
    }
    if (voucher.minOrder == null) {
      // eslint-disable-next-line no-console
      console.log('[voucher useEffect] bail: minOrder is null/undefined →',
        'voucher state was set without a minOrder. Either validate-voucher',
        'didn\'t return one, or this voucher state predates the deploy.')
      return
    }
    if (rawTotal < voucher.minOrder) {
      // eslint-disable-next-line no-console
      console.log('[voucher useEffect] FIRING: rawTotal', rawTotal, '<', voucher.minOrder, '— removing voucher')
      removeVoucher()
      setError(
        lang === 'el'
          ? `Απαιτείται ελάχιστη παραγγελία €${voucher.minOrder.toFixed(2)} για αυτό το κουπόνι`
          : `Minimum order €${voucher.minOrder.toFixed(2)} required for this voucher`,
      )
    } else {
      // eslint-disable-next-line no-console
      console.log('[voucher useEffect] OK: rawTotal', rawTotal, '>=', voucher.minOrder)
    }
  }, [rawTotal, voucher.applied, voucher.minOrder, voucher.code, cart, removeVoucher, lang])

  if (voucher.applied && voucher.code) {
    return (
      <div className="voucher-applied">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>{voucher.code}</span>
        {voucher.type === 'pct' && <span className="voucher-val">-{voucher.value}%</span>}
        {voucher.type === 'fixed' && <span className="voucher-val">-€{voucher.value?.toFixed(2)}</span>}
        <button className="voucher-remove" onClick={removeVoucher}>✕</button>
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
