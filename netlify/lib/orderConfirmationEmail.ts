// WEC-498: fire the customer "Order Placed" confirmation email FROM THE DB.
//
// Background: submit-order.ts fires the Klaviyo "Order Placed" event (which
// drives the customer order-confirmation email) at submit time for every
// payment method. For card / link that's WRONG — the order is still `pending`
// at submit and the customer is about to be redirected to Viva. A customer who
// abandons payment would receive a "your order is confirmed ✓" email for an
// order they never paid (and which auto-cancels after 48h).
//
// Fix: for card / link, submit-order SKIPS the email; instead this helper is
// invoked from `markPaid()` — the single idempotent convergence point for all
// three Viva confirmation layers (return-URL verify, webhook, reconcile). Since
// markPaid only runs its body on the call that wins the pending→paid race, the
// email fires exactly once, at the moment payment actually succeeds.
//
// cash / transfer / wallet keep emailing at submit (they are legitimately
// "placed" at submission — cash/transfer are pay-later, wallet is paid sync).
//
// Faithfulness: this rebuilds the SAME payload shape submit-order sends, but
// from the persisted snapshot (orders + child_orders + order_items + settings).
// order_items stores prices in CENTS and macros PER-UNIT (see submit-order.ts
// insert: calories = variant.calories, total_price = unit_price * quantity), so
// per-line macros are macro × quantity here, exactly mirroring klaviyoDays.
//
// The only field not persisted is `lang` (it comes from the UI toggle at
// submit). We source it from the customer's user_prefs.lang, falling back to
// 'el' (Greece-first) — including for guest card orders with no user_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { track, subscribeProfileToMarketing, EVT } from './klaviyo'

function dayLabelFor(iso: string): { el: string; en: string } {
  const d = new Date(iso + 'T12:00:00Z')
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  const elDow = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'][dow]
  const enDow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow]
  const dd = d.getUTCDate().toString().padStart(2, '0')
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  return { el: `${elDow} ${dd}/${mm}`, en: `${enDow} ${dd}/${mm}` }
}

function fmtTime(t: string | null): string {
  return typeof t === 'string' ? t.slice(0, 5) : ''
}

interface OrderRow {
  id: string
  order_number: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  user_id: string | null
  subtotal: number | null
  discount_amount: number | null
  total: number | null
  payment_method: string | null
  payment_status: string | null
  admin_order_id: string | null
  invoice_type: string | null   // WEC-698
  invoice_name: string | null
  invoice_vat: string | null
}
interface ChildRow {
  id: string
  delivery_date: string
  time_from: string | null
  time_to: string | null
  address_street: string | null
  address_area: string | null
  address_zip: string | null
}
interface ItemRow {
  child_order_id: string
  dish_id: string | null
  variant_id: string | null
  name_el: string | null
  name_en: string | null
  variant_label_el: string | null
  variant_label_en: string | null
  quantity: number | null
  unit_price: number | null
  total_price: number | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  comment: string | null
}

export interface OrderEventOpts {
  /**
   * WEC-580 — which fire this is:
   *   'order_placed'            — fired at SUBMIT (cash / transfer / wallet).
   *                               No card/link guard; uses the order's real
   *                               payment_status.
   *   'order_paid_confirmation' — fired POST-PAYMENT from markPaid (card / link).
   *                               DEFAULT; preserves the WEC-498 guard + 'paid'.
   */
  kind?: 'order_placed' | 'order_paid_confirmation'
  /** UI language at submit; falls back to user_prefs.lang, then 'el'. */
  lang?: 'el' | 'en'
}

/**
 * Rebuild and fire the "Order Placed" confirmation (customer + admin BCC) for
 * an order, reading the entire payload from the DB (never a trusted request
 * body). Fail-soft: never throws, logs and returns on any problem so it can
 * never break the payment-confirmation or submit path.
 *
 * WEC-580: this is the single source for order-event firing. Both callers route
 * through here — submit-order's order-events-background invoke (kind
 * 'order_placed') and markPaid (kind 'order_paid_confirmation', the default).
 */
