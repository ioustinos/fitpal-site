import { useEffect } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { makeTr } from '../../lib/translations'
import { activeDays, subTotal, fmt } from '../../lib/helpers'
import { useMenuStore } from '../../store/useMenuStore'
import { DayOrderGroup } from '../shared/DayOrderGroup'
import { CartDietWarning } from '../cart/CartDietWarning'
import { useVoucherWidget } from '../cart/useVoucherWidget'

interface OrderSummaryProps {
  /** WEC-562: checkout contact identity used to re-validate the voucher. */
  contactEmail?: string
  contactPhone?: string
  /** True once both email + phone pass their field validators. */
  contactReady?: boolean
}

export function OrderSummary({ contactEmail = '', contactPhone = '', contactReady = false }: OrderSummaryProps = {}) {
  const lang = useUIStore((s) => s.lang)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const cart = useCartStore((s) => s.cart)
  const t = makeTr(lang)

  // Voucher state + handlers come from the shared hook (WEC-193). Same hook
  // powers the cart sidebar's <VoucherInput/>; we render a different layout
  // here (subtotal + savings rows) but the apply/remove + min-order
  // auto-removal logic is unified.
  const { voucher, code, setCode, error, setError, apply, remove, loading, rawTotal, revalidateWithContact } = useVoucherWidget()

  // WEC-562: once the customer has entered a valid email + phone at checkout,
  // re-validate any applied voucher against that identity (debounced) so a
  // guest reusing a one-per-user code is told BEFORE submit, not after. The
  // hook drops the voucher + surfaces the reason inline/toast on rejection.
  useEffect(() => {
    if (!voucher.applied || !contactReady) return
    const id = window.setTimeout(() => {
      void revalidateWithContact(contactEmail, contactPhone)
    }, 500)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactEmail, contactPhone, contactReady, voucher.applied, voucher.code])

  const weeks = useMenuStore((s) => s.weeks)
  const dishMap = useMenuStore((s) => s.dishMap)
  // WEC-262: dish→category lookup for scope-aware voucher discount.
  const catLookup = (id: string) => dishMap[id]?.catId
  // WEC-336: activeDays returns date strings (YYYY-MM-DD), iterated below.
  const dates = activeDays(cart)
  const total = subTotal(cart, voucher, catLookup)

  if (!dates.length) {
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
      {/* WEC-336: iterate cart dates and match each to a loaded WeekDay
          across all weeks (not just the active one). Falls back to a stub
          {date} if no matching day is loaded so the row still renders. */}
      <div className="cart-scroll">
        {dates.map((dDate) => {
          const day =
            weeks.flatMap((w) => w?.days ?? []).find((wd) => wd.date === dDate)
            ?? { date: dDate }
          return (
            <DayOrderGroup
              key={dDate}
              day={day}
              editable
            />
          )
        })}
      </div>

      {/* Footer: voucher + total + back */}
      <div className="cart-ftr">
        {/* WEC-345: allergy / avoided-ingredient warning above the totals. */}
        <CartDietWarning />

        {/* Voucher widget */}
        {voucher.applied ? (
          <>
            <div className="cart-total-row" style={{ marginBottom: 6 }}>
              <span className="cart-total-lbl" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('subtotal')}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)' }}>
                {fmt(rawTotal)}
              </span>
            </div>
            <div className="cart-total-row" style={{ marginBottom: 6 }}>
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
            {/* WEC-217: single-voucher policy hint (matches CartSidebar). */}
            <div className="voucher-policy" style={{ marginBottom: 10 }}>
              {t('coOneVoucherPerOrder')}
            </div>
          </>
        ) : (
          <div className="voucher-row" style={{ marginBottom: 10 }}>
            <input
              className="voucher-input"
              placeholder={t('voucherPh')}
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
              {loading ? '...' : t('voucherApply')}
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
          {t('backMenu')}
        </button>
      </div>
    </div>
  )
}
