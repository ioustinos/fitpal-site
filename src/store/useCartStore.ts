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
}

// ─── Store interface ───────────────────────────────────────────────────────────

interface CartStore {
  cart: Record<number, CartItem[]>     // keyed by day index
  delivery: Record<number, DeliveryInfo>
  payment: PaymentInfo
  voucher: VoucherState

  addItem: (dayIndex: number, item: CartItem) => void
  updateItem: (dayIndex: number, itemIndex: number, patch: Partial<CartItem>) => void
  removeItem: (dayIndex: number, itemIndex: number) => void
  clearDay: (dayIndex: number) => void
  clearAll: () => void

  setDelivery: (dayIndex: number, info: Partial<DeliveryInfo>) => void
  copyDeliveryToAll: (srcDay: number) => void

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
//   - cart        — items per day. Validated against the active menu on
//                   hydrate; dishes no longer in the menu (week rolled over,
//                   admin disabled them, etc.) are dropped silently.
//   - delivery    — addresses + time slots per day. Customers expect this.
//   - payment     — method + cutlery/invoice flags. Re-confirmed at checkout.
//
// What we do NOT persist:
//   - voucher     — re-validate every time. A voucher applied yesterday may
//                   be expired, max-uses-reached, or ineligible for today's
//                   cart total. Customer re-applies if needed.
//   - voucherLoading — transient UI state.
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
  payment: defaultPayment,
  voucher: defaultVoucher,
  voucherLoading: false,

  addItem: (dayIndex, newItem) =>
    set((state) => {
      const dayItems = state.cart[dayIndex] ?? []
      const existing = dayItems.findIndex(
        (i) => i.dishId === newItem.dishId && i.variantId === newItem.variantId
      )
      const updated =
        existing >= 0
          ? dayItems.map((i, idx) =>
              idx === existing ? { ...i, qty: i.qty + newItem.qty } : i
            )
          : [...dayItems, newItem]
      return { cart: { ...state.cart, [dayIndex]: updated } }
    }),

  updateItem: (dayIndex, itemIndex, patch) =>
    set((state) => {
      const dayItems = state.cart[dayIndex] ?? []
      const updated = dayItems.map((item, i) =>
        i === itemIndex ? { ...item, ...patch } : item
      )
      return { cart: { ...state.cart, [dayIndex]: updated } }
    }),

  removeItem: (dayIndex, itemIndex) =>
    set((state) => {
      const dayItems = (state.cart[dayIndex] ?? []).filter((_, i) => i !== itemIndex)
      return { cart: { ...state.cart, [dayIndex]: dayItems } }
    }),

  clearDay: (dayIndex) =>
    set((state) => {
      const { [dayIndex]: _removed, ...rest } = state.cart
      return { cart: rest }
    }),

  clearAll: () =>
    set({ cart: {}, delivery: {}, payment: defaultPayment, voucher: defaultVoucher }),

  setDelivery: (dayIndex, info) =>
    set((state) => ({
      delivery: {
        ...state.delivery,
        [dayIndex]: { ...emptyDelivery(), ...state.delivery[dayIndex], ...info },
      },
    })),

  copyDeliveryToAll: (srcDay) =>
    set((state) => {
      const src = state.delivery[srcDay]
      if (!src) return state
      const updates: Record<number, DeliveryInfo> = {}
      Object.keys(state.cart).forEach((d) => {
        const idx = Number(d)
        if (idx !== srcDay && (state.cart[idx]?.length ?? 0) > 0) {
          // Preserve the existing time slot for each day
          updates[idx] = { ...src, timeSlot: state.delivery[idx]?.timeSlot ?? src.timeSlot }
        }
      })
      return { delivery: { ...state.delivery, ...updates } }
    }),

  setPayment: (info) =>
    set((state) => ({ payment: { ...state.payment, ...info } })),

  applyVoucher: async (code, cartTotal, userId) => {
    set({ voucherLoading: true })
    try {
      const res = await fetch('/api/validate-voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase(), cartTotal, userId }),
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
      version: 1,
      // Persist cart + delivery + payment. Everything else is either
      // transient UI state or must re-validate on demand.
      partialize: (state) => ({
        cart: state.cart,
        delivery: state.delivery,
        payment: state.payment,
      }),
      // Discard old/incompatible persisted shapes — easier than migrating
      // a cart's worth of arbitrary item shape changes.
      migrate: () => ({
        cart: {},
        delivery: {},
        payment: defaultPayment,
      }),
    },
  ),
)

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
  const next: Record<number, CartItem[]> = {}
  let droppedAny = false
  for (const [dayKey, items] of Object.entries(state.cart)) {
    const dayIdx = Number(dayKey)
    if (!Array.isArray(items)) continue
    const kept = items.filter((it) => availableDishIds.has(it.dishId))
    if (kept.length !== items.length) droppedAny = true
    if (kept.length > 0) next[dayIdx] = kept
  }
  if (droppedAny) {
    useCartStore.setState({ cart: next })
  }
}
