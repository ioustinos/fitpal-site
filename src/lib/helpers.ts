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

/** Grand total across all days, with voucher applied */
export const subTotal = (
  cart: Record<number, CartItem[]>,
  voucher?: VoucherState,
): number => {
  const raw = Object.values(cart).reduce(
    (s, items) => s + items.reduce((ss, i) => ss + i.price * i.qty, 0),
    0,
  )
  if (!voucher?.applied || !voucher.value) return raw
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

// ─── Delivery zones ───────────────────────────────────────────────────────────

export const ZONES = [
  { name: 'Αθήνα' },
  { name: 'Γλυφάδα' },
  { name: 'Μαρούσι' },
  { name: 'Χαλάνδρι' },
  { name: 'Κηφισιά' },
  { name: 'Ψυχικό' },
  { name: 'Φιλοθέη' },
  { name: 'Βύρωνας' },
  { name: 'Ζωγράφου' },
  { name: 'Παγκράτι' },
  { name: 'Κολωνάκι' },
  { name: 'Εξάρχεια' },
  { name: 'Κουκάκι' },
  { name: 'Καλλιθέα' },
  { name: 'Νέα Σμύρνη' },
  { name: 'Άλιμος' },
  { name: 'Πειραιάς' },
  { name: 'Περιστέρι' },
  { name: 'Ηλιούπολη' },
  { name: 'Δάφνη' },
  { name: 'Αιγάλεω' },
]

const ZONE_KEYWORDS = ZONES.map((z) => z.name.toLowerCase())

export const zoneOk = (area: string): boolean => {
  const lower = area.toLowerCase()
  return lower.length > 1 && ZONE_KEYWORDS.some((z) => lower.includes(z))
}

// ─── Delivery validation ──────────────────────────────────────────────────────

export const MIN_ORDER = 15

export const delivOk = (area: string, amount: number): boolean =>
  zoneOk(area) && amount >= MIN_ORDER

// ─── Time slots ───────────────────────────────────────────────────────────────

export const SLOTS = [
  '9:00–11:00',
  '10:00–12:00',
  '11:00–13:00',
  '12:00–14:00',
  '13:00–15:00',
]

// ─── Cutoff ───────────────────────────────────────────────────────────────────

/** Orders for a given delivery date close at CUTOFF_HOUR on the previous calendar day */
export const CUTOFF_HOUR = 18

export const getCutoffDate = (isoDate: string): Date => {
  const delivery = new Date(isoDate + 'T00:00:00')
  const cutoff = new Date(delivery)
  cutoff.setDate(cutoff.getDate() - 1)
  cutoff.setHours(CUTOFF_HOUR, 0, 0, 0)
  return cutoff
}

// ─── Vouchers ─────────────────────────────────────────────────────────────────

export const VOUCHERS: Record<string, { type: 'pct' | 'fixed'; value: number }> = {
  FITPAL10: { type: 'pct',   value: 10 },
  FITPAL20: { type: 'pct',   value: 20 },
  WELCOME5: { type: 'fixed', value: 5  },
  HEALTHY8: { type: 'fixed', value: 8  },
}
