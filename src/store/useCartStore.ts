import { create } from 'zustand'
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

export const useCartStore = create<CartStore>((set) => ({
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
}))
