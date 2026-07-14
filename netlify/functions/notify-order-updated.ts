// WEC-487: admin-triggered "your order has changed" email.
//
// Admin opens the order drawer, edits whatever (quantity, variant, address,
// time, day cancel, etc.), then clicks "Send update email". This endpoint:
//   1. Validates the caller is an admin
//   2. Loads the order + child_orders + order_items + bank_transfer_infos from DB
//   3. Builds the same payload shape as submit-order's Order Placed event
//   4. Fires Klaviyo `Order Updated` metric (new event — needs its own flow set
//      up in Klaviyo dashboard, mirroring the Order Placed flow with the
//      "your order has changed" template)
//   5. Fans out to admin BCC list per WEC-486 (same setting)
//
// The Klaviyo template renders the CURRENT order state — no per-edit diff.
// Admin decides when to fire (no auto-trigger on every edit; that would spam).
//
// Reuses the data-fetching shape from submit-order's customer Order Placed
// payload so the same template body just works (subject differs).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
// WEC-487 followup (2026-06-24): use `track` (awaited) instead of `trackAsync`
// (fire-and-forget). The function returns immediately after firing the event
// and has no other awaited work afterwards — Netlify kills the Node runtime
// before the trackAsync microtask gets a chance to do the actual HTTP POST,
// so the Klaviyo event never lands. submit-order can use trackAsync because
// it does hundreds of ms of DB writes after the call which keeps the runtime
// alive long enough for the microtask to drain. Here we must await.
import { track, subscribeProfileToMarketing, EVT } from '../lib/klaviyo'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface RequestBody {
  orderId: string
}

