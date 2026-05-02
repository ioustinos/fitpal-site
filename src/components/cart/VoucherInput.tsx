import { useUIStore } from '../../store/useUIStore'
import { makeTr } from '../../lib/translations'
import { useVoucherWidget } from './useVoucherWidget'

/**
 * Cart sidebar voucher widget — compact pill when applied, single-row
 * input otherwise. Logic comes from `useVoucherWidget`; this file owns
 * only the layout. The checkout summary's voucher block uses the same
 * hook with a different layout (subtotal + savings rows).
 */
export function VoucherInput() {
  const lang = useUIStore((s) => s.lang)
  const t = makeTr(lang)
  const { voucher, code, setCode, error, setError, apply, remove, loading } = useVoucherWidget()

  if (voucher.applied && voucher.code) {
    return (
      <div className="voucher-applied">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>{voucher.code}</span>
        {voucher.type === 'pct' && <span className="voucher-val">-{voucher.value}%</span>}
        {voucher.type === 'fixed' && <span className="voucher-val">-€{voucher.value?.toFixed(2)}</span>}
        <button className="voucher-remove" onClick={remove}>✕</button>
      </div>
    )
  }

  // Error renders OUTSIDE `.voucher-row` so it doesn't get pulled into the
  // flex row alongside the input + button (which would squash the input
  // and grow the row vertically). Mirrors the OrderSummary layout where
  // the error sits as a separate block below the row.
  return (
    <>
      <div className="voucher-row">
        <input
          className="voucher-input"
          placeholder={t('voucherPlaceholder')}
          value={code}
          onChange={(e) => { setCode(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
        />
        <button className="voucher-btn" onClick={apply} disabled={!code.trim() || loading}>
          {loading ? '...' : t('apply')}
        </button>
      </div>
      {error && <div className="voucher-error">{error}</div>}
    </>
  )
}
