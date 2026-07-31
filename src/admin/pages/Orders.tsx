import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import {
  listAdminOrders, getAdminOrder,
  setOrderStatus, setOrderPaymentStatus,
  updateOrderItemQuantity, updateChildOrderAddress, updateChildOrderTime,
  refundOrder, regenerateVivaPaymentLink,
  sendOrderUpdateEmail,
  addOrderItem, fetchOnMenuDishIds,
  updateOrderItemVariant, cancelChildOrder, restoreChildOrder, updateOrderNotes,
  ORDER_STATUS_VALUES, PAYMENT_STATUS_VALUES, VALID_NEXT_STATUS,
  type AdminOrder, type AdminChildOrder, type AdminOrderItem,
  type OrderFilters, type OrderStatus, type PaymentStatus,
  type PaymentMethod,
  type RefundKind,
} from '../../lib/api/adminOrders'
import { fetchAdminDishes, type AdminDish } from '../../lib/api/adminDishes'
import { foldGreek } from '../../lib/text'
// WEC-528: shared Order Type classifier (same module the Airtable push uses)
import { orderTypeCode, ORDER_TYPE_LABELS, type OrderTypeCode } from '../../lib/orderType'
// WEC-577/499: single source of truth for payment-method labels
import { paymentShort, PAYMENT_METHOD_IDS } from '../../lib/paymentMethods'

const STATUS_COLOURS: Record<OrderStatus, string> = {
  // WEC-420: draft uses the same warm orange as the in-drawer banner so the
  // list row, the badge and the banner all read as "this isn't a real order
  // yet" without the admin having to read the word.
  draft: '#f97316',
  pending: '#f59e0b', confirmed: '#3b82f6', preparing: '#8b5cf6',
  delivering: '#14b8a6', delivered: '#10b981', cancelled: '#ef4444',
}
const PAYMENT_COLOURS: Record<PaymentStatus, string> = {
  pending: '#f59e0b', paid: '#10b981', failed: '#ef4444', refunded: '#6b7280',
}

// WEC-370: only pending + confirmed are in active use for now. Cancel stays
// available everywhere. The rest of the lifecycle (preparing/delivering/
// delivered) stays defined in adminOrders.ts so it can be switched back on later.
const ENABLED_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'delivered']
const STATUS_FILTER_VALUES: OrderStatus[] = ORDER_STATUS_VALUES.filter(
  (s) => ENABLED_STATUSES.includes(s) || s === 'cancelled',
)

/** WEC-372/393: pending ⇄ confirmed plus deliver / cancel. Confirmed → Pending
 *  lets an admin unlock an order to edit it; Confirmed → Delivered will also be
 *  set in bulk later (bike-load script). Legacy statuses fall back to the map. */
function offeredTransitions(status: OrderStatus): OrderStatus[] {
  if (status === 'pending') return ['confirmed', 'cancelled']
  if (status === 'confirmed') return ['pending', 'delivered', 'cancelled']
  if (status === 'delivered') return ['confirmed', 'cancelled']
  return VALID_NEXT_STATUS[status].filter((n) => ENABLED_STATUSES.includes(n) || n === 'cancelled')
}

// WEC-393: action-verb labels for status buttons (coloured by target status).
// WEC-420: no transition INTO a draft is offered by offeredTransitions(),
// so the 'draft' label is only here to satisfy the Record<OrderStatus,string>
// type — it should never be rendered.
const TRANSITION_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  pending: 'Make Pending',
  confirmed: 'Confirm',
  preparing: 'Mark Preparing',
  delivering: 'Mark Delivering',
  delivered: 'Mark Delivered',
  cancelled: 'Cancel',
}

type Preset = 'all' | 'today' | 'pending-payment' | 'this-week' | 'drafts'

