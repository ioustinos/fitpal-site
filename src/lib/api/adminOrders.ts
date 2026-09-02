import { supabase } from '../supabase'

// ─── Enum values (mirror DB) ──────────────────────────────────────────────

// WEC-415/420: 'draft' is an in-progress checkout snapshot — has its own
// preset in the admin Orders list and is excluded from every other view.
// It's not a "real" status admins transition into, so it's deliberately
// omitted from ORDER_STATUS_VALUES (the checkbox filter row) and from
// VALID_NEXT_STATUS (there's no transition INTO a draft, only OUT of it,
// and that's done by the customer hitting Submit — handled by submit-order).
export type OrderStatus = 'draft' | 'pending' | 'confirmed' | 'preparing' | 'delivering' | 'delivered' | 'cancelled'
export type PaymentStatus = 'pending' | 'pending_link_sent' | 'paid' | 'failed' | 'refunded'
export type PaymentMethod = 'cash' | 'card' | 'link' | 'transfer' | 'wallet'

export const ORDER_STATUS_VALUES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'delivering', 'delivered', 'cancelled']
export const PAYMENT_STATUS_VALUES: PaymentStatus[] = ['pending', 'pending_link_sent', 'paid', 'failed', 'refunded']

/** Valid forward transitions for order status (admin can always force-cancel). */
export const VALID_NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  draft:      [],
  pending:    ['confirmed', 'cancelled'],
  confirmed:  ['preparing', 'cancelled'],
  preparing:  ['delivering', 'cancelled'],
  delivering: ['delivered', 'cancelled'],
  delivered:  [],
  cancelled:  [],
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface AdminOrderItem {
  id: string
  childOrderId: string
  dishId: string | null
  variantId: string | null
  nameEl: string
  nameEn: string
  variantLabelEl: string
  variantLabelEn: string
  quantity: number
  unitPrice: number    // cents
  totalPrice: number   // cents
  calories: number
  protein: number
  carbs: number
  fat: number
  comment: string | null
}

export interface AdminChildOrder {
  id: string
  orderId: string
  deliveryDate: string
  timeFrom: string | null
  timeTo: string | null
  addressStreet: string | null
  addressArea: string | null
  addressZip: string | null
  addressFloor: string | null
  /** WEC-389: set when this delivery day has been soft-cancelled. */
  cancelledAt: string | null
  items: AdminOrderItem[]
}

export interface AdminVoucherUse {
  id: string
  voucherId: string
  code: string
  amount: number      // cents
  usedAt: string
}

export interface AdminChangeLogEntry {
  id: number
  tableName: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
  label: string | null
  adminUser: string | null
  createdAt: string
}

export interface AdminOrder {
  id: string
  orderNumber: string
  userId: string | null
  customerName: string
  customerEmail: string
  customerPhone: string
  subtotal: number
  discountAmount: number
  total: number
  /** WEC-171: cumulative refund amount in cents. */
  refundAmount: number
  paymentMethod: PaymentMethod | null
  paymentStatus: PaymentStatus
  status: OrderStatus
  cutlery: boolean
  invoiceType: string | null
  invoiceName: string | null
  invoiceVat: string | null
  notes: string | null
  adminOrderId: string | null
  adminNotes: string | null
  cancelReason: string | null
  createdAt: string
  /** WEC-590: real submit time (draft created_at is the draft's age, not the order's). */
  submittedAt: string | null
  updatedAt: string
  childOrders: AdminChildOrder[]
  voucherUses: AdminVoucherUse[]
  changeLog: AdminChangeLogEntry[]
  /** WEC-171/176: Viva payment link (null for non-Viva orders). */
  paymentLink: AdminPaymentLink | null
  /** WEC-606: derived payment ledger — actually-collected / remaining / refundable. */
  payment: OrderPaymentSummary
}

/** WEC-606 — the one shared "how much was actually paid" answer
 *  (from the order_payment_summary DB function). All money in cents. */
export interface OrderPaymentSummary {
  total: number
  paid: number        // Σ paid-link amounts + Σ wallet debits + manual_paid_amount
  refunded: number    // orders.refund_amount
  remaining: number   // still to collect = total − paid + refunded
  refundable: number  // can't refund more than collected = paid − refunded
}

/** WEC-171/176 — Viva payment link snapshot for the admin drawer. */
export interface AdminPaymentLink {
  id: string
  vivaOrderCode: string | null
  transactionId: string | null
  statusId: string | null
  status: 'pending' | 'success' | 'failure'
  paymentUrl: string | null
  lastVerifiedAt: string | null
  /** WEC-606/607: what this link is for (cents). A paid link = that much collected. */
  amount: number | null
  createdAt: string
  updatedAt: string
}

// ─── Filters ──────────────────────────────────────────────────────────────

export interface OrderFilters {
  search?: string            // substring of order_number / customer name / email / phone
  status?: OrderStatus[]
  paymentStatus?: PaymentStatus[]
  paymentMethod?: PaymentMethod[]   // WEC-577 — raw payment method (cash/card/link/transfer/wallet)
  deliveryDateFrom?: string  // YYYY-MM-DD — uses child_orders.delivery_date
  deliveryDateTo?: string
  createdFrom?: string       // YYYY-MM-DD
  createdTo?: string
  addressZip?: string        // match child_orders.address_zip
}

// ─── Queries ──────────────────────────────────────────────────────────────

