import { useEffect, useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { makeTr } from '../../lib/translations'
import { activeDays, dayAmt, subTotal, fmt } from '../../lib/helpers'
import { useMenuStore } from '../../store/useMenuStore'
import { DayOrderGroup } from '../shared/DayOrderGroup'

export function OrderSummary() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const applyVoucher = useCartStore((s) => s.applyVoucher)
  const removeVoucher = useCartStore((s) => s.removeVoucher)
  const voucherLoading = useCartStore((s) => s.voucherLoading)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  const [voucherInput, setVoucherInput] = useState('')
  const [voucherError, setVoucherError] = useState('')

  const weeks = useMenuStore((s) => s.weeks)
  const week = weeks[activeWeek] ?? weeks[0]
  const dayIdxs = activeDays(cart)
  const total = subTotal(cart, voucher)

  // Raw subtotal (before voucher)
  const rawTotal = dayIdxs.reduce((sum, i) => sum + dayAmt(cart, i), 0)

  async function handleApplyVoucher() {
    const result = await applyVoucher(voucherInput.trim(), rawTotal, user?.id)
    if (!result.ok) {
      setVoucherError(result.error ?? (lang === 'el' ? 'Άκυρος κωδικός κουπονιού' : 'Invalid voucher code'))
    } else {
      setVoucherError('')
    }
  }

  function handleRemoveVoucher() {
    removeVoucher()
    setVoucherInput('')
    setVoucherError('')
  }

  // When the cart shrinks below the voucher's min_order after the voucher
  // was already applied, drop it and surface the same error message the
  // server returns at apply-time. Mirrors the logic in VoucherInput.tsx
  // (cart sidebar). The two surfaces will be unified into a single shared
  // component as a follow-up — see the cart-component-duplication ticket.
  useEffect(() => {
    if (!voucher.applied || voucher.minOrder == null) return
    if (rawTotal < voucher.minOrder) {
      removeVoucher()
      setVoucherError(
        lang === 'el'
          ? `Απαιτείται ελάχιστη παραγγελία €${voucher.minOrder.toFixed(2)} για αυτό το κουπόνι`
          : `Minimum order €${voucher.minOrder.toFixed(2)} required for this voucher`,
      )
    }
  }, [rawTotal, voucher.applied, voucher.minOrder, removeVoucher, lang])

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
                  onClick={handleRemoveVoucher}
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
              value={voucherInput}
              onChange={(e) => { setVoucherInput(e.target.value.toUpperCase().trim()); setVoucherError('') }}
              style={{ fontSize: 11, padding: '7px 10px' }}
            />
            <button
              className="btn-apply"
              onClick={handleApplyVoucher}
              disabled={voucherLoading}
              style={{ fontSize: 11, padding: '7px 12px' }}
            >
              {voucherLoading ? '...' : (lang === 'el' ? 'Εφαρμογή' : 'Apply')}
            </button>
          </div>
        )}
        {voucherError && (
          <div className="fnote bad" style={{ marginTop: -6, marginBottom: 6 }}>{voucherError}</div>
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
