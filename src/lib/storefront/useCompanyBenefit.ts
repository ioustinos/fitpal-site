/**
 * WEC-713 (B2B-5 — Company Benefit): the per-delivery-day amount a company
 * funds for its employees, as the cart should display it.
 *
 * Ioustinos: *"an invisible voucher that is automatically applied and it's a
 * monetary deduction, lets say 2 euros… actually call it company benefit and
 * make it visual on cart."*
 *
 * Two things this is NOT:
 *   - not a voucher: an ordinary voucher can still be applied on top
 *   - not a discount: the COMPANY REIMBURSES Fitpal, so it is never folded
 *     into the order's discount amount (see submit-order.ts and
 *     recompute_order_money — the server is authoritative for all of this)
 *
 * Amounts here are in EUROS, matching the rest of the client. The store
 * setting is in cents, like everything server-side.
 */

import { useCartStore } from '../../store/useCartStore'
import { useStorefront } from './StoreProvider'
import { activeDays, dayAmt } from '../helpers'

export interface CompanyBenefit {
  /** Euros funded per delivery day. 0 on retail, or when the store has none. */
  perDay: number
  /** Delivery days in the cart that actually accrue something. */
  days: number
  /** Total euros deducted across the cart. */
  total: number
  /** Per-date breakdown, for showing the amount next to each day. */
  byDate: Record<string, number>
  active: boolean
}

export function useCompanyBenefit(): CompanyBenefit {
  const storefront = useStorefront()
  const cart = useCartStore((s) => s.cart)

  const raw = (storefront.settings as Record<string, unknown>)?.company_benefit
  const perDayCents = !storefront.isMain && typeof raw === 'number' && raw > 0 ? Math.floor(raw) : 0
  const perDay = perDayCents / 100

  if (perDay <= 0) {
    return { perDay: 0, days: 0, total: 0, byDate: {}, active: false }
  }

  const byDate: Record<string, number> = {}
  let total = 0
  for (const date of activeDays(cart)) {
    // A day never contributes more than it is worth — the benefit cannot
    // push a day, or the order, below zero.
    const amount = Math.min(perDay, dayAmt(cart, date))
    if (amount > 0) {
      byDate[date] = amount
      total += amount
    }
  }

  return {
    perDay,
    days: Object.keys(byDate).length,
    total: Math.round(total * 100) / 100,
    byDate,
    active: true,
  }
}
