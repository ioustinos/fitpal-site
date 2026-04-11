import { useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { makeTr } from '../../lib/translations'

export function VoucherInput() {
  const lang = useUIStore((s) => s.lang)
  const voucher = useCartStore((s) => s.voucher)
  const applyVoucher = useCartStore((s) => s.applyVoucher)
  const removeVoucher = useCartStore((s) => s.removeVoucher)
  const t = makeTr(lang)

  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  function handleApply() {
    const result = applyVoucher(code.trim().toUpperCase())
    if (!result) {
      setError(lang === 'el' ? 'Μη έγκυρο κουπόνι' : 'Invalid voucher code')
    } else {
      setCode('')
      setError('')
    }
  }

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
      <button className="voucher-btn" onClick={handleApply} disabled={!code.trim()}>
        {t('apply')}
      </button>
      {error && <div className="voucher-error">{error}</div>}
    </div>
  )
}
