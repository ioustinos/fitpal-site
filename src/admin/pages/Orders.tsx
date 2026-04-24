import { useEffect, useState } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import {
  listAdminOrders, getAdminOrder,
  setOrderStatus, setOrderPaymentStatus,
  updateOrderItemQuantity, updateChildOrderAddress, updateChildOrderTime,
  refundOrder, regenerateVivaPaymentLink,
  ORDER_STATUS_VALUES, PAYMENT_STATUS_VALUES, VALID_NEXT_STATUS,
  type AdminOrder, type OrderFilters, type OrderStatus, type PaymentStatus,
  type RefundKind,
} from '../../lib/api/adminOrders'

const STATUS_COLOURS: Record<OrderStatus, string> = {
  pending: '#f59e0b', confirmed: '#3b82f6', preparing: '#8b5cf6',
  delivering: '#14b8a6', delivered: '#10b981', cancelled: '#ef4444',
}
const PAYMENT_COLOURS: Record<PaymentStatus, string> = {
  pending: '#f59e0b', paid: '#10b981', failed: '#ef4444', refunded: '#6b7280',
}

type Preset = 'all' | 'today' | 'pending-payment' | 'this-week'

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

  async function refresh() {
    setLoading(true); setErr(null)
    const filters: OrderFilters = { search: search.trim() || undefined }
    if (filterStatus.length) filters.status = filterStatus
    if (filterPayment.length) filters.paymentStatus = filterPayment
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

  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [preset, filterStatus.join(','), filterPayment.join(',')])

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

  const totalLoaded = orders.length

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
            {ORDER_STATUS_VALUES.map((s) => (
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
                <th>Status</th>
                <th>Payment</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={9} className="admin-table-empty">No orders match.</td></tr>}
              {orders.map((o) => (
                <tr key={o.id} onClick={() => openDetail(o.id)} style={{ cursor: 'pointer' }}>
                  <td><strong>{o.orderNumber}</strong></td>
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
                  <td><StatusBadge status={o.status} /></td>
                  <td><PaymentBadge status={o.paymentStatus} /></td>
                  <td className="admin-sub" style={{ whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
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
  const [tab, setTab] = useState<'overview' | 'items' | 'delivery' | 'refund' | 'timeline'>('overview')
  const [err, setErr] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function changeStatus(next: OrderStatus) {
    if (!order) return
    setWorking(true); setErr(null)
    const { error } = await setOrderStatus(order.id, order.status, next, adminUser)
    setWorking(false)
    if (error) { setErr(error); return }
    onRefresh()
  }

  async function changePayment(next: PaymentStatus) {
    if (!order) return
    setWorking(true); setErr(null)
    const { error } = await setOrderPaymentStatus(order.id, order.paymentStatus, next, adminUser)
    setWorking(false)
    if (error) { setErr(error); return }
    onRefresh()
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2>{order ? order.orderNumber : `#${orderId.slice(0, 6)}…`}</h2>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </header>

        {loading && <div className="admin-loading">Loading…</div>}
        {err && <div className="admin-error-banner" style={{ margin: '10px 20px 0' }}>{err}</div>}

        {order && (
          <>
            {/* Status bar */}
            <div className="admin-order-status-bar">
              <div>
                <StatusBadge status={order.status} />
                <PaymentBadge status={order.paymentStatus} />
              </div>
              <div className="admin-status-actions">
                {VALID_NEXT_STATUS[order.status].map((n) => (
                  <button key={n} className={n === 'cancelled' ? 'admin-btn-danger' : 'admin-btn-primary'} disabled={working} onClick={() => changeStatus(n)}>
                    {n === 'cancelled' ? 'Cancel' : `→ ${n}`}
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
              </div>
            </div>

            <nav className="admin-order-tabs">
              {(['overview', 'items', 'delivery', 'refund', 'timeline'] as const).map((t) => (
                <button key={t} className={`admin-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </nav>

            <div className="admin-drawer-body">
              {tab === 'overview' && <OverviewTab order={order} onChanged={onRefresh} />}
              {tab === 'items' && <ItemsTab order={order} adminUser={adminUser} onChanged={onRefresh} />}
              {tab === 'delivery' && <DeliveryTab order={order} adminUser={adminUser} onChanged={onRefresh} />}
              {tab === 'refund' && <RefundTab order={order} adminUser={adminUser} onChanged={onRefresh} />}
              {tab === 'timeline' && <TimelineTab order={order} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function OverviewTab({ order, onChanged }: { order: AdminOrder; onChanged: () => void }) {
  return (
    <div>
      <section className="admin-form-section">
        <h3 className="admin-form-label" style={{ fontSize: 13 }}>Customer</h3>
        <div><strong>{order.customerName || '—'}</strong></div>
        <div className="admin-sub">{order.customerEmail} · {order.customerPhone}</div>
      </section>
      <section className="admin-form-section">
        <h3 className="admin-form-label" style={{ fontSize: 13 }}>Totals</h3>
        <div className="admin-totals">
          <div><span>Subtotal</span><strong>€{(order.subtotal / 100).toFixed(2)}</strong></div>
          {order.discountAmount > 0 && <div><span>Discount</span><strong>−€{(order.discountAmount / 100).toFixed(2)}</strong></div>}
          <div className="admin-total-final"><span>Total</span><strong>€{(order.total / 100).toFixed(2)}</strong></div>
        </div>
      </section>
      <section className="admin-form-section">
        <h3 className="admin-form-label" style={{ fontSize: 13 }}>Payment</h3>
        <div>Method: <strong>{order.paymentMethod ?? '—'}</strong></div>
        <div>Status: <PaymentBadge status={order.paymentStatus} /></div>
        {(order.refundAmount ?? 0) > 0 && (
          <div className="admin-sub" style={{ marginTop: 4 }}>
            Refunded: <strong>€{((order.refundAmount ?? 0) / 100).toFixed(2)}</strong>
          </div>
        )}
      </section>
      <PaymentLinkBlock order={order} onChanged={onChanged} />
      {(order.voucherUses.length > 0 || order.discountAmount > 0) && (
        <section className="admin-form-section">
          <h3 className="admin-form-label" style={{ fontSize: 13 }}>
            Discount · −€{(order.discountAmount / 100).toFixed(2)}
          </h3>
          {order.voucherUses.length > 0 ? (
            order.voucherUses.map((v) => (
              <div key={v.id}>
                Voucher <code>{v.code}</code> — €{(v.amount / 100).toFixed(2)}
                <span className="admin-sub" style={{ marginLeft: 8 }}>
                  {new Date(v.usedAt).toLocaleDateString('en-GB')}
                </span>
              </div>
            ))
          ) : (
            <div className="admin-sub">Manual discount — no voucher on record.</div>
          )}
        </section>
      )}
      <section className="admin-form-section">
        <h3 className="admin-form-label" style={{ fontSize: 13 }}>Meta</h3>
        <div>Cutlery: {order.cutlery ? 'yes' : 'no'}</div>
        <div>Invoice: {order.invoiceType ?? 'receipt'}{order.invoiceName ? ` — ${order.invoiceName}` : ''}</div>
        {order.notes && <div className="admin-note-box">Customer note: {order.notes}</div>}
        {order.adminNotes && <div className="admin-note-box admin-note-admin">Admin note: {order.adminNotes}</div>}
      </section>
    </div>
  )
}

function ItemsTab({ order, adminUser, onChanged }: { order: AdminOrder; adminUser: string; onChanged: () => void }) {
  return (
    <div>
      {order.childOrders.map((c) => (
        <section key={c.id} className="admin-form-section">
          <h3 className="admin-form-label" style={{ fontSize: 13 }}>
            {c.deliveryDate} · {c.timeFrom?.slice(0, 5)} — {c.timeTo?.slice(0, 5)}
          </h3>
          <table className="admin-table admin-table-tight">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {c.items.length === 0 && <tr><td colSpan={5} className="admin-table-empty">No items.</td></tr>}
              {c.items.map((it) => (
                <ItemRow key={it.id} item={it} orderId={order.id} childOrderId={c.id} adminUser={adminUser} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

function ItemRow({ item, orderId, childOrderId, adminUser, onChanged }: {
  item: { id: string; nameEl: string; variantLabelEl: string; quantity: number; unitPrice: number; totalPrice: number; comment: string | null }
  orderId: string; childOrderId: string; adminUser: string; onChanged: () => void
}) {
  const [qty, setQty] = useState(item.quantity)
  const dirty = qty !== item.quantity
  async function save() {
    await updateOrderItemQuantity(item.id, item.quantity, qty, orderId, childOrderId, adminUser)
    onChanged()
  }
  async function del() {
    if (!confirm('Remove this item?')) return
    await updateOrderItemQuantity(item.id, item.quantity, 0, orderId, childOrderId, adminUser)
    onChanged()
  }
  return (
    <tr>
      <td>
        <div>{item.nameEl}</div>
        {item.variantLabelEl && <div className="admin-sub">{item.variantLabelEl}</div>}
        {item.comment && <div className="admin-sub">💬 {item.comment}</div>}
      </td>
      <td>
        <input className="admin-input admin-input-tight" type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, +e.target.value || 0))} style={{ width: 64 }} />
      </td>
      <td>€{(item.unitPrice / 100).toFixed(2)}</td>
      <td>€{((item.unitPrice * qty) / 100).toFixed(2)}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {dirty && <button className="admin-row-btn" onClick={save}>Save</button>}
        <button className="admin-row-btn danger" onClick={del}>Remove</button>
      </td>
    </tr>
  )
}

function DeliveryTab({ order, adminUser, onChanged }: { order: AdminOrder; adminUser: string; onChanged: () => void }) {
  return (
    <div>
      {order.childOrders.map((c) => (
        <ChildOrderEditor key={c.id} child={c} orderId={order.id} adminUser={adminUser} onChanged={onChanged} />
      ))}
    </div>
  )
}

function ChildOrderEditor({ child, orderId, adminUser, onChanged }: {
  child: { id: string; deliveryDate: string; timeFrom: string | null; timeTo: string | null; addressStreet: string | null; addressArea: string | null; addressZip: string | null; addressFloor: string | null }
  orderId: string; adminUser: string; onChanged: () => void
}) {
  const [street, setStreet] = useState(child.addressStreet ?? '')
  const [area, setArea] = useState(child.addressArea ?? '')
  const [zip, setZip] = useState(child.addressZip ?? '')
  const [floor, setFloor] = useState(child.addressFloor ?? '')
  const [timeFrom, setTimeFrom] = useState(child.timeFrom?.slice(0, 5) ?? '')
  const [timeTo, setTimeTo] = useState(child.timeTo?.slice(0, 5) ?? '')

  async function saveAddress() {
    await updateChildOrderAddress(child.id, orderId, { street, area, zip, floor }, adminUser)
    onChanged()
  }
  async function saveTime() {
    await updateChildOrderTime(child.id, orderId, timeFrom ? `${timeFrom}:00` : null, timeTo ? `${timeTo}:00` : null, adminUser)
    onChanged()
  }

  return (
    <section className="admin-form-section">
      <h3 className="admin-form-label" style={{ fontSize: 13 }}>{child.deliveryDate}</h3>
      <div className="admin-grid-2">
        <div><label className="admin-form-label">Street</label><input className="admin-input" value={street} onChange={(e) => setStreet(e.target.value)} /></div>
        <div><label className="admin-form-label">Area</label><input className="admin-input" value={area} onChange={(e) => setArea(e.target.value)} /></div>
        <div><label className="admin-form-label">Zip</label><input className="admin-input" value={zip} onChange={(e) => setZip(e.target.value)} /></div>
        <div><label className="admin-form-label">Floor</label><input className="admin-input" value={floor} onChange={(e) => setFloor(e.target.value)} /></div>
      </div>
      <div className="admin-inline-form" style={{ marginTop: 10 }}>
        <button className="admin-btn-ghost" onClick={saveAddress}>Save address</button>
      </div>
      <div className="admin-inline-form" style={{ marginTop: 14 }}>
        <label className="admin-form-label" style={{ marginRight: 8 }}>Time window</label>
        <input className="admin-input" type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} style={{ width: 110 }} />
        <span className="admin-text-muted">to</span>
        <input className="admin-input" type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} style={{ width: 110 }} />
        <button className="admin-btn-ghost" onClick={saveTime}>Save time</button>
      </div>
    </section>
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
  if (!isLinkMethod) return null

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
            <span className={`admin-pill admin-pill-${link.status === 'success' ? 'ok' : link.status === 'failure' ? 'err' : 'warn'}`}>
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
      <p className="admin-sub">Latest {order.changeLog.length} changes:</p>
      <table className="admin-table admin-table-tight">
        <thead><tr><th>When</th><th>Field</th><th>Old</th><th>New</th><th>Label</th><th>By</th></tr></thead>
        <tbody>
          {order.changeLog.length === 0 && <tr><td colSpan={6} className="admin-table-empty">No admin changes yet.</td></tr>}
          {order.changeLog.map((l) => (
            <tr key={l.id}>
              <td className="admin-sub">{new Date(l.createdAt).toLocaleString('en-GB')}</td>
              <td>{l.tableName}.{l.fieldName}</td>
              <td className="admin-sub">{l.oldValue ?? '—'}</td>
              <td className="admin-sub">{l.newValue ?? '—'}</td>
              <td>{l.label}</td>
              <td className="admin-sub">{l.adminUser}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
