import type { CartItem, VoucherState } from '../store/useCartStore'

// ─── Formatting ───────────────────────────────────────────────────────────────

export const fmt = (n: number) => '€' + n.toFixed(2)

// ─── Pricing ──────────────────────────────────────────────────────────────────

/** Apply a percentage discount to a price */
export const effPrice = (price: number, discountPct?: number): number =>
  discountPct ? +(price * (1 - discountPct / 100)).toFixed(2) : price

// ─── Cart totals ──────────────────────────────────────────────────────────────

/** Sum of items for a single day */
export const dayAmt = (cart: Record<number, CartItem[]>, dayIndex: number): number =>
  (cart[dayIndex] ?? []).reduce((s, i) => s + i.price * i.qty, 0)

/** Raw cart total before any voucher discount. */
export const rawSubTotal = (cart: Record<number, CartItem[]>): number =>
  Object.values(cart).reduce(
    (s, items) => s + items.reduce((ss, i) => ss + i.price * i.qty, 0),
    0,
  )

/**
 * True when a voucher is "applied" client-side but its min_order isn't met
 * by the current raw cart. In this state the voucher chip stays visible
 * (so the user can see what they applied) but the discount is NOT applied
 * to the displayed total.
 *
 * Without this gate, removing an item after applying a voucher would keep
 * showing a discounted total — and the server would then reject the order
 * at submit time with a `Minimum order not met` error, which is a confusing
 * mid-checkout surprise. Gating in subTotal keeps the displayed total
 * honest as the cart changes.
 */
export const voucherInactive = (
  cart: Record<number, CartItem[]>,
  voucher?: VoucherState,
): boolean => {
  if (!voucher?.applied || !voucher.value) return false
  if (voucher.minOrder == null) return false
  return rawSubTotal(cart) < voucher.minOrder
}

/** Grand total across all days, with voucher applied (when valid). */
export const subTotal = (
  cart: Record<number, CartItem[]>,
  voucher?: VoucherState,
): number => {
  const raw = rawSubTotal(cart)
  if (!voucher?.applied || !voucher.value) return raw
  // Min-order gate — without this, removing items can keep a discount
  // applied that no longer qualifies. Server-side submit-order also
  // re-validates so this gate is purely a UI honesty fix.
  if (voucher.minOrder != null && raw < voucher.minOrder) return raw
  if (voucher.type === 'pct')   return Math.max(0, +(raw * (1 - voucher.value / 100)).toFixed(2))
  if (voucher.type === 'fixed') return Math.max(0, +(raw - voucher.value).toFixed(2))
  return raw
}

/** Total item count across all days */
export const totalCount = (cart: Record<number, CartItem[]>, dayIndex?: number): number => {
  if (dayIndex !== undefined) return (cart[dayIndex] ?? []).reduce((s, i) => s + i.qty, 0)
  return Object.values(cart).flat().reduce((s, i) => s + i.qty, 0)
}

/** Array of day indices that have items */
export const activeDays = (cart: Record<number, CartItem[]>): number[] =>
  Object.keys(cart)
    .filter((d) => (cart[+d] ?? []).length > 0)
    .map(Number)
    .sort((a, b) => a - b)

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

// ─── Delivery validation ──────────────────────────────────────────────────────

/** @deprecated — use settings.minOrder from useMenuStore instead */
export const MIN_ORDER = 15

/** Postcode-based delivery availability + min-order check. */
export const delivOk = (
  zip: string | undefined,
  amount: number,
  zones: DeliveryZone[],
  minOrder = MIN_ORDER,
): boolean => zipInZone(zip, zones) && amount >= minOrder

// ─── Time slots (loaded from Supabase via useMenuStore) ───────────────────────

/** Build display strings from DB time slots. Returns unique sorted strings like "9:00–11:00". */
export const formatSlots = (slots: TimeSlot[]): string[] => {
  const unique = new Set(slots.map((s) => `${s.timeFrom}–${s.timeTo}`))
  return [...unique].sort()
}

// ─── Cutoff ───────────────────────────────────────────────────────────────────

/** @deprecated — use settings.cutoffHour from useMenuStore instead */
export const CUTOFF_HOUR = 18

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
