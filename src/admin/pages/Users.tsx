import { useEffect, useState } from 'react'
import {
  fetchAdminUsers, fetchAdminUserDetail, saveAdminUserNotes, setWalletAdminManaged,
  type AdminUserRow, type AdminUserDetail,
} from '../../lib/api/adminUsers'
import { useImpersonationStore } from '../../store/useImpersonationStore'
import { useNavigate } from 'react-router-dom'

const PAGE_SIZE = 50

/**
 * Users admin — searchable list + per-user detail panel.
 *
 * Detail panel exposes:
 *   - Profile summary (name, phone, email, member since)
 *   - Editable admin-only fields: dietician, dietary_notes
 *   - Wallet status + the admin_managed toggle
 *   - Stats: orders count, total spent
 *   - Recent orders (last 20)
 *   - "Place an order for this customer" button — kicks off impersonation
 *
 * The list intentionally doesn't expose every detail; it's a directory.
 * Click into a user to see and edit.
 */
export function Users() {
  const navigate = useNavigate()
  const startImpersonation = useImpersonationStore((s) => s.start)

  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function refresh(opts?: { page?: number; search?: string }) {
    setLoading(true); setErr(null)
    const p = opts?.page ?? page
    const s = opts?.search ?? search
    const { data, total: t, error } = await fetchAdminUsers({
      search: s, limit: PAGE_SIZE, offset: p * PAGE_SIZE,
    })
    if (error) setErr(error)
    setRows(data); setTotal(t); setLoading(false)
  }

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDetail(userId: string) {
    setSelectedId(userId); setDetailLoading(true)
    const { data, error } = await fetchAdminUserDetail(userId)
    if (error || !data) {
      setErr(error ?? 'Could not load user')
      setDetail(null)
    } else {
      setDetail(data)
    }
    setDetailLoading(false)
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPage(0); setSearch(searchInput)
    refresh({ page: 0, search: searchInput })
  }

  function handleImpersonate(d: AdminUserDetail) {
    startImpersonation({
      userId: d.userId,
      email: d.email,
      name: d.name,
      addresses: d.addresses,
      walletBalance: d.walletBalance,
      walletAdminManaged: d.walletAdminManaged,
    })
    // Land on the customer menu so admin can build the order.
    navigate('/')
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Users</h1>
          <p className="admin-page-sub">{total} total · page {page + 1} of {pageCount}</p>
        </div>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            className="admin-input"
            placeholder="Search email or name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button className="admin-btn-primary" type="submit">Search</button>
          {search && (
            <button
              className="admin-btn-ghost"
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); setPage(0); refresh({ page: 0, search: '' }) }}
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading users…</div>}

      {!loading && (
        <div className="admin-zones-layout">
          <aside className="admin-zones-list">
            {rows.length === 0 && (
              <div className="admin-text-muted" style={{ padding: 14 }}>No users match.</div>
            )}
            {rows.map((u) => (
              <button
                key={u.userId}
                className={`admin-zone-item${selectedId === u.userId ? ' selected' : ''}`}
                onClick={() => loadDetail(u.userId)}
              >
                <div className="admin-zone-item-name">
                  {u.name || u.email || '(no name)'}
                  {u.isAdmin && <span style={{ marginLeft: 6, fontSize: 10, color: '#a16207' }}>★ admin</span>}
                  {u.walletAdminManaged && <span style={{ marginLeft: 6, fontSize: 10, color: '#0369a1' }}>● managed</span>}
                </div>
                <div className="admin-zone-item-meta">
                  {u.email} · {u.ordersCount} orders · €{(u.totalSpent / 100).toFixed(2)} spent
                  {u.walletActive && <> · €{(u.walletBalance / 100).toFixed(2)} wallet</>}
                </div>
              </button>
            ))}
            {pageCount > 1 && (
              <div style={{ padding: 10, display: 'flex', gap: 6, justifyContent: 'space-between' }}>
                <button
                  className="admin-btn-ghost"
                  disabled={page === 0}
                  onClick={() => { const np = Math.max(0, page - 1); setPage(np); refresh({ page: np }) }}
                >
                  ← Prev
                </button>
                <button
                  className="admin-btn-ghost"
                  disabled={page >= pageCount - 1}
                  onClick={() => { const np = Math.min(pageCount - 1, page + 1); setPage(np); refresh({ page: np }) }}
                >
                  Next →
                </button>
              </div>
            )}
          </aside>

          <div className="admin-zones-editor">
            {detailLoading && <div className="admin-loading">Loading user…</div>}
            {!detailLoading && detail && (
              <UserDetail
                detail={detail}
                onSavedNotes={() => loadDetail(detail.userId)}
                onWalletAdminManagedChange={() => loadDetail(detail.userId)}
                onImpersonate={() => handleImpersonate(detail)}
              />
            )}
            {!detailLoading && !detail && (
              <div className="admin-text-muted" style={{ padding: 40, textAlign: 'center' }}>
                Pick a user to see their full profile.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function UserDetail({
  detail, onSavedNotes, onWalletAdminManagedChange, onImpersonate,
}: {
  detail: AdminUserDetail
  onSavedNotes: () => void
  onWalletAdminManagedChange: () => void
  onImpersonate: () => void
}) {
  const [dietician, setDietician] = useState(detail.dietician ?? '')
  const [dietaryNotes, setDietaryNotes] = useState(detail.dietaryNotes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [savingFlag, setSavingFlag] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setDietician(detail.dietician ?? '')
    setDietaryNotes(detail.dietaryNotes ?? '')
  }, [detail.userId, detail.dietician, detail.dietaryNotes])

  async function handleSaveNotes() {
    setSavingNotes(true); setErr(null)
    const { error } = await saveAdminUserNotes(detail.userId, {
      dietician: dietician.trim() || null,
      dietaryNotes: dietaryNotes.trim() || null,
    })
    if (error) setErr(error)
    setSavingNotes(false)
    onSavedNotes()
  }

  async function handleToggleAdminManaged(next: boolean) {
    if (!detail.walletDetail) {
      window.alert("This user doesn't have a wallet yet — can't flip the flag.")
      return
    }
    const msg = next
      ? `Mark wallet as admin-managed? Customer will no longer be able to spend their own wallet — only admins via impersonation.`
      : `Allow this customer to spend their wallet directly again?`
    if (!window.confirm(msg)) return
    setSavingFlag(true); setErr(null)
    const { error } = await setWalletAdminManaged(detail.userId, next)
    if (error) setErr(error)
    setSavingFlag(false)
    onWalletAdminManagedChange()
  }

  return (
    <div className="admin-user-editor">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 className="admin-page-title" style={{ marginTop: 0 }}>{detail.name || '(no name)'}</h2>
          <div className="admin-text-muted">
            {detail.email} · {detail.phone || 'no phone'} ·
            joined {new Date(detail.createdAt).toLocaleDateString()}
          </div>
          {detail.isAdmin && (
            <div style={{ marginTop: 4, display: 'inline-block', padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
              ★ ADMIN
            </div>
          )}
        </div>
        <button className="admin-btn-primary" onClick={onImpersonate}>
          Place order for this customer →
        </button>
      </div>

      {err && <div className="admin-error-banner" style={{ marginTop: 12 }}>{err}</div>}

      {/* Stats */}
      <div className="admin-form-grid" style={{ marginTop: 18 }}>
        <Stat label="Orders" value={String(detail.ordersCount)} />
        <Stat label="Total spent" value={`€${(detail.totalSpent / 100).toFixed(2)}`} />
        <Stat
          label="Wallet"
          value={detail.walletDetail
            ? `€${(detail.walletBalance / 100).toFixed(2)} · ${detail.walletAdminManaged ? 'managed' : 'self-serve'}`
            : 'None'}
        />
        <Stat label="Goals" value={detail.goals?.enabled ? 'On' : 'Off'} />
      </div>

      {/* Admin notes */}
      <h3 className="admin-page-sub" style={{ marginTop: 24, marginBottom: 8 }}>Admin notes (not visible to customer)</h3>
      <div className="admin-form-grid">
        <div className="admin-form-row">
          <label>Dietician</label>
          <input
            className="admin-input"
            value={dietician}
            onChange={(e) => setDietician(e.target.value)}
            placeholder="Maria Papadopoulos"
          />
        </div>
        <div className="admin-form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Dietary notes</label>
          <textarea
            className="admin-input"
            rows={3}
            value={dietaryNotes}
            onChange={(e) => setDietaryNotes(e.target.value)}
            placeholder="e.g. avoid dairy on Tuesdays per dietitian's plan"
          />
        </div>
      </div>
      <div className="admin-form-actions">
        <button className="admin-btn-primary" onClick={handleSaveNotes} disabled={savingNotes}>
          {savingNotes ? 'Saving…' : 'Save notes'}
        </button>
      </div>

      {/* Wallet management */}
      {detail.walletDetail && (
        <>
          <h3 className="admin-page-sub" style={{ marginTop: 24, marginBottom: 8 }}>Wallet</h3>
          <div style={{
            padding: 14, background: 'var(--a-bg)', border: '1px solid var(--a-border)',
            borderRadius: 8,
          }}>
            <div>Balance: <strong>€{(detail.walletDetail.balance / 100).toFixed(2)}</strong>
              <span className="admin-text-muted"> (base €{(detail.walletDetail.baseBalance / 100).toFixed(2)} + bonus €{(detail.walletDetail.bonusBalance / 100).toFixed(2)})</span>
            </div>
            <div className="admin-text-muted" style={{ marginTop: 4 }}>
              {detail.walletDetail.active ? 'Active' : 'Inactive'} ·
              {detail.walletDetail.autoRenew ? ' Auto-renews' : ' Manual renewal'}
              {detail.walletDetail.nextRenewal && ` · Next ${detail.walletDetail.nextRenewal}`}
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={detail.walletAdminManaged}
                  onChange={(e) => handleToggleAdminManaged(e.target.checked)}
                  disabled={savingFlag}
                />
                <strong>Admin-managed wallet</strong>
              </label>
              <span className="admin-text-muted" style={{ fontSize: 12 }}>
                When on, only admins (via impersonation) can spend this wallet.
              </span>
            </div>
          </div>
        </>
      )}

      {/* Recent orders */}
      <h3 className="admin-page-sub" style={{ marginTop: 24, marginBottom: 8 }}>Recent orders</h3>
      {detail.recentOrders.length === 0 ? (
        <div className="admin-text-muted">No orders yet.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>When</th>
                <th>Status</th>
                <th>Payment</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td><code>{o.orderNumber}</code></td>
                  <td>{new Date(o.createdAt).toLocaleString()}</td>
                  <td>{o.status}</td>
                  <td>{o.paymentMethod} · {o.paymentStatus}</td>
                  <td style={{ textAlign: 'right' }}>€{(o.total / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Addresses */}
      <h3 className="admin-page-sub" style={{ marginTop: 24, marginBottom: 8 }}>Addresses</h3>
      {detail.addresses.length === 0 ? (
        <div className="admin-text-muted">No saved addresses.</div>
      ) : (
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          {detail.addresses.map((a) => (
            <li key={a.id} style={{ marginBottom: 4 }}>
              <strong>{a.labelEl}</strong> · {a.street}, {a.zip ?? ''} {a.area}
              {a.isDefault && <span style={{ marginLeft: 6, fontSize: 10, color: '#0369a1' }}>★ default</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: 12, background: 'var(--a-bg)', border: '1px solid var(--a-border)',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--a-text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  )
}
