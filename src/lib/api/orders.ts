import { supabase } from '../supabase'

// ─── DB row shapes ───────────────────────────────────────────────────────────

interface DbOrder {
  id: string
  order_number: string
  user_id: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  subtotal: number           // cents
  discount_amount: number    // cents
  total: number              // cents
  payment_method: string
  payment_status: string
  status: string
  cutlery: boolean
  invoice_type: string | null
  invoice_name: string | null
  invoice_vat: string | null
  notes: string | null
  created_at: string
}

interface DbChildOrder {
  id: string
  order_id: string
  delivery_date: string
  time_from: string | null
  time_to: string | null
  address_street: string
  address_area: string
  address_zip: string | null
  address_floor: string | null
}

interface DbOrderItem {
  id: string
  child_order_id: string
  dish_id: string
  variant_id: string
  name_el: string
  name_en: string
  variant_label_el: string | null
  variant_label_en: string | null
  quantity: number
  unit_price: number         // cents
  total_price: number        // cents
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  comment: string | null
}

// ─── Frontend order shape (matches current useAuthStore mock) ────────────────

export interface OrderHistoryItem {
  id: string                 // order_number
  date: string               // created_at ISO
  statusEl: string
  statusEn: string
  status: string             // raw enum
  total: number              // euros
  paymentEl: string
  paymentEn: string
  childOrders: ChildOrderView[]
}

export interface ChildOrderView {
  /** Raw YYYY-MM-DD delivery date. Needed by the goals-history tab
   *  (WEC-168) to bucket intake per day and classify future deliveries
   *  as forecast. */
  deliveryDate: string
  dayLabel: string
  dayLabelEn: string
  address: string
  timeSlot: string
  subtotal: number           // euros
  macros: { cal: number; protein: number; carbs: number; fat: number }
  items: OrderItemView[]
}