export async function listAdminOrders(f: OrderFilters): Promise<{ data: AdminOrder[] | null; error: string | null }> {
  // Filtering on child_orders requires joining via IN (...) of order_ids that match
  let orderIdsFromChild: Set<string> | null = null
  if (f.deliveryDateFrom || f.deliveryDateTo || f.addressZip) {
    let q = supabase.from('child_orders').select('order_id')
    if (f.deliveryDateFrom) q = q.gte('delivery_date', f.deliveryDateFrom)
    if (f.deliveryDateTo) q = q.lte('delivery_date', f.deliveryDateTo)
    if (f.addressZip) q = q.eq('address_zip', f.addressZip)
    const { data, error } = await q
    if (error) return { data: null, error: error.message }
    orderIdsFromChild = new Set((data ?? []).map((r) => r.order_id as string))
    if (orderIdsFromChild.size === 0) return { data: [], error: null }
  }

  let q = supabase.from('orders').select('*').order('created_at', { ascending: false })
  // WEC-419: default view excludes drafts; the Drafts tab opts in by passing
  // ['draft'] in f.status, which then routes through the `in` filter below.
  if (f.status && f.status.length) {
    q = q.in('status', f.status)
  } else {
    q = q.neq('status', 'draft')
  }
  if (f.paymentStatus && f.paymentStatus.length) q = q.in('payment_status', f.paymentStatus)
  if (f.paymentMethod && f.paymentMethod.length) q = q.in('payment_method', f.paymentMethod)
  // WEC-590: filter on the real submit time, not the draft's created_at.
  // submitted_at is backfilled for all non-draft rows (wec473) + stamped at
  // submit; the default admin view excludes drafts, so a submitted_at filter is
  // authoritative here.
  if (f.createdFrom) q = q.gte('submitted_at', `${f.createdFrom}T00:00:00Z`)
  if (f.createdTo) q = q.lte('submitted_at', `${f.createdTo}T23:59:59Z`)
  if (orderIdsFromChild) q = q.in('id', Array.from(orderIdsFromChild))
  if (f.search) {
    const s = f.search.trim()
    q = q.or(`order_number.ilike.%${s}%,customer_name.ilike.%${s}%,customer_email.ilike.%${s}%,customer_phone.ilike.%${s}%`)
  }
  q = q.limit(200)
  const { data, error } = await q
  if (error) return { data: null, error: error.message }

  const orderIds = (data ?? []).map((r) => r.id as string)
  if (orderIds.length === 0) return { data: [], error: null }

  // Load child_orders, then items filtered by child_order_id
  const cosRes = await supabase.from('child_orders').select('*').in('order_id', orderIds)
  if (cosRes.error) return { data: null, error: cosRes.error.message }
  const childIds = (cosRes.data ?? []).map((r) => r.id as string)
  const itemsFinal = childIds.length > 0
    ? await supabase.from('order_items').select('*').in('child_order_id', childIds)
    : { data: [] as unknown[], error: null }
  if (itemsFinal.error) return { data: null, error: (itemsFinal.error as { message: string }).message }

  const itemsByChild = new Map<string, AdminOrderItem[]>()
  for (const it of (itemsFinal.data ?? [])) {
    const row = it as {
      id: string; child_order_id: string; dish_id: string | null; variant_id: string | null;
      name_el: string; name_en: string | null; variant_label_el: string | null; variant_label_en: string | null;
      quantity: number; unit_price: number; total_price: number;
      calories: number | null; protein: number | null; carbs: number | null; fat: number | null;
      comment: string | null;
    }
    const arr = itemsByChild.get(row.child_order_id) ?? []
    arr.push({
      id: row.id, childOrderId: row.child_order_id,
      dishId: row.dish_id, variantId: row.variant_id,
      nameEl: row.name_el, nameEn: row.name_en ?? '',
      variantLabelEl: row.variant_label_el ?? '', variantLabelEn: row.variant_label_en ?? '',
      quantity: row.quantity, unitPrice: row.unit_price, totalPrice: row.total_price,
      calories: row.calories ?? 0, protein: row.protein ?? 0, carbs: row.carbs ?? 0, fat: row.fat ?? 0,
      comment: row.comment,
    })
    itemsByChild.set(row.child_order_id, arr)
  }

  const childrenByOrder = new Map<string, AdminChildOrder[]>()
  for (const c of (cosRes.data ?? [])) {
    const row = c as {
      id: string; order_id: string; delivery_date: string;
      time_from: string | null; time_to: string | null;
      address_street: string | null; address_area: string | null; address_zip: string | null; address_floor: string | null;
      cancelled_at: string | null;
    }
    const arr = childrenByOrder.get(row.order_id) ?? []
    arr.push({
      id: row.id, orderId: row.order_id, deliveryDate: row.delivery_date,
      timeFrom: row.time_from, timeTo: row.time_to,
      addressStreet: row.address_street, addressArea: row.address_area,
      addressZip: row.address_zip, addressFloor: row.address_floor,
      cancelledAt: row.cancelled_at,
      items: itemsByChild.get(row.id) ?? [],
    })
    childrenByOrder.set(row.order_id, arr)
  }

  const result: AdminOrder[] = (data ?? []).map((r) => mapOrderRow(r, childrenByOrder.get(r.id as string) ?? [], [], []))
  return { data: result, error: null }
}

