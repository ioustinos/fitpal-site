import { useEffect, useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { activeDays, dayAmt } from '../../lib/helpers'

/**
 * Shared voucher logic for the two surfaces that render a voucher widget:
 *   - CartSidebar's <VoucherInput /> (compact pill in the sidebar footer)
 *   - OrderSummary's inline voucher block (checkout summary footer)
 *
 * Before WEC-193 each surface kept its own copy of:
 *   - apply / remove handlers wired to useCartStore
 *   - error state + min-order auto-remove effect
 *   - rawTotal calculation across active days
 *
 * The two copies drifted (one would auto-remove on min-order, the other
 * wouldn't, etc.) — root cause of WEC-188-class bugs. This hook is the
 * single source of truth; visual components stay separate so each surface
 * can render the shape that fits its layout.
 */
export function useVoucherWidget() {
  const lang = useUIStore((s) => s.lang)
  const voucher = useCartStore((s) => s.voucher)
  const applyVoucher = useCartStore((s) => s.applyVoucher)
  const removeVoucher = useCartStore((s) => s.removeVoucher)
  const voucherLoading = useCartStore((s) => s.voucherLoading)
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)

  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  // Cart-wide raw total (before voucher), used for min-order checks at
  // apply-time and for the "drop voucher when cart shrinks" effect below.
  const rawTotal = activeDays(cart).reduce((sum, i) => sum + dayAmt(cart, i), 0)

  async function apply() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    const result = await applyVoucher(trimmed, rawTotal, user?.id)
    if (!result.ok) {
      setError(result.error ?? (lang === 'el' ? 'Μη έγκυρο κουπόνι' : 'Invalid voucher code'))
    } else {
      setCode('')
      setError('')
    }
  }

  function remove() {
    removeVoucher()
    setCode('')
    setError('')
  }

  // Auto-drop the applied voucher when the cart shrinks below its min_order.
  // We surface the same message the server returns at apply-time so the
  // user immediately understands why the discount disappeared.
  useEffect(() => {
    if (!voucher.applied || voucher.minOrder == null) return
    if (rawTotal < voucher.minOrder) {
      removeVoucher()
      setError(
        lang === 'el'
          ? `Απαιτείται ελάχιστη παραγγελία €${voucher.minOrder.toFixed(2)} για αυτό το κουπόνι`
          : `Minimum order €${voucher.minOrder.toFixed(2)} required for this voucher`,
      )
    }
  }, [rawTotal, voucher.applied, voucher.minOrder, removeVoucher, lang])

  return {
    /** Cart-store voucher state (.applied, .code, .type, .value, .minOrder, etc.) */
    voucher,
    /** Controlled input value for the code field */
    code,
    setCode,
    /** User-facing error string ('' = clear) */
    error,
    setError,
    /** Apply the current input code; sets `error` on failure */
    apply,
    /** Remove the applied voucher and clear input + error */
    remove,
    /** True while applyVoucher is in flight */
    loading: voucherLoading,
    /** Cart-wide raw total (before voucher), useful for summary surfaces */
    rawTotal,
  }
}
