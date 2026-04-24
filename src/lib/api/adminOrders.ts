import { supabase } from '../supabase'

// ─── Enum values (mirror DB) ──────────────────────────────────────────────

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'delivering' | 'delivered' | 'cancelled'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type PaymentMethod = 'cash' | 'card' | 'link' | 'transfer' | 'wallet'

export const ORDER_STATUS_VALUES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'delivering', 'delivered', 'cancelled']
export const PAYMENT_STATUS_VALUES: PaymentStatus[] = ['pending', 'paid', 'failed', 'refunded']

/** Valid forward transitions for order status (admin can always force-cancel). */
export const VALID_NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
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
  createdAt: string
  updatedAt: string
  childOrders: AdminChildOrder[]
  voucherUses: AdminVoucherUse[]
  changeLog: AdminChangeLogEntry[]
  /** WEC-171/176: Viva payment link (null for non-Viva orders). */
  paymentLink: AdminPaymentLink | null
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
  createdAt: string
  updatedAt: string
}

// ─── Filters ──────────────────────────────────────────────────────────────

export interface OrderFilters {
  search?: string            // substring of order_number / customer name / email / phone
  status?: OrderStatus[]
  paymentStatus?: PaymentStatus[]
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
  if (f.status && f.status.length) q = q.in('status', f.status)
  if (f.paymentStatus && f.paymentStatus.length) q = q.in('payment_status', f.paymentStatus)
  if (f.createdFrom) q = q.gte('created_at', `${f.createdFrom}T00:00:00Z`)
  if (f.createdTo) q = q.lte('created_at', `${f.createdTo}T23:59:59Z`)
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
    }
    const arr = childrenByOrder.get(row.order_id) ?? []
    arr.push({
      id: row.id, orderId: row.order_id, deliveryDate: row.delivery_date,
      timeFrom: row.time_from, timeTo: row.time_to,
      addressStreet: row.address_street, addressArea: row.address_area,
      addressZip: row.address_zip, addressFloor: row.address_floor,
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

  const [cosRes, vuRes, logRes, plRes] = await Promise.all([
    supabase.from('child_orders').select('*').eq('order_id', id).order('delivery_date'),
    supabase.from('voucher_uses').select('*, vouchers(code)').eq('order_id', id),
    supabase.from('admin_change_log').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(50),
    // WEC-171/176 — most recent payment_links row for this order.
    supabase.from('payment_links').select('*').eq('order_id', id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
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
    }
    return {
      id: row.id, orderId: row.order_id, deliveryDate: row.delivery_date,
      timeFrom: row.time_from, timeTo: row.time_to,
      addressStreet: row.address_street, addressArea: row.address_area,
      addressZip: row.address_zip, addressFloor: row.address_floor,
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
      createdAt: plRow.created_at,
      updatedAt: plRow.updated_at,
    }
  }

  return { data: mapOrderRow(orderRes.data, childOrders, voucherUses, changeLog, paymentLink), error: null }
}

function mapOrderRow(r: unknown, childOrders: AdminChildOrder[], voucherUses: AdminVoucherUse[], changeLog: AdminChangeLogEntry[], paymentLink: AdminPaymentLink | null = null): AdminOrder {
  const row = r as {
    id: string; order_number: string; user_id: string | null;
    customer_name: string | null; customer_email: string | null; customer_phone: string | null;
    subtotal: number; discount_amount: number | null; total: number; refund_amount: number | null;
    payment_method: PaymentMethod | null; payment_status: PaymentStatus | null; status: OrderStatus | null;
    cutlery: boolean | null; invoice_type: string | null; invoice_name: string | null; invoice_vat: string | null;
    notes: string | null; admin_order_id: string | null; admin_notes: string | null;
    created_at: string; updated_at: string;
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
    createdAt: row.created_at, updatedAt: row.updated_at,
    childOrders, voucherUses, changeLog,
    paymentLink,
  }
}

// ─── Audit log writer ─────────────────────────────────────────────────────

async function writeChangeLog(args: {
  orderId?: string; childOrderId?: string; orderItemId?: string;
  tableName: string; fieldName: string;
  oldValue: string | null; newValue: string | null;
  label: string; adminUser: string;
}) {
  await supabase.from('admin_change_log').insert({
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
}

// ─── Status / payment transitions ─────────────────────────────────────────

export async function setOrderStatus(id: string, current: OrderStatus, next: OrderStatus, adminUser: string, note?: string): Promise<{ error: string | null }> {
  // Allow any transition with force, but warn on invalid ones (called from UI)
  const { error } = await supabase.from('orders').update({ status: next, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId: id, tableName: 'orders', fieldName: 'status',
    oldValue: current, newValue: next, label: note ?? `status: ${current} → ${next}`,
    adminUser,
  })
  return { error: null }
}

export async function setOrderPaymentStatus(id: string, current: PaymentStatus, next: PaymentStatus, adminUser: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('orders').update({ payment_status: next, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId: id, tableName: 'orders', fieldName: 'payment_status',
    oldValue: current, newValue: next, label: `payment: ${current} → ${next}`,
    adminUser,
  })
  return { error: null }
}

// ─── Order item edits ─────────────────────────────────────────────────────

export async function updateOrderItemQuantity(itemId: string, oldQty: number, newQty: number, orderId: string, childOrderId: string, adminUser: string): Promise<{ error: string | null }> {
  if (newQty <= 0) {
    // Delete item
    const { error } = await supabase.from('order_items').delete().eq('id', itemId)
    if (error) return { error: error.message }
    await writeChangeLog({
      orderId, childOrderId, orderItemId: itemId,
      tableName: 'order_items', fieldName: 'quantity',
      oldValue: String(oldQty), newValue: '0 (removed)',
      label: 'item removed', adminUser,
    })
    return recomputeOrderTotals(orderId)
  }
  // Fetch current unit price to recompute total
  const { data, error: fetchErr } = await supabase.from('order_items').select('unit_price').eq('id', itemId).single()
  if (fetchErr) return { error: fetchErr.message }
  const unit = (data as { unit_price: number }).unit_price
  const { error } = await supabase.from('order_items').update({
    quantity: newQty,
    total_price: unit * newQty,
  }).eq('id', itemId)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId, childOrderId, orderItemId: itemId,
    tableName: 'order_items', fieldName: 'quantity',
    oldValue: String(oldQty), newValue: String(newQty),
    label: `qty ${oldQty} → ${newQty}`, adminUser,
  })
  return recomputeOrderTotals(orderId)
}

export async function deleteOrderItem(itemId: string, orderId: string, childOrderId: string, adminUser: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('order_items').delete().eq('id', itemId)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId, childOrderId, orderItemId: itemId,
    tableName: 'order_items', fieldName: 'quantity',
    oldValue: null, newValue: 'removed',
    label: 'item removed', adminUser,
  })
  return recomputeOrderTotals(orderId)
}