export async function getAdminOrder(id: string): Promise<{ data: AdminOrder | null; error: string | null }> {
  const orderRes = await supabase.from('orders').select('*').eq('id', id).single()
  if (orderRes.error) return { data: null, error: orderRes.error.message }

  const [cosRes, vuRes, logRes, plRes, sumRes] = await Promise.all([
    supabase.from('child_orders').select('*').eq('order_id', id).order('delivery_date'),
    supabase.from('voucher_uses').select('*, vouchers(code)').eq('order_id', id),
    supabase.from('admin_change_log').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(50),
    // WEC-171/176 — most recent payment_links row for this order.
    supabase.from('payment_links').select('*').eq('order_id', id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    // WEC-606 — derived payment ledger (paid / remaining / refundable).
    supabase.rpc('order_payment_summary', { p_order_id: id }),
  ])
  if (cosRes.error) return { data: null, error: cosRes.error.message }

  const childIds = (cosRes.data ?? []).map((r) => r.id as string)
  const itemsRes = childIds.length > 0
    ? await supabase.from('order_items').select('*').in('child_order_id', childIds)
    : { data: [] as unknown[], error: null }
  if (itemsRes.error) return { data: null, error: (itemsRes.error as { message: string }).message }

  const itemsByChild = new Map<string, AdminOrderItem[]>()
  for (const it of itemsRes.data ?? []) {
    const row = it as {
      id: string; child_order_id: string; dish_id: string | null; variant_id: string | null;
      name_el: string; name_en: string | null; variant_label_el: string | null; variant_label_en: string | null;
      quantity: number; unit_price: number; total_price: number;
      calories: number | null; protein: number | null; carbs: number | null; fat: number | null;
      comment: string | null;
    }
    const arr = itemsByChild.get(row.child_order_id) ?? []
    arr.push({
      id: row.id, childOrderId: row.child_order_id, dishId: row.dish_id, variantId: row.variant_id,
      nameEl: row.name_el, nameEn: row.name_en ?? '',
      variantLabelEl: row.variant_label_el ?? '', variantLabelEn: row.variant_label_en ?? '',
      quantity: row.quantity, unitPrice: row.unit_price, totalPrice: row.total_price,
      calories: row.calories ?? 0, protein: row.protein ?? 0, carbs: row.carbs ?? 0, fat: row.fat ?? 0,
      comment: row.comment,
    })
    itemsByChild.set(row.child_order_id, arr)
  }

  const childOrders: AdminChildOrder[] = (cosRes.data ?? []).map((c) => {
    const row = c as {
      id: string; order_id: string; delivery_date: string;
      time_from: string | null; time_to: string | null;
      address_street: string | null; address_area: string | null; address_zip: string | null; address_floor: string | null;
      cancelled_at: string | null;
    }
    return {
      id: row.id, orderId: row.order_id, deliveryDate: row.delivery_date,
      timeFrom: row.time_from, timeTo: row.time_to,
      addressStreet: row.address_street, addressArea: row.address_area,
      addressZip: row.address_zip, addressFloor: row.address_floor,
      cancelledAt: row.cancelled_at,
      items: itemsByChild.get(row.id) ?? [],
    }
  })

  const voucherUses: AdminVoucherUse[] = (vuRes.data ?? []).map((v) => {
    const row = v as { id: string; voucher_id: string; amount: number; used_at: string; vouchers: { code: string } | null }
    return {
      id: row.id, voucherId: row.voucher_id, code: row.vouchers?.code ?? '',
      amount: row.amount, usedAt: row.used_at,
    }
  })

  const changeLog: AdminChangeLogEntry[] = (logRes.data ?? []).map((l) => {
    const row = l as {
      id: number; table_name: string; field_name: string;
      old_value: string | null; new_value: string | null;
      label: string | null; admin_user: string | null; created_at: string
    }
    return {
      id: row.id, tableName: row.table_name, fieldName: row.field_name,
      oldValue: row.old_value, newValue: row.new_value,
      label: row.label, adminUser: row.admin_user, createdAt: row.created_at,
    }
  })

  let paymentLink: AdminPaymentLink | null = null
  if (plRes.data) {
    const plRow = plRes.data as {
      id: string
      viva_order_code: string | null
      transaction_id: string | null
      status_id: string | null
      status: 'pending' | 'success' | 'failure'
      payment_url: string | null
      last_verified_at: string | null
      amount: number | null
      created_at: string
      updated_at: string
    }
    paymentLink = {
      id: plRow.id,
      vivaOrderCode: plRow.viva_order_code,
      transactionId: plRow.transaction_id,
      statusId: plRow.status_id,
      status: plRow.status,
      paymentUrl: plRow.payment_url,
      lastVerifiedAt: plRow.last_verified_at,
      amount: plRow.amount ?? null,
      createdAt: plRow.created_at,
      updatedAt: plRow.updated_at,
    }
  }

  // WEC-606: order_payment_summary returns a single row (may arrive as an array).
  const sumRow = (Array.isArray(sumRes.data) ? sumRes.data[0] : sumRes.data) as
    | { total: number; paid: number; refunded: number; remaining: number; refundable: number }
    | undefined
  const payment: OrderPaymentSummary = {
    total: sumRow?.total ?? (orderRes.data as { total?: number }).total ?? 0,
    paid: sumRow?.paid ?? 0,
    refunded: sumRow?.refunded ?? 0,
    remaining: sumRow?.remaining ?? 0,
    refundable: sumRow?.refundable ?? 0,
  }

  return { data: mapOrderRow(orderRes.data, childOrders, voucherUses, changeLog, paymentLink, payment), error: null }
}

function mapOrderRow(r: unknown, childOrders: AdminChildOrder[], voucherUses: AdminVoucherUse[], changeLog: AdminChangeLogEntry[], paymentLink: AdminPaymentLink | null = null, payment: OrderPaymentSummary | null = null): AdminOrder {
  const row = r as {
    id: string; order_number: string; user_id: string | null;
    customer_name: string | null; customer_email: string | null; customer_phone: string | null;
    subtotal: number; discount_amount: number | null; total: number; refund_amount: number | null;
    payment_method: PaymentMethod | null; payment_status: PaymentStatus | null; status: OrderStatus | null;
    cutlery: boolean | null; invoice_type: string | null; invoice_name: string | null; invoice_vat: string | null;
    notes: string | null; admin_order_id: string | null; admin_notes: string | null;
    cancel_reason: string | null;
    created_at: string; submitted_at: string | null; updated_at: string;
  }
  return {
    id: row.id, orderNumber: row.order_number, userId: row.user_id,
    customerName: row.customer_name ?? '', customerEmail: row.customer_email ?? '', customerPhone: row.customer_phone ?? '',
    subtotal: row.subtotal, discountAmount: row.discount_amount ?? 0, total: row.total,
    refundAmount: row.refund_amount ?? 0,
    paymentMethod: row.payment_method, paymentStatus: row.payment_status ?? 'pending',
    status: row.status ?? 'pending',
    cutlery: row.cutlery ?? false, invoiceType: row.invoice_type,
    invoiceName: row.invoice_name, invoiceVat: row.invoice_vat,
    notes: row.notes, adminOrderId: row.admin_order_id, adminNotes: row.admin_notes,
    cancelReason: (row.cancel_reason as string | null) ?? null,
    createdAt: row.created_at, submittedAt: row.submitted_at ?? null, updatedAt: row.updated_at,
    childOrders, voucherUses, changeLog,
    paymentLink,
    // List view doesn't fetch the summary — fall back to a total-only default
    // (the drawer, which is what renders payment UI, always passes the real one).
    payment: payment ?? { total: row.total, paid: 0, refunded: row.refund_amount ?? 0, remaining: row.total, refundable: 0 },
  }
}

// ─── Audit log writer ─────────────────────────────────────────────────────

// WEC-604: this used to fire-and-forget the insert, so a failed audit write was
// invisible — the third silent-failure bug this week (cf. WEC-594, WEC-602).
// Now it ALWAYS console.errors and RETURNS the error, so money-affecting
// callers can fail loudly (e.g. don't delete an item you couldn't log).
async function writeChangeLog(args: {
  orderId?: string; childOrderId?: string; orderItemId?: string | null;
  tableName: string; fieldName: string;
  oldValue: string | null; newValue: string | null;
  label: string; adminUser: string;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('admin_change_log').insert({
    order_id: args.orderId ?? null,
    child_order_id: args.childOrderId ?? null,
    order_item_id: args.orderItemId ?? null,
    table_name: args.tableName,
    field_name: args.fieldName,
    old_value: args.oldValue,
    new_value: args.newValue,
    label: args.label,
    admin_user: args.adminUser,
  })
  if (error) console.error('[writeChangeLog] insert failed:', args.tableName, args.fieldName, error.message)
  return { error: error?.message ?? null }
}

// WEC-603: timeline labels name the dish, variant, qty and the delivery day
// they belonged to, so an admin can read "what changed for this customer"
// without opening the DB. English labels; dish/variant names stay as stored
// (Greek). Each helper is one small read — admin volume, not hot-path.
async function deliveryDayTag(childOrderId: string | null | undefined): Promise<string> {
  if (!childOrderId) return ''
  const { data } = await supabase.from('child_orders').select('delivery_date').eq('id', childOrderId).maybeSingle()
  const iso = (data as { delivery_date: string } | null)?.delivery_date
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' })
}
async function itemDescriptor(itemId: string): Promise<{ nameEl: string; variantLabelEl: string | null; quantity: number } | null> {
  const { data } = await supabase.from('order_items').select('name_el, variant_label_el, quantity').eq('id', itemId).maybeSingle()
  if (!data) return null
  const r = data as { name_el: string; variant_label_el: string | null; quantity: number }
  return { nameEl: r.name_el, variantLabelEl: r.variant_label_el, quantity: r.quantity }
}
function itemPhrase(nameEl: string, variantLabelEl: string | null | undefined, qty: number): string {
  return `${nameEl}${variantLabelEl ? ` (${variantLabelEl})` : ''} ×${qty}`
}
function withDay(base: string, dayTag: string): string {
  return dayTag ? `${base} — ${dayTag}` : base
}

// ─── Status / payment transitions ─────────────────────────────────────────

export async function setOrderStatus(id: string, current: OrderStatus, next: OrderStatus, adminUser: string, note?: string): Promise<{ error: string | null }> {
  // Allow any transition with force, but warn on invalid ones (called from UI)
  // WEC-526: on cancel, persist the (optional) admin reason on the order.
  const patch: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() }
  if (next === 'cancelled') patch.cancel_reason = note && note.trim() ? note.trim() : null
  const { error } = await supabase.from('orders').update(patch).eq('id', id)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId: id, tableName: 'orders', fieldName: 'status',
    oldValue: current, newValue: next, label: note ?? `status: ${current} → ${next}`,
    adminUser,
  })

  // WEC-289: fire Klaviyo "Order Cancelled" transactional email on cancel
  // transition. Server endpoint handles auth, lang lookup, and the Klaviyo
  // call. Fail-soft — never block admin UI on email delivery, and the cancel
  // has already committed at this point.
  if (next === 'cancelled' && current !== 'cancelled') {
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (token) {
        void fetch('/api/notify-order-cancelled', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId: id, reason: note ?? '' }),
        }).catch((e) => console.warn('[setOrderStatus] notify-order-cancelled failed:', e))
      }
    } catch (e) {
      console.warn('[setOrderStatus] notify-order-cancelled threw:', e)
    }
  }

  return { error: null }
}

