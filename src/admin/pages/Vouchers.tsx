import { useEffect, useMemo, useState } from 'react'
import {
  fetchAdminVouchers, createVoucher, saveVoucher, deactivateVoucher,
  fetchVoucherUses, VOUCHER_TYPES,
  type AdminVoucher, type AdminVoucherUseRow, type VoucherType,
} from '../../lib/api/adminVouchers'
import { fetchAdminCategories, type AdminCategory } from '../../lib/api/adminDishes'

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
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // WEC-904: Orders-style filter bar.
  const [search, setSearch] = useState('')
  const [fType, setFType] = useState<'' | VoucherType>('')
  const [fScope, setFScope] = useState<'' | 'orders' | 'subscriptions'>('')
  const [fStatus, setFStatus] = useState<'active' | 'inactive' | 'all'>('active')
  // Drawer: an existing voucher, 'new', or null (closed).
  const [drawer, setDrawer] = useState<AdminVoucher | 'new' | null>(null)

  async function refresh(keepOpen?: AdminVoucher | 'new' | null) {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminVouchers()
    if (error) setErr(error)
    setVouchers(data ?? [])
    if (keepOpen !== undefined) setDrawer(keepOpen)
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    return vouchers.filter((v) => {
      if (fStatus === 'active' && !v.active) return false
      if (fStatus === 'inactive' && v.active) return false
      if (fType && v.type !== fType) return false
      if (fScope && v.appliesTo !== fScope) return false
      if (q && !v.code.includes(q)) return false
      return true
    })
  }, [vouchers, search, fType, fScope, fStatus])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Vouchers</h1>
          <p className="admin-page-sub">
            {vouchers.length} total · {vouchers.filter((v) => v.active).length} active
          </p>
        </div>
        <button className="admin-btn-primary" onClick={() => setDrawer('new')}>+ New voucher</button>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}

      <div className="admin-filter-bar">
        <input className="admin-input" placeholder="Αναζήτηση κωδικού…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        <select className="admin-select" value={fType} onChange={(e) => setFType(e.target.value as '' | VoucherType)}>
          <option value="">Όλοι οι τύποι</option>
          <option value="pct">Ποσοστό %</option>
          <option value="fixed">Σταθερό €</option>
          <option value="credit">Credit €</option>
        </select>
        <select className="admin-select" value={fScope} onChange={(e) => setFScope(e.target.value as '' | 'orders' | 'subscriptions')}>
          <option value="">Όλα τα πεδία</option>
          <option value="orders">Παραγγελίες</option>
          <option value="subscriptions">Συνδρομές</option>
        </select>
        <select className="admin-select" value={fStatus} onChange={(e) => setFStatus(e.target.value as 'active' | 'inactive' | 'all')}>
          <option value="active">Ενεργά</option>
          <option value="inactive">Ανενεργά</option>
          <option value="all">Όλα</option>
        </select>
        {(search || fType || fScope || fStatus !== 'active') && (
          <button className="admin-btn-secondary admin-btn-sm" onClick={() => { setSearch(''); setFType(''); setFScope(''); setFStatus('active') }}>✕ Καθαρισμός</button>
        )}
        <button className="admin-btn-secondary" onClick={() => refresh()}>Refresh</button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">No vouchers match those filters.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Type</th>
              <th>Value</th>
              <th>Scope</th>
              <th>Uses</th>
              <th>Min order</th>
              <th>Expires</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const expired = v.expiresAt != null && v.expiresAt < today
              return (
                <tr key={v.id} onClick={() => setDrawer(v)} style={{ cursor: 'pointer', ...(v.active ? {} : { opacity: 0.55 }) }}>
                  <td>
                    <strong>{v.code}</strong>
                    {v.userId && <span className="admin-text-muted" title="Linked to a specific customer" style={{ marginLeft: 6 }}>🔒</span>}
                    {v.registeredOnly && <VPill bg="#eef2ff" fg="#3730a3" bd="#c7d2fe">registered</VPill>}
                  </td>
                  <td><VoucherTypeBadge type={v.type} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {labelForType(v.type, v.value)}
                    {v.type === 'credit' && v.remaining != null && (
                      <div className="admin-text-muted" style={{ fontSize: 11 }}>{(v.remaining / 100).toFixed(2)} € left</div>
                    )}
                  </td>
                  <td><VoucherScopeBadge scope={v.appliesTo} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{v.usesCount}{v.maxUses != null ? ` / ${v.maxUses}` : ' / ∞'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{v.minOrder > 0 ? `${(v.minOrder / 100).toFixed(2)} €` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {v.expiresAt
                      ? <span style={expired ? { color: '#b91c1c', fontWeight: 700 } : undefined}>{v.expiresAt.split('-').reverse().join('/')}{expired ? ' (ληγμένο)' : ''}</span>
                      : '—'}
                  </td>
                  <td>
                    {v.active
                      ? <VPill bg="#10b98122" fg="#047857" bd="#a7f3d0">Ενεργό</VPill>
                      : <VPill bg="#6b728022" fg="#4b5563" bd="#d1d5db">Ανενεργό</VPill>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="admin-btn-secondary admin-btn-sm" onClick={() => setDrawer(v)}>Edit</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {drawer && (
        <div className="admin-drawer-overlay" onClick={() => setDrawer(null)}>
          <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="admin-drawer-head">
              <span className="admin-drawer-head-title">{drawer === 'new' ? 'New voucher' : `Edit ${drawer.code}`}</span>
              <button className="admin-drawer-close" onClick={() => setDrawer(null)}>×</button>
            </div>
            <div className="admin-drawer-body">
              <VoucherEditor
                key={drawer === 'new' ? 'new' : drawer.id}
                voucher={drawer === 'new' ? null : drawer}
                onSaved={(v) => refresh(v ?? null)}
                onCancel={() => setDrawer(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// WEC-904: small pill helpers to match the Orders page badges.
function VPill({ bg, fg, bd, children }: { bg: string; fg: string; bd: string; children: string }) {
  return (
    <span style={{ display: 'inline-block', marginLeft: 6, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 800, background: bg, color: fg, border: `1px solid ${bd}`, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{children}</span>
  )
}
function VoucherTypeBadge({ type }: { type: VoucherType }) {
  const m: Record<VoucherType, [string, string, string, string]> = {
    pct:    ['#eef2ff', '#3730a3', '#c7d2fe', 'Ποσοστό %'],
    fixed:  ['#ecfdf5', '#047857', '#a7f3d0', 'Σταθερό €'],
    credit: ['#fffbeb', '#b45309', '#fde68a', 'Credit €'],
  }
  const [bg, fg, bd, label] = m[type]
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: bg, color: fg, border: `1px solid ${bd}`, whiteSpace: 'nowrap' }}>{label}</span>
}
function VoucherScopeBadge({ scope }: { scope: 'orders' | 'subscriptions' }) {
  const sub = scope === 'subscriptions'
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sub ? '#f5f3ff' : '#eff6ff', color: sub ? '#6d28d9' : '#1d4ed8', border: `1px solid ${sub ? '#ddd6fe' : '#bfdbfe'}`, whiteSpace: 'nowrap' }}>{sub ? 'Συνδρομές' : 'Παραγγελίες'}</span>
}

function labelForType(type: VoucherType, value: number): string {
  if (type === 'pct') return `-${value}%`
  if (type === 'fixed') return `-${(value / 100).toFixed(2)} €`
  return `${(value / 100).toFixed(2)} € credit`
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
  registeredOnly: boolean  // WEC-546: only logged-in users may redeem
  userEmail: string  // optional — links voucher to a specific customer
  /** WEC-262: empty array = applies to all categories. */
  applicableCategoryIds: string[]
  /** WEC-703: 'orders' (food) or 'subscriptions' (packages). */
  appliesTo: 'orders' | 'subscriptions'
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
          {/* WEC-898: non-blocking warning only — a code that mixes Greek and
              Latin look-alike letters (e.g. a Greek keyboard left the «ΚΑ» in
              KASTANAS20 as Greek) works via copy-paste but fails when the
              customer types it. No conversion, no enforcement — just a heads-up. */}
          {/[A-Za-z]/.test(form.code) && /[Ͱ-Ͽἀ-῿]/.test(form.code) && (
            <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '7px 10px' }}>
              ⚠ Ο κωδικός περιέχει <strong>ανάμειξη ελληνικών και λατινικών</strong> χαρακτήρων. Δουλεύει με αντιγραφή/επικόλληση αλλά <strong>αποτυγχάνει όταν τον πληκτρολογεί ο πελάτης</strong>. (Δεν εμποδίζει την αποθήκευση.)
            </div>
          )}
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

        {/* WEC-703: scope — a code redeems against food orders OR subscription
            purchases, never both. Locked after creation (redemptions reference
            the scope). Switching to subscriptions hides + clears categories. */}
        <div className="admin-form-row">
          <label>Applies to (WEC-703)</label>
          <select
            className="admin-input"
            value={form.appliesTo}
            onChange={(e) => patch('appliesTo', e.target.value as 'orders' | 'subscriptions')}
            disabled={!!voucher}
          >
            <option value="orders">Food orders</option>
            <option value="subscriptions">Subscription purchases</option>
          </select>
          <small className="admin-text-muted">
            {form.appliesTo === 'subscriptions'
              ? 'This code only applies when a customer buys a subscription package. Category scoping is disabled.'
              : 'This code only applies to à-la-carte food orders.'}
            {!voucher ? '' : ' Scope is fixed after creation.'}
          </small>
        </div>

        <div className="admin-form-row">
          <label>{form.type === 'pct' ? 'Discount %' : 'Amount (€)'}</label>
          <input
            className="admin-input"
            type="text"
            inputMode="decimal"
            onWheel={(e) => e.currentTarget.blur()}
            value={form.valueDisplay}
            onChange={(e) => patch('valueDisplay', e.target.value)}
          />
        </div>

        {form.type === 'credit' && voucher && (
          <div className="admin-form-row">
            <label>Remaining (€)</label>
            <input
              className="admin-input"
              type="text"
              inputMode="decimal"
              onWheel={(e) => e.currentTarget.blur()}
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
            type="text"
            inputMode="decimal"
            onWheel={(e) => e.currentTarget.blur()}
            value={form.minOrderDisplay}
            onChange={(e) => patch('minOrderDisplay', e.target.value)}
          />
        </div>

        <div className="admin-form-row">
          <label>Max uses (total)</label>
          <input
            className="admin-input"
            type="text"
            inputMode="numeric"
            onWheel={(e) => e.currentTarget.blur()}
            value={form.maxUses}
            onChange={(e) => patch('maxUses', e.target.value)}
            placeholder="Unlimited"
          />
        </div>

        <div className="admin-form-row">
          <label>Per-user limit</label>
          <input
            className="admin-input"
            type="text"
            inputMode="numeric"
            onWheel={(e) => e.currentTarget.blur()}
            value={form.perUserLimit}
            onChange={(e) => patch('perUserLimit', e.target.value)}
            placeholder="Unlimited"
          />
        </div>

        <div className="admin-form-row">
          <label>Registered users only (WEC-546)</label>
          <input
            type="checkbox"
            checked={form.registeredOnly}
            onChange={(e) => patch('registeredOnly', e.target.checked)}
          />
          <small className="admin-text-muted">
            When on, only logged-in customers can redeem this code (guests are rejected with "Log in to use this code").
          </small>
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

        {form.appliesTo === 'orders' && (
          <div className="admin-form-row">
            <label>Applicable categories (WEC-262)</label>
            <CategoryPicker
              selected={form.applicableCategoryIds}
              onChange={(ids) => patch('applicableCategoryIds', ids)}
            />
            <small className="admin-text-muted">
              Leave all unchecked to apply the discount to the whole order. Pick one or more categories to scope it — the discount only applies to the cart items in those categories.
            </small>
          </div>
        )}

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
                  <th>Order / Plan</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {uses.map((u) => (
                  <tr key={u.id}>
                    <td>{new Date(u.usedAt).toLocaleString()}</td>
                    <td>{u.userEmail ?? <em>—</em>}</td>
                    <td>{u.orderNumber ?? (u.planRef ? <span title="Subscription purchase">{u.planRef}</span> : <em>—</em>)}</td>
                    <td style={{ textAlign: 'right' }}>{(u.amount / 100).toFixed(2)} €</td>
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
      expiresAt: '', active: true, registeredOnly: false, userEmail: '',
      applicableCategoryIds: [], appliesTo: 'orders',
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
    registeredOnly: v.registeredOnly,
    userEmail: '',
    applicableCategoryIds: v.applicableCategoryIds ?? [],
    appliesTo: v.appliesTo ?? 'orders',
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
      registeredOnly: form.registeredOnly,
      // WEC-703: subscription vouchers are never category-scoped.
      applicableCategoryIds: form.appliesTo === 'subscriptions' ? [] : form.applicableCategoryIds,
      appliesTo: form.appliesTo,
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
    registeredOnly: draft.registeredOnly ?? v.registeredOnly,
    expiresAt: draft.expiresAt ?? v.expiresAt,
    active: draft.active ?? v.active,
    applicableCategoryIds: draft.applicableCategoryIds ?? v.applicableCategoryIds,
    appliesTo: draft.appliesTo ?? v.appliesTo,
  }
}

/**
 * WEC-262: category multi-select for the voucher editor. Loads categories
 * once on mount; checkboxes toggle membership in `selected`. Empty selected
 * means "applies to all" — that's the legacy behaviour and the default for
 * new vouchers.
 */
function CategoryPicker({
  selected, onChange,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [cats, setCats] = useState<AdminCategory[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetchAdminCategories().then(({ data }) => {
      setCats(data ?? [])
      setLoading(false)
    })
  }, [])
  if (loading) return <div className="admin-text-muted">Loading categories…</div>
  if (cats.length === 0) return <div className="admin-text-muted">No categories yet.</div>
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id))
    else onChange([...selected, id])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {cats.map((c) => (
        <label key={c.id} className="admin-form-checkbox" style={{ gap: 8 }}>
          <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
          <span>{c.nameEl} <code style={{ fontSize: 11, color: 'var(--a-text-muted)' }}>{c.id}</code></span>
        </label>
      ))}
    </div>
  )
}