async function recomputeOrderTotals(orderId: string): Promise<{ error: string | null }> {
  const { data: cos, error: cosErr } = await supabase.from('child_orders').select('id').eq('order_id', orderId)
  if (cosErr) return { error: cosErr.message }
  const cIds = (cos ?? []).map((r) => r.id as string)
  if (cIds.length === 0) return { error: null }
  const { data: items, error: itErr } = await supabase.from('order_items').select('total_price').in('child_order_id', cIds)
  if (itErr) return { error: itErr.message }
  const subtotal = (items ?? []).reduce((s, r) => s + ((r as { total_price: number }).total_price ?? 0), 0)
  // Keep existing discount — admin should refund rather than retroactively discount
  const { data: ord, error: oErr } = await supabase.from('orders').select('discount_amount').eq('id', orderId).single()
  if (oErr) return { error: oErr.message }
  const discount = ((ord as { discount_amount: number | null }).discount_amount ?? 0)
  const total = Math.max(0, subtotal - discount)
  const { error } = await supabase.from('orders').update({
    subtotal, total, updated_at: new Date().toISOString(),
  }).eq('id', orderId)
  return { error: error?.message ?? null }
}

// ─── Child-order edits (address + time) ───────────────────────────────────

export async function updateChildOrderAddress(childId: string, orderId: string, patch: { street?: string; area?: string; zip?: string; floor?: string }, adminUser: string): Promise<{ error: string | null }> {
  const update: Record<string, string | null> = {}
  if (patch.street !== undefined) update.address_street = patch.street || null
  if (patch.area !== undefined) update.address_area = patch.area || null
  if (patch.zip !== undefined) update.address_zip = patch.zip || null
  if (patch.floor !== undefined) update.address_floor = patch.floor || null
  const { error } = await supabase.from('child_orders').update(update).eq('id', childId)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId, childOrderId: childId,
    tableName: 'child_orders', fieldName: 'address',
    oldValue: null, newValue: JSON.stringify(patch),
    label: 'address updated', adminUser,
  })
  return { error: null }
}

export async function updateChildOrderTime(childId: string, orderId: string, timeFrom: string | null, timeTo: string | null, adminUser: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('child_orders').update({
    time_from: timeFrom, time_to: timeTo,
  }).eq('id', childId)
  if (error) return { error: error.message }
  await writeChangeLog({
    orderId, childOrderId: childId,
    tableName: 'child_orders', fieldName: 'time',
    oldValue: null, newValue: `${timeFrom} — ${timeTo}`,
    label: 'time window updated', adminUser,
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
  if (amountCents > order.total - (order.refundAmount ?? 0)) {
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
  if (walletRow) {
    walletId = (walletRow as { id: string; balance: number }).id
    currentBalance = (walletRow as { balance: number }).balance
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
    .update({ balance: currentBalance + amountCents })
    .eq('id', walletId)
  if (balErr) return { error: balErr.message }

  // Update orders.refund_amount + flip status if fully refunded.
  const newRefund = (order.refundAmount ?? 0) + amountCents
  const isFull = newRefund >= order.total
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
    label: `wallet refund €${(amountCents / 100).toFixed(2)}${reason ? ` — ${reason}` : ''}`, adminUser,
  })
  return { error: null }
}

// ─── Payment link (WEC-176) ──────────────────────────────────────────────

export async function regenerateVivaPaymentLink(orderId: string): Promise<{ data: { orderCode: string; paymentUrl: string } | null; error: string | null }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  if (!token) return { data: null, error: 'Not authenticated' }

  const res = await fetch('/api/viva-regenerate-link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { data: null, error: (json as { error?: string }).error ?? `Regenerate failed (${res.status})` }
  return { data: json as { orderCode: string; paymentUrl: string }, error: null }
}

// ─── Admin-place-order (V1 stub) ─────────────────────────────────────────
//
// Full admin-placed-order flow (customer search + cart building + checkout)
// needs the whole customer cart UI. V1 ships a shell that redirects admin to
// the customer site to place the order while signed in as that customer.
// Tracked as a V2 follow-up.