// WEC-668: inline-editable order fields on the drawer (no separate page). Same
// audit trail (admin_change_log) as every other admin write, and the error is
// returned to the caller so the UI surfaces it (no silent-write repeat of
// WEC-594/602/604).
export async function updateOrderPaymentMethod(id: string, current: PaymentMethod | null, next: PaymentMethod, adminUser: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('orders').update({ payment_method: next, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId: id, tableName: 'orders', fieldName: 'payment_method',
    oldValue: current ?? '', newValue: next, label: `payment method: ${current ?? '—'} → ${next}`,
    adminUser,
  })
  return { error: null }
}

export async function updateOrderCutlery(id: string, current: boolean, next: boolean, adminUser: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('orders').update({ cutlery: next, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId: id, tableName: 'orders', fieldName: 'cutlery',
    oldValue: current ? 'yes' : 'no', newValue: next ? 'yes' : 'no', label: `cutlery: ${next ? 'yes' : 'no'}`,
    adminUser,
  })
  return { error: null }
}

/**
 * WEC-487: admin-triggered "your order has changed" email. Posts to the
 * notify-order-updated function which validates admin, loads the current
 * order state and fires the Klaviyo `Order Updated` event (+ optional
 * admin BCC fan-out from WEC-486).
 *
 * Awaited (unlike notify-order-cancelled which is fire-and-forget) — the
 * admin clicked a button, so they want to know if it actually went out.
 */
export async function sendOrderUpdateEmail(orderId: string): Promise<{ error: string | null }> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    if (!token) return { error: 'Not signed in' }

    const res = await fetch('/api/notify-order-updated', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderId }),
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const j = await res.json() as { error?: string }
        if (j?.error) msg = j.error
      } catch { /* not json */ }
      return { error: msg }
    }
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function setOrderPaymentStatus(id: string, current: PaymentStatus, next: PaymentStatus, adminUser: string): Promise<{ error: string | null }> {
  // WEC-606: this is the MANUAL admin path (Viva/wallet payments update the order
  // directly via markPaid / wallet_debit, never through here). A manual mark-paid
  // counts as collecting the FULL order total at that moment (Ioustinos' decision —
  // not editable), recorded in orders.manual_paid_amount so order_payment_summary
  // has a number for cash / bank-transfer payments and the amount lands on the
  // timeline.
  const patch: Record<string, unknown> = { payment_status: next, updated_at: new Date().toISOString() }
  let paidCents = 0
  if (next === 'paid') {
    // Manual payment TOPS UP to the full total — i.e. it covers whatever a paid
    // link / wallet debit hasn't already. In the common cash case that's the whole
    // total; if a link already paid part, we don't double-count.
    const { data: o } = await supabase.from('orders').select('total').eq('id', id).maybeSingle()
    const total = (o as { total: number } | null)?.total ?? 0
    const { data: linkRows } = await supabase.from('payment_links').select('amount').eq('order_id', id).eq('status', 'success')
    const linksSum = (linkRows ?? []).reduce((s, r) => s + ((r as { amount: number | null }).amount ?? 0), 0)
    const { data: wRows } = await supabase.from('wallet_transactions').select('amount').eq('order_id', id).eq('type', 'debit')
    const walletSum = (wRows ?? []).reduce((s, r) => s + ((r as { amount: number | null }).amount ?? 0), 0)
    paidCents = Math.max(0, total - linksSum - walletSum)
    patch.manual_paid_amount = paidCents
  }
  const { error } = await supabase.from('orders').update(patch).eq('id', id)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId: id, tableName: 'orders', fieldName: 'payment_status',
    oldValue: current, newValue: next,
    label: next === 'paid'
      ? `Marked paid manually — ${(paidCents / 100).toFixed(2)} €`
      : `payment: ${current} → ${next}`,
    adminUser,
  })
  return { error: null }
}

