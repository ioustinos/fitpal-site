import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Macros } from '../data/menu'

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface CartItem {
  dishId: string
  variantId: string
  nameEl: string
  nameEn: string
  variantLabelEl: string
  variantLabelEn: string
  price: number          // effective unit price (after dish-level discount + wallet)
  originalPrice?: number // pre-discount price, shown as strikethrough when present
  qty: number
  macros?: Macros
  img?: string           // dish image URL for cart thumbnails
  emoji?: string         // emoji fallback for cart thumbnails
  comment?: string       // dish-level note from customer
}

export interface DeliveryInfo {
  street: string
  area: string
  zip?: string
  floor?: string
  doorbell?: string
  notes?: string
  timeSlot?: string
  addrId?: string  // ID of the selected saved address (if any)
}

export interface PaymentInfo {
  method: 'cash' | 'card' | 'link' | 'transfer' | 'wallet' | ''
  cutlery?: boolean
  invoice?: boolean
  invoiceName?: string
  invoiceVat?: string
  notes?: string
}

export interface VoucherState {
  code: string
  applied: boolean
  type: 'pct' | 'fixed' | ''
  value?: number          // percentage or fixed €
  /** Minimum order amount in euros required for this voucher to apply.
   *  Persisted so we can re-check locally when the cart shrinks — without
   *  this, removing items from a cart that started above the min would
   *  silently keep applying a discount that no longer qualifies. The
   *  server also re-validates at submit time. */
  minOrder?: number
  /**
   * WEC-262: empty array = applies to whole cart. Non-empty = discount
   * only applies to cart items whose dish category is in this list.
   * subTotal() in helpers.ts uses this to compute the right total
   * client-side without an extra server round-trip per cart change.
   */
  applicableCategoryIds?: string[]
}

// ─── Store interface ───────────────────────────────────────────────────────────

/** WEC-259: per-day fulfillment toggle. */
export type FulfillmentType = 'delivery' | 'pickup'

/**
 * WEC-336: cart entries are keyed by **delivery date** (YYYY-MM-DD), not by
 * day-of-week index. The previous indexed shape (0..4 for Mon..Fri) shared
 * `cart[3]` between week-1 Thursday and week-2 Thursday — so a cart built
 * while viewing week 1, then submitted while activeWeek was week 2, would
 * silently re-target items at the wrong dates. Keying by date makes
 * cross-week sharing impossible by construction.
 */
type DateKey = string  // YYYY-MM-DD

interface CartStore {
  cart: Record<DateKey, CartItem[]>
  delivery: Record<DateKey, DeliveryInfo>
  /** WEC-259: per-day fulfillment. Missing key = 'delivery' (default). */
  fulfillment: Record<DateKey, FulfillmentType>
  payment: PaymentInfo
  voucher: VoucherState
  /**
   * WEC-199: epoch ms of the last meaningful cart mutation. Used by
   * reconcileCartAgeAndDates() on hydrate to wipe carts older than 24h.
   * 0 means "never touched" → reconcile treats it the same as fresh.
   */
  lastTouchedAt: number

  addItem: (dayDate: DateKey, item: CartItem) => void
  updateItem: (dayDate: DateKey, itemIndex: number, patch: Partial<CartItem>) => void
  removeItem: (dayDate: DateKey, itemIndex: number) => void
  clearDay: (dayDate: DateKey) => void
  clearAll: () => void

  setDelivery: (dayDate: DateKey, info: Partial<DeliveryInfo>) => void
  copyDeliveryToAll: (srcDate: DateKey) => void
  /** WEC-259: flip a single day between delivery and pickup. */
  setFulfillment: (dayDate: DateKey, type: FulfillmentType) => void

  setPayment: (info: Partial<PaymentInfo>) => void

  applyVoucher: (code: string, cartTotal: number, userId?: string) => Promise<{ ok: boolean; error?: string }>
  removeVoucher: () => void
  voucherLoading: boolean
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const defaultPayment: PaymentInfo = { method: '' }
const defaultVoucher: VoucherState = { code: '', applied: false, type: '' }

export const emptyDelivery = (): DeliveryInfo => ({ street: '', area: '' })

// ─── Store ────────────────────────────────────────────────────────────────────
//
// Persistence (WEC-180):
//
// The cart, per-day delivery info, and payment options survive page refresh,
// browser restart, and same-origin redirects (e.g. Viva return URL after a
// card payment). Without this, a customer who pays via Viva loses their cart
// the moment they're redirected to /order/pending/success — and refreshing
// the menu page mid-build wipes their progress.
//
// What we persist:
//   - cart        — items per date. Validated against the active menu on
//                   hydrate; dishes no longer in the menu (week rolled over,
//                   admin disabled them, etc.) are dropped silently.
//   - delivery    — addresses + time slots per date. Customers expect this.
//   - payment     — method + cutlery/invoice flags. Re-confirmed at checkout.
//   - lastTouchedAt — for the 24h TTL.
//
// What we do NOT persist:
//   - voucher     — re-validate every time. A voucher applied yesterday may
//                   be expired, max-uses-reached, or ineligible for today's
//                   cart total. Customer re-applies if needed.
//   - voucherLoading — transient UI state.
//   - fulfillment — per-session UX toggle, defaults to 'delivery'.
//
// Schema versioning: bump `version` on any breaking change to the persisted
// shape. The migrate() callback returns a clean blank state for old versions
// (we don't try to upgrade — easier to ask the customer to re-add a few
// items than to maintain migrations for cart shape forever).

export const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
  cart: {},
  delivery: {},
  fulfillment: {},
  payment: defaultPayment,
  voucher: defaultVoucher,
  voucherLoading: false,
  lastTouchedAt: 0,