export interface OrderItemView {
  nameEl: string
  nameEn: string
  variantDetail: string
  variant: string
  qty: number
  price: number              // euros (unit price)
  macros: { cal: number; protein: number; carbs: number; fat: number }
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

const centsToEuros = (cents: number): number => +(cents / 100).toFixed(2)

const STATUS_LABELS: Record<string, { el: string; en: string }> = {
  pending:     { el: 'Εκκρεμεί', en: 'Pending' },
  confirmed:   { el: 'Επιβεβαιωμένη', en: 'Confirmed' },
  preparing:   { el: 'Ετοιμάζεται', en: 'Preparing' },
  delivering:  { el: 'Παραδίδεται', en: 'Delivering' },
  delivered:   { el: 'Παραδόθηκε', en: 'Delivered' },
  cancelled:   { el: 'Ακυρώθηκε', en: 'Cancelled' },
}

const PAYMENT_LABELS: Record<string, { el: string; en: string }> = {
  cash:     { el: 'Μετρητά', en: 'Cash' },
  card:     { el: 'Κάρτα', en: 'Card' },
  link:     { el: 'Link πληρωμής', en: 'Payment Link' },
  transfer: { el: 'Μεταφορά', en: 'Transfer' },
  wallet:   { el: 'Πορτοφόλι', en: 'Wallet' },
}

const fmtTimeSlot = (from: string | null, to: string | null): string => {
  if (!from || !to) return ''
  const f = from.split(':').slice(0, 2)
  const t = to.split(':').slice(0, 2)
  return `${parseInt(f[0])}:${f[1]}–${parseInt(t[0])}:${t[1]}`
}

const fmtDayLabel = (dateStr: string, lang: 'el' | 'en'): string => {
  const d = new Date(dateStr + 'T00:00:00')
  const locale = lang === 'el' ? 'el-GR' : 'en-US'
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' })
  const day = d.getDate()
  const month = d.toLocaleDateString(locale, { month: 'short' })
  return `${weekday} ${day} ${month}`
}

const fmtAddress = (row: DbChildOrder): string => {
  const parts = [row.address_street]
  if (row.address_zip) parts.push(row.address_zip)
  parts.push(row.address_area)
  return parts.join(', ')
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch order history for a user, newest first.
 * Includes child orders and their items.
 */
export async function fetchUserOrders(userId: string): Promise<{
  data: OrderHistoryItem[] | null
  error: string | null
}> {
  // 1. Orders
  const { data: rawOrders, error: oErr } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (oErr) return { data: null, error: oErr.message }
  if (!rawOrders || rawOrders.length === 0) return { data: [], error: null }

  const orders = rawOrders as DbOrder[]
  const orderIds = orders.map((o) => o.id)

  // 2. Child orders
  const { data: rawChildren, error: cErr } = await supabase
    .from('child_orders')
    .select('*')
    .in('order_id', orderIds)
    .order('delivery_date')

  if (cErr) return { data: null, error: cErr.message }
  const children = (rawChildren ?? []) as DbChildOrder[]

  // 3. Order items
  const childIds = children.map((c) => c.id)
  let items: DbOrderItem[] = []
  if (childIds.length > 0) {
    const { data: rawItems, error: iErr } = await supabase
      .from('order_items')
      .select('*')
      .in('child_order_id', childIds)

    if (iErr) return { data: null, error: iErr.message }
    items = (rawItems ?? []) as DbOrderItem[]
  }

  // Build lookup maps
  const itemsByChild = new Map<string, DbOrderItem[]>()
  for (const it of items) {
    const list = itemsByChild.get(it.child_order_id) ?? []
    list.push(it)
    itemsByChild.set(it.child_order_id, list)
  }

  const childrenByOrder = new Map<string, DbChildOrder[]>()
  for (const ch of children) {
    const list = childrenByOrder.get(ch.order_id) ?? []
    list.push(ch)
    childrenByOrder.set(ch.order_id, list)
  }

  // Assemble
  const result: OrderHistoryItem[] = orders.map((o) => {
    const oChildren = childrenByOrder.get(o.id) ?? []

    const childViews: ChildOrderView[] = oChildren.map((ch) => {
      const chItems = itemsByChild.get(ch.id) ?? []

      const itemViews: OrderItemView[] = chItems.map((it) => ({
        nameEl: it.name_el,
        nameEn: it.name_en,
        variantDetail: it.variant_label_el ?? '',
        variant: it.variant_label_en ?? '',
        qty: it.quantity,
        price: centsToEuros(it.unit_price),
        macros: {
          cal: it.calories ?? 0,
          protein: it.protein ?? 0,
          carbs: it.carbs ?? 0,
          fat: it.fat ?? 0,
        },
      }))

      const subtotal = chItems.reduce((s, it) => s + it.total_price, 0)
      const macros = chItems.reduce(
        (acc, it) => ({
          cal: acc.cal + (it.calories ?? 0) * it.quantity,
          protein: acc.protein + (it.protein ?? 0) * it.quantity,
          carbs: acc.carbs + (it.carbs ?? 0) * it.quantity,
          fat: acc.fat + (it.fat ?? 0) * it.quantity,
        }),
        { cal: 0, protein: 0, carbs: 0, fat: 0 },
      )

      return {
        deliveryDate: ch.delivery_date,
        dayLabel: fmtDayLabel(ch.delivery_date, 'el'),
        dayLabelEn: fmtDayLabel(ch.delivery_date, 'en'),
        address: fmtAddress(ch),
        timeSlot: fmtTimeSlot(ch.time_from, ch.time_to),
        subtotal: centsToEuros(subtotal),
        macros,
        items: itemViews,
      }
    })

    const sLabel = STATUS_LABELS[o.status] ?? { el: o.status, en: o.status }
    const pLabel = PAYMENT_LABELS[o.payment_method] ?? { el: o.payment_method, en: o.payment_method }

    return {
      id: o.order_number,
      date: o.created_at,
      statusEl: sLabel.el,
      statusEn: sLabel.en,
      status: o.status === 'delivered' ? 'completed' : o.status === 'cancelled' ? 'cancelled' : 'active',
      total: centsToEuros(o.total),
      paymentEl: pLabel.el,
      paymentEn: pLabel.en,
      childOrders: childViews,
    }
  })

  return { data: result, error: null }
}

// ─── Order submission types ──────────────────────────────────────────────────

export interface SubmitOrderPayload {
  userId?: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  paymentMethod: 'cash' | 'card' | 'link' | 'transfer' | 'wallet'
  cutlery: boolean
  invoiceType?: string
  invoiceName?: string
  invoiceVat?: string
  notes?: string
  voucherCode?: string
  days: SubmitDayPayload[]
  /**
   * Admin impersonation: when set, the order is filed under this customer's
   * user_id, with the admin's id stored in `admin_order_id`. Server-side
   * verifies the caller is admin via JWT before honouring this field.
   */
  impersonateUserId?: string
}

export interface SubmitDayPayload {
  deliveryDate: string       // ISO date
  timeFrom: string           // HH:MM
  timeTo: string
  addressStreet: string
  addressArea: string
  addressZip?: string
  addressFloor?: string
  items: SubmitItemPayload[]
}

export interface SubmitItemPayload {
  dishId: string
  variantId: string
  quantity: number
  comment?: string
}

/**
 * Submit an order via the Netlify function.
 * The actual insertion + validation happens server-side.
 */
export async function submitOrder(payload: SubmitOrderPayload): Promise<{
  data: {
    orderNumber: string
    orderId: string
    /** Viva-hosted checkout URL for card/link methods. Null for cash/transfer/wallet. */
    paymentUrl?: string | null
    /** True if we created the order row but the Viva call failed. Admin must regenerate. */
    paymentSetupFailed?: boolean
  } | null
  error: string | null
  validationErrors?: Record<string, string[]>
}> {
  try {
    // Get auth token if logged in
    const { data: session } = await supabase.auth.getSession()
    const token = session?.session?.access_token

    const res = await fetch('/api/submit-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    const json = await res.json()

    if (!res.ok) {
      return {
        data: null,
        error: json.error ?? `Order failed (${res.status})`,
        validationErrors: json.validationErrors,
      }
    }

    return {
      data: {
        orderNumber: json.orderNumber,
        orderId: json.orderId,
        paymentUrl: json.paymentUrl ?? null,
        paymentSetupFailed: json.paymentSetupFailed ?? false,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Network error' }
  }
}