// ─── Order item edits ─────────────────────────────────────────────────────

export async function updateOrderItemQuantity(itemId: string, oldQty: number, newQty: number, orderId: string, childOrderId: string, adminUser: string): Promise<{ error: string | null }> {
  const day = await deliveryDayTag(childOrderId)
  if (newQty <= 0) {
    // WEC-603: capture the dish descriptor BEFORE deleting so the label names it.
    const desc = await itemDescriptor(itemId)
    // WEC-604: log BEFORE the delete, with orderItemId=NULL. The old order was
    // delete-then-log-with-the-deleted-id → 23503 FK violation, silently
    // swallowed → removals never appeared and money rows had no cause. Logging
    // first + null ref (the id has no value once the row is gone) fixes it; and
    // if the log itself fails we bail WITHOUT deleting, so a money-affecting
    // change can never again happen unrecorded.
    const logRes = await writeChangeLog({
      orderId, childOrderId, orderItemId: null,
      tableName: 'order_items', fieldName: 'item',
      oldValue: String(oldQty), newValue: '0 (removed)',
      label: withDay(`Removed: ${desc ? itemPhrase(desc.nameEl, desc.variantLabelEl, oldQty) : 'item'}`, day),
      adminUser,
    })
    if (logRes.error) return { error: `Could not record removal — item not deleted: ${logRes.error}` }
    const { error } = await supabase.from('order_items').delete().eq('id', itemId)
    if (error) return { error: error.message }
    return recomputeOrderTotals(orderId, adminUser)
  }
  // Fetch current unit price to recompute total + name for the label.
  const { data, error: fetchErr } = await supabase.from('order_items').select('unit_price, name_el').eq('id', itemId).single()
  if (fetchErr) return { error: fetchErr.message }
  const unit = (data as { unit_price: number }).unit_price
  const nameEl = (data as { name_el: string }).name_el
  const { error } = await supabase.from('order_items').update({
    quantity: newQty,
    total_price: unit * newQty,
  }).eq('id', itemId)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId, childOrderId, orderItemId: itemId,
    tableName: 'order_items', fieldName: 'quantity',
    oldValue: String(oldQty), newValue: String(newQty),
    label: withDay(`Qty: ${nameEl} ${oldQty} → ${newQty}`, day), adminUser,
  })
  return recomputeOrderTotals(orderId, adminUser)
}

// WEC-390: edit the customer note and the internal admin note on an order.
// Not money-affecting, so allowed in any status. admin_notes is free text for
// kitchen / packaging / management.
export async function updateOrderNotes(
  orderId: string,
  patch: { notes?: string | null; adminNotes?: string | null },
  adminUser: string,
): Promise<{ error: string | null }> {
  const update: Record<string, string | null> = { updated_at: new Date().toISOString() }
  if (patch.notes !== undefined) update.notes = patch.notes
  if (patch.adminNotes !== undefined) update.admin_notes = patch.adminNotes
  const { error } = await supabase.from('orders').update(update).eq('id', orderId)
  if (error) return { error: error.message }
  const isCustomer = patch.notes !== undefined
  await writeChangeLog({
    orderId,
    tableName: 'orders',
    fieldName: isCustomer ? 'notes' : 'admin_notes',
    oldValue: null,
    newValue: (isCustomer ? patch.notes : patch.adminNotes) || '(cleared)',
    label: isCustomer ? 'customer note updated' : 'admin note updated',
    adminUser,
  })
  return { error: null }
}