async function assertAdmin(token: string): Promise<{ userId: string } | { error: string; status: number }> {
  if (!token) return { error: 'Missing Authorization', status: 401 }
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userRes } = await supa.auth.getUser()
  if (!userRes?.user) return { error: 'Invalid session', status: 401 }
  const { data, error } = await supa.rpc('is_admin')
  if (error) return { error: `Admin check failed: ${error.message}`, status: 500 }
  if (!data) return { error: 'Forbidden — admin role required', status: 403 }
  return { userId: userRes.user.id }
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: cors,
    })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const who = await assertAdmin(token)
  if ('error' in who) {
    return Response.json({ error: who.error }, { status: who.status, headers: cors})
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors})
  }
  if (!body.orderId) {
    return Response.json({ error: 'orderId required' }, { status: 400, headers: cors})
  }

  const svc: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Load order + children + items + settings in parallel ─────────────────
  const [orderRes, childrenRes, settingsRes] = await Promise.all([
    svc.from('orders')
      .select('id, order_number, user_id, customer_name, customer_email, customer_phone, subtotal, discount_amount, total, payment_method, payment_status, status, cutlery')
      .eq('id', body.orderId).single(),
    svc.from('child_orders')
      .select('id, delivery_date, time_from, time_to, address_street, address_area, address_zip, address_floor, fulfillment_type, pickup_location_id, cancelled_at')
      .eq('order_id', body.orderId)
      .is('cancelled_at', null)
      .order('delivery_date'),
    svc.from('settings').select('key, value').in('key', ['bank_transfer_info', 'order_confirmation_admin_emails', 'pickup_locations']),
  ])

  if (orderRes.error || !orderRes.data) {
    return Response.json({ error: 'Order not found' }, { status: 404, headers: cors})
  }
  const order = orderRes.data
  const childOrders = childrenRes.data ?? []
  const settingsRows = (settingsRes.data ?? []) as Array<{ key: string; value: unknown }>

  if (!order.customer_email) {
    return Response.json({ error: 'Order has no customer email' }, { status: 400, headers: cors})
  }

  // Items for ALL active child_orders
  const childIds = childOrders.map((c) => c.id as string)
  let items: Array<{
    id: string; child_order_id: string; dish_id: string | null; variant_id: string | null;
    name_el: string; name_en: string | null; variant_label_el: string | null; variant_label_en: string | null;
    quantity: number; unit_price: number; total_price: number;
    calories: number | null; protein: number | null; carbs: number | null; fat: number | null;
    comment: string | null;
  }> = []
  if (childIds.length > 0) {
    const { data: itemRows } = await svc
      .from('order_items')
      .select('id, child_order_id, dish_id, variant_id, name_el, name_en, variant_label_el, variant_label_en, quantity, unit_price, total_price, calories, protein, carbs, fat, comment')
      .in('child_order_id', childIds)
    items = (itemRows ?? []) as typeof items
  }

  // Lang lookup — server-side, admin-initiated. user_prefs.lang wins;
  // defaults to 'el' (Greece-first).
  let custLang: 'el' | 'en' = 'el'
  if (order.user_id) {
    const { data: pref } = await svc
      .from('user_prefs')
      .select('lang')
      .eq('user_id', order.user_id as string)
      .maybeSingle()
    const l = (pref as { lang?: string } | null)?.lang
    if (l === 'el' || l === 'en') custLang = l
  }

  // ── Pickup location resolution (mirrors submit-order) ─────────────────────
  const rawPickupLocs = settingsRows.find((r) => r.key === 'pickup_locations')?.value
  const pickupList = Array.isArray(rawPickupLocs) ? (rawPickupLocs as Array<Record<string, unknown>>) : []
  function pickupLocFor(id: string | null): { name_el: string; name_en: string; address: string } | null {
    if (!id) return null
    const loc = pickupList.find((l) => l.id === id)
    if (!loc) return null
    return {
      name_el: typeof loc.name_el === 'string' ? loc.name_el : '',
      name_en: typeof loc.name_en === 'string' ? loc.name_en : '',
      address: typeof loc.address === 'string' ? loc.address : '',
    }
  }

  // ── Build the per-day payload shape (mirrors submit-order's klaviyoDays) ──
  function fmtTime(t: string | null): string {
    if (!t) return ''
    return t.slice(0, 5) // 'HH:MM:SS' → 'HH:MM'
  }
  function dayLabel(iso: string): { el: string; en: string } {
    const d = new Date(iso + 'T12:00:00Z')
    const dow = d.getUTCDay() // 0=Sun..6=Sat
    const elDow = ['Κυριακή','Δευτέρα','Τρίτη','Τετάρτη','Πέμπτη','Παρασκευή','Σάββατο'][dow]
    const enDow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow]
    const dd = d.getUTCDate().toString().padStart(2, '0')
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
    return { el: `${elDow} ${dd}/${mm}`, en: `${enDow} ${dd}/${mm}` }
  }

  const klaviyoDays = childOrders.map((c) => {
    const cId = c.id as string
    const dayItems = items.filter((i) => i.child_order_id === cId)
    const dayCals  = dayItems.reduce((s, it) => s + (it.calories ?? 0) * it.quantity, 0)
    const dayPro   = dayItems.reduce((s, it) => s + (it.protein  ?? 0) * it.quantity, 0)
    const dayCarb  = dayItems.reduce((s, it) => s + (it.carbs    ?? 0) * it.quantity, 0)
    const dayFat   = dayItems.reduce((s, it) => s + (it.fat      ?? 0) * it.quantity, 0)
    const labels = dayLabel(c.delivery_date as string)
    const pickup = pickupLocFor(c.pickup_location_id as string | null)
    return {
      date: c.delivery_date,
      day_label_el: labels.el,
      day_label_en: labels.en,
      time_window: c.time_from && c.time_to ? `${fmtTime(c.time_from as string)}–${fmtTime(c.time_to as string)}` : '',
      address: c.fulfillment_type === 'pickup' && pickup
        ? `${pickup.address}`
        : [c.address_street, c.address_zip, c.address_area].filter(Boolean).join(', '),
      fulfillment_type: c.fulfillment_type ?? 'delivery',
      pickup_location: pickup,
      day_total: dayItems.reduce((s, it) => s + it.total_price, 0) / 100,
      day_macros: {
        calories: dayCals, protein: dayPro, carbs: dayCarb, fat: dayFat,
      },
      items: dayItems.map((it) => ({
        name_el: it.name_el,
        name_en: it.name_en ?? '',
        variant_label_el: it.variant_label_el ?? '',
        variant_label_en: it.variant_label_en ?? '',
        qty: it.quantity,
        unit_price: it.unit_price / 100,
        total_price: it.total_price / 100,
        calories: (it.calories ?? 0) * it.quantity,
        protein:  (it.protein  ?? 0) * it.quantity,
        carbs:    (it.carbs    ?? 0) * it.quantity,
        fat:      (it.fat      ?? 0) * it.quantity,
        comment: it.comment ?? '',
      })),
    }
  })

  // Bank transfer infos (same parsing as submit-order)
  const rawBankInfos = settingsRows.find((r) => r.key === 'bank_transfer_info')?.value
  const bankList = Array.isArray(rawBankInfos)
    ? rawBankInfos
    : (rawBankInfos && typeof rawBankInfos === 'object' ? [rawBankInfos] : [])
  // Emit BOTH bank_name (snake — template) and bankName (camel — legacy).
  const bankTransferInfos = (bankList as Array<Record<string, unknown>>)
    .filter((e) => !!e && typeof e === 'object')
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

  // ── Build the event properties (same shape as Order Placed, plus
  //    isUpdate so the Klaviyo template can swap the subject prefix) ────────
  //
  // 2026-06-26: Klaviyo template uses snake_case (order_number,
  // payment_method, discount_amount, first_name, etc.) — see the
  // submit-order.ts comment for the full naming-mismatch story.
  // Emit BOTH snake and camel keys so the template renders and any
  // downstream camelCase consumer keeps working.
  const totalItemsForMacros = items.reduce((s, it) => s + it.quantity, 0)
  const allDaysMacros = klaviyoDays.reduce((acc, d) => ({
    calories: acc.calories + d.day_macros.calories,
    protein:  acc.protein  + d.day_macros.protein,
    carbs:    acc.carbs    + d.day_macros.carbs,
    fat:      acc.fat      + d.day_macros.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
  const firstNameUpd = (((order.customer_name as string) ?? '').split(' ')[0]) ?? ''
  const orderUpdatedProperties = {
    lang: custLang,
    // ── snake_case (template-expected) ───────────────────────────────────
    first_name: firstNameUpd,
    order_number: order.order_number,
    total: (order.total as number) / 100,
    subtotal: (order.subtotal as number) / 100,
    discount_amount: (order.discount_amount as number) / 100,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    day_count: childOrders.length,
    item_count: totalItemsForMacros,
    total_macros: allDaysMacros,
    // ── camelCase (legacy / downstream compat) ───────────────────────────
    orderId: order.id,
    orderNumber: order.order_number,
    discountAmount: (order.discount_amount as number) / 100,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    dayCount: childOrders.length,
    itemCount: totalItemsForMacros,
    totalMacros: allDaysMacros,
    bank_transfer_infos: bankTransferInfos,
    bank_transfer_info: bankTransferInfos[0] ?? null,
    days: klaviyoDays,
    isUpdate: true,                 // template can prefix subject with "Updated:"
    sentByAdminId: who.userId,
    sentAt: new Date().toISOString(),
  }

  // ── Fire the event for the customer + admin BCC list in parallel ────────
  //
  // 2026-06-24: per Ioustinos's original spec ("same template, conditional
  // subject, one flow to maintain"), we fire the SAME `Order Placed` metric
  // here — NOT a separate `Order Updated` metric. The `isUpdate: true` flag
  // on event properties lets the Order Placed flow's email subject swap
  // wording via Django ({% if event.isUpdate %}Updated...{% else %}...{% endif %})
  // without needing a duplicate flow or template. One source of truth for
  // the body; the only thing that differs between the two semantic events
  // is the subject line.
  //
  // Analytics-side: `count(Order Placed where isUpdate is true)` = updates,
  // `count(... where isUpdate is false)` = real orders. Same metric stream,
  // separable via property filter when reporting.
  //
  // All Klaviyo calls are awaited via Promise.all so Netlify doesn't kill
  // the function before the HTTP POSTs complete. track() already swallows
  // its own errors and returns { ok, error }, so this can't throw.
  const fires: Promise<{ ok: boolean; error?: string }>[] = []

  // 2026-06-25 launch fix: subscribe profile to marketing before firing.
  // See klaviyo.ts → subscribeProfileToMarketing. Without this, Klaviyo
  // silently drops the email for NEVER_SUBSCRIBED profiles even on Live flows.
  fires.push(subscribeProfileToMarketing(
    order.customer_email as string,
    'Fitpal order updated (auto-subscribe)',
  ))

  fires.push(track(EVT.OrderPlaced, {
    email: order.customer_email as string,
    firstName: ((order.customer_name as string) ?? '').split(' ')[0],
    lastName: ((order.customer_name as string) ?? '').split(' ').slice(1).join(' '),
    phone: (order.customer_phone as string | null) ?? undefined,
    externalId: (order.user_id as string | null) ?? undefined,
  }, orderUpdatedProperties))

  // ── WEC-486 reuse: fan out to admin BCC list ─────────────────────────────
  try {
    const rawAdmins = settingsRows.find((r) => r.key === 'order_confirmation_admin_emails')?.value
    const adminEmails = Array.isArray(rawAdmins)
      ? (rawAdmins as unknown[])
          .filter((v): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
          .map((v) => v.trim())
      : []
    const customerLower = (order.customer_email as string).toLowerCase()
    for (const adminEmail of adminEmails) {
      if (adminEmail.toLowerCase() === customerLower) continue
      fires.push(subscribeProfileToMarketing(
        adminEmail,
        'Fitpal admin BCC (auto-subscribe)',
      ))
      fires.push(track(EVT.OrderPlaced, {
        email: adminEmail,
        firstName: 'Fitpal',
        lastName: 'Admin notification',
      }, {
        ...orderUpdatedProperties,
        isAdminCopy: true,
      }))
    }
  } catch (e) {
    console.warn('[notify-order-updated] admin BCC fan-out setup failed:', e)
  }

  const results = await Promise.all(fires)
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.warn('[notify-order-updated] %d/%d Klaviyo fires failed: %s',
      failed.length, results.length, failed.map((r) => r.error).join(' | '))
  }

  return Response.json({ ok: true }, { headers: cors})
}