  addItem: (dayDate, newItem) =>
    set((state) => {
      const dayItems = state.cart[dayDate] ?? []
      const existing = dayItems.findIndex(
        (i) => i.dishId === newItem.dishId && i.variantId === newItem.variantId
      )
      const updated =
        existing >= 0
          ? dayItems.map((i, idx) =>
              idx === existing ? { ...i, qty: i.qty + newItem.qty } : i
            )
          : [...dayItems, newItem]
      return { cart: { ...state.cart, [dayDate]: updated }, lastTouchedAt: Date.now() }
    }),

  updateItem: (dayDate, itemIndex, patch) =>
    set((state) => {
      const dayItems = state.cart[dayDate] ?? []
      const updated = dayItems.map((item, i) =>
        i === itemIndex ? { ...item, ...patch } : item
      )
      return { cart: { ...state.cart, [dayDate]: updated }, lastTouchedAt: Date.now() }
    }),

  removeItem: (dayDate, itemIndex) =>
    set((state) => {
      const dayItems = (state.cart[dayDate] ?? []).filter((_, i) => i !== itemIndex)
      return { cart: { ...state.cart, [dayDate]: dayItems }, lastTouchedAt: Date.now() }
    }),

  clearDay: (dayDate) =>
    set((state) => {
      const { [dayDate]: _removed, ...rest } = state.cart
      return { cart: rest, lastTouchedAt: Date.now() }
    }),

  clearAll: () =>
    set({
      cart: {},
      delivery: {},
      payment: defaultPayment,
      voucher: defaultVoucher,
      lastTouchedAt: Date.now(),
    }),

  setDelivery: (dayDate, info) =>
    set((state) => ({
      delivery: {
        ...state.delivery,
        [dayDate]: { ...emptyDelivery(), ...state.delivery[dayDate], ...info },
      },
      lastTouchedAt: Date.now(),
    })),

  copyDeliveryToAll: (srcDate) =>
    set((state) => {
      const src = state.delivery[srcDate]
      if (!src) return state
      const updates: Record<DateKey, DeliveryInfo> = {}
      // Copy to every other date that has items
      Object.keys(state.cart).forEach((d) => {
        if (d !== srcDate && (state.cart[d]?.length ?? 0) > 0) {
          // Preserve the existing time slot for each date
          updates[d] = { ...src, timeSlot: state.delivery[d]?.timeSlot ?? src.timeSlot }
        }
      })
      return { delivery: { ...state.delivery, ...updates }, lastTouchedAt: Date.now() }
    }),

  setPayment: (info) =>
    set((state) => ({ payment: { ...state.payment, ...info }, lastTouchedAt: Date.now() })),

  // WEC-259: per-day fulfillment toggle.
  setFulfillment: (dayDate, type) =>
    set((state) => ({
      fulfillment: { ...state.fulfillment, [dayDate]: type },
      lastTouchedAt: Date.now(),
    })),

  applyVoucher: async (code, cartTotal, userId) => {
    set({ voucherLoading: true })
    try {
      // WEC-262: send the cart's items so the server can compute the
      // eligible-only subtotal for category-scoped vouchers. We dedupe
      // and aggregate per-dish line totals to keep the payload small.
      const cartState = (useCartStore.getState() as { cart: Record<DateKey, CartItem[]> }).cart
      const totalsByDish = new Map<string, number>()
      for (const dayItems of Object.values(cartState)) {
        for (const it of dayItems) {
          totalsByDish.set(it.dishId, (totalsByDish.get(it.dishId) ?? 0) + it.price * it.qty)
        }
      }
      const items = Array.from(totalsByDish.entries()).map(([dishId, lineTotal]) => ({
        dishId,
        lineTotal: +lineTotal.toFixed(2),
      }))

      const res = await fetch('/api/validate-voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase(), cartTotal, userId, items }),
      })
      const json = await res.json()

      if (!json.valid) {
        set({ voucherLoading: false })
        return { ok: false, error: json.error ?? 'Invalid voucher code' }
      }

      set({
        voucher: {
          code: json.code,
          applied: true,
          type: json.type as 'pct' | 'fixed',
          value: json.value,
          minOrder: json.minOrder ?? undefined,
          applicableCategoryIds: Array.isArray(json.applicableCategoryIds) ? json.applicableCategoryIds : [],
        },
        voucherLoading: false,
      })
      return { ok: true }
    } catch {
      set({ voucherLoading: false })
      return { ok: false, error: 'Network error' }
    }
  },

  removeVoucher: () => set({ voucher: defaultVoucher }),
    }),
    {
      name: 'fitpal-cart',
      // WEC-336: bumped from 2 → 3 to re-key cart entries by deliveryDate
      // (YYYY-MM-DD) instead of dayIndex (number). Old v2 carts are wiped
      // on hydrate via migrate() — easier than mapping indices to dates
      // without knowing which week the customer was building for.
      version: 3,
      // Persist cart + delivery + payment + lastTouchedAt. Fulfillment
      // (WEC-259) and voucher are deliberately not persisted.
      partialize: (state) => ({
        cart: state.cart,
        delivery: state.delivery,
        payment: state.payment,
        lastTouchedAt: state.lastTouchedAt,
      }),
      migrate: () => ({
        cart: {},
        delivery: {},
        payment: defaultPayment,
        lastTouchedAt: 0,
      }),
    },
  ),
)