// WEC-386: change ONLY the variant of an existing order item (very common —
// customer wants a different protein/side size). Re-snapshots label + price +
// macros from the chosen variant, recomputes line + order totals, audit-logs.
export async function updateOrderItemVariant(params: {
  itemId: string
  orderId: string
  childOrderId: string
  quantity: number
  variantId: string
  variantLabelEl: string
  variantLabelEn: string
  unitPrice: number   // cents
  calories: number
  protein: number
  carbs: number
  fat: number
  oldLabel: string
  adminUser: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('order_items').update({
    variant_id: params.variantId,
    variant_label_el: params.variantLabelEl || null,
    variant_label_en: params.variantLabelEn || null,
    unit_price: params.unitPrice,
    total_price: params.unitPrice * params.quantity,
    calories: params.calories ?? null,
    protein: params.protein ?? null,
    carbs: params.carbs ?? null,
    fat: params.fat ?? null,
  }).eq('id', params.itemId)
  if (error) return { error: error.message }
  const vDay = await deliveryDayTag(params.childOrderId)
  const vDesc = await itemDescriptor(params.itemId) // name (variant already updated above)
  await writeChangeLog({
    orderId: params.orderId, childOrderId: params.childOrderId, orderItemId: params.itemId,
    tableName: 'order_items', fieldName: 'variant',
    oldValue: params.oldLabel, newValue: params.variantLabelEl,
    label: withDay(`Variant: ${vDesc?.nameEl ?? ''} ${params.oldLabel || '—'} → ${params.variantLabelEl || '—'}`.trim(), vDay),
    adminUser: params.adminUser,
  })
  return recomputeOrderTotals(params.orderId, params.adminUser)
}

// WEC-389: SOFT-cancel a whole delivery day (child order). Marks cancelled_at
// (keeps the record + items for audit / refund reconciliation). Totals and the
// customer/kitchen views exclude cancelled days; an admin can Restore it. If no
// active (non-cancelled) day remains, the parent order is set to cancelled.
export async function cancelChildOrder(childOrderId: string, orderId: string, adminUser: string): Promise<{ error: string | null }> {
  const { error: coErr } = await supabase
    .from('child_orders')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', childOrderId)
  if (coErr) return { error: coErr.message }
  await writeChangeLog({
    orderId, childOrderId,
    tableName: 'child_orders', fieldName: 'cancelled_at',
    oldValue: null, newValue: 'cancelled',
    label: 'delivery day cancelled', adminUser,
  })
  const { data: active } = await supabase
    .from('child_orders')
    .select('id')
    .eq('order_id', orderId)
    .is('cancelled_at', null)
  if ((active ?? []).length === 0) {
    await supabase.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', orderId)
    await writeChangeLog({
      orderId, tableName: 'orders', fieldName: 'status',
      oldValue: null, newValue: 'cancelled',
      label: 'all days cancelled → order cancelled', adminUser,
    })
  }
  return recomputeOrderTotals(orderId, adminUser)
}

// WEC-389: restore a soft-cancelled day. Clears cancelled_at, recomputes totals,
// and re-opens the parent order if it had been auto-cancelled.
export async function restoreChildOrder(childOrderId: string, orderId: string, adminUser: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('child_orders')
    .update({ cancelled_at: null })
    .eq('id', childOrderId)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId, childOrderId,
    tableName: 'child_orders', fieldName: 'cancelled_at',
    oldValue: 'cancelled', newValue: null,
    label: 'delivery day restored', adminUser,
  })
  const { data: ord } = await supabase.from('orders').select('status').eq('id', orderId).single()
  if ((ord as { status: string } | null)?.status === 'cancelled') {
    await supabase.from('orders').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', orderId)
    await writeChangeLog({
      orderId, tableName: 'orders', fieldName: 'status',
      oldValue: 'cancelled', newValue: 'pending',
      label: 'day restored → order re-opened (pending)', adminUser,
    })
  }
  return recomputeOrderTotals(orderId, adminUser)
}

export async function deleteOrderItem(itemId: string, orderId: string, childOrderId: string, adminUser: string): Promise<{ error: string | null }> {
  // WEC-603: capture descriptor + day BEFORE deleting so the timeline names the dish.
  const day = await deliveryDayTag(childOrderId)
  const desc = await itemDescriptor(itemId)
  // WEC-604: log BEFORE the delete with orderItemId=NULL (see updateOrderItemQuantity).
  // Bail without deleting if the audit write fails — never a silent money change.
  const logRes = await writeChangeLog({
    orderId, childOrderId, orderItemId: null,
    tableName: 'order_items', fieldName: 'item',
    oldValue: null, newValue: 'removed',
    label: withDay(`Removed: ${desc ? itemPhrase(desc.nameEl, desc.variantLabelEl, desc.quantity) : 'item'}`, day),
    adminUser,
  })
  if (logRes.error) return { error: `Could not record removal — item not deleted: ${logRes.error}` }
  const { error } = await supabase.from('order_items').delete().eq('id', itemId)
  if (error) return { error: error.message }
  return recomputeOrderTotals(orderId, adminUser)
}

// WEC-371: add a brand-new line item to an existing order. Snapshots
// name/variant/price/macros exactly like the customer checkout
// (submit-order.ts) so the row is self-contained even if the dish/variant
// later changes. Recomputes order totals; payment is handled manually by the
// admin (balance link if total went up, refund if down).
export async function addOrderItem(params: {
  orderId: string
  childOrderId: string
  dishId: string
  variantId: string
  nameEl: string
  nameEn: string
  variantLabelEl: string
  variantLabelEn: string
  unitPrice: number   // cents
  quantity: number
  calories: number
  protein: number
  carbs: number
  fat: number
  comment?: string | null
  adminUser: string
}): Promise<{ error: string | null }> {
  const qty = Math.max(1, Math.floor(params.quantity || 1))
  const { data, error } = await supabase.from('order_items').insert({
    child_order_id: params.childOrderId,
    dish_id: params.dishId,
    variant_id: params.variantId,
    name_el: params.nameEl,
    name_en: params.nameEn || params.nameEl,
    variant_label_el: params.variantLabelEl || null,
    variant_label_en: params.variantLabelEn || null,
    quantity: qty,
    unit_price: params.unitPrice,
    total_price: params.unitPrice * qty,
    calories: params.calories ?? null,
    protein: params.protein ?? null,
    carbs: params.carbs ?? null,
    fat: params.fat ?? null,
    comment: params.comment?.trim() || null,
  }).select('id').single()
  if (error) return { error: error.message }
  const addDay = await deliveryDayTag(params.childOrderId)
  await writeChangeLog({
    orderId: params.orderId,
    childOrderId: params.childOrderId,
    orderItemId: (data as { id: string }).id,
    tableName: 'order_items',
    fieldName: 'item',
    oldValue: null,
    newValue: itemPhrase(params.nameEl, params.variantLabelEl, qty),
    label: withDay(`Added: ${itemPhrase(params.nameEl, params.variantLabelEl, qty)}`, addDay),
    adminUser: params.adminUser,
  })
  return recomputeOrderTotals(params.orderId, params.adminUser)
}

/**
 * WEC-371: dish ids that appear on the active menu for a given delivery date.
 * Used to badge "on menu today" in the admin add-item picker. Admins can still
 * add off-menu dishes — this is a hint, not a filter.
 */
export async function fetchOnMenuDishIds(date: string): Promise<Set<string>> {
  const { data: menus } = await supabase
    .from('weekly_menus')
    .select('id')
    .eq('active', true)
    .lte('from_date', date)
    .gte('to_date', date)
  const ids = (menus ?? []).map((m) => (m as { id: string }).id)
  if (ids.length === 0) return new Set()
  const { data: mdd } = await supabase
    .from('menu_day_dishes')
    .select('dish_id')
    .eq('date', date)
    .in('menu_id', ids)
  return new Set((mdd ?? []).map((r) => (r as { dish_id: string }).dish_id))
}

