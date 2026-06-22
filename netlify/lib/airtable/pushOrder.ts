// WEC-477: push one platform order into Airtable (retail order mirror).
// One-way: platform DB is the master; Airtable mirrors. Idempotent upserts so
// re-runs (event push + reconcile) converge. Links (Customer, Μenu Reference,
// Parent/Child) are set by resolved record id — never typecast.

import type { SupabaseClient } from '@supabase/supabase-js'
import { TABLES, RETAIL_STORE_ID } from './env'
import { findRecordId, upsertRecords, createRecord } from './client'
import { mapPaid, mapPaymentMethod, mapInvoice, toEuros, athensIso, esc } from './maps'

export interface PushResult {
  ok: boolean
  orderId: string
  skipped?: 'not_eligible' | 'not_found'
  error?: string
}

interface OrderRow {
  id: string
  order_number: number | string
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  subtotal: number | null
  total: number | null
  payment_method: string
  payment_status: string
  status: string
  cutlery: boolean | null
  invoice_type: string | null
  invoice_vat: string | null
  notes: string | null
  created_at?: string | null
  submitted_at?: string | null
  updated_at?: string | null
}

// Mirror an order once it is "confirmed enough": never a draft, and for online
// card the payment must have landed (avoids phantom abandoned-checkout rows).
// cash / transfer / link (pay-later) / wallet are valid at submit.
export function isMirrorEligible(o: { status: string; payment_method: string; payment_status: string }): boolean {
  if (o.status === 'draft') return false
  if (o.payment_method === 'card' && o.payment_status !== 'paid') return false
  return true
}

async function findOrCreateCustomer(
  phone: string | null,
  name: string | null,
  email: string | null,
): Promise<string | null> {
  if (!phone) return null
  const existing = await findRecordId(TABLES.customers, `{Phone Number}='${esc(phone)}'`)
  if (existing) return existing
  return createRecord(TABLES.customers, {
    Name: name ?? '',
    'Phone Number': phone,
    Email: email ?? '',
    Source: 'Other',
  })
}