/**
 * Reconcile a hydrated cart against time (WEC-199 + WEC-336).
 *
 * Now that the cart is keyed by date (WEC-336), this is much simpler than
 * before — no weeksMeta dependency, no index→date mapping. Two passes:
 *
 *   1. **24-hour TTL.** If the last meaningful touch was more than 24h ago,
 *      wipe everything (items + delivery + payment + voucher). Re-adding a
 *      few dishes is faster than scrolling through a stale cart trying to
 *      figure out which prices / macros / zone checks are still valid.
 *
 *   2. **Past-day pruning.** Drop any cart entry whose date is < today
 *      (YYYY-MM-DD string compare against local-date `today`).
 *
 * Runs in MenuPage's useEffect on hydrate, BEFORE the menu-reconcile
 * (which prunes items whose dish is no longer on the menu).
 */
const TTL_MS = 24 * 60 * 60 * 1000

function todayIso(): string {
  // Local date — matches how `weeksMeta[*].days[*].date` is stored
  // (YYYY-MM-DD, day-local). UTC date would cause off-by-one near midnight
  // for any customer not on UTC, which is every Greek customer.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function reconcileCartAgeAndDates() {
  const state = useCartStore.getState()
  const cartNonEmpty = Object.keys(state.cart).length > 0
  const deliveryNonEmpty = Object.keys(state.delivery).length > 0

  // Pass 1 — TTL wipe.
  // Skip when nothing has been touched (lastTouchedAt is 0 on fresh hydrate
  // after migrate). Without this we'd wipe a not-yet-touched cart every load.
  if (state.lastTouchedAt > 0 && Date.now() - state.lastTouchedAt > TTL_MS) {
    if (cartNonEmpty || deliveryNonEmpty) {
      useCartStore.setState({
        cart: {},
        delivery: {},
        payment: defaultPayment,
        voucher: defaultVoucher,
        lastTouchedAt: 0,
      })
    }
    return
  }

  // Pass 2 — past-day pruning. Key compares are lexical YYYY-MM-DD strings
  // — that ordering happens to match calendar order, which is the whole
  // point of ISO date format.
  const today = todayIso()
  const nextCart: Record<string, CartItem[]> = {}
  const nextDelivery: Record<string, DeliveryInfo> = {}
  let droppedAny = false

  for (const [dayDate, items] of Object.entries(state.cart)) {
    if (dayDate < today) {
      droppedAny = true
      continue
    }
    nextCart[dayDate] = items
  }
  for (const [dayDate, info] of Object.entries(state.delivery)) {
    if (dayDate < today) {
      droppedAny = true
      continue
    }
    nextDelivery[dayDate] = info
  }

  if (droppedAny) {
    useCartStore.setState({ cart: nextCart, delivery: nextDelivery })
  }
}

/**
 * Reconcile a hydrated cart against the live menu (WEC-180).
 *
 * Called from MenuPage once the active week's menu has loaded. Drops any
 * cart items whose `dishId` no longer appears in the available menu —
 * silently, no toast, because surprise "your cart was modified" alerts
 * are worse than just a smaller cart. Customer notices and re-adds.
 *
 * Also drops days that end up empty after pruning, so the cart sidebar
 * doesn't render orphan day headers.
 */
export function reconcileCartAgainstMenu(availableDishIds: Set<string>) {
  const state = useCartStore.getState()
  const next: Record<string, CartItem[]> = {}
  let droppedAny = false
  for (const [dayDate, items] of Object.entries(state.cart)) {
    if (!Array.isArray(items)) continue
    const kept = items.filter((it) => availableDishIds.has(it.dishId))
    if (kept.length !== items.length) droppedAny = true
    if (kept.length > 0) next[dayDate] = kept
  }
  if (droppedAny) {
    useCartStore.setState({ cart: next })
  }
}
