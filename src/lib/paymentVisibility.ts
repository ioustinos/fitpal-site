// WEC-255/588: single source for "which payment methods are visible right now".
//
// The admin configures per-method Public/Admin visibility at /admin/payments
// (`settings.paymentMethodVisibility`). Both the checkout PaymentSection and the
// Account → Προτιμήσεις payment picker must honour the SAME map so a method
// turned off (Public) can't be offered anywhere to customers. This module holds
// the canonical catalog (display order + icon) and the filter, so neither caller
// duplicates the logic (WEC-490 philosophy).
//
// Labels/descriptions come from the single payment-methods source
// (`paymentMethods.ts`); this file only adds display order + the per-method icon.

import { PAYMENT_METHODS as PM, type PaymentMethodId } from './paymentMethods'
import type { PaymentMethodVisibilityMap } from './api/settings'

export interface PaymentCatalogEntry {
  id: PaymentMethodId
  iconPath: string
  labelEl: string
  labelEn: string
  descEl: string
  descEn: string
}

/** Canonical catalog — checkout display order + icons. Labels from `paymentMethods.ts`. */
export const PAYMENT_METHOD_CATALOG: PaymentCatalogEntry[] = [
  { id: 'wallet',   iconPath: 'M2 9h20M2 5h20v14H2zM16 12h.01', labelEl: PM.wallet.titleEl,   labelEn: PM.wallet.titleEn,   descEl: PM.wallet.descEl,   descEn: PM.wallet.descEn },
  { id: 'card',     iconPath: 'M3 9h18M7 15h.01M11 15h2',        labelEl: PM.card.titleEl,     labelEn: PM.card.titleEn,     descEl: PM.card.descEl,     descEn: PM.card.descEn },
  { id: 'cash',     iconPath: 'M12 12a4 4 0 100-8 4 4 0 000 8zM3 20c0-4 3.6-7 9-7s9 3 9 7', labelEl: PM.cash.titleEl, labelEn: PM.cash.titleEn, descEl: PM.cash.descEl, descEn: PM.cash.descEn },
  { id: 'link',     iconPath: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71', labelEl: PM.link.titleEl, labelEn: PM.link.titleEn, descEl: PM.link.descEl, descEn: PM.link.descEn },
  { id: 'transfer', iconPath: 'M4 6h16M4 12h16M4 18h16',         labelEl: PM.transfer.titleEl, labelEn: PM.transfer.titleEn, descEl: PM.transfer.descEl, descEn: PM.transfer.descEn },
]

export interface PaymentVisibilityOpts {
  /** When an admin is impersonating a customer, use each method's `admin` flag. */
  isImpersonating: boolean
  /**
   * Checkout-only: also hide the wallet for non-impersonating customers when it
   * isn't spendable now (no active wallet / zero balance / admin-managed). The
   * preferences picker leaves this OFF — a saved default shouldn't depend on the
   * current balance.
   */
  applyWalletGating?: boolean
  wallet?: { active?: boolean | null; balance?: number | null; adminManaged?: boolean | null } | null
}

/**
 * Filter the catalog by the admin visibility map.
 *   Layer 1 — public/admin flag (admin when impersonating).
 *   Layer 2 — optional wallet spendability gating (checkout only).
 * Returns catalog entries in canonical order.
 */
export function visiblePaymentMethods(
  visibility: PaymentMethodVisibilityMap | undefined,
  opts: PaymentVisibilityOpts,
): PaymentCatalogEntry[] {
  if (!visibility) return []
  const { isImpersonating, applyWalletGating = false, wallet } = opts
  return PAYMENT_METHOD_CATALOG.filter((m) => {
    const v = visibility[m.id]
    if (!v) return false
    if (!(isImpersonating ? v.admin : v.public)) return false
    if (applyWalletGating && m.id === 'wallet' && !isImpersonating) {
      if (wallet?.adminManaged) return false
      if (!wallet?.active || (wallet?.balance ?? 0) <= 0) return false
    }
    return true
  })
}

/** Lookup a single catalog entry by id (e.g. to render a saved-but-hidden pref). */
export function paymentCatalogEntry(id: string): PaymentCatalogEntry | undefined {
  return PAYMENT_METHOD_CATALOG.find((m) => m.id === id)
}
