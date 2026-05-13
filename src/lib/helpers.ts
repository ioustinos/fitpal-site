import type { CartItem, VoucherState } from '../store/useCartStore'

// ─── Formatting ───────────────────────────────────────────────────────────────

export const fmt = (n: number) => '€' + n.toFixed(2)

// ─── Pricing ──────────────────────────────────────────────────────────────────

/** Apply a percentage discount to a price */
export const effPrice = (price: number, discountPct?: number): number =>
  discountPct ? +(price * (1 - discountPct / 100)).toFixed(2) : price

// ─── Cart totals ──────────────────────────────────────────────────────────────
//
// WEC-336: cart is now keyed by delivery date (YYYY-MM-DD), not dayIndex.
// All helpers that look up a single day take a `dayDate: string` instead of
// a `dayIndex: number`. activeDays() returns sorted date strings.

/** Sum of items for a single delivery date */
export const dayAmt = (cart: Record<string, CartItem[]>, dayDate: string): number =>
  (cart[dayDate] ?? []).reduce((s, i) => s + i.price * i.qty, 0)

/**
 * Cart-wide raw total (no voucher, no discount). Sum of every item's
 * line total across all dates.
 */
export const cartRaw = (cart: Record<string, CartItem[]>): number =>
  Object.values(cart).reduce(
    (s, items) => s + items.reduce((ss, i) => ss + i.price * i.qty, 0),
    0,
  )

/**
 * Eligible subtotal under a voucher. For unscoped vouchers this equals
 * cartRaw. For scoped vouchers (WEC-262) it's the sum of items whose
 * dish is in the voucher's applicable categories. Returns 0 if the cart
 * has no eligible items — caller should treat that as voucher-not-applicable.
 *
 * `dishCatLookup` is `(dishId) => categoryId | undefined`. The customer
 * passes a closure over `useMenuStore.dishMap`. If omitted (e.g. raw
 * helpers called somewhere without the menu store), we return cartRaw —
 * the server's submit-order guard is still authoritative.
 */
export const eligibleSubtotal = (
  cart: Record<string, CartItem[]>,
  voucher?: VoucherState,
  dishCatLookup?: (dishId: string) => string | undefined,
): number => {
  const raw = cartRaw(cart)
  const cats = voucher?.applicableCategoryIds
  if (!voucher?.applied || !cats || cats.length === 0 || !dishCatLookup) return raw
  let s = 0
  for (const items of Object.values(cart)) {
    for (const i of items) {
      const cat = dishCatLookup(i.dishId)
      if (cat && cats.includes(cat)) s += i.price * i.qty
    }
  }
  return +s.toFixed(2)
}

/**
 * Voucher discount in euros. WEC-262: applied to the eligible subtotal,
 * not the full raw total. Caller must pass `dishCatLookup` if they want
 * scope-aware discounting; without it, scoped vouchers fall back to the
 * raw cart total (over-discounts in UI, but the server's submit-order
 * still computes the correct number for the actual order).
 */
export const voucherDiscount = (
  cart: Record<string, CartItem[]>,
  voucher?: VoucherState,
  dishCatLookup?: (dishId: string) => string | undefined,
): number => {
  if (!voucher?.applied || !voucher.value) return 0
  const base = eligibleSubtotal(cart, voucher, dishCatLookup)
  if (base <= 0) return 0
  if (voucher.type === 'pct')   return +(base * voucher.value / 100).toFixed(2)
  if (voucher.type === 'fixed') return Math.min(voucher.value, base)
  return 0
}

/**
 * Per-item discount allocation (WEC-262). For a scoped voucher, the
 * total discount is split proportionally across eligible items in the
 * cart so each cart row can show its individual "−€X". Returns 0 for
 * items not in the voucher's category scope.
 *
 * For UNSCOPED vouchers (cats empty) this still allocates proportionally
 * across all items, so the cart can show a per-item line if you want it.
 * Pass dishCatLookup so we can identify eligible items for scoped cases.
 */
export const itemVoucherDiscount = (
  item: CartItem,
  cart: Record<string, CartItem[]>,
  voucher?: VoucherState,
  dishCatLookup?: (dishId: string) => string | undefined,
): number => {
  const totalDiscount = voucherDiscount(cart, voucher, dishCatLookup)
  if (totalDiscount <= 0) return 0
  const cats = voucher?.applicableCategoryIds ?? []
  // Determine if this item is in scope.
  if (cats.length > 0 && dishCatLookup) {
    const cat = dishCatLookup(item.dishId)
    if (!cat || !cats.includes(cat)) return 0
  }
  const eligible = eligibleSubtotal(cart, voucher, dishCatLookup)
  if (eligible <= 0) return 0
  const lineTotal = item.price * item.qty
  return +(totalDiscount * (lineTotal / eligible)).toFixed(2)
}

/** Grand total across all dates, with voucher applied */
export const subTotal = (
  cart: Record<string, CartItem[]>,
  voucher?: VoucherState,
  dishCatLookup?: (dishId: string) => string | undefined,
): number => {
  const raw = cartRaw(cart)
  const discount = voucherDiscount(cart, voucher, dishCatLookup)
  return Math.max(0, +(raw - discount).toFixed(2))
}

/** Total item count across all dates (or for a single date when given) */
export const totalCount = (cart: Record<string, CartItem[]>, dayDate?: string): number => {
  if (dayDate !== undefined) return (cart[dayDate] ?? []).reduce((s, i) => s + i.qty, 0)
  return Object.values(cart).flat().reduce((s, i) => s + i.qty, 0)
}