export async function fireOrderConfirmationFromDb(
  supabase: SupabaseClient,
  orderId: string,
  opts: OrderEventOpts = {},
): Promise<void> {
  const kind = opts.kind ?? 'order_paid_confirmation'
  try {
    const { data: orderRaw, error: oErr } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_email, customer_phone, user_id, subtotal, discount_amount, total, payment_method, payment_status, admin_order_id, invoice_type, invoice_name, invoice_vat')
      .eq('id', orderId)
      .maybeSingle()
    if (oErr || !orderRaw) {
      console.warn('[orderConfirmation] order not found for %s:', orderId, oErr)
      return
    }
    const order = orderRaw as OrderRow
    if (!order.customer_email) {
      console.warn('[orderConfirmation] no customer_email on %s, skipping', orderId)
      return
    }
    const customerEmail = order.customer_email
    // WEC-498 safety: the POST-PAYMENT kind exists to send the confirmation for
    // card / link orders at payment time. cash / transfer / wallet already
    // emailed at submit, so if one of those ever reaches markPaid we must NOT
    // email again. The SUBMIT kind ('order_placed') has no such guard.
    if (kind === 'order_paid_confirmation'
      && order.payment_method !== 'card' && order.payment_method !== 'link') {
      return
    }

    const { data: childRaw } = await supabase
      .from('child_orders')
      .select('id, delivery_date, time_from, time_to, address_street, address_area, address_zip')
      .eq('order_id', orderId)
      .order('delivery_date', { ascending: true })
    const childs = (childRaw ?? []) as ChildRow[]

    const childIds = childs.map((c) => c.id)
    const { data: itemRaw } = childIds.length
      ? await supabase
          .from('order_items')
          .select('child_order_id, dish_id, variant_id, name_el, name_en, variant_label_el, variant_label_en, quantity, unit_price, total_price, calories, protein, carbs, fat, comment')
          .in('child_order_id', childIds)
      : { data: [] as ItemRow[] }
    const items = (itemRaw ?? []) as ItemRow[]

    // Settings: bank IBANs + admin BCC list (same keys submit-order reads).
    const { data: settingsRaw } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['bank_transfer_info', 'order_confirmation_admin_emails'])
    const settingsRows = (settingsRaw ?? []) as { key: string; value: unknown }[]

    // lang: explicit opt (UI toggle at submit) wins; else customer preference;
    // else Greece-first default. (Not persisted on the order — see file header.)
    let lang: 'el' | 'en' = 'el'
    if (opts.lang === 'en' || opts.lang === 'el') {
      lang = opts.lang
    } else if (order.user_id) {
      const { data: prefs } = await supabase
        .from('user_prefs')
        .select('lang')
        .eq('user_id', order.user_id)
        .maybeSingle()
      const pl = (prefs as { lang?: string } | null)?.lang
      if (pl === 'en' || pl === 'el') lang = pl
    }

    // ── Build klaviyoDays (faithful to submit-order's shape) ────────────────
    const klaviyoDays = childs.map((c) => {
      const dayItems = items.filter((i) => i.child_order_id === c.id)
      const enrichedItems = dayItems.map((it) => {
        const qty = it.quantity ?? 0
        const unitPriceCents = it.unit_price ?? 0
        const lineTotalCents = it.total_price ?? unitPriceCents * qty
        // order_items macros are PER-UNIT; per-line = macro × qty (mirrors
        // submit-order's `(variant.calories ?? 0) * it.quantity`).
        const cal = (it.calories ?? 0) * qty
        const protein = (it.protein ?? 0) * qty
        const carbs = (it.carbs ?? 0) * qty
        const fat = (it.fat ?? 0) * qty
        return {
          // ── snake_case (template expects these) ──
          name_el: it.name_el ?? '',
          name_en: it.name_en ?? '',
          variant_label_el: it.variant_label_el ?? '',
          variant_label_en: it.variant_label_en ?? '',
          qty,
          unit_price: unitPriceCents / 100,
          total_price: lineTotalCents / 100,
          // ── camelCase (legacy / downstream compat) ──
          dishId: it.dish_id,
          variantId: it.variant_id,
          nameEl: it.name_el ?? '',
          nameEn: it.name_en ?? '',
          variantLabelEl: it.variant_label_el ?? null,
          variantLabelEn: it.variant_label_en ?? null,
          quantity: qty,
          unitPrice: unitPriceCents / 100,
          lineTotal: lineTotalCents / 100,
          calories: cal,
          protein,
          carbs,
          fat,
          unitMacros: {
            calories: it.calories ?? 0,
            protein: it.protein ?? 0,
            carbs: it.carbs ?? 0,
            fat: it.fat ?? 0,
          },
          comment: it.comment ?? '',
        }
      })

      const daySubtotalCents = enrichedItems.reduce((s, i) => s + Math.round(i.total_price * 100), 0)
      const dayCalories = enrichedItems.reduce((s, i) => s + i.calories, 0)
      const dayProtein = enrichedItems.reduce((s, i) => s + i.protein, 0)
      const dayCarbs = enrichedItems.reduce((s, i) => s + i.carbs, 0)
      const dayFat = enrichedItems.reduce((s, i) => s + i.fat, 0)
      const dayItemCount = enrichedItems.reduce((s, i) => s + i.qty, 0)
      const labels = dayLabelFor(c.delivery_date)
      const timeWindow = c.time_from && c.time_to
        ? `${fmtTime(c.time_from)}–${fmtTime(c.time_to)}`
        : ''
      const addressLine = [c.address_street, c.address_zip, c.address_area].filter(Boolean).join(', ')

      return {
        date: c.delivery_date,
        day_label_el: labels.el,
        day_label_en: labels.en,
        time_window: timeWindow,
        address: addressLine,
        day_total: daySubtotalCents / 100,
        day_macros: { calories: dayCalories, protein: dayProtein, carbs: dayCarbs, fat: dayFat },
        deliveryDate: c.delivery_date,
        timeFrom: c.time_from,
        timeTo: c.time_to,
        addressStreet: c.address_street,
        addressArea: c.address_area,
        addressZip: c.address_zip ?? null,
        items: enrichedItems,
        subtotal: daySubtotalCents / 100,
        itemCount: dayItemCount,
        macros: { calories: dayCalories, protein: dayProtein, carbs: dayCarbs, fat: dayFat },
      }
    })

    // Bank IBANs — accepts legacy single object or array (mirrors submit-order).
    const rawBankInfos = settingsRows.find((r) => r.key === 'bank_transfer_info')?.value
    const bankList = Array.isArray(rawBankInfos)
      ? (rawBankInfos as unknown[])
      : (rawBankInfos && typeof rawBankInfos === 'object' ? [rawBankInfos] : [])
    const bankTransferInfos = bankList
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((o) => {
        const name = typeof o.bankName === 'string' ? o.bankName : null
        return {
          iban: typeof o.iban === 'string' ? o.iban : '',
          beneficiary: typeof o.beneficiary === 'string' ? o.beneficiary : '',
          bank_name: name,
          bankName: name,
        }
      })
      .filter((e) => e.iban.length > 0)

    const totalItems = klaviyoDays.reduce((s, d) => s + d.itemCount, 0)
    const allDaysMacros = klaviyoDays.reduce(
      (acc, d) => ({
        calories: acc.calories + d.day_macros.calories,
        protein: acc.protein + d.day_macros.protein,
        carbs: acc.carbs + d.day_macros.carbs,
        fat: acc.fat + d.day_macros.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    )

    const firstName = (order.customer_name ?? '').split(' ')[0] ?? ''
    const placedByAdmin = !!order.admin_order_id
    // WEC-580: post-payment kind is always 'paid' (markPaid won the race);
    // submit kind reflects the order's true status (wallet=paid, cash/transfer=pending).
    const paymentStatus = kind === 'order_paid_confirmation' ? 'paid' : (order.payment_status ?? 'pending')
    const orderPlacedProperties = {
      lang,
      // ── snake_case (template-expected) ──
      first_name: firstName,
      // WEC-690: carry the customer's identity so «Στοιχεία χρέωσης» renders the
      // CUSTOMER, not the recipient. Without this the template falls back to
      // {{ person.email }} — correct on the customer's own copy, but on an admin
      // BCC copy it tells the admin THEY placed the order.
      customer_email: order.customer_email ?? null,
      customer_name:  order.customer_name ?? null,
      customer_phone: order.customer_phone ?? null,
      order_number: order.order_number,
      total: (order.total ?? 0) / 100,
      subtotal: (order.subtotal ?? 0) / 100,
      discount_amount: (order.discount_amount ?? 0) / 100,
      payment_method: order.payment_method,
      payment_status: paymentStatus,
      // WEC-698: invoice details so the email confirms the recorded Τιμολόγιο.
      invoice_type: order.invoice_type ?? null,
      invoice_name: order.invoice_name ?? null,
      invoice_vat: order.invoice_vat ?? null,
      placed_by_admin: placedByAdmin,
      admin_user_id: order.admin_order_id ?? null,
      day_count: klaviyoDays.length,
      item_count: totalItems,
      total_macros: allDaysMacros,
      isUpdate: false,
      // ── camelCase (legacy / downstream compat) ──
      orderId: order.id,
      orderNumber: order.order_number,
      discountAmount: (order.discount_amount ?? 0) / 100,
      paymentMethod: order.payment_method,
      placedByAdmin,
      adminUserId: order.admin_order_id ?? null,
      dayCount: klaviyoDays.length,
      itemCount: totalItems,
      totalMacros: allDaysMacros,
      paymentStatus,
      bank_transfer_infos: bankTransferInfos,
      bank_transfer_info: bankTransferInfos[0] ?? null,
      days: klaviyoDays,
    }

    // WEC-580: each external call is retried (3 attempts, 1s/4s/10s backoff)
    // because we now run detached in a background function — a transient
    // Klaviyo blip should not silently lose the event. Idempotency keys
    // (`<orderId>:<kind>:<email>`) make the retries safe: Klaviyo dedupes on
    // unique_id, and subscribe is inherently idempotent.
    const subSource = kind === 'order_placed'
      ? 'Fitpal order placed (auto-subscribe)'
      : 'Fitpal order paid (auto-subscribe)'
    const evtKey = `${orderId}:${kind}`

    type Fire = { label: string; run: () => Promise<{ ok: boolean; error?: string }> }
    const fires: Fire[] = []

    // Customer: subscribe (consent) then the event.
    fires.push({ label: `subscribe:${customerEmail}`, run: () => subscribeProfileToMarketing(customerEmail, subSource) })
    fires.push({ label: `track:${customerEmail}`, run: () => track(EVT.OrderPlaced, {
      email: customerEmail,
      firstName,
      lastName: (order.customer_name ?? '').split(' ').slice(1).join(' '),
      phone: order.customer_phone ?? undefined,
      externalId: order.user_id ?? undefined,
    }, orderPlacedProperties, `${evtKey}:${customerEmail}`) })

    // Admin BCC fan-out (WEC-486 parity).
    const rawAdmins = settingsRows.find((r) => r.key === 'order_confirmation_admin_emails')?.value
    const adminEmails = Array.isArray(rawAdmins)
      ? (rawAdmins as unknown[])
          .filter((v): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
          .map((v) => v.trim())
      : []
    const customerLower = customerEmail.toLowerCase()
    for (const adminEmail of adminEmails) {
      if (adminEmail.toLowerCase() === customerLower) continue
      fires.push({ label: `subscribe:${adminEmail}`, run: () => subscribeProfileToMarketing(adminEmail, 'Fitpal admin BCC (auto-subscribe)') })
      fires.push({ label: `track:${adminEmail}`, run: () => track(EVT.OrderPlaced, {
        email: adminEmail,
        firstName: 'Fitpal',
        lastName: 'Admin notification',
      }, { ...orderPlacedProperties, isAdminCopy: true }, `${evtKey}:${adminEmail}`) })
    }

    const results = await Promise.all(
      fires.map(async (f) => ({ label: f.label, res: await withRetry(f.run) })),
    )
    for (const r of results) {
      if (!r.res.ok) {
        // Loud, greppable — the alerting hook for later.
        console.error('[order-events] GAVE UP kind=%s order=%s %s: %s',
          kind, order.order_number ?? orderId, r.label, r.res.error)
      }
    }
  } catch (e) {
    console.error('[orderConfirmation] unexpected error for orderId=%s (non-fatal):', orderId, e)
  }
}

/**
 * WEC-580: retry a fail-soft Klaviyo call (returns { ok } rather than throwing)
 * up to `attempts` times with exponential backoff. Returns the last result.
 */
async function withRetry(
  run: () => Promise<{ ok: boolean; error?: string }>,
  attempts = 3,
  delaysMs = [1000, 4000, 10000],
): Promise<{ ok: boolean; error?: string }> {
  let last: { ok: boolean; error?: string } = { ok: false, error: 'not run' }
  for (let i = 0; i < attempts; i++) {
    last = await run()
    if (last.ok) return last
    // Don't burn the backoff when the key isn't configured — it will never succeed.
    if (last.error === 'KLAVIYO_API_KEY not set') return last
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delaysMs[i] ?? 1000))
  }
  return last
}
