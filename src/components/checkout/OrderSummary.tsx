import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { makeTr } from '../../lib/translations'
import { activeDays, subTotal, fmt } from '../../lib/helpers'
import { useMenuStore } from '../../store/useMenuStore'
import { DayOrderGroup } from '../shared/DayOrderGroup'
import { useVoucherWidget } from '../cart/useVoucherWidget'

export function OrderSummary() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const cart = useCartStore((s) => s.cart)
  const t = makeTr(lang)

  // Voucher state + handlers come from the shared hook (WEC-193). Same hook
  // powers the cart sidebar's <VoucherInput/>; we render a different layout
  // here (subtotal + savings rows) but the apply/remove + min-order
  // auto-removal logic is unified.
  const { voucher, code, setCode, error, setError, apply, remove, loading, rawTotal } = useVoucherWidget()

  const weeks = useMenuStore((s) => s.weeks)
  const week = weeks[activeWeek] ?? weeks[0]
  const dayIdxs = activeDays(cart)
  const total = subTotal(cart, voucher)

  if (!dayIdxs.length) {
    return (
      <div className="co-summary-card">
        <div className="sidebar-hdr">
          <div className="sidebar-title">{t('cartTitle')}</div>
        </div>
        <div className="cart-empty">
          <div className="cart-empty-img">🛒</div>
          <div className="cart-empty-title">{t('cartEmpty')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="co-summary-card">
      {/* Header */}
      <div className="sidebar-hdr">
        <div className="sidebar-title">{t('cartTitle')}</div>
        <div className="sidebar-sub">{t('cartSub')}</div>
      </div>

      {/* Scrollable items — WEC-189: shared DayOrderGroup with editable=true,
          identical to the cart sidebar. Eliminates the inline cart-item +
          qty-ctrl markup that previously duplicated CartItemRow. */}
      <div className="cart-scroll">
        {dayIdxs.map((i) => {
          const day = week?.days[i]
          if (!day) return null
          return (
            <DayOrderGroup
              key={day.date}
              dayIndex={i}
              day={day}
              editable
            />
          )
        })}
      </div>

      {/* Footer: voucher + total + back */}
      <div className="cart-ftr">
        {/* Voucher widget */}
        {voucher.applied ? (
          <>
            <div className="cart-total-row" style={{ marginBottom: 6 }}>
              <span className="cart-total-lbl" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {lang === 'el' ? 'Υποσύνολο' : 'Subtotal'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)' }}>
                {fmt(rawTotal)}
              </span>
            </div>
            <div className="cart-total-row" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 900, background: 'var(--green-light)', color: 'var(--green-dark)', padding: '1px 6px', borderRadius: 999 }}>
                  {voucher.code}
                </span>
                <span
                  style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={remove}
                >✕</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--green)' }}>
                −{fmt(rawTotal - total)}
              </span>
            </div>
          </>
        ) : (
          <div className="voucher-row" style={{ marginBottom: 10 }}>
            <input
              className="voucher-input"
              placeholder={lang === 'el' ? 'π.χ. FITPAL10' : 'e.g. FITPAL10'}
              value={code}
              onChange={(e) => { setCode(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
              style={{ fontSize: 11, padding: '7px 10px' }}
            />
            <button
              className="btn-apply"
              onClick={apply}
              disabled={!code.trim() || loading}
              style={{ fontSize: 11, padding: '7px 12px' }}
            >
              {loading ? '...' : (lang === 'el' ? 'Εφαρμογή' : 'Apply')}
            </button>
          </div>
        )}
        {error && (
          <div className="fnote bad" style={{ marginTop: -6, marginBottom: 6 }}>{error}</div>
        )}

        {/* Total */}
        <div className="cart-total-row">
          <span className="cart-total-lbl">{t('total')}</span>
          <span className="cart-total-amt">{fmt(total)}</span>
        </div>

        {/* Back to menu */}
        <button className="btn-back-menu" onClick={closeCheckout}>
          {lang === 'el' ? '← Επιστροφή στο Μενού' : '← Back to Menu'}
        </button>
      </div>
    </div>
  )
}