/**
 * Array of delivery dates (YYYY-MM-DD) that have items, sorted lexically
 * (which matches calendar order for ISO date strings — by design).
 */
export const activeDays = (cart: Record<string, CartItem[]>): string[] =>
  Object.keys(cart)
    .filter((d) => (cart[d] ?? []).length > 0)
    .sort()

// ─── Delivery zones (loaded from Supabase via useMenuStore) ───────────────────

import type { DeliveryZone, TimeSlot } from './api/zones'

/**
 * Postcode-only zone resolution — zone `name_el` / `name_en` are admin
 * organizational labels and never validated against the customer's free-text
 * "area" field. Use this everywhere zone membership matters (checkout
 * validation, time-slot filtering, server-side submit validation).
 */
export const resolveZone = (
  zip: string | undefined,
  zones: DeliveryZone[],
): DeliveryZone | undefined => {
  if (!zip) return undefined
  const clean = zip.trim().replace(/\s/g, '')
  if (!clean) return undefined
  return zones.find((z) => z.postcodes.includes(clean))
}

/** Kept as an alias for legacy callers. */
export const zoneByPostcode = (postcode: string, zones: DeliveryZone[]): DeliveryZone | undefined =>
  resolveZone(postcode, zones)

/** Convenience boolean — postcode is in at least one active zone. */
export const zipInZone = (zip: string | undefined, zones: DeliveryZone[]): boolean =>
  !!resolveZone(zip, zones)

// ─── Time slots (loaded from Supabase via useMenuStore) ───────────────────────

/** Build display strings from DB time slots. Returns unique sorted strings like "9:00–11:00". */
export const formatSlots = (slots: TimeSlot[]): string[] => {
  const unique = new Set(slots.map((s) => `${s.timeFrom}–${s.timeTo}`))
  return [...unique].sort()
}

// ─── Cutoff ───────────────────────────────────────────────────────────────────

import type { AppSettings } from './api/settings'

/** Convert JS Date.getDay() (0=Sun..6=Sat) to ISO weekday (1=Mon..7=Sun). */
const toIsoDow = (jsDay: number): number => (jsDay === 0 ? 7 : jsDay)

/**
 * Compute the cutoff moment for a given delivery date.
 *
 * Resolution order (first match wins):
 *   1. `settings.cutoffDateOverrides[isoDate]` — per-date override (holidays, long weekends)
 *   2. `settings.cutoffWeekdayOverrides[deliveryIsoDow]` — recurring weekday rule
 *      (e.g. Monday deliveries close on Saturday 18:00)
 *   3. default — previous calendar day at `settings.cutoffHour`
 */
export const getCutoffDate = (isoDate: string, settings: AppSettings): Date => {
  // 1. Date-specific override
  const dateOv = settings.cutoffDateOverrides[isoDate]
  if (dateOv) {
    const cutoff = new Date(dateOv.cutoffDate + 'T00:00:00')
    cutoff.setHours(dateOv.hour, 0, 0, 0)
    return cutoff
  }

  const delivery = new Date(isoDate + 'T00:00:00')
  const deliveryIsoDow = toIsoDow(delivery.getDay())

  // 2. Weekday override
  const wdOv = settings.cutoffWeekdayOverrides[deliveryIsoDow]
  if (wdOv) {
    // Walk back to the most recent occurrence of wdOv.dow (ISO) before delivery.
    // diff ∈ [1..7]: how many days before delivery to land on the target weekday.
    let diff = deliveryIsoDow - wdOv.dow
    if (diff <= 0) diff += 7
    const cutoff = new Date(delivery)
    cutoff.setDate(delivery.getDate() - diff)
    cutoff.setHours(wdOv.hour, 0, 0, 0)
    return cutoff
  }

  // 3. Default: previous calendar day at cutoffHour
  const cutoff = new Date(delivery)
  cutoff.setDate(cutoff.getDate() - 1)
  cutoff.setHours(settings.cutoffHour, 0, 0, 0)
  return cutoff
}

/** A day D is orderable when `now < getCutoffDate(D, settings)` */
export const isDayOrderable = (isoDate: string, settings: AppSettings, now: Date = new Date()): boolean =>
  now < getCutoffDate(isoDate, settings)

export interface LandingTarget {
  weekIndex: number
  dayIndex: number
}

/**
 * Find the first (weekIndex, dayIndex) across all weeks where the cutoff is still in the future.
 * Fallback: the last (weekIndex, dayIndex) across all weeks — so user still sees content even
 * when everything is past cutoff.
 *
 * Works on any structure with `{ days: { date: string }[] }[]` — accepts WeekDef or WeekMeta.
 */
export const findLandingDay = (
  weeks: { days: { date: string }[] }[],
  settings: AppSettings,
  now: Date = new Date(),
): LandingTarget => {
  let firstOpen: LandingTarget | null = null
  let last: LandingTarget = { weekIndex: 0, dayIndex: 0 }
  for (let wi = 0; wi < weeks.length; wi++) {
    const days = weeks[wi].days
    for (let di = 0; di < days.length; di++) {
      last = { weekIndex: wi, dayIndex: di }
      if (!firstOpen && now < getCutoffDate(days[di].date, settings)) {
        firstOpen = { weekIndex: wi, dayIndex: di }
      }
    }
  }
  return firstOpen ?? last
}

// ─── Vouchers ─────────────────────────────────────────────────────────────────
// Voucher validation is now server-side via /api/validate-voucher (WEC-91)