async function recomputeOrderTotals(orderId: string, adminUser: string = 'system'): Promise<{ error: string | null }> {
  // Preserve prior behaviour: with NO active child orders (e.g. every delivery
  // day cancelled), don't zero the money — refund reconciliation still needs
  // the order total. Skip the recompute entirely.
  const { data: cos, error: cosErr } = await supabase.from('child_orders').select('id').eq('order_id', orderId).is('cancelled_at', null)
  if (cosErr) return { error: cosErr.message }
  if ((cos ?? []).length === 0) return { error: null }

  // WEC-605: recompute subtotal + voucher discount + total ATOMICALLY in the DB
  // (a pct voucher now tracks the new basket; a voucher below its min_order is
  // dropped; orders + voucher_uses stay in lockstep). Returns old/new for logs.
  const { data, error } = await supabase.rpc('recompute_order_money', { p_order_id: orderId })
  if (error) return { error: error.message }
  const row = (Array.isArray(data) ? data[0] : data) as {
    old_subtotal: number; old_discount: number; old_total: number
    new_subtotal: number; new_discount: number; new_total: number
  } | undefined
  if (!row) return { error: null }

  // WEC-566/603: log each money change; the feed renders the € delta from
  // old/new_value, so the label is just the English field name.
  if (row.new_subtotal !== row.old_subtotal) {
    await writeChangeLog({
      orderId, tableName: 'orders', fieldName: 'subtotal',
      oldValue: String(row.old_subtotal), newValue: String(row.new_subtotal), label: 'Subtotal', adminUser,
    })
  }
  if (row.new_discount !== row.old_discount) {
    await writeChangeLog({
      orderId, tableName: 'orders', fieldName: 'discount_amount',
      oldValue: String(row.old_discount), newValue: String(row.new_discount), label: 'Discount', adminUser,
    })
  }
  if (row.new_total !== row.old_total) {
    await writeChangeLog({
      orderId, tableName: 'orders', fieldName: 'total',
      oldValue: String(row.old_total), newValue: String(row.new_total), label: 'Total', adminUser,
    })
    // WEC-606: if the total changed while money was already collected for a
    // different amount, record a drift warning on the timeline (the drawer also
    // shows a live banner). Fires only on a total change, so no spam.
    const { data: sum } = await supabase.rpc('order_payment_summary', { p_order_id: orderId })
    const s = (Array.isArray(sum) ? sum[0] : sum) as { paid: number } | undefined
    const paid = s?.paid ?? 0
    if (paid > 0 && paid !== row.new_total) {
      await writeChangeLog({
        orderId, tableName: 'orders', fieldName: 'payment_drift',
        oldValue: String(paid), newValue: String(row.new_total),
        label: `⚠ Payment drift — collected ${(paid / 100).toFixed(2)} €, order total now ${(row.new_total / 100).toFixed(2)} €`,
        adminUser,
      })
    }
  }
  return { error: null }
}

// ─── Child-order edits (address + time) ───────────────────────────────────

export async function updateChildOrderAddress(childId: string, orderId: string, patch: { street?: string; area?: string; zip?: string; floor?: string }, adminUser: string): Promise<{ error: string | null }> {
  // WEC-604: capture the OLD address + delivery day so the timeline shows a
  // real before → after with the day, not «address updated» + raw JSON.
  const { data: bRow } = await supabase.from('child_orders').select('address_street, address_area, delivery_date').eq('id', childId).maybeSingle()
  const b = (bRow ?? {}) as { address_street?: string | null; address_area?: string | null; delivery_date?: string }
  const update: Record<string, string | null> = {}
  if (patch.street !== undefined) update.address_street = patch.street || null
  if (patch.area !== undefined) update.address_area = patch.area || null
  if (patch.zip !== undefined) update.address_zip = patch.zip || null
  if (patch.floor !== undefined) update.address_floor = patch.floor || null
  const { error } = await supabase.from('child_orders').update(update).eq('id', childId)
  if (error) return { error: error.message }
  const fmtAddr = (s?: string | null, a?: string | null) => [s, a].filter(Boolean).join(', ') || '—'
  const oldStr = fmtAddr(b.address_street, b.address_area)
  const newStr = fmtAddr(patch.street ?? b.address_street, patch.area ?? b.address_area)
  const day = await deliveryDayTag(childId)
  await writeChangeLog({
    orderId, childOrderId: childId,
    tableName: 'child_orders', fieldName: 'address',
    oldValue: fmtAddr(b.address_street, b.address_area), newValue: JSON.stringify(patch),
    label: withDay(`Address: ${oldStr} → ${newStr}`, day), adminUser,
  })
  return { error: null }
}

export async function updateChildOrderTime(childId: string, orderId: string, timeFrom: string | null, timeTo: string | null, adminUser: string): Promise<{ error: string | null }> {
  // WEC-604: capture OLD slot + day for a readable before → after.
  const { data: bRow } = await supabase.from('child_orders').select('time_from, time_to').eq('id', childId).maybeSingle()
  const b = (bRow ?? {}) as { time_from?: string | null; time_to?: string | null }
  const { error } = await supabase.from('child_orders').update({
    time_from: timeFrom, time_to: timeTo,
  }).eq('id', childId)
  if (error) return { error: error.message }
  const fmtSlot = (f?: string | null, t?: string | null) => (f && t ? `${f.slice(0, 5)}–${t.slice(0, 5)}` : '—')
  const day = await deliveryDayTag(childId)
  await writeChangeLog({
    orderId, childOrderId: childId,
    tableName: 'child_orders', fieldName: 'time',
    oldValue: fmtSlot(b.time_from, b.time_to), newValue: `${timeFrom} — ${timeTo}`,
    label: withDay(`Time: ${fmtSlot(b.time_from, b.time_to)} → ${fmtSlot(timeFrom, timeTo)}`, day), adminUser,
  })
  return { error: null }
}

// ─── Refunds ──────────────────────────────────────────────────────────────

export type RefundKind = 'wallet' | 'viva'

/**
 * Refund an order.
 *
 * - `wallet` — credit the customer's wallet. Pure DB operation (no money moves
 *   through a payment network). For any method that doesn't have a Viva tx,
 *   or when the admin wants to compensate regardless of how they paid.
 * - `viva`   — real Viva refund via the `/api/viva-refund` Netlify Function.
 *   Only valid on orders paid with `card` / `link` that have a transaction_id.
 *
 * WEC-175: Viva path now calls the real API. WEC-177: aligns with the
 * unified payment semantics (full refund → `payment_status = 'refunded'`).
 */
