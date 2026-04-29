import { useEffect, useMemo, useState } from 'react'
import {
  fetchAdminVouchers, createVoucher, saveVoucher, deactivateVoucher,
  fetchVoucherUses, VOUCHER_TYPES,
  type AdminVoucher, type AdminVoucherUseRow, type VoucherType,
} from '../../lib/api/adminVouchers'

/**
 * Vouchers admin — list + per-row editor + uses panel.
 *
 * Pricing units: pct = 1–100 percent. fixed = euros (we convert to cents on
 * save). credit = euros (we convert to cents). All money columns in DB are
 * cents to match the rest of the app.
 *
 * Soft-delete only: `Deactivate` flips active=false. We never DELETE because
 * voucher_uses rows reference voucher_id and we want the audit trail.
 */
export function Vouchers() {
  const [vouchers, setVouchers] = useState<AdminVoucher[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)

  async function refresh(keepId?: string | null) {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminVouchers()
    if (error) setErr(error)
    setVouchers(data ?? [])
    if (keepId !== undefined) setSelectedId(keepId)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toUpperCase()
    return vouchers.filter((v) => {
      if (!showInactive && !v.active) return false
      if (q && !v.code.includes(q)) return false
      return true
    })
  }, [vouchers, filter, showInactive])

  const selected = vouchers.find((v) => v.id === selectedId) ?? null

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Vouchers</h1>
          <p className="admin-page-sub">
            {vouchers.length} total · {vouchers.filter((v) => v.active).length} active
          </p>
        </div>
        <button className="admin-btn-primary" onClick={() => { setCreatingNew(true); setSelectedId(null) }}>
          + New voucher
        </button>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <div className="admin-zones-layout">
          <aside className="admin-zones-list">
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                className="admin-input"
                placeholder="Filter by code…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#6b7280' }}>
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show inactive
              </label>
            </div>
            {filtered.length === 0 && (
              <div className="admin-text-muted" style={{ padding: 14 }}>No vouchers match.</div>
            )}
            {filtered.map((v) => (
              <button
                key={v.id}
                className={`admin-zone-item${selectedId === v.id ? ' selected' : ''}${!v.active ? ' inactive' : ''}`}
                onClick={() => { setSelectedId(v.id); setCreatingNew(false) }}
              >
                <div className="admin-zone-item-name">{v.code}</div>
                <div className="admin-zone-item-meta">
                  {labelForType(v.type, v.value)} · {v.usesCount}{v.maxUses != null ? `/${v.maxUses}` : ''} uses
                  {!v.active && <> · <em>inactive</em></>}
                </div>
              </button>
            ))}
          </aside>

          <div className="admin-zones-editor">
            {creatingNew ? (
              <VoucherEditor
                key="new"
                voucher={null}
                onSaved={(v) => { setCreatingNew(false); refresh(v?.id ?? null) }}
                onCancel={() => setCreatingNew(false)}
              />
            ) : selected ? (
              <VoucherEditor
                key={selected.id}
                voucher={selected}
                onSaved={(v) => refresh(v?.id ?? selected.id)}
              />
            ) : (
              <div className="admin-text-muted" style={{ padding: 40, textAlign: 'center' }}>
                Pick a voucher to edit, or create a new one.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function labelForType(type: VoucherType, value: number): string {
  if (type === 'pct') return `-${value}%`
  if (type === 'fixed') return `-€${(value / 100).toFixed(2)}`
  return `€${(value / 100).toFixed(2)} credit`
}

interface FormState {
  code: string
  type: VoucherType
  valueDisplay: string  // user-facing value (pct as %, fixed/credit as euros)
  remainingDisplay: string
  minOrderDisplay: string
  maxUses: string
  perUserLimit: string
  expiresAt: string
  active: boolean
  userEmail: string  // optional — links voucher to a specific customer
}

function VoucherEditor({
  voucher, onSaved, onCancel,
}: {
  voucher: AdminVoucher | null
  onSaved: (v: AdminVoucher | null) => void
  onCancel?: () => void
}) {
  const [form, setForm] = useState<FormState>(() => fromVoucher(voucher))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [uses, setUses] = useState<AdminVoucherUseRow[]>([])
  const [usesLoading, setUsesLoading] = useState(false)

  useEffect(() => { setForm(fromVoucher(voucher)); setErr(null) }, [voucher])

  // Load uses panel only for existing vouchers.
  useEffect(() => {
    if (!voucher?.id) { setUses([]); return }
    setUsesLoading(true)
    fetchVoucherUses(voucher.id).then(({ data }) => {
      setUses(data); setUsesLoading(false)
    })
  }, [voucher?.id])

  function patch<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleSave() {
    setErr(null); setSaving(true)
    const { ok, draft, error } = serialise(form)
    if (!ok) { setErr(error ?? 'Invalid'); setSaving(false); return }

    if (voucher) {
      const { error: e } = await saveVoucher(voucher.id, draft)
      if (e) { setErr(e); setSaving(false); return }
      onSaved({ ...voucher, ...mergeDraftForDisplay(voucher, draft) })
    } else {
      const { data, error: e } = await createVoucher(draft)
      if (e || !data) { setErr(e ?? 'Create failed'); setSaving(false); return }
      onSaved(data)
    }
    setSaving(false)
  }

  async function handleDeactivate() {
    if (!voucher) return
    if (!window.confirm(`Deactivate ${voucher.code}? It cannot be applied to new orders.`)) return
    setSaving(true); setErr(null)
    const { error } = await deactivateVoucher(voucher.id)
    if (error) { setErr(error); setSaving(false); return }
    onSaved({ ...voucher, active: false })
    setSaving(false)
  }

  return (
    <div className="admin-voucher-editor">
      <h2 className="admin-page-title" style={{ marginTop: 0 }}>
        {voucher ? `Edit ${voucher.code}` : 'New voucher'}
      </h2>

      {err && <div className="admin-error-banner">{err}</div>}

      <div className="admin-form-grid">
        <div className="admin-form-row">
          <label>Code</label>
          <input
            className="admin-input"
            value={form.code}
            onChange={(e) => patch('code', e.target.value.toUpperCase())}
            placeholder="WELCOME10"
            disabled={!!voucher}  // codes are immutable post-creation
          />
        </div>

        <div className="admin-form-row">
          <label>Type</label>
          <select
            className="admin-input"
            value={form.type}
            onChange={(e) => patch('type', e.target.value as VoucherType)}
            disabled={!!voucher}
          >
            {VOUCHER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <small className="admin-text-muted">
            {VOUCHER_TYPES.find((t) => t.id === form.type)?.help}
          </small>
        </div>

        <div className="admin-form-row">
          <label>{form.type === 'pct' ? 'Discount %' : 'Amount (€)'}</label>
          <input
            className="admin-input"
            type="number"
            step={form.type === 'pct' ? '1' : '0.01'}
            min="0"
            value={form.valueDisplay}
            onChange={(e) => patch('valueDisplay', e.target.value)}
          />
        </div>

        {form.type === 'credit' && voucher && (
          <div className="admin-form-row">
            <label>Remaining (€)</label>
            <input
              className="admin-input"
              type="number"
              step="0.01"
              min="0"
              value={form.remainingDisplay}
              onChange={(e) => patch('remainingDisplay', e.target.value)}
            />
            <small className="admin-text-muted">Auto-decrements as the customer redeems.</small>
          </div>
        )}

        <div className="admin-form-row">
          <label>Min order (€)</label>
          <input
            className="admin-input"
            type="number"
            step="0.01"
            min="0"
            value={form.minOrderDisplay}
            onChange={(e) => patch('minOrderDisplay', e.target.value)}
          />
        </div>

        <div className="admin-form-row">
          <label>Max uses (total)</label>
          <input
            className="admin-input"
            type="number"
            min="0"
            value={form.maxUses}
            onChange={(e) => patch('maxUses', e.target.value)}
            placeholder="Unlimited"
          />
        </div>

        <div className="admin-form-row">
          <label>Per-user limit</label>
          <input
            className="admin-input"
            type="number"
            min="0"
            value={form.perUserLimit}
            onChange={(e) => patch('perUserLimit', e.target.value)}
            placeholder="Unlimited"
          />
        </div>

        <div className="admin-form-row">
          <label>Expires at</label>
          <input
            className="admin-input"
            type="datetime-local"
            value={form.expiresAt}
            onChange={(e) => patch('expiresAt', e.target.value)}
          />
        </div>

        <div className="admin-form-row">
          <label>Customer email (optional — link to specific user)</label>
          <input
            className="admin-input"
            type="email"
            value={form.userEmail}
            onChange={(e) => patch('userEmail', e.target.value)}
            placeholder="customer@example.com"
            disabled  // resolution to user_id deferred — admin Users page handles linking
          />
          <small className="admin-text-muted">
            Setting a customer-link via email isn't wired yet (uses Users admin lookup, coming soon).
          </small>
        </div>

        <div className="admin-form-row">
          <label>Active</label>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => patch('active', e.target.checked)}
          />
        </div>
      </div>

      <div className="admin-form-actions">
        <button className="admin-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : voucher ? 'Save changes' : 'Create voucher'}
        </button>
        {voucher && voucher.active && (
          <button className="admin-btn-danger" onClick={handleDeactivate} disabled={saving}>
            Deactivate
          </button>
        )}
        {onCancel && (
          <button className="admin-btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>

      {voucher && (
        <div style={{ marginTop: 24 }}>
          <h3 className="admin-page-sub" style={{ marginBottom: 8 }}>
            Uses ({voucher.usesCount})
          </h3>
          {usesLoading && <div className="admin-loading">Loading…</div>}
          {!usesLoading && uses.length === 0 && (
            <div className="admin-text-muted">No redemptions yet.</div>
          )}
          {!usesLoading && uses.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Order</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {uses.map((u) => (
                  <tr key={u.id}>
                    <td>{new Date(u.usedAt).toLocaleString()}</td>
                    <td>{u.userEmail ?? <em>—</em>}</td>
                    <td>{u.orderNumber ?? <em>—</em>}</td>
                    <td style={{ textAlign: 'right' }}>€{(u.amount / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function fromVoucher(v: AdminVoucher | null): FormState {
  if (!v) {
    return {
      code: '', type: 'pct', valueDisplay: '10', remainingDisplay: '',
      minOrderDisplay: '0', maxUses: '', perUserLimit: '',
      expiresAt: '', active: true, userEmail: '',
    }
  }
  return {
    code: v.code,
    type: v.type,
    valueDisplay: v.type === 'pct' ? String(v.value) : (v.value / 100).toFixed(2),
    remainingDisplay: v.remaining != null ? (v.remaining / 100).toFixed(2) : '',
    minOrderDisplay: (v.minOrder / 100).toFixed(2),
    maxUses: v.maxUses != null ? String(v.maxUses) : '',
    perUserLimit: v.perUserLimit != null ? String(v.perUserLimit) : '',
    expiresAt: v.expiresAt ? toLocalInputValue(v.expiresAt) : '',
    active: v.active,
    userEmail: '',
  }
}

function toLocalInputValue(iso: string): string {
  // <input type="datetime-local"> wants 'YYYY-MM-DDTHH:mm' in LOCAL time, no zone.
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function serialise(form: FormState):
  | { ok: true; draft: Parameters<typeof createVoucher>[0]; error?: undefined }
  | { ok: false; draft?: undefined; error: string }
{
  const code = form.code.trim().toUpperCase()
  if (!code) return { ok: false, error: 'Code is required' }

  const valueNum = Number(form.valueDisplay)
  if (!Number.isFinite(valueNum) || valueNum < 0) return { ok: false, error: 'Invalid value' }

  let value = valueNum
  if (form.type !== 'pct') value = Math.round(valueNum * 100)
  if (form.type === 'pct' && (valueNum > 100)) return { ok: false, error: 'Percentage must be ≤ 100' }

  const minOrderNum = Number(form.minOrderDisplay || 0)
  if (!Number.isFinite(minOrderNum) || minOrderNum < 0) return { ok: false, error: 'Invalid min order' }

  const maxUses = form.maxUses.trim() ? Number(form.maxUses) : null
  if (maxUses != null && (!Number.isFinite(maxUses) || maxUses < 0)) return { ok: false, error: 'Invalid max uses' }

  const perUserLimit = form.perUserLimit.trim() ? Number(form.perUserLimit) : null
  if (perUserLimit != null && (!Number.isFinite(perUserLimit) || perUserLimit < 0)) return { ok: false, error: 'Invalid per-user limit' }

  let remaining: number | null | undefined = undefined
  if (form.type === 'credit') {
    if (form.remainingDisplay.trim() === '') {
      remaining = value  // default = starting value
    } else {
      const r = Number(form.remainingDisplay)
      if (!Number.isFinite(r) || r < 0) return { ok: false, error: 'Invalid remaining' }
      remaining = Math.round(r * 100)
    }
  }

  return {
    ok: true,
    draft: {
      code,
      type: form.type,
      value,
      remaining,
      minOrder: Math.round(minOrderNum * 100),
      maxUses,
      perUserLimit,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      active: form.active,
    },
  }
}

function mergeDraftForDisplay(
  v: AdminVoucher,
  draft: Parameters<typeof createVoucher>[0],
): Partial<AdminVoucher> {
  return {
    code: draft.code ?? v.code,
    type: draft.type ?? v.type,
    value: draft.value ?? v.value,
    remaining: (draft as { remaining?: number | null }).remaining ?? v.remaining,
    minOrder: draft.minOrder ?? v.minOrder,
    maxUses: draft.maxUses ?? v.maxUses,
    perUserLimit: draft.perUserLimit ?? v.perUserLimit,
    expiresAt: draft.expiresAt ?? v.expiresAt,
    active: draft.active ?? v.active,
  }
}
