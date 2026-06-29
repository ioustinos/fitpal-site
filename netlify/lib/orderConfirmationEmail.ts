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
  admin_order_id: string | null
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

/**
 * Rebuild and fire the "Order Placed" confirmation (customer + admin BCC) for
 * an order that has just been confirmed paid. Fail-soft: never throws, logs and
 * returns on any problem so it can never break the payment-confirmation path.
 */
export async function fireOrderConfirmationFromDb(
  supabase: SupabaseClient,
  orderId: string,
): Promise<void> {
  try {
    const { data: orderRaw, error: oErr } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_email, customer_phone, user_id, subtotal, discount_amount, total, payment_method, admin_order_id')
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
    // WEC-498 safety: this helper exists to send the confirmation for card /
    // link orders at payment time. cash / transfer / wallet already emailed at
    // submit, so if one of those ever reaches markPaid we must NOT email again.
    if (order.payment_method !== 'card' && order.payment_method !== 'link') {
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

    // lang: customer preference, else Greece-first default. (Not persisted on
    // the order — see file header.)
    let lang: 'el' | 'en' = 'el'
    if (order.user_id) {
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
    const orderPlacedProperties = {
      lang,
      // ── snake_case (template-expected) ──
      first_name: firstName,
      order_number: order.order_number,
      total: (order.total ?? 0) / 100,
      subtotal: (order.subtotal ?? 0) / 100,
      discount_amount: (order.discount_amount ?? 0) / 100,
      payment_method: order.payment_method,
      payment_status: 'paid', // WEC-498: this fires only after markPaid won
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
      paymentStatus: 'paid',
      placedByAdmin,
      adminUserId: order.admin_order_id ?? null,
      dayCount: klaviyoDays.length,
      itemCount: totalItems,
      totalMacros: allDaysMacros,
      bank_transfer_infos: bankTransferInfos,
      bank_transfer_info: bankTransferInfos[0] ?? null,
      days: klaviyoDays,
    }

    const fires: Promise<{ ok: boolean; error?: string }>[] = []

    // Customer: subscribe (consent) then the event, same order as submit-order.
    fires.push(subscribeProfileToMarketing(order.customer_email, 'Fitpal order paid (auto-subscribe)'))
    fires.push(track(EVT.OrderPlaced, {
      email: order.customer_email,
      firstName,
      lastName: (order.customer_name ?? '').split(' ').slice(1).join(' '),
      phone: order.customer_phone ?? undefined,
      externalId: order.user_id ?? undefined,
    }, orderPlacedProperties))

    // Admin BCC fan-out (WEC-486 parity).
    const rawAdmins = settingsRows.find((r) => r.key === 'order_confirmation_admin_emails')?.value
    const adminEmails = Array.isArray(rawAdmins)
      ? (rawAdmins as unknown[])
          .filter((v): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
          .map((v) => v.trim())
      : []
    const customerLower = order.customer_email.toLowerCase()
    for (const adminEmail of adminEmails) {
      if (adminEmail.toLowerCase() === customerLower) continue
      fires.push(subscribeProfileToMarketing(adminEmail, 'Fitpal admin BCC (auto-subscribe)'))
      fires.push(track(EVT.OrderPlaced, {
        email: adminEmail,
        firstName: 'Fitpal',
        lastName: 'Admin notification',
      }, { ...orderPlacedProperties, isAdminCopy: true }))
    }

    const results = await Promise.all(fires)
    const failed = results.filter((r) => !r.ok)
    if (failed.length > 0) {
      console.warn('[orderConfirmation] %d/%d Klaviyo events failed for %s: %s',
        failed.length, results.length, order.order_number, failed.map((r) => r.error).join(' | '))
    }
  } catch (e) {
    console.error('[orderConfirmation] unexpected error for orderId=%s (non-fatal):', orderId, e)
  }
}