export async function pushOrderToAirtable(
  supabase: SupabaseClient,
  orderId: string,
): Promise<PushResult> {
  // 1. Load order
  const { data: order, error: oErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, customer_name, customer_email, customer_phone, subtotal, total, payment_method, payment_status, status, cutlery, invoice_type, invoice_vat, notes, created_at, submitted_at, updated_at',
    )
    .eq('id', orderId)
    .single<OrderRow>()
  if (oErr || !order) return { ok: false, orderId, skipped: 'not_found' }

  if (!isMirrorEligible(order)) return { ok: true, orderId, skipped: 'not_eligible' }

  // 2. Load children + items
  const { data: children } = await supabase
    .from('child_orders')
    .select('id, delivery_date, time_from, time_to, address_street, address_area, address_zip, address_floor')
    .eq('order_id', orderId)
  const childList = children ?? []
  const childIds = childList.map((c: any) => c.id)
  const { data: items } = childIds.length
    ? await supabase
        .from('order_items')
        .select('id, child_order_id, dish_id, variant_id, name_el, variant_label_el, quantity, unit_price, total_price, comment')
        .in('child_order_id', childIds)
    : { data: [] as any[] }
  const itemList = items ?? []

  // 3. Resolve variant external_id + category per dish (one query each)
  const variantIds = [...new Set(itemList.map((i: any) => i.variant_id).filter(Boolean))]
  const dishIds = [...new Set(itemList.map((i: any) => i.dish_id).filter(Boolean))]
  const extByVariant = new Map<string, string>()
  if (variantIds.length) {
    const { data: vrows } = await supabase
      .from('dish_variants')
      .select('id, external_id')
      .in('id', variantIds)
    for (const v of vrows ?? []) extByVariant.set(v.id, v.external_id ?? v.id)
  }
  const catByDish = new Map<string, string>()
  const descByDish = new Map<string, string>()
  if (dishIds.length) {
    const { data: drows } = await supabase
      .from('dishes')
      .select('id, desc_el, category_id, categories(name_el)')
      .in('id', dishIds)
    for (const d of (drows ?? []) as any[]) {
      const cat = Array.isArray(d.categories) ? d.categories[0]?.name_el : d.categories?.name_el
      if (cat) catByDish.set(d.id, cat)
      if (d.desc_el) descByDish.set(d.id, d.desc_el)
    }
  }

  // 4. Customer (find-or-create by phone)
  const customerRecId = await findOrCreateCustomer(order.customer_phone, order.customer_name, order.customer_email)
  const custLink = customerRecId ? [customerRecId] : undefined

  // 5. Resolve Μenu Reference record ids by external code (cached)
  const menuRefCache = new Map<string, string | null>()
  async function menuRefId(code: string): Promise<string | null> {
    if (menuRefCache.has(code)) return menuRefCache.get(code)!
    const id = await findRecordId(TABLES.menuReference, `{Κωδικός}='${esc(code)}'`)
    menuRefCache.set(code, id)
    return id
  }

  // 6. Upsert Orders
  // Airtable dateTime fields reject Postgres's 6-digit microsecond timestamps
  // under typecast:false — normalize to millisecond ISO so they actually land.
  const isoMs = (v?: string | null): string | undefined => (v ? new Date(v).toISOString() : undefined)
  const pm = mapPaymentMethod(order.payment_method)
  const orderFields: Record<string, unknown> = {
    'Order Id': order.id,
    'Admin Order ID': String(order.order_number),
    'Customer Name': order.customer_name ?? '',
    'Customer Phone': order.customer_phone ?? '',
    'Customer Email': order.customer_email ?? '',
    // GonnaOrder parity: Placement = order/draft creation, Submitted = user
    // submit, Updated At = last status change. (Airtable "Created" is internal.)
    'Order Placement Time': isoMs(order.created_at) ?? new Date().toISOString(),
    'Submitted at (GO)': isoMs(order.submitted_at) ?? isoMs(order.created_at),
    'Updated At (GO)': isoMs(order.updated_at),
    'Total Order Value': toEuros(order.subtotal),
    'Total Order Price (After Discount)': toEuros(order.total),
    'Order Comments': order.notes ?? '',
    Paid: mapPaid(order.payment_status),
    'Payment Method': pm.method,
    'Store Id': RETAIL_STORE_ID,
    'Μαχαιροπίρουνα': !!order.cutlery,
  }
  if (pm.extra) orderFields['Payment Extra'] = pm.extra
  const inv = mapInvoice(order.invoice_type)
  if (inv) orderFields['Τιμολόγιο/Απόδειξη'] = inv
  if (order.invoice_vat) orderFields['ΑΦΜ'] = order.invoice_vat
  if (custLink) orderFields['Customer'] = custLink

  const [orderRec] = await upsertRecords(TABLES.orders, ['Order Id'], [{ fields: orderFields }])
  const orderRecId = orderRec.id

  // 7. Upsert Child/Day Orders + their items
  for (const c of childList as any[]) {
    const wishIso = athensIso(c.delivery_date, c.time_from)
    const childKey = `${order.id}#${wishIso}`
    const childFields: Record<string, unknown> = {
      'Child/Day Order Id': childKey,
      'Order Wish Time': wishIso,
      Address: c.address_street ?? '',
      'Post Code': c.address_zip ?? '',
      City: c.address_area ?? '',
      Floor: c.address_floor ?? '',
      'Parent Order Id': [orderRecId],
    }
    if (custLink) childFields['Customer'] = custLink
    const [childRec] = await upsertRecords(TABLES.childOrders, ['Child/Day Order Id'], [{ fields: childFields }])
    const childRecId = childRec.id

    const childItems = itemList.filter((i: any) => i.child_order_id === c.id)
    const itemRecords = []
    for (const it of childItems as any[]) {
      const code = extByVariant.get(it.variant_id) ?? it.variant_id
      const refId = code ? await menuRefId(code) : null
      const fields: Record<string, unknown> = {
        uuid: it.id,
        'Item Name': it.name_el ?? '',
        'Item Variant': it.variant_label_el ?? '',
        'Item Fitpal ID': code ? String(code) : '',
        Quantity: it.quantity,
        'Item Price': toEuros(it.unit_price),
        'Items Full Price': toEuros(it.total_price),
        'Item Comment': it.comment ?? '',
        'Item Long Description': descByDish.get(it.dish_id) ?? '',
        Category: catByDish.get(it.dish_id) ?? '',
        'Child/Day Order ID': [childRecId],
      }
      if (refId) fields['Item'] = [refId]
      if (custLink) fields['Customer'] = custLink
      itemRecords.push({ fields })
    }
    if (itemRecords.length) await upsertRecords(TABLES.orderItems, ['uuid'], itemRecords)
  }

  // 8. Stamp synced (clears dirty without re-flagging via the trigger guard)
  await supabase
    .from('orders')
    .update({ airtable_dirty: false, airtable_synced_at: new Date().toISOString() })
    .eq('id', orderId)

  return { ok: true, orderId }
}