export async function refundOrder(
  order: AdminOrder,
  refundType: RefundKind,
  amountCents: number,
  adminUser: string,
  reason: string = '',
): Promise<{ error: string | null }> {
  if (amountCents <= 0) return { error: 'Refund amount must be > 0' }
  // WEC-608: ceiling is actually-collected − already-refunded, not order.total.
  if (amountCents > order.payment.refundable) {
    return { error: 'Refund exceeds remaining refundable balance' }
  }

  if (refundType === 'viva') {
    if (!reason.trim()) return { error: 'Reason is required for Viva refunds' }
    const { data: session } = await supabase.auth.getSession()
    const token = session?.session?.access_token
    if (!token) return { error: 'Not authenticated' }

    const res = await fetch('/api/viva-refund', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderId: order.id, amountCents, reason }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { error: (json as { error?: string }).error ?? `Refund failed (${res.status})` }
    // Server wrote orders.refund_amount + admin_change_log + flipped status.
    return { error: null }
  }

  // refundType === 'wallet'
  if (!order.userId) return { error: 'Cannot refund to wallet — order has no linked customer.' }

  const { data: walletRow } = await supabase.from('wallets').select('*').eq('user_id', order.userId).maybeSingle()
  let walletId: string
  let currentBalance = 0
  let currentBonus = 0
  if (walletRow) {
    walletId = (walletRow as { id: string; balance: number }).id
    currentBalance = (walletRow as { balance: number }).balance
    currentBonus = (walletRow as { bonus_balance: number }).bonus_balance
  } else {
    const { data: created, error: walletErr } = await supabase
      .from('wallets')
      .insert({ user_id: order.userId, balance: 0, base_balance: 0, bonus_balance: 0, active: true })
      .select('*')
      .single()
    if (walletErr) return { error: walletErr.message }
    walletId = (created as { id: string }).id
  }
  const { error: txErr } = await supabase.from('wallet_transactions').insert({
    wallet_id: walletId,
    type: 'refund',
    amount: amountCents,
    description_el: `Επιστροφή για παραγγελία ${order.orderNumber}`,
    description_en: `Refund for order ${order.orderNumber}`,
    order_id: order.id,
  })
  if (txErr) return { error: txErr.message }
  const { error: balErr } = await supabase
    .from('wallets')
    // WEC-208: refunds are bonus credit (per convention) — increment bonus_balance
    // alongside balance so balance = base_balance + bonus_balance stays consistent.
    .update({ balance: currentBalance + amountCents, bonus_balance: currentBonus + amountCents })
    .eq('id', walletId)
  if (balErr) return { error: balErr.message }

  // Update orders.refund_amount + flip status if fully refunded.
  // WEC-608: fully refunded ⇔ refunds ≥ actually collected, not ≥ order.total.
  const newRefund = (order.refundAmount ?? 0) + amountCents
  const isFull = newRefund >= order.payment.paid
  const updates: Record<string, unknown> = {
    refund_amount: newRefund,
    updated_at: new Date().toISOString(),
  }
  if (isFull) updates.payment_status = 'refunded'
  const { error: psErr } = await supabase.from('orders').update(updates).eq('id', order.id)
  if (psErr) return { error: psErr.message }

  await writeChangeLog({
    orderId: order.id,
    tableName: 'orders', fieldName: 'refund_amount',
    oldValue: String(order.refundAmount ?? 0), newValue: String(newRefund),
    label: `wallet refund ${(amountCents / 100).toFixed(2)} €${reason ? ` — ${reason}` : ''}`, adminUser,
  })
  return { error: null }
}

// ─── Payment link (WEC-176) ──────────────────────────────────────────────

export async function regenerateVivaPaymentLink(orderId: string, amountCents?: number, allowOverAmount?: boolean): Promise<{ data: { orderCode: string; paymentUrl: string } | null; error: string | null }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  if (!token) return { data: null, error: 'Not authenticated' }

  const res = await fetch('/api/viva-regenerate-link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // WEC-607: admin-chosen amount (cents); omitted → server uses total.
    // WEC-678: allowOverAmount carries the "charge more than remaining" tick to
    // the server, which is the only place that can actually permit an overcharge.
    body: JSON.stringify({
      orderId,
      ...(amountCents != null ? { amountCents } : {}),
      ...(allowOverAmount ? { allowOverAmount: true } : {}),
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { data: null, error: (json as { error?: string }).error ?? `Regenerate failed (${res.status})` }
  return { data: json as { orderCode: string; paymentUrl: string }, error: null }
}

/**
 * WEC-598: generate/regenerate a payment link AND record it on the order
 * timeline. `firstTime` distinguishes the first send ("Payment link sent") from
 * a re-issue ("Payment link regenerated") — WEC-581's mislabel bug. The log is
 * best-effort: a link that generated but failed to log is still a live link, so
 * we don't fail the whole action on a logging error.
 */
export async function sendPaymentLinkLogged(
  orderId: string,
  adminUser: string,
  firstTime: boolean,
  amountCents?: number,
  allowOverAmount?: boolean,
): Promise<{ data: { orderCode: string; paymentUrl: string } | null; error: string | null }> {
  const res = await regenerateVivaPaymentLink(orderId, amountCents, allowOverAmount)
  if (res.error || !res.data) return res
  // WEC-604: no hardcoded local time in the label — the feed's When column
  // already shows the timestamp. WEC-607: state the link amount.
  const amtLabel = amountCents != null ? ` — ${(amountCents / 100).toFixed(2)} €` : ''
  await writeChangeLog({
    orderId,
    tableName: 'payment_links',
    fieldName: 'payment_url',
    oldValue: null,
    newValue: res.data.orderCode,
    label: (firstTime ? 'Payment link sent' : 'Payment link regenerated') + amtLabel,
    adminUser,
  })
  return res
}

// ─── Admin-place-order (V1 stub) ─────────────────────────────────────────
//
// Full admin-placed-order flow (customer search + cart building + checkout)
// needs the whole customer cart UI. V1 ships a shell that redirects admin to
// the customer site to place the order while signed in as that customer.
// Tracked as a V2 follow-up.
