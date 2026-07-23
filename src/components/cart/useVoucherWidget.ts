import { useEffect, useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useToast } from '../ui/Toast'
import { activeDays, dayAmt, eligibleSubtotal } from '../../lib/helpers'

/**
 * WEC-455: localize the server's structured voucher rejection. Each errorCode
 * maps to a bilingual user-facing message. Some codes use structured params
 * from the server (e.g. min_order_not_met → minOrderCents → formatted euros).
 *
 * If we receive an errorCode we don't recognise (forward-compat with future
 * server-side additions), we fall back to the server's English `error` field.
 * If even that's missing, the user gets a generic "invalid code".
 */
function localizeVoucherError(
  errorCode: string | undefined,
  errorParams: Record<string, unknown> | undefined,
  serverError: string | undefined,
  lang: 'el' | 'en',
): string {
  if (!errorCode) {
    return serverError ?? (lang === 'el' ? 'Μη έγκυρο κουπόνι' : 'Invalid voucher code')
  }

  const isEl = lang === 'el'

  switch (errorCode) {
    case 'not_found':
      return isEl ? 'Ο κωδικός δεν βρέθηκε' : "This voucher code doesn't exist"
    case 'inactive':
      return isEl ? 'Ο κωδικός δεν είναι ενεργός' : 'This voucher is currently disabled'
    case 'expired':
      return isEl ? 'Ο κωδικός έχει λήξει' : 'This voucher has expired'
    case 'max_uses_reached':
      return isEl ? 'Ο κωδικός έχει εξαντληθεί' : 'This voucher has reached its maximum uses'
    case 'per_user_limit':
      return isEl ? 'Ο κωδικός έχει ήδη χρησιμοποιηθεί' : 'This code has already been used'
    case 'registered_only':
      return isEl ? 'Συνδέσου για να χρησιμοποιήσεις αυτόν τον κωδικό' : 'Log in to use this code'
    case 'user_mismatch':
      return isEl ? 'Ο κωδικός δεν είναι διαθέσιμος για τον λογαριασμό σου' : 'This voucher is not available for your account'
    case 'credit_exhausted':
      return isEl ? 'Το υπόλοιπο του κωδικού έχει εξαντληθεί' : "This voucher's credit balance is depleted"
    case 'no_eligible_items':
      return isEl ? 'Κανένα προϊόν στο καλάθι σου δεν είναι επιλέξιμο για αυτόν τον κωδικό' : 'No items in your cart qualify for this voucher'
    case 'rate_limit':
      return isEl ? 'Πολλές προσπάθειες. Δοκίμασε ξανά σε λίγο' : 'Too many attempts — please try again shortly'
    case 'network':
      return isEl ? 'Σφάλμα δικτύου — δοκίμασε ξανά' : 'Network error — please try again'
    case 'min_order_not_met': {
      const minCents = typeof errorParams?.minOrderCents === 'number' ? (errorParams.minOrderCents as number) : null
      const cartCents = typeof errorParams?.cartTotalCents === 'number' ? (errorParams.cartTotalCents as number) : null
      if (minCents != null) {
        const minEuros = (minCents / 100).toFixed(2)
        const needEuros = cartCents != null
          ? ((minCents - cartCents) / 100).toFixed(2)
          : null
        if (needEuros != null && +needEuros > 0) {
          return isEl
            ? `Ελάχιστη παραγγελία €${minEuros} για αυτόν τον κωδικό (χρειάζεσαι €${needEuros} ακόμα)`
            : `Minimum order €${minEuros} required (add €${needEuros} more)`
        }
        return isEl
          ? `Απαιτείται ελάχιστη παραγγελία €${minEuros}`
          : `Minimum order €${minEuros} required`
      }
      return serverError ?? (isEl ? 'Δεν πληρείται η ελάχιστη παραγγελία' : 'Minimum order not met')
    }
    default:
      return serverError ?? (isEl ? 'Μη έγκυρος κωδικός' : 'Invalid voucher code')
  }
}

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
  const revalidateVoucher = useCartStore((s) => s.revalidateVoucher)
  const removeVoucher = useCartStore((s) => s.removeVoucher)
  const voucherLoading = useCartStore((s) => s.voucherLoading)
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)

  const dishMap = useMenuStore((s) => s.dishMap)
  const catLookup = (id: string) => dishMap[id]?.catId
  // WEC-402: toast on auto-drop so the customer sees the removal even when
  // they're not looking at the voucher widget (e.g. after a page reload that
  // re-validated the persisted voucher against the current cart and rejected).
  const toast = useToast((s) => s.show)

  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  // Cart-wide raw total (before voucher), used for min-order checks at
  // apply-time and for the "drop voucher when cart shrinks" effect below.
  const rawTotal = activeDays(cart).reduce((sum, i) => sum + dayAmt(cart, i), 0)
  // WEC-262: eligible-only subtotal under a scoped voucher. When the
  // customer removes the last item that qualifies, we drop the voucher
  // to keep the displayed total honest.
  const eligibleNow = eligibleSubtotal(cart, voucher, catLookup)

  async function apply() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    const result = await applyVoucher(trimmed, rawTotal, user?.id)
    if (!result.ok) {
      // WEC-455: map server's structured errorCode to a localized,
      // specific message. Fall back to the server's English message (or a
      // generic "invalid code") if the errorCode is unknown — should never
      // happen for clients on the same version as the server but kept as a
      // defensive default.
      setError(localizeVoucherError(result.errorCode, result.errorParams, result.error, lang))
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

  // WEC-562: at checkout, re-check the applied voucher against the entered
  // email + phone. If the server now rejects on identity (e.g. a guest reusing
  // a one-per-user code, which can't be caught at apply-time before contact
  // info exists), the store drops the voucher — here we surface the reason
  // inline + toast, mirroring the min-order / scoped auto-drop UX above.
  // Transient network/rate errors keep the voucher (submit stays the backstop).
  async function revalidateWithContact(email: string, phone: string) {
    if (!voucher.applied) return
    const droppedCode = voucher.code
    const result = await revalidateVoucher(rawTotal, user?.id, { email, phone })
    if (!result.ok && !result.transient) {
      const msg = localizeVoucherError(result.errorCode, result.errorParams, result.error, lang)
      setError(msg)
      toast(lang === 'el'
        ? `Ο κωδικός ${droppedCode} αφαιρέθηκε — ${msg.toLowerCase()}`
        : `Voucher ${droppedCode} removed — ${msg.toLowerCase()}`)
    }
  }

  // Auto-drop the applied voucher when the cart shrinks below its min_order.
  // We surface the same message the server returns at apply-time so the
  // user immediately understands why the discount disappeared.
  useEffect(() => {
    if (!voucher.applied || voucher.minOrder == null) return
    if (rawTotal < voucher.minOrder) {
      const droppedCode = voucher.code
      removeVoucher()
      const msg = lang === 'el'
        ? `Απαιτείται ελάχιστη παραγγελία €${voucher.minOrder.toFixed(2)} για αυτό το κουπόνι`
        : `Minimum order €${voucher.minOrder.toFixed(2)} required for this voucher`
      setError(msg)
      // WEC-402: also toast so a reload-induced drop (or a drop while the cart
      // sidebar is closed) is visible — not silent.
      toast(lang === 'el'
        ? `Ο κωδικός ${droppedCode} αφαιρέθηκε — ${msg.toLowerCase()}`
        : `Voucher ${droppedCode} removed — ${msg.toLowerCase()}`)
    }
  }, [rawTotal, voucher.applied, voucher.minOrder, voucher.code, removeVoucher, lang, toast])

  // Resolve category ids → labels so the auto-drop message can tell the
  // customer exactly which categories the voucher works on, instead of
  // a generic "not applicable" line.
  const categories = useMenuStore((s) => s.categories)

  // WEC-262: auto-drop scoped voucher when no eligible items remain in
  // the cart. e.g. customer applies "salads only", removes all salads —
  // the voucher disappears with a clear list of which categories it does
  // apply to so the customer knows what they could add.
  useEffect(() => {
    if (!voucher.applied) return
    const cats = voucher.applicableCategoryIds
    if (!cats || cats.length === 0) return
    if (eligibleNow <= 0) {
      const droppedCode = voucher.code
      removeVoucher()
      const labels = cats
        .map((id) => {
          const c = categories.find((cc) => cc.id === id)
          if (!c) return id
          return lang === 'el' ? c.labelEl : c.labelEn
        })
        .join(', ')
      const msg = lang === 'el'
        ? `Το κουπόνι εφαρμόζεται μόνο στις εξής κατηγορίες: ${labels}`
        : `This voucher only applies to: ${labels}`
      setError(msg)
      // WEC-402: also toast so the customer sees the drop even if the cart
      // sidebar isn't in view at that moment.
      toast(lang === 'el'
        ? `Ο κωδικός ${droppedCode} αφαιρέθηκε — ${msg.toLowerCase()}`
        : `Voucher ${droppedCode} removed — ${msg.toLowerCase()}`)
    }
  }, [eligibleNow, voucher.applied, voucher.applicableCategoryIds, voucher.code, removeVoucher, lang, categories, toast])

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
    /** WEC-562: re-check the applied voucher against checkout email+phone; drops + explains on identity rejection */
    revalidateWithContact,
    /** True while applyVoucher is in flight */
    loading: voucherLoading,
    /** Cart-wide raw total (before voucher), useful for summary surfaces */
    rawTotal,
  }
}
