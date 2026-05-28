// WEC-417: client helper for /api/save-draft. Reads the current checkout
// snapshot (cart, delivery, fulfillment, payment, voucher) from the Zustand
// stores and POSTs it to the server. The first call creates the draft; the
// returned `draft_id` is parked in useCartStore and reused on every subsequent
// save (debounced trigger B + synchronous trigger C). Cleared on successful
// order placement.

import { supabase } from '../supabase'
import { useCartStore } from '../../store/useCartStore'
import { useAuthStore } from '../../store/useAuthStore'

export interface SaveDraftArgs {
  /** Customer contact captured by CheckoutPage's <ContactSection /> (local state, not in a store). */
  contact: { name: string; email: string; phone: string }
}

export interface SaveDraftResult {
  draftId: string
  updatedAt: string
}

/** Build the save-draft body from the current Zustand snapshot + contact. */
function buildBody(args: SaveDraftArgs, userId: string | null) {
  const c = useCartStore.getState()
  const cartByDay = Object.entries(c.cart)
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .map(([delivery_date, items]) => ({
      delivery_date,
      items: items.map((it) => ({
        dish_id: it.dishId,
        variant_id: it.variantId ?? null,
        quantity: it.qty,
        comment: it.comment ?? undefined,
      })),
    }))

  const addressesByDay = Object.entries(c.delivery).map(([delivery_date, d]) => ({
    delivery_date,
    street: d.street || undefined,
    area: d.area || undefined,
    zip: d.zip || undefined,
    floor: d.floor || undefined,
    fulfillment_type: c.fulfillment[delivery_date] ?? 'delivery',
    pickup_location_id: d.pickupLocationId ?? null,
  }))

  const timeSlotsByDay = Object.entries(c.delivery)
    .filter(([, d]) => !!d.timeSlot)
    .map(([delivery_date, d]) => {
      const [from, to] = (d.timeSlot ?? '').split(/[–-]/).map((s) => s.trim())
      return { delivery_date, from, to }
    })

  return {
    draft_id: c.draftId ?? undefined,
    user_id: userId,
    customer: args.contact,
    cart_by_day: cartByDay,
    addresses_by_day: addressesByDay,
    time_slots_by_day: timeSlotsByDay,
    payment_method: c.payment.method || undefined,
    voucher_code: c.voucher.applied ? c.voucher.code : null,
    cutlery: c.payment.cutlery ?? false,
    invoice: c.payment.invoice
      ? { type: 'invoice' as const, name: c.payment.invoiceName, vat: c.payment.invoiceVat }
      : undefined,
    notes: c.payment.notes ?? undefined,
  }
}

/**
 * Save (or update) the current checkout as a draft on the server. Fail-soft —
 * a transient draft failure NEVER blocks the customer; the caller decides
 * whether to surface the error (trigger C may want to log it; A/B do not).
 *
 * Returns `null` on failure, never throws.
 */
export async function saveDraft(args: SaveDraftArgs): Promise<SaveDraftResult | null> {
  try {
    const { data: session } = await supabase.auth.getSession()
    const token = session?.session?.access_token ?? null
    const userId = useAuthStore.getState().user?.id ?? null

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch('/api/save-draft', {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(args, userId)),
      // Trigger C uses await, so we want this to complete reliably even when
      // the page is mid-transition (e.g. submit clicked).
      keepalive: true,
    })
    if (!res.ok) {
      // 409 = draft already promoted (race) — caller should drop its draft id.
      if (res.status === 409) {
        useCartStore.getState().clearDraft()
      }
      console.warn('[saveDraft] non-OK', res.status)
      return null
    }
    const json = (await res.json()) as { draft_id: string; updated_at: string }
    useCartStore.getState().setDraftId(json.draft_id)
    useCartStore.getState().setDraftLastSavedAt(Date.now())
    return { draftId: json.draft_id, updatedAt: json.updated_at }
  } catch (e) {
    console.warn('[saveDraft] network/parse error:', e)
    return null
  }
}