export function Orders() {
  const user = useAuthStore((s) => s.user)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminOrder | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [preset, setPreset] = useState<Preset>('all')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<OrderStatus[]>([])
  const [filterPayment, setFilterPayment] = useState<PaymentStatus[]>([])
  // WEC-577: raw payment METHOD filter — server-side (mirrors paymentStatus).
  const [filterMethod, setFilterMethod] = useState<PaymentMethod[]>([])
  // WEC-528: Order Type is DERIVED (payment_method × admin_order_id), no DB
  // column — so this filter is applied client-side on the loaded list.
  const [filterType, setFilterType] = useState<OrderTypeCode[]>([])

  async function refresh() {
    setLoading(true); setErr(null)
    const filters: OrderFilters = { search: search.trim() || undefined }
    // WEC-420: Drafts tab. Forces status=['draft'] (overriding any user-picked
    // Status filter for this tab); other presets default-exclude drafts via
    // the API's neq guard (WEC-419).
    if (preset === 'drafts') {
      filters.status = ['draft']
    } else if (filterStatus.length) {
      filters.status = filterStatus
    }
    if (filterPayment.length) filters.paymentStatus = filterPayment
    if (filterMethod.length) filters.paymentMethod = filterMethod
    const today = new Date().toISOString().slice(0, 10)
    if (preset === 'today') { filters.deliveryDateFrom = today; filters.deliveryDateTo = today }
    if (preset === 'this-week') {
      const mondayOffset = (new Date().getDay() + 6) % 7
      const mon = new Date(Date.now() - mondayOffset * 86_400_000).toISOString().slice(0, 10)
      const sun = new Date(Date.now() + (6 - mondayOffset) * 86_400_000).toISOString().slice(0, 10)
      filters.deliveryDateFrom = mon; filters.deliveryDateTo = sun
    }
    if (preset === 'pending-payment') { filters.paymentStatus = ['pending'] }
    const { data, error } = await listAdminOrders(filters)
    if (error) setErr(error)
    setOrders(data ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [preset, filterStatus.join(','), filterPayment.join(','), filterMethod.join(',')])

  async function refreshDetail(id: string) {
    setDetailLoading(true)
    const { data, error } = await getAdminOrder(id)
    if (error) setErr(error)
    setDetail(data)
    setDetailLoading(false)
  }

  async function openDetail(id: string) {
    setSelectedId(id)
    refreshDetail(id)
  }
  function closeDetail() { setSelectedId(null); setDetail(null) }

  // WEC-528: client-side Order Type filter (derived classification).
  const visibleOrders = filterType.length
    ? orders.filter((o) => filterType.includes(orderTypeCode(o.paymentMethod, o.adminOrderId)))
    : orders

  const totalLoaded = visibleOrders.length

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Orders</h1>
          <p className="admin-page-sub">{totalLoaded} orders loaded.</p>
        </div>
      </div>

      {/* Preset filter pills */}
      <div className="admin-pill-row">
        {([
          { k: 'all', label: 'All' },
          { k: 'today', label: "Today's deliveries" },
          { k: 'this-week', label: 'This week' },
          { k: 'pending-payment', label: 'Pending payment' },
          // WEC-420: Drafts tab — in-progress checkouts that haven't been
          // submitted yet. Excluded from every other view.
          { k: 'drafts', label: 'Drafts' },
        ] as { k: Preset; label: string }[]).map((p) => (
          <button key={p.k} className={`admin-pill${preset === p.k ? ' on' : ''}`} onClick={() => setPreset(p.k)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="admin-toolbar">
        <input
          className="admin-input"
          type="search"
          placeholder="Order # / name / email / phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') refresh() }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="admin-btn-ghost" onClick={refresh}>Search</button>

        <details className="admin-filter-details">
          <summary className="admin-btn-ghost">Status ({filterStatus.length || 'any'})</summary>
          <div className="admin-filter-body">
            {STATUS_FILTER_VALUES.map((s) => (
              <label key={s} className="admin-form-checkbox">
                <input
                  type="checkbox"
                  checked={filterStatus.includes(s)}
                  onChange={(e) => setFilterStatus(e.target.checked ? [...filterStatus, s] : filterStatus.filter((x) => x !== s))}
                />
                <span>{s}</span>
              </label>
            ))}
          </div>
        </details>

        <details className="admin-filter-details">
          <summary className="admin-btn-ghost">Payment ({filterPayment.length || 'any'})</summary>
          <div className="admin-filter-body">
            {PAYMENT_STATUS_VALUES.map((s) => (
              <label key={s} className="admin-form-checkbox">
                <input
                  type="checkbox"
                  checked={filterPayment.includes(s)}
                  onChange={(e) => setFilterPayment(e.target.checked ? [...filterPayment, s] : filterPayment.filter((x) => x !== s))}
                />
                <span>{s}</span>
              </label>
            ))}
          </div>
        </details>

        {/* WEC-577: raw payment Method — server-side filter */}
        <details className="admin-filter-details">
          <summary className="admin-btn-ghost">Method ({filterMethod.length || 'any'})</summary>
          <div className="admin-filter-body">
            {PAYMENT_METHOD_IDS.map((m) => (
              <label key={m} className="admin-form-checkbox">
                <input
                  type="checkbox"
                  checked={filterMethod.includes(m)}
                  onChange={(e) => setFilterMethod(e.target.checked ? [...filterMethod, m] : filterMethod.filter((x) => x !== m))}
                />
                <span>{paymentShort(m, 'el')}</span>
              </label>
            ))}
          </div>
        </details>

        {/* WEC-528: Order Type — derived classification, filtered client-side */}
        <details className="admin-filter-details">
          <summary className="admin-btn-ghost">Type ({filterType.length || 'any'})</summary>
          <div className="admin-filter-body">
            {(Object.keys(ORDER_TYPE_LABELS) as OrderTypeCode[]).map((c) => (
              <label key={c} className="admin-form-checkbox">
                <input
                  type="checkbox"
                  checked={filterType.includes(c)}
                  onChange={(e) => setFilterType(e.target.checked ? [...filterType, c] : filterType.filter((x) => x !== c))}
                />
                <span>{ORDER_TYPE_LABELS[c].en}</span>
              </label>
            ))}
          </div>
        </details>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <div className="admin-table-wrap">
          <table className="admin-table admin-table-compact">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th style={{ width: 56, textAlign: 'center' }}>Days</th>
                <th>Delivery dates</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Disc.</th>
                <th style={{ width: 84 }}>Type</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Method</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.length === 0 && <tr><td colSpan={11} className="admin-table-empty">No orders match.</td></tr>}
              {visibleOrders.map((o) => (
                <tr key={o.id} onClick={() => openDetail(o.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <strong>{o.orderNumber}</strong>
                    {/* WEC-521: managed order (admin placed it while impersonating
                        the customer). adminOrderId is the audit column. Icon changed
                        star → admin shield (same glyph as the header Admin pill) per
                        Ioustinos 2026-07-15 — reads as "admin", matches icon style. */}
                    {o.adminOrderId && (
                      <span
                        className="admin-managed-star"
                        title="Managed order — placed by an admin on behalf of the customer"
                        aria-label="Managed order"
                        style={{ marginLeft: 6, color: '#D97706', verticalAlign: 'middle' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: '-2px' }}>
                          <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
                        </svg>
                      </span>
                    )}
                  </td>
                  <td>
                    <div>{o.customerName || '—'}</div>
                    <div className="admin-sub">{o.customerEmail}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="admin-days-badge">{o.childOrders.length}</span>
                  </td>
                  <td>
                    <div className="admin-date-chips">
                      {o.childOrders.map((c) => <span key={c.id} className="admin-date-chip">{c.deliveryDate.slice(5)}</span>)}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>€{(o.total / 100).toFixed(2)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {o.discountAmount > 0
                      ? <span className="admin-discount">−€{(o.discountAmount / 100).toFixed(2)}</span>
                      : <span className="admin-sub">—</span>}
                  </td>
                  <td style={{ width: 84 }}><OrderTypeBadge method={o.paymentMethod} adminOrderId={o.adminOrderId} wrap /></td>
                  <td><StatusBadge status={o.status} /></td>
                  <td><PaymentBadge status={o.paymentStatus} /></td>
                  <td><PaymentMethodBadge method={o.paymentMethod} /></td>
                  <td className="admin-sub" style={{ whiteSpace: 'nowrap' }}>
                    <div>{new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
                    <div>{new Date(o.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <OrderDrawer
          orderId={selectedId}
          order={detail}
          loading={detailLoading}
          adminUser={user?.email ?? 'admin'}
          onClose={closeDetail}
          onRefresh={() => { refreshDetail(selectedId); refresh() }}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className="admin-badge" style={{ background: `${STATUS_COLOURS[status]}22`, color: STATUS_COLOURS[status] }}>{status}</span>
}
function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className="admin-badge" style={{ background: `${PAYMENT_COLOURS[status]}22`, color: PAYMENT_COLOURS[status] }}>{status}</span>
}
// WEC-577: raw payment-method badge. Distinct subtle colour per method
// (WEC-520 lesson: same-colour pills read as one). Labels from the single
// source of truth (paymentShort, WEC-499). Non-clickable look.
const PAYMENT_METHOD_COLOURS: Record<PaymentMethod, string> = {
  cash: '#059669', card: '#2563eb', link: '#7c3aed', transfer: '#0891b2', wallet: '#d97706',
}
function PaymentMethodBadge({ method }: { method: PaymentMethod | null }) {
  if (!method) return <span className="admin-sub">—</span>
  return (
    <span
      className="admin-badge"
      style={{ background: `${PAYMENT_METHOD_COLOURS[method]}22`, color: PAYMENT_METHOD_COLOURS[method], whiteSpace: 'nowrap' }}
      title="Payment method (raw)"
    >
      {paymentShort(method, 'el')}
    </span>
  )
}

// WEC-528: derived Order Type badge — payment source × who placed it.
// Distinct colour per type (WEC-520 lesson: same-colour pills read as one).
const ORDER_TYPE_COLOURS: Record<OrderTypeCode, string> = {
  alacarte_own: '#16a34a',
  alacarte_managed: '#d97706',
  subscription_own: '#0284c7',
  subscription_managed: '#7c3aed',
}
function OrderTypeBadge({ method, adminOrderId, wrap = false }: { method: PaymentMethod; adminOrderId: string | null; wrap?: boolean }) {
  const code = orderTypeCode(method, adminOrderId)
  return (
    <span
      className="admin-badge"
      style={{ background: `${ORDER_TYPE_COLOURS[code]}22`, color: ORDER_TYPE_COLOURS[code], whiteSpace: wrap ? 'normal' : 'nowrap' }}
      title="Order type — payment source × who placed it (derived, mirrors Airtable Order Type)"
    >
      {ORDER_TYPE_LABELS[code].en}
    </span>
  )
}

// WEC-361 polish: small inline icon set for the order Details screen.
const ICONS = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M5.5 21a7.5 7.5 0 0 1 13 0" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 6 10 7L22 6" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  receipt: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  tag: <><path d="M3 3h8l9 9-8 8-9-9V3z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  utensils: <path d="M4 3v7a2 2 0 0 0 4 0V3M6 11v10M18 3c-2 0-3 2-3 6s1 4 3 4v8" />,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
  note: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />,
  shield: <path d="M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5l-8-3z" />,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="m3 8 9 5 9-5M12 13v9" /></>,
  truck: <><rect x="1" y="4" width="15" height="11" rx="1" /><path d="M16 8h4l3 3v4h-7z" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  pin: <><path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
}
function Ico({ name, size = 15 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg className="admin-od-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

// ─── Order detail drawer ─────────────────────────────────────────────────

function OrderDrawer({
  orderId, order, loading, adminUser, onClose, onRefresh,
}: {
  orderId: string
  order: AdminOrder | null
  loading: boolean
  adminUser: string
  onClose: () => void
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'details' | 'refund' | 'timeline'>('details')
  const [err, setErr] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  // WEC-431: soft prompt when admin cancels a paid order. Stash the pending
  // 'cancelled' transition + the order snapshot it was raised against, so
  // the modal can show "€X paid via {card/link/wallet}" and route the admin
  // to the Refund tab if they choose to issue one.
  const [cancelPrompt, setCancelPrompt] = useState<{ orderId: string; mode: 'refund' | 'plain' } | null>(null)
  // WEC-526: optional cancellation reason captured in the cancel modal.
  const [cancelReason, setCancelReason] = useState('')
  // WEC-487: state for the manual "Send update email" button. We show a
  // tiny inline confirmation flow rather than a modal — one extra click is
  // enough to prevent a fat-finger fire that emails the customer mid-edit.
  const [updateEmailState, setUpdateEmailState] = useState<'idle' | 'confirm' | 'sending' | 'sent'>('idle')

  async function performStatusChange(next: OrderStatus, reason?: string) {
    if (!order) return
    setWorking(true); setErr(null)
    const trimmed = reason && reason.trim() ? reason.trim() : undefined
    const { error } = await setOrderStatus(order.id, order.status, next, adminUser, trimmed)
    setWorking(false)
    if (error) { setErr(error); return }
    onRefresh()
  }

  // WEC-526: every cancel routes through a modal that captures an OPTIONAL
  // reason (emailed to the customer + persisted). Paid refundable orders get
  // the WEC-431 refund-choice variant; everything else a plain confirm.
  function changeStatus(next: OrderStatus) {
    if (!order) return
    if (next === 'cancelled') {
      const refundableMethods: PaymentMethod[] = ['card', 'link', 'wallet']
      const refundable =
        order.paymentStatus === 'paid' &&
        refundableMethods.includes(order.paymentMethod) &&
        (order.refundAmount ?? 0) < order.total
      setCancelReason('')
      setCancelPrompt({ orderId: order.id, mode: refundable ? 'refund' : 'plain' })
      return
    }
    void performStatusChange(next)
  }

  /** WEC-431/526: cancel + jump to the Refund tab so the admin completes the
   *  refund in one flow. Reason (if any) rides along to the email + record. */
  async function confirmCancelAndOpenRefund() {
    setCancelPrompt(null)
    await performStatusChange('cancelled', cancelReason)
    setTab('refund')
  }
  /** Cancel without a refund tab switch (unpaid orders, or "cancel without
   *  refund" on a paid one). Reason threads through the same way. */
  async function confirmCancel() {
    setCancelPrompt(null)
    await performStatusChange('cancelled', cancelReason)
  }

  async function changePayment(next: PaymentStatus) {
    if (!order) return
    setWorking(true); setErr(null)
    const { error } = await setOrderPaymentStatus(order.id, order.paymentStatus, next, adminUser)
    setWorking(false)
    if (error) { setErr(error); return }
    onRefresh()
  }

  /**
   * WEC-487: confirm-then-fire the "Send update email" button. Two-step UX:
   *   click "Send update email" → button morphs into "Confirm send?"
   *   click confirm → POST notify-order-updated → either "Sent ✓" pill or
   *     inline error in the drawer's existing error banner.
   * After 4s the "Sent ✓" pill resets so the admin can re-send if needed.
   */
  async function sendUpdateEmail() {
    if (!order) return
    setUpdateEmailState('sending'); setErr(null)
    const { error } = await sendOrderUpdateEmail(order.id)
    if (error) {
      setUpdateEmailState('idle')
      setErr(`Update email failed: ${error}`)
      return
    }
    setUpdateEmailState('sent')
    setTimeout(() => setUpdateEmailState('idle'), 4000)
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <div className="admin-drawer-head-title">
            <h2>{order ? order.orderNumber : `#${orderId.slice(0, 6)}…`}</h2>
            {/* WEC-404: order placement time next to the order ID — first thing
                the admin sees when opening the drawer, no clicking required. */}
            {order && (
              <span className="admin-drawer-placed">
                {new Date(order.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            )}
          </div>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </header>

        {loading && <div className="admin-loading">Loading…</div>}
        {err && <div className="admin-error-banner" style={{ margin: '10px 20px 0' }}>{err}</div>}

        {order && (
          <>
            {/* WEC-420: Drafts are in-progress checkouts — the customer hasn't
                submitted yet. Surface a clear banner + hide status-transition
                buttons / payment changes / Refund tab so admins don't act on
                a draft as if it were a real order. */}
            {order.status === 'draft' && (
              <div className="admin-error-banner" style={{ margin: '10px 20px 0', background: '#FFF7ED', borderColor: '#FED7AA', color: '#9A3412' }}>
                <strong>Draft</strong> — in-progress checkout, not yet submitted. Read-only view; no payment actions available.
              </div>
            )}

            {/* Status bar */}
            <div className="admin-order-status-bar">
              <div className="admin-od-statusbar-badges">
                <span className="admin-od-badgewrap"><span className="admin-od-badgecap">Order</span><StatusBadge status={order.status} /></span>
                {/* WEC-528: derived order type, same classification as the Airtable mirror */}
                <span className="admin-od-badgewrap"><span className="admin-od-badgecap">Type</span><OrderTypeBadge method={order.paymentMethod} adminOrderId={order.adminOrderId} /></span>
                {/* Payment status is meaningless on a draft — hide. */}
                {order.status !== 'draft' && (
                  <span className="admin-od-badgewrap"><span className="admin-od-badgecap">Payment</span><PaymentBadge status={order.paymentStatus} /></span>
                )}
              </div>
              {order.status !== 'draft' && (
                <div className="admin-status-actions">
                  {offeredTransitions(order.status).map((n) => (
                    <button
                      key={n}
                      className={n === 'cancelled' ? 'admin-btn-danger' : 'admin-od-statusbtn'}
                      style={n === 'cancelled' ? undefined : { background: `${STATUS_COLOURS[n]}1f`, borderColor: `${STATUS_COLOURS[n]}66`, color: STATUS_COLOURS[n] }}
                      disabled={working}
                      onClick={() => changeStatus(n)}
                    >
                      {TRANSITION_LABEL[n]}
                    </button>
                  ))}
                  <details className="admin-filter-details">
                    <summary className="admin-btn-ghost">Payment…</summary>
                    <div className="admin-filter-body">
                      {PAYMENT_STATUS_VALUES.filter((p) => p !== order.paymentStatus).map((p) => (
                        <button key={p} className="admin-row-btn" disabled={working} onClick={() => changePayment(p)}>
                          → {p}
                        </button>
                      ))}
                    </div>
                  </details>
                  {/* WEC-487: admin-triggered "your order has changed" email.
                      Hidden on draft (customer hasn't seen the order yet) and
                      on cancelled (use the auto-fire cancel email instead).
                      Two-step UX: click → "Confirm" → fire. */}
                  {order.status !== 'cancelled' && (
                    updateEmailState === 'sent' ? (
                      <span
                        className="admin-od-statusbtn"
                        style={{ background: '#10B98114', borderColor: '#10B98166', color: '#047857' }}
                      >
                        Update sent
                      </span>
                    ) : updateEmailState === 'confirm' ? (
                      <>
                        <button
                          className="admin-btn-danger"
                          disabled={updateEmailState !== 'confirm'}
                          onClick={sendUpdateEmail}
                        >
                          Confirm send
                        </button>
                        <button
                          className="admin-btn-ghost"
                          onClick={() => setUpdateEmailState('idle')}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="admin-btn-ghost"
                        disabled={updateEmailState === 'sending'}
                        onClick={() => setUpdateEmailState('confirm')}
                        title="Email the customer the current order state (Klaviyo Order Updated)"
                      >
                        {updateEmailState === 'sending' ? 'Sending…' : 'Send update email'}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            {/* WEC-526: surface the saved cancellation reason on the order. */}
            {order.status === 'cancelled' && order.cancelReason && (
              <div className="admin-error-banner" style={{ margin: '10px 20px 0', background: '#FFF7ED', borderColor: '#FED7AA', color: '#9A3412' }}>
                <strong>Cancellation reason:</strong> {order.cancelReason}
              </div>
            )}

            <nav className="admin-order-tabs">
              {(['details', 'refund', 'timeline'] as const)
                // WEC-420: Refund tab makes no sense on a draft (nothing was paid).
                .filter((t) => !(t === 'refund' && order.status === 'draft'))
                .map((t) => (
                  <button key={t} className={`admin-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
            </nav>

            {/* WEC-361: Overview + Items + Delivery are one scrollable screen.
                Refund (destructive) and Timeline (audit) stay separate tabs. */}
            <div className="admin-drawer-body">
              {tab === 'details' && (
                <>
                  <OverviewTab order={order} adminUser={adminUser} onChanged={onRefresh} />
                  <DaysSection order={order} adminUser={adminUser} onChanged={onRefresh} />
                </>
              )}
              {tab === 'refund' && <RefundTab order={order} adminUser={adminUser} onChanged={onRefresh} />}
              {tab === 'timeline' && <TimelineTab order={order} />}
            </div>
          </>
        )}

        {/* WEC-431: refund prompt — shown when admin tries to cancel a paid
            order on a refundable method. "Issue refund" cancels + jumps to
            Refund tab; "Cancel without refund" cancels normally. Background
            click and Esc both bail out without changing anything. */}
        {cancelPrompt && order && (
          <div
            className="admin-drawer-overlay"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={() => setCancelPrompt(null)}
          >
            <div
              className="admin-modal"
              style={{
                maxWidth: 460, margin: '14vh auto', background: '#fff',
                border: '1px solid #e5e7eb', borderRadius: 10, padding: 24,
                boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>
                {cancelPrompt.mode === 'refund' ? 'Cancel this paid order?' : 'Cancel this order?'}
              </h3>
              {cancelPrompt.mode === 'refund' && (
                <p style={{ margin: '0 0 14px', color: '#4b5563', fontSize: 14, lineHeight: 1.45 }}>
                  This order has <strong>€{((order.total - (order.refundAmount ?? 0)) / 100).toFixed(2)}</strong>
                  {' '}still paid via <strong>{order.paymentMethod}</strong>. Cancelling without a
                  refund leaves the funds with{order.paymentMethod === 'wallet' ? ' your wallet ledger' : ' Viva'}.
                </p>
              )}
              {/* WEC-526: optional reason → cancellation email + kept on record */}
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Reason (optional) — shown to the customer in the cancellation email
              </label>
              <textarea
                className="admin-input"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Sold out for this date"
                rows={3}
                style={{ width: '100%', resize: 'vertical', marginBottom: 16 }}
              />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  className="admin-btn-ghost"
                  disabled={working}
                  onClick={() => setCancelPrompt(null)}
                >
                  Keep order
                </button>
                {cancelPrompt.mode === 'refund' ? (
                  <>
                    <button
                      className="admin-btn-ghost"
                      disabled={working}
                      onClick={() => void confirmCancel()}
                    >
                      Cancel without refund
                    </button>
                    <button
                      className="admin-btn-danger"
                      disabled={working}
                      onClick={() => void confirmCancelAndOpenRefund()}
                    >
                      Cancel + issue refund
                    </button>
                  </>
                ) : (
                  <button
                    className="admin-btn-danger"
                    disabled={working}
                    onClick={() => void confirmCancel()}
                  >
                    Cancel order
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OverviewTab({ order, adminUser, onChanged }: { order: AdminOrder; adminUser: string; onChanged: () => void }) {
  const hasDiscount = order.voucherUses.length > 0 || order.discountAmount > 0
  return (
    <div className="admin-od">
      <div className="admin-od-grid">
        {/* Customer — widest card, top-left */}
        <div className="admin-od-card admin-od-col-4">
          <div className="admin-od-card-head">
            <span className="admin-od-card-title"><Ico name="user" /> Customer</span>
            {/* WEC-263: shortcut to the customer's profile (guests have no profile). */}
            {order.userId && (
              <Link
                to={`/admin/users?userId=${order.userId}`}
                className="admin-od-link"
                title="Open this customer's profile in the Users admin"
              >
                Profile <Ico name="arrow" size={13} />
              </Link>
            )}
          </div>
          <div className="admin-od-name">{order.customerName || '—'}</div>
          <div className="admin-od-contacts">
            {order.customerEmail && (
              <a className="admin-od-contact" href={`mailto:${order.customerEmail}`}><Ico name="mail" /> {order.customerEmail}</a>
            )}
            {order.customerPhone && (
              <a className="admin-od-contact" href={`tel:${order.customerPhone}`}><Ico name="phone" /> {order.customerPhone}</a>
            )}
          </div>
          {/* WEC-404: order placement time, always visible — ops/kitchen care
              about "did this come in before cutoff?" / "how long has it been
              sitting?" without having to infer from the order number. */}
          <div className="admin-od-provenance">
            <Ico name="info" size={13} /> Placed at {new Date(order.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
          {/* WEC-392: read-only impersonation provenance (from admin_order_id),
              kept separate from the editable admin note. */}
          {order.adminOrderId && (
            <div className="admin-od-provenance">
              <Ico name="shield" size={13} /> Placed by an admin on behalf of the customer · {new Date(order.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="admin-od-card admin-od-col-3">
          <span className="admin-od-card-title"><Ico name="card" /> Payment</span>
          <dl className="admin-od-kv">
            <div><dt>Method</dt><dd className="admin-od-method">{order.paymentMethod ?? '—'}</dd></div>
            <div><dt>Status</dt><dd><PaymentBadge status={order.paymentStatus} /></dd></div>
            {(order.refundAmount ?? 0) > 0 && (
              <div><dt>Refunded</dt><dd>€{((order.refundAmount ?? 0) / 100).toFixed(2)}</dd></div>
            )}
          </dl>
        </div>

        {/* Totals */}
        <div className="admin-od-card admin-od-col-2">
          <span className="admin-od-card-title"><Ico name="receipt" /> Totals</span>
          <div className="admin-od-totals">
            <div className="admin-od-total-row"><span>Subtotal</span><span>€{(order.subtotal / 100).toFixed(2)}</span></div>
            {order.discountAmount > 0 && (
              <div className="admin-od-total-row admin-od-total-disc"><span>Discount</span><span>−€{(order.discountAmount / 100).toFixed(2)}</span></div>
            )}
            <div className="admin-od-total-row admin-od-total-grand"><span>Total</span><span>€{(order.total / 100).toFixed(2)}</span></div>
          </div>
        </div>

        {/* Extras — a card in the same row (cutlery + invoice) */}
        <div className="admin-od-card admin-od-col-3">
          <span className="admin-od-card-title"><Ico name="info" /> Extras</span>
          <div className="admin-od-chips">
            <span className={`admin-od-chip${order.cutlery ? ' on' : ''}`}><Ico name="utensils" /> Cutlery {order.cutlery ? '✓' : '—'}</span>
            {/* WEC-403: distinguish invoice (Τιμολόγιο, B2B with company+ΑΦΜ)
                from receipt (Απόδειξη). Invoice chip highlights so the admin
                can see at a glance that this is a business-invoice order. */}
            <span className={`admin-od-chip${order.invoiceType === 'invoice' ? ' on' : ''}`}>
              <Ico name="doc" />{' '}
              {order.invoiceType === 'invoice'
                ? `Τιμολόγιο · ${order.invoiceName || '—'}${order.invoiceVat ? ' · ΑΦΜ ' + order.invoiceVat : ''}`
                : 'Απόδειξη'}
            </span>
          </div>
        </div>

        {/* Discount detail (rare) — full width, drops to its own row */}
        {hasDiscount && (
          <div className="admin-od-card admin-od-col-12">
            <span className="admin-od-card-title"><Ico name="tag" /> Discount · −€{(order.discountAmount / 100).toFixed(2)}</span>
            {order.voucherUses.length > 0 ? (
              <div className="admin-od-vouchers">
                {order.voucherUses.map((v) => (
                  <div key={v.id} className="admin-od-voucher">
                    <code>{v.code}</code>
                    <span>€{(v.amount / 100).toFixed(2)}</span>
                    <span className="admin-sub">{new Date(v.usedAt).toLocaleDateString('en-GB')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="admin-sub">Manual discount — no voucher on record.</div>
            )}
          </div>
        )}
      </div>

      <PaymentLinkBlock order={order} onChanged={onChanged} />

      <NotesBlock order={order} adminUser={adminUser} onChanged={onChanged} />
    </div>
  )
}

/** WEC-390: editable customer note + a single internal admin note (kitchen /
    packaging / management). Both saved independently, audit-logged, any status. */
function NotesBlock({ order, adminUser, onChanged }: { order: AdminOrder; adminUser: string; onChanged: () => void }) {
  const [customer, setCustomer] = useState(order.notes ?? '')
  const [admin, setAdmin] = useState(order.adminNotes ?? '')
  const [savingC, setSavingC] = useState(false)
  const [savingA, setSavingA] = useState(false)
  const dirtyC = customer !== (order.notes ?? '')
  const dirtyA = admin !== (order.adminNotes ?? '')

  async function saveCustomer() {
    setSavingC(true)
    const { error } = await updateOrderNotes(order.id, { notes: customer.trim() || null }, adminUser)
    setSavingC(false)
    if (error) { alert(error); return }
    onChanged()
  }
  async function saveAdmin() {
    setSavingA(true)
    const { error } = await updateOrderNotes(order.id, { adminNotes: admin.trim() || null }, adminUser)
    setSavingA(false)
    if (error) { alert(error); return }
    onChanged()
  }

  return (
    <div className="admin-od-notes">
      <div className="admin-od-note-edit">
        <label className="admin-od-card-title"><Ico name="note" /> Customer note</label>
        <textarea
          className="admin-input admin-od-note-ta"
          rows={2}
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder="No customer note."
        />
        {dirtyC && (
          <div className="admin-od-note-actions">
            <button className="admin-btn-ghost" onClick={() => setCustomer(order.notes ?? '')}>Reset</button>
            <button className="admin-btn-primary" disabled={savingC} onClick={saveCustomer}>{savingC ? 'Saving…' : 'Save customer note'}</button>
          </div>
        )}
      </div>

      <div className="admin-od-note-edit admin-od-note-edit-admin">
        <label className="admin-od-card-title">
          <Ico name="shield" /> Admin note
          <span className="admin-od-note-hint">internal — kitchen / packaging / management</span>
        </label>
        <textarea
          className="admin-input admin-od-note-ta"
          rows={2}
          value={admin}
          onChange={(e) => setAdmin(e.target.value)}
          placeholder="Add an internal note…"
        />
        {dirtyA && (
          <div className="admin-od-note-actions">
            <button className="admin-btn-ghost" onClick={() => setAdmin(order.adminNotes ?? '')}>Reset</button>
            <button className="admin-btn-primary" disabled={savingA} onClick={saveAdmin}>{savingA ? 'Saving…' : 'Save admin note'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

const EMPTY_SET: Set<string> = new Set()

function DaysSection({ order, adminUser, onChanged }: { order: AdminOrder; adminUser: string; onChanged: () => void }) {
  // WEC-371: dish catalog + per-day on-menu hints (for the add-item picker and
  // the inline variant editor).
  const [dishes, setDishes] = useState<AdminDish[]>([])
  const [onMenuByDate, setOnMenuByDate] = useState<Record<string, Set<string>>>({})
  useEffect(() => {
    let cancelled = false
    fetchAdminDishes().then((r) => { if (!cancelled) setDishes((r.data ?? []).filter((d) => d.active)) })
    Promise.all(
      order.childOrders.map((c) =>
        fetchOnMenuDishIds(c.deliveryDate).then((s) => [c.deliveryDate, s] as const),
      ),
    ).then((pairs) => { if (!cancelled) setOnMenuByDate(Object.fromEntries(pairs)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const dishById = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes])

  // WEC-372: item edits (variant / qty / remove / add / cancel day) only while
  // the order is Pending. Revert a Confirmed order to Pending, then re-confirm.
  const editable = order.status === 'pending'

  return (
    <div className="admin-od-days">
      <h3 className="admin-od-days-title"><Ico name="truck" /> Delivery Days ({order.childOrders.length})</h3>
      {!editable && (
        <div className="admin-info-banner">
          This order is <strong>{order.status}</strong> — revert it to <strong>Pending</strong> (status bar above) to edit items or cancel a day.
        </div>
      )}
      {order.childOrders.map((c) => (
        <DayCard
          key={c.id}
          order={order}
          child={c}
          dishById={dishById}
          dishes={dishes}
          onMenuIds={onMenuByDate[c.deliveryDate] ?? EMPTY_SET}
          editable={editable}
          adminUser={adminUser}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function DayCard({
  order, child, dishById, dishes, onMenuIds, editable, adminUser, onChanged,
}: {
  order: AdminOrder
  child: AdminChildOrder
  dishById: Map<string, AdminDish>
  dishes: AdminDish[]
  onMenuIds: Set<string>
  editable: boolean
  adminUser: string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(true)
  const [editingAddr, setEditingAddr] = useState(false)
  const [working, setWorking] = useState(false)

  const cancelled = !!child.cancelledAt
  const canEdit = editable && !cancelled

  const timeLabel = child.timeFrom && child.timeTo
    ? `${child.timeFrom.slice(0, 5)} – ${child.timeTo.slice(0, 5)}`
    : '—'
  const addrLine = [child.addressStreet, child.addressZip, child.addressArea].filter(Boolean).join(', ') || '—'
  const daySubtotal = child.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0)
  // WEC-488: per-day macro totals. Multiply by quantity — the per-item
  // calories/protein/carbs/fat snapshot is per-unit, taken from the
  // variant at order time, and we sum across the day's items.
  const dayMacros = child.items.reduce(
    (acc, it) => ({
      calories: acc.calories + it.calories * it.quantity,
      protein:  acc.protein  + it.protein  * it.quantity,
      carbs:    acc.carbs    + it.carbs    * it.quantity,
      fat:      acc.fat      + it.fat      * it.quantity,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )

  async function cancelDay() {
    if (!confirm(`Cancel the whole delivery day ${fmtDay(child.deliveryDate)}? Its ${child.items.length} item(s) stay on record but drop out of the total — you can Restore it later.`)) return
    setWorking(true)
    const { error } = await cancelChildOrder(child.id, order.id, adminUser)
    setWorking(false)
    if (error) { alert(error); return }
    onChanged()
  }
  async function restoreDay() {
    setWorking(true)
    const { error } = await restoreChildOrder(child.id, order.id, adminUser)
    setWorking(false)
    if (error) { alert(error); return }
    onChanged()
  }

  return (
    <div className={`admin-od-day${cancelled ? ' admin-od-day-cancelled' : ''}`}>
      {/* WEC-386: the whole header toggles the accordion; action buttons stop
          propagation so they don't also collapse the day. */}
      <header
        className="admin-od-day-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}
      >
        <span className={`admin-od-day-chevron${open ? ' open' : ''}`} aria-hidden="true"><Ico name="chevron" size={16} /></span>
        <div className="admin-od-day-id">
          <div className="admin-od-day-date">
            {fmtDay(child.deliveryDate)}
            {cancelled && <span className="admin-od-day-cancelbadge">Cancelled</span>}
          </div>
          <div className="admin-od-day-addr"><Ico name="pin" size={13} /> {addrLine}</div>
        </div>
        <span className="admin-od-timepill">{timeLabel}</span>
        <span className="admin-od-day-count">{child.items.length} item{child.items.length === 1 ? '' : 's'} · €{(daySubtotal / 100).toFixed(2)}</span>
        {cancelled ? (
          <button className="admin-row-btn admin-od-restoreday" disabled={working} onClick={(e) => { e.stopPropagation(); restoreDay() }}>Restore</button>
        ) : editable ? (
          <button className="admin-od-cancelday" disabled={working} onClick={(e) => { e.stopPropagation(); cancelDay() }}>Cancel Day</button>
        ) : null}
      </header>

      {open && (
        <div className="admin-od-day-body">
          {!editingAddr ? (
            <div className="admin-od-addr">
              <div><span className="admin-od-addr-k">Address</span><span>{child.addressStreet || '—'}</span></div>
              <div><span className="admin-od-addr-k">Post Code</span><span>{child.addressZip || '—'}</span></div>
              <div><span className="admin-od-addr-k">City</span><span>{child.addressArea || '—'}</span></div>
              <div><span className="admin-od-addr-k">Floor</span><span>{child.addressFloor || '—'}</span></div>
              {!cancelled && <button className="admin-row-btn admin-od-addr-edit" onClick={() => setEditingAddr(true)}>Edit address &amp; time</button>}
            </div>
          ) : (
            <AddressTimeEditor
              child={child}
              orderId={order.id}
              adminUser={adminUser}
              onDone={() => { setEditingAddr(false); onChanged() }}
              onCancel={() => setEditingAddr(false)}
            />
          )}

          <table className="admin-table admin-table-tight admin-od-items">
            <thead>
              <tr>
                <th>Item</th><th>Variant</th><th>Comment</th>
                <th style={{ textAlign: 'center' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Unit</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {child.items.length === 0 && <tr><td colSpan={7} className="admin-table-empty">No items.</td></tr>}
              {child.items.map((it) => (
                <DayItemRow
                  key={it.id}
                  item={it}
                  dish={it.dishId ? dishById.get(it.dishId) : undefined}
                  orderId={order.id}
                  childOrderId={child.id}
                  editable={canEdit}
                  adminUser={adminUser}
                  onChanged={onChanged}
                />
              ))}
            </tbody>
          </table>

          {/* WEC-488: per-day macro totals. Visual mirrors the Order Placed
              email template (.day-macros class) — one muted single-line
              summary, not a card. Same wording, same separator dots. */}
          {child.items.length > 0 && (
            <div className="admin-od-day-macros">
              Day macros: {Math.round(dayMacros.calories)} kcal · {Math.round(dayMacros.protein)} g protein · {Math.round(dayMacros.carbs)} g carbs · {Math.round(dayMacros.fat)} g fat
            </div>
          )}

          {canEdit && (
            <AddItemPanel
              orderId={order.id}
              childOrderId={child.id}
              dishes={dishes}
              onMenuIds={onMenuIds}
              paymentStatus={order.paymentStatus}
              adminUser={adminUser}
              onAdded={onChanged}
            />
          )}
        </div>
      )}
    </div>
  )
}

function DayItemRow({ item, dish, orderId, childOrderId, editable, adminUser, onChanged }: {
  item: AdminOrderItem
  dish: AdminDish | undefined
  orderId: string
  childOrderId: string
  editable: boolean
  adminUser: string
  onChanged: () => void
}) {
  const [qty, setQty] = useState(item.quantity)
  const [working, setWorking] = useState(false)
  const dirty = qty !== item.quantity

  async function saveQty() {
    setWorking(true)
    await updateOrderItemQuantity(item.id, item.quantity, qty, orderId, childOrderId, adminUser)
    setWorking(false); onChanged()
  }
  async function remove() {
    if (!confirm('Remove this item?')) return
    setWorking(true)
    await updateOrderItemQuantity(item.id, item.quantity, 0, orderId, childOrderId, adminUser)
    setWorking(false); onChanged()
  }
  async function changeVariant(variantId: string) {
    const v = dish?.variants.find((x) => x.id === variantId)
    if (!v) return
    setWorking(true)
    await updateOrderItemVariant({
      itemId: item.id, orderId, childOrderId,
      quantity: item.quantity,
      variantId: v.id, variantLabelEl: v.labelEl, variantLabelEn: v.labelEn,
      unitPrice: v.price, calories: v.calories, protein: v.protein, carbs: v.carbs, fat: v.fat,
      oldLabel: item.variantLabelEl, adminUser,
    })
    setWorking(false); onChanged()
  }

  const variants = dish?.variants ?? []
  const canEditVariant = editable && variants.length > 0
  const currentInList = variants.some((v) => v.id === item.variantId)

  return (
    <tr>
      <td>{item.nameEl}</td>
      <td>
        {canEditVariant ? (
          <select
            className="admin-select admin-input-tight"
            value={item.variantId ?? ''}
            disabled={working}
            onChange={(e) => changeVariant(e.target.value)}
          >
            {!currentInList && item.variantId && (
              <option value={item.variantId}>{item.variantLabelEl || '—'}</option>
            )}
            {variants.map((v) => (
              <option key={v.id} value={v.id}>{(v.labelEl || '—')} · €{(v.price / 100).toFixed(2)}</option>
            ))}
          </select>
        ) : (
          <span className="admin-sub">{item.variantLabelEl || '—'}</span>
        )}
      </td>
      <td className="admin-sub">{item.comment ? `💬 ${item.comment}` : '—'}</td>
      <td style={{ textAlign: 'center' }}>
        {editable
          ? <input className="admin-input admin-input-tight" type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, +e.target.value || 0))} style={{ width: 54 }} />
          : item.quantity}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>€{(item.unitPrice / 100).toFixed(2)}</td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>€{((item.unitPrice * (editable ? qty : item.quantity)) / 100).toFixed(2)}</td>
      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
        {editable && (
          <>
            {dirty && <button className="admin-row-btn" disabled={working} onClick={saveQty}>Save</button>}
            <button className="admin-od-itemx" disabled={working} onClick={remove} title="Remove item">×</button>
          </>
        )}
      </td>
    </tr>
  )
}

/** WEC-371: in-drawer "add item" picker for a single child order. Full active
    catalogue (admins can add off-menu dishes), with on-menu dishes badged +
    floated to the top. Payment is handled manually after saving. */
function AddItemPanel({
  orderId, childOrderId, dishes, onMenuIds, paymentStatus, adminUser, onAdded,
}: {
  orderId: string
  childOrderId: string
  dishes: AdminDish[]
  onMenuIds: Set<string>
  paymentStatus: PaymentStatus
  adminUser: string
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dishId, setDishId] = useState<string | null>(null)
  const [variantId, setVariantId] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dish = dishes.find((d) => d.id === dishId) ?? null
  const variant = dish?.variants.find((v) => v.id === variantId) ?? null

  const filtered = useMemo(() => {
    const n = foldGreek(search.trim())
    const arr = dishes.filter((d) => !n || foldGreek(`${d.nameEl} ${d.nameEn}`).includes(n))
    // On-menu dishes float to the top (hint only — off-menu is still allowed).
    return [...arr]
      .sort((a, b) => (onMenuIds.has(b.id) ? 1 : 0) - (onMenuIds.has(a.id) ? 1 : 0))
      .slice(0, 60)
  }, [dishes, search, onMenuIds])

  function pickDish(d: AdminDish) {
    setDishId(d.id)
    const def = d.variants.find((v) => v.isDefault) ?? d.variants[0] ?? null
    setVariantId(def?.id ?? null)
  }

  function reset() {
    setDishId(null); setVariantId(null); setQty(1); setComment(''); setSearch(''); setErr(null)
  }

  async function add() {
    if (!dish || !variant) return
    setSaving(true); setErr(null)
    const { error } = await addOrderItem({
      orderId, childOrderId,
      dishId: dish.id, variantId: variant.id,
      nameEl: dish.nameEl, nameEn: dish.nameEn,
      variantLabelEl: variant.labelEl, variantLabelEn: variant.labelEn,
      unitPrice: variant.price,
      quantity: qty,
      calories: variant.calories, protein: variant.protein, carbs: variant.carbs, fat: variant.fat,
      comment,
      adminUser,
    })
    setSaving(false)
    if (error) { setErr(error); return }
    reset()
    setOpen(false)
    onAdded()
  }

  if (!open) {
    return (
      <button className="admin-od-additem-link" onClick={() => setOpen(true)}>
        + Add item from menu
      </button>
    )
  }

  return (
    <div className="admin-additem">
      {err && <div className="admin-error-banner">{err}</div>}
      {paymentStatus === 'paid' && (
        <div className="admin-warn-banner">
          This order is already paid — adding items won’t charge the customer. Send a payment link for the balance after saving.
        </div>
      )}

      {!dish && (
        <>
          <input
            className="admin-input"
            type="search"
            autoFocus
            placeholder="Search dishes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="admin-additem-list">
            {filtered.length === 0 && <div className="admin-text-muted" style={{ padding: 8 }}>No dishes match.</div>}
            {filtered.map((d) => (
              <button key={d.id} type="button" className="admin-additem-row" onClick={() => pickDish(d)}>
                <span>{d.nameEl}</span>
                {onMenuIds.has(d.id) && <span className="admin-additem-badge">on menu</span>}
              </button>
            ))}
          </div>
          <div className="admin-additem-actions">
            <button className="admin-btn-ghost" onClick={() => { reset(); setOpen(false) }}>Cancel</button>
          </div>
        </>
      )}

      {dish && (
        <div className="admin-additem-config">
          <div className="admin-additem-picked">
            <strong>{dish.nameEl}</strong>
            <button type="button" className="admin-row-btn" onClick={() => { setDishId(null); setVariantId(null) }}>Change dish</button>
          </div>

          <label className="admin-form-label">Variant</label>
          <div className="admin-chip-wrap">
            {dish.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`admin-chip${variantId === v.id ? ' on' : ''}`}
                onClick={() => setVariantId(v.id)}
              >
                {v.labelEl || '—'} · €{(v.price / 100).toFixed(2)}
              </button>
            ))}
          </div>

          <div className="admin-grid-2" style={{ marginTop: 10 }}>
            <div>
              <label className="admin-form-label">Quantity</label>
              <input className="admin-input" type="number" min={1} value={qty}
                onChange={(e) => setQty(Math.max(1, +e.target.value || 1))} />
            </div>
            <div>
              <label className="admin-form-label">Comment (optional)</label>
              <input className="admin-input" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
          </div>

          <div className="admin-additem-actions">
            <button className="admin-btn-ghost" onClick={() => { reset(); setOpen(false) }}>Cancel</button>
            <button className="admin-btn-primary" disabled={saving || !variant} onClick={add}>
              {saving ? 'Adding…' : variant ? `Add · €${((variant.price * qty) / 100).toFixed(2)}` : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddressTimeEditor({ child, orderId, adminUser, onDone, onCancel }: {
  child: AdminChildOrder
  orderId: string
  adminUser: string
  onDone: () => void
  onCancel: () => void
}) {
  const [street, setStreet] = useState(child.addressStreet ?? '')
  const [area, setArea] = useState(child.addressArea ?? '')
  const [zip, setZip] = useState(child.addressZip ?? '')
  const [floor, setFloor] = useState(child.addressFloor ?? '')
  const [timeFrom, setTimeFrom] = useState(child.timeFrom?.slice(0, 5) ?? '')
  const [timeTo, setTimeTo] = useState(child.timeTo?.slice(0, 5) ?? '')
  const [working, setWorking] = useState(false)

  async function saveAll() {
    setWorking(true)
    await updateChildOrderAddress(child.id, orderId, { street, area, zip, floor }, adminUser)
    await updateChildOrderTime(child.id, orderId, timeFrom ? `${timeFrom}:00` : null, timeTo ? `${timeTo}:00` : null, adminUser)
    setWorking(false)
    onDone()
  }

  return (
    <div className="admin-od-addr-edit-panel">
      <div className="admin-od-addr-grid">
        <div><label className="admin-form-label">Address</label><input className="admin-input" value={street} onChange={(e) => setStreet(e.target.value)} /></div>
        <div><label className="admin-form-label">Post Code</label><input className="admin-input" value={zip} onChange={(e) => setZip(e.target.value)} /></div>
        <div><label className="admin-form-label">City</label><input className="admin-input" value={area} onChange={(e) => setArea(e.target.value)} /></div>
        <div><label className="admin-form-label">Floor</label><input className="admin-input" value={floor} onChange={(e) => setFloor(e.target.value)} /></div>
        <div><label className="admin-form-label">Time from</label><input className="admin-input" type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} /></div>
        <div><label className="admin-form-label">Time to</label><input className="admin-input" type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} /></div>
      </div>
      <div className="admin-od-addr-edit-actions">
        <button className="admin-btn-ghost" disabled={working} onClick={onCancel}>Cancel</button>
        <button className="admin-btn-primary" disabled={working} onClick={saveAll}>{working ? 'Saving…' : 'Save address & time'}</button>
      </div>
    </div>
  )
}

function RefundTab({ order, adminUser, onChanged }: { order: AdminOrder; adminUser: string; onChanged: () => void }) {
  const remaining = order.total - (order.refundAmount ?? 0)
  const canVivaRefund = !!order.paymentLink?.transactionId
  const [amount, setAmount] = useState(remaining)
  const [kind, setKind] = useState<RefundKind>(canVivaRefund ? 'viva' : 'wallet')
  const [reason, setReason] = useState<'legal' | 'kitchen_error' | 'customer_request' | 'other'>('customer_request')
  const [reasonText, setReasonText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [working, setWorking] = useState(false)

  async function submit() {
    setErr(null)
    setWorking(true)
    const reasonFull = reason === 'other' ? (reasonText.trim() || 'other') : reason
    const { error } = await refundOrder(order, kind, amount, adminUser, reasonFull)
    setWorking(false)
    if (error) { setErr(error); return }
    setDone(true)
    onChanged()
  }

  if (order.paymentStatus === 'refunded') {
    return <div className="admin-info-banner">This order is fully refunded (€{((order.refundAmount ?? 0) / 100).toFixed(2)}).</div>
  }

  return (
    <div>
      {done && <div className="admin-info-banner">Refund issued.</div>}
      {err && <div className="admin-error-banner">{err}</div>}
      <p className="admin-sub">
        Total paid: €{(order.total / 100).toFixed(2)}
        {(order.refundAmount ?? 0) > 0 && (
          <>
            {' · Already refunded: €'}{((order.refundAmount ?? 0) / 100).toFixed(2)}
            {' · Remaining: €'}{(remaining / 100).toFixed(2)}
          </>
        )}
      </p>

      <div className="admin-form-section">
        <label className="admin-form-label">Refund to</label>
        <div className="admin-tab-row">
          <button className={`admin-tab${kind === 'viva' ? ' active' : ''}`} disabled={!canVivaRefund} onClick={() => setKind('viva')}>
            Back to card (Viva){!canVivaRefund && ' — unavailable'}
          </button>
          <button className={`admin-tab${kind === 'wallet' ? ' active' : ''}`} onClick={() => setKind('wallet')}>Customer wallet</button>
        </div>
        {kind === 'viva' && !canVivaRefund && (
          <div className="admin-warn-banner">This order has no Viva transaction — refund via wallet, or cancel + re-bill instead.</div>
        )}
        {kind === 'wallet' && !order.userId && (
          <div className="admin-warn-banner">Guest order — no linked customer to credit. Use Viva refund or cancel the order.</div>
        )}
      </div>

      <div className="admin-form-section">
        <label className="admin-form-label">Reason</label>
        <select className="admin-input" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          <option value="customer_request">Customer request</option>
          <option value="kitchen_error">Kitchen error</option>
          <option value="legal">Legal</option>
          <option value="other">Other</option>
        </select>
        {reason === 'other' && (
          <input
            className="admin-input" type="text" placeholder="Please specify…"
            value={reasonText} onChange={(e) => setReasonText(e.target.value)}
            style={{ marginTop: 8 }}
          />
        )}
      </div>

      <div className="admin-form-section admin-grid-2">
        <div>
          <label className="admin-form-label">Amount (€)</label>
          <input
            className="admin-input" type="number" min={0} step="0.01"
            value={(amount / 100).toFixed(2)}
            onChange={(e) => setAmount(Math.round((+e.target.value || 0) * 100))}
          />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button
            className="admin-btn-primary"
            disabled={
              working
              || amount <= 0
              || amount > remaining
              || (kind === 'viva' && !canVivaRefund)
              || (kind === 'wallet' && !order.userId)
              || (reason === 'other' && !reasonText.trim())
            }
            onClick={submit}
          >
            {working ? 'Processing…' : `Issue refund (€${(amount / 100).toFixed(2)})`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** WEC-176 — Payment link block for card/link orders. Shows status + URL + regenerate. */
function PaymentLinkBlock({ order, onChanged }: { order: AdminOrder; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)

  const link = order.paymentLink
  const isLinkMethod = order.paymentMethod === 'link' || order.paymentMethod === 'card'
  // WEC-569: also show on ANY pending order (cash / transfer / wallet) so an
  // admin can generate + send a Viva link to collect it online, regardless of
  // the method the order was placed with. Hidden only when it's neither a
  // card/link order nor pending (nothing left to collect).
  if (!isLinkMethod && order.paymentStatus !== 'pending') return null

  async function copy() {
    if (!link?.paymentUrl) return
    try {
      await navigator.clipboard.writeText(link.paymentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setErr('Copy failed — browser blocked clipboard access.')
    }
  }

  async function regenerate() {
    setErr(null); setWorking(true)
    const { error } = await regenerateVivaPaymentLink(order.id)
    setWorking(false)
    if (error) { setErr(error); return }
    onChanged()
  }

  return (
    <section className="admin-form-section">
      <h3 className="admin-section-title" style={{ marginTop: 0 }}>Payment link</h3>
      {err && <div className="admin-error-banner">{err}</div>}

      {!link && (
        <>
          <p className="admin-text-muted">No payment link generated for this order yet.</p>
          {order.paymentStatus === 'pending' && (
            <button className="admin-btn-primary" disabled={working} onClick={regenerate}>
              {working ? 'Generating…' : 'Generate payment link'}
            </button>
          )}
        </>
      )}

      {link && (
        <>
          <div style={{ marginBottom: 8 }}>
            <span className={`admin-pill-${link.status === 'success' ? 'ok' : link.status === 'failure' ? 'err' : 'warn'}`}>
              {link.status}
            </span>
            {link.statusId && <span className="admin-text-muted" style={{ marginLeft: 8 }}>Viva statusId: {link.statusId}</span>}
          </div>
          {link.paymentUrl && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input className="admin-input" type="text" value={link.paymentUrl} readOnly style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
              <button className="admin-btn-ghost" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
            </div>
          )}
          {order.paymentStatus === 'pending' && (
            <button className="admin-btn-ghost" disabled={working} onClick={regenerate}>
              {working ? 'Regenerating…' : 'Regenerate link'}
            </button>
          )}
          <p className="admin-text-muted" style={{ marginTop: 8, fontSize: 12 }}>
            Last verified: {link.lastVerifiedAt ? new Date(link.lastVerifiedAt).toLocaleString() : 'never'}
          </p>
        </>
      )}
    </section>
  )
}

function TimelineTab({ order }: { order: AdminOrder }) {
  return (
    <div>
      <p className="admin-sub">Order placement + latest {order.changeLog.length} admin change(s):</p>
      <table className="admin-table admin-table-tight">
        <thead><tr><th>When</th><th>Field</th><th>Old</th><th>New</th><th>Label</th><th>By</th></tr></thead>
        <tbody>
          {/* WEC-404: synthetic first row — the order's own placement. Always
              present; reads chronologically from "Order placed" → subsequent
              admin changes. Styled identically to the other rows. */}
          <tr>
            <td className="admin-sub">{new Date(order.createdAt).toLocaleString('en-GB')}</td>
            <td>orders.created</td>
            <td className="admin-sub">—</td>
            <td className="admin-sub">placed</td>
            <td>Order placed</td>
            <td className="admin-sub">customer</td>
          </tr>
          {[...order.changeLog]
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((l) => {
            // WEC-566: money fields (total/subtotal/discount) store cents in
            // old/new_value — render as € with a red/green delta so the money
            // impact of an admin edit is visible, not just the field name.
            const isMoney = l.tableName === 'orders' && (l.fieldName === 'total' || l.fieldName === 'subtotal' || l.fieldName === 'discount_amount')
            const eur = (v: string | null) => {
              const n = Number(v)
              return v != null && Number.isFinite(n) ? `€${(n / 100).toFixed(2)}` : (v ?? '—')
            }
            const oldN = Number(l.oldValue)
            const newN = Number(l.newValue)
            const deltaColor = isMoney && Number.isFinite(oldN) && Number.isFinite(newN) && newN !== oldN
              ? (newN > oldN ? '#15803d' : '#b91c1c')
              : undefined
            return (
            <tr key={l.id}>
              <td className="admin-sub">{new Date(l.createdAt).toLocaleString('en-GB')}</td>
              <td>{l.tableName}.{l.fieldName}</td>
              <td className="admin-sub">{isMoney ? eur(l.oldValue) : (l.oldValue ?? '—')}</td>
              <td className="admin-sub" style={deltaColor ? { color: deltaColor, fontWeight: 700 } : undefined}>{isMoney ? eur(l.newValue) : (l.newValue ?? '—')}</td>
              <td>{l.label}</td>
              <td className="admin-sub">{l.adminUser}</td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
