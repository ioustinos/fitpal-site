// WEC-477: push one platform order into Airtable (retail order mirror).
// One-way: platform DB is the master; Airtable mirrors. Idempotent upserts so
// re-runs (event push + reconcile) converge. Links (Customer, Μenu Reference,
// Parent/Child) are set by resolved record id — never typecast.

import type { SupabaseClient } from '@supabase/supabase-js'
import { TABLES, RETAIL_STORE_ID, airtableDeleteEnabled, airtableInvoiceNameField } from './env'
import { findRecordId, upsertRecords, createRecord, listRecords, deleteRecords } from './client'
import { mapPaid, mapPaymentMethod, mapInvoice, mapOrderType, mapOrderStatus, toEuros, athensIso, esc } from './maps'

export interface PushResult {
  ok: boolean
  orderId: string
  skipped?: 'not_eligible' | 'not_found'
  error?: string
  // WEC-697: what the delete-reconcile did (or would do, in dry-run). Surfaced
  // so airtable-reconcile can write the trail to reconcile_runs.notes.
  deletions?: {
    dryRun: boolean
    childKeys: string[]   // stale Child/Day Order keys removed (or would be)
    itemUuids: string[]   // stale Order Item uuids removed (or would be)
    skippedReason?: string
    debug?: string        // WEC-697: one-shot schema probe (temporary)
  }
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
  invoice_name: string | null   // WEC-697
  invoice_vat: string | null
  notes: string | null
  admin_order_id: string | null
  cancel_reason: string | null
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
      'id, order_number, customer_name, customer_email, customer_phone, subtotal, total, payment_method, payment_status, status, cutlery, invoice_type, invoice_name, invoice_vat, notes, admin_order_id, cancel_reason, created_at, submitted_at, updated_at',
    )
    .eq('id', orderId)
    .single<OrderRow>()
  if (oErr || !order) return { ok: false, orderId, skipped: 'not_found' }

  if (!isMirrorEligible(order)) return { ok: true, orderId, skipped: 'not_eligible' }

  // 2. Load children + items.
  // WEC-697: capture the read error explicitly — a FAILED read must never be
  // treated as "no rows" (that would make the delete-reconcile wipe everything).
  // Also fetch cancelled_at: a soft-cancelled day must NOT be mirrored as a live
  // day (it was being re-pushed with its items), so it's excluded from the upsert
  // set and becomes stale → removed by the reconcile.
  const { data: children, error: cErr } = await supabase
    .from('child_orders')
    .select('id, delivery_date, time_from, time_to, address_street, address_area, address_zip, address_floor, address_doorbell, address_notes, cancelled_at')
    .eq('order_id', orderId)
  const allChildren = children ?? []
  const childList = allChildren.filter((c: any) => c.cancelled_at == null) // active days only
  const activeChildIds = childList.map((c: any) => c.id)
  const { data: items, error: iErr } = activeChildIds.length
    ? await supabase
        .from('order_items')
        .select('id, child_order_id, dish_id, variant_id, name_el, variant_label_el, quantity, unit_price, total_price, comment')
        .in('child_order_id', activeChildIds)
    : { data: [] as any[], error: null }
  const itemList = items ?? []
  // Reads must both have SUCCEEDED before we're allowed to delete anything.
  const readsOk = !cErr && !iErr

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
    // WEC-528: payment source × who placed it. Exact single-select strings —
    // see mapOrderType. "From Company" is never emitted from this platform.
    'Order Type': mapOrderType(order.payment_method, order.admin_order_id),
    'Store Id': RETAIL_STORE_ID,
    'Μαχαιροπίρουνα': !!order.cutlery,
  }
  if (pm.extra) orderFields['Payment Extra'] = pm.extra
  const inv = mapInvoice(order.invoice_type)
  if (inv) orderFields['Τιμολόγιο/Απόδειξη'] = inv
  if (order.invoice_vat) orderFields['ΑΦΜ'] = order.invoice_vat
  if (custLink) orderFields['Customer'] = custLink
  // WEC-537: mirror order status + (on cancel) the admin reason so cancelled
  // orders don't look active in Airtable. draft never reaches here.
  const statusOpt = mapOrderStatus(order.status)
  if (statusOpt) orderFields['Order Status'] = statusOpt
  if (order.status === 'cancelled') orderFields['Cancellation Reason'] = order.cancel_reason ?? ''

  const [orderRec] = await upsertRecords(TABLES.orders, ['Order Id'], [{ fields: orderFields }])
  const orderRecId = orderRec.id

  // WEC-697: invoice company name («Επωνυμία»). Sent as an ISOLATED, best-effort
  // upsert so a wrong/missing field name can never 422 the main order mirror
  // above (acceptance: "No regression on the upsert path"). Merges on Order Id.
  if (order.invoice_name && order.invoice_type && mapInvoice(order.invoice_type) === 'Τιμολόγιο') {
    try {
      await upsertRecords(TABLES.orders, ['Order Id'], [{
        fields: { 'Order Id': order.id, [airtableInvoiceNameField()]: order.invoice_name },
      }])
    } catch (e) {
      console.warn('[pushOrder] invoice-name patch skipped (field name?):', (e as Error).message)
    }
  }

  // WEC-697: the CURRENT (active) child keys + item uuids — the delete-reconcile
  // removes any Airtable row for this order NOT in these sets.
  const currentChildKeys = new Set<string>()
  const currentItemUuids = new Set<string>()

  // 7. Upsert Child/Day Orders + their items
  for (const c of childList as any[]) {
    const wishIso = athensIso(c.delivery_date, c.time_from)
    const childKey = `${order.id}#${wishIso}`
    currentChildKeys.add(childKey)
    const childFields: Record<string, unknown> = {
      'Child/Day Order Id': childKey,
      'Order Wish Time': wishIso,
      Address: c.address_street ?? '',
      'Post Code': c.address_zip ?? '',
      City: c.address_area ?? '',
      Floor: c.address_floor ?? '',
      // WEC-530 (2026-07-10): new-platform semantics — Doorbell carries the
      // ACTUAL doorbell; address comments go to the new "Address Comment"
      // field. (GonnaOrder-legacy rows still put comments in Doorbell until
      // B2B migrates — mixed semantics in Airtable during the transition.)
      Doorbell: c.address_doorbell ?? '',
      'Address Comment': c.address_notes ?? '',
      'Parent Order Id': [orderRecId],
    }
    if (custLink) childFields['Customer'] = custLink
    const [childRec] = await upsertRecords(TABLES.childOrders, ['Child/Day Order Id'], [{ fields: childFields }])
    const childRecId = childRec.id

    const childItems = itemList.filter((i: any) => i.child_order_id === c.id)
    const itemRecords = []
    for (const it of childItems as any[]) {
      currentItemUuids.add(String(it.id))
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

  // 8. WEC-697: reconcile the Airtable side against ours — remove day/item rows
  // the customer/admin deleted or cancelled, so the kitchen never preps food
  // nobody ordered. Destructive + runs every 5 min, so it is heavily guarded and
  // ships in DRY-RUN (log-only) until AIRTABLE_DELETE_ENABLED=true.
  const deletions = await reconcileDeletes(order.id, currentChildKeys, currentItemUuids, readsOk)

  // 9. Stamp synced (clears dirty without re-flagging via the trigger guard)
  await supabase
    .from('orders')
    .update({ airtable_dirty: false, airtable_synced_at: new Date().toISOString() })
    .eq('id', orderId)

  return { ok: true, orderId, deletions }
}

/**
 * WEC-697: delete (or, in dry-run, log) Airtable Child/Day + Item rows for this
 * order that are no longer in the current DB set.
 *
 * Scope safety — how B2B/GonnaOrder rows are provably never touched:
 *   • Every record this platform creates keys on `${order.id}#…` (children) /
 *     the item's link to such a child. We ONLY ever list + delete records whose
 *     key carries THIS order's uuid prefix, and this order is a retail order we
 *     created (Store Id = RETAIL_STORE_ID). A B2B row cannot match the prefix.
 *   • A FAILED read (`readsOk === false`, or a list throw) aborts with zero
 *     deletions — an error is never mistaken for "empty set", so it can't
 *     delete-everything. An empty set from a SUCCESSFUL read is legitimate.
 */
async function reconcileDeletes(
  orderId: string,
  currentChildKeys: Set<string>,
  currentItemUuids: Set<string>,
  readsOk: boolean,
): Promise<PushResult['deletions']> {
  const dryRun = !airtableDeleteEnabled()
  if (!readsOk) {
    console.warn('[pushOrder] delete-reconcile SKIPPED for %s: DB read failed (never delete on a failed read)', orderId)
    return { dryRun, childKeys: [], itemUuids: [], skippedReason: 'db_read_failed' }
  }

  const prefix = `${orderId}#`
  const staleChildKeys: string[] = []
  const staleItemUuids: string[] = []
  const staleChildRecIds: string[] = []
  const staleItemRecIds: string[] = []
  let debug: string | undefined
  try {
    // Children: keyed on the text field {Child/Day Order Id} = `${orderId}#…` —
    // a plain text field, so the filter is reliable (not a link-formula guess).
    const atChildren = await listRecords(
      TABLES.childOrders,
      `FIND('${esc(prefix)}', {Child/Day Order Id}) = 1`,
    )

    // Items: scope WITHOUT guessing a primary/link display. The Airtable REST
    // API returns link cells as arrays of RECORD IDs, so every item record
    // linked under this order's children is reachable directly from the child
    // records' link fields. We gather all linked rec-ids from those children
    // then look them up by RECORD_ID().
    const linkedRecIds = new Set<string>()
    const recArrayFields: string[] = []
    for (const rec of atChildren) {
      const key = String((rec.fields as Record<string, unknown>)['Child/Day Order Id'] ?? '')
      if (key && !currentChildKeys.has(key)) { staleChildKeys.push(key); staleChildRecIds.push(rec.id) }
      for (const [fname, v] of Object.entries(rec.fields)) {
        if (Array.isArray(v) && v.some((x) => typeof x === 'string' && (x as string).startsWith('rec'))) {
          recArrayFields.push(fname)
          for (const x of v) if (typeof x === 'string' && x.startsWith('rec')) linkedRecIds.add(x)
        }
      }
    }

    let itemsFetched = 0
    const idList = [...linkedRecIds]
    for (let i = 0; i < idList.length; i += 50) {
      const chunk = idList.slice(i, i + 50)
      const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`
      const atItems = await listRecords(TABLES.orderItems, formula)
      itemsFetched += atItems.length
      for (const rec of atItems) {
        const uuid = String((rec.fields as Record<string, unknown>)['uuid'] ?? '')
        if (uuid && !currentItemUuids.has(uuid)) { staleItemUuids.push(uuid); staleItemRecIds.push(rec.id) }
      }
    }

    // WEC-697 one-shot schema probe: only emit when the child was found but NO
    // items resolved (the mismatch we're chasing). Removed once verified.
    if (atChildren.length && itemsFetched === 0) {
      const sampleFields = Object.keys((atChildren[0]?.fields as object) ?? {})
      debug = `PROBE ${orderId.slice(0, 8)}: children=${atChildren.length} recArrayFields=[${[...new Set(recArrayFields)].join(';')}] linkedRecIds=${linkedRecIds.size} itemsFetched=0 childFields=[${sampleFields.join(';')}]`
    }
  } catch (e) {
    console.warn('[pushOrder] delete-reconcile read failed for %s — no deletions:', orderId, (e as Error).message)
    return { dryRun, childKeys: [], itemUuids: [], skippedReason: 'airtable_read_failed', debug: `ERR ${(e as Error).message.slice(0, 120)}` }
  }

  if (dryRun) {
    // Always log (incl. the 0/0 case) so Netlify logs prove the path ran and a
    // "detected nothing" result isn't silent (WEC-697 dry-run observability gap).
    console.log('[pushOrder] delete-reconcile DRY-RUN %s — would delete %d day(s) %j and %d item(s) %j',
      orderId, staleChildKeys.length, staleChildKeys, staleItemUuids.length, staleItemUuids)
    return { dryRun: true, childKeys: staleChildKeys, itemUuids: staleItemUuids, debug }
  }

  // Live delete. Items first (children hold the links), then children.
  if (staleItemRecIds.length) await deleteRecords(TABLES.orderItems, staleItemRecIds)
  if (staleChildRecIds.length) await deleteRecords(TABLES.childOrders, staleChildRecIds)
  if (staleChildKeys.length || staleItemUuids.length) {
    console.log('[pushOrder] delete-reconcile %s — deleted %d day(s) %j and %d item(s) %j',
      orderId, staleChildKeys.length, staleChildKeys, staleItemUuids.length, staleItemUuids)
  }
  return { dryRun: false, childKeys: staleChildKeys, itemUuids: staleItemUuids, debug }
}
