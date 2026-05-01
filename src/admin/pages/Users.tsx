import { useEffect, useState } from 'react'
import {
  fetchAdminUsers, fetchAdminUserDetail, saveAdminUserNotes, setWalletAdminManaged,
  grantWalletCredit,
  type AdminUserRow, type AdminUserDetail, type WalletGrantType,
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

  async function handleImpersonate(d: AdminUserDetail) {
    // Approach A — session swap. The store stashes the admin's session,
    // calls /api/admin-impersonate-start to mint a magic-link token for
    // the customer, then verifyOtp swaps the active Supabase session.
    // From there the customer site renders with the customer's data
    // because auth.uid() is the customer.
    const { ok, error } = await startImpersonation(d.userId)
    if (!ok) {
      setErr(error ?? 'Failed to start impersonation')
      return
    }
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
  const [showGrantModal, setShowGrantModal] = useState(false)

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

      {/* Wallet management. Always shown — even if the user has no wallet
          row yet, admin can still grant credit (which creates the wallet). */}
      <h3 className="admin-page-sub" style={{ marginTop: 24, marginBottom: 8 }}>Wallet</h3>
      <div style={{
        padding: 14, background: 'var(--a-bg)', border: '1px solid var(--a-border)',
        borderRadius: 8,
      }}>
        {detail.walletDetail ? (
          <>
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
          </>
        ) : (
          <div className="admin-text-muted" style={{ marginBottom: 8 }}>
            No wallet yet. Granting credit will create one.
          </div>
        )}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: detail.walletDetail ? '1px solid var(--a-border)' : 'none' }}>
          <button
            className="admin-btn-primary"
            onClick={() => setShowGrantModal(true)}
          >
            + Grant credit
          </button>
          <span className="admin-text-muted" style={{ marginLeft: 10, fontSize: 12 }}>
            Refund, gift, or balance adjustment. Capped at €500 per grant.
          </span>
        </div>
      </div>

      {showGrantModal && (
        <GrantCreditModal
          userId={detail.userId}
          userName={detail.name || detail.email}
          onClose={() => setShowGrantModal(false)}
          onGranted={() => { setShowGrantModal(false); onWalletAdminManagedChange() }}
        />
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
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--a-text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  )
}

/* ─── Grant credit modal ───────────────────────────────────────────────── */

const GRANT_TYPE_DEFAULTS: Record<WalletGrantType, { el: string; en: string }> = {
  refund:     { el: 'Επιστροφή χρημάτων',  en: 'Refund' },
  gift:       { el: 'Δώρο Fitpal',          en: 'Fitpal gift' },
  adjustment: { el: 'Προσαρμογή υπολοίπου', en: 'Balance adjustment' },
}

function GrantCreditModal({
  userId, userName, onClose, onGranted,
}: {
  userId: string
  userName: string
  onClose: () => void
  onGranted: () => void
}) {
  const [amountStr, setAmountStr] = useState('')
  const [type, setType] = useState<WalletGrantType>('gift')
  const [descriptionEl, setDescriptionEl] = useState(GRANT_TYPE_DEFAULTS.gift.el)
  const [descriptionEn, setDescriptionEn] = useState(GRANT_TYPE_DEFAULTS.gift.en)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Track whether the user has manually edited the description fields. If
  // not, switching the type updates them to the default; if they have, we
  // leave their text alone (don't clobber a custom message).
  const [descriptionTouched, setDescriptionTouched] = useState(false)

  function handleTypeChange(next: WalletGrantType) {
    setType(next)
    if (!descriptionTouched) {
      setDescriptionEl(GRANT_TYPE_DEFAULTS[next].el)
      setDescriptionEn(GRANT_TYPE_DEFAULTS[next].en)
    }
  }

  async function handleSubmit() {
    setErr(null)
    const amountEuros = Number(amountStr)
    if (!Number.isFinite(amountEuros) || amountEuros <= 0) {
      setErr('Amount must be a positive number')
      return
    }
    if (amountEuros > 500) {
      setErr('Amount exceeds €500 cap')
      return
    }
    if (!descriptionEl.trim() || !descriptionEn.trim()) {
      setErr('Both description fields are required')
      return
    }
    setSubmitting(true)
    const { error } = await grantWalletCredit({
      targetUserId: userId,
      amountCents: Math.round(amountEuros * 100),
      type,
      descriptionEl: descriptionEl.trim(),
      descriptionEn: descriptionEn.trim(),
    })
    setSubmitting(false)
    if (error) {
      setErr(error)
      return
    }
    onGranted()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Grant wallet credit"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--a-surface)',
        border: '1px solid var(--a-border)',
        borderRadius: 12,
        padding: 22,
        width: 'min(540px, 100%)',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <h2 className="admin-page-title" style={{ marginTop: 0, marginBottom: 4 }}>
          Grant wallet credit
        </h2>
        <p className="admin-text-muted" style={{ marginTop: 0, marginBottom: 18 }}>
          To <strong>{userName}</strong>. The amount will be added as bonus credit and visible in their wallet history.
        </p>

        {err && <div className="admin-error-banner">{err}</div>}

        <div className="admin-form-grid" style={{ marginTop: 4 }}>
          <div className="admin-form-row">
            <label>Amount (€)</label>
            <input
              className="admin-input"
              type="number"
              step="0.01"
              min="0"
              max="500"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="e.g. 10.00"
              autoFocus
            />
            <small className="admin-text-muted">Max €500 per grant.</small>
          </div>

          <div className="admin-form-row">
            <label>Type</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['refund', 'gift', 'adjustment'] as WalletGrantType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={type === t ? 'admin-btn-primary' : 'admin-btn-ghost'}
                  onClick={() => handleTypeChange(t)}
                  style={{ textTransform: 'capitalize', flex: '1 1 0' }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-form-row" style={{ gridColumn: '1 / -1' }}>
            <label>Description (Greek) — visible to customer</label>
            <input
              className="admin-input"
              value={descriptionEl}
              onChange={(e) => { setDescriptionEl(e.target.value); setDescriptionTouched(true) }}
            />
          </div>

          <div className="admin-form-row" style={{ gridColumn: '1 / -1' }}>
            <label>Description (English) — visible to customer</label>
            <input
              className="admin-input"
              value={descriptionEn}
              onChange={(e) => { setDescriptionEn(e.target.value); setDescriptionTouched(true) }}
            />
          </div>
        </div>

        <div className="admin-form-actions">
          <button className="admin-btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Granting…' : 'Grant credit'}
          </button>
          <button className="admin-btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
