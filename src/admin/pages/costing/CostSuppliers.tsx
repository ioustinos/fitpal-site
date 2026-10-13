import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchSuppliers, saveSupplier, type SupplierRow } from '../../../lib/api/adminCosting'
import { CostingTabs, fmtDate, fmtEur, skey, useUrlState } from '../../costing/shared'

/**
 * /admin/costing/suppliers — suppliers list + drawer (WEC-862: cost items +
 * suppliers screens). Invoice stats come from the overview RPC; the invoice
 * count links to the purchases screen filtered by supplier. No delete —
 * «Active» only (invoices reference suppliers).
 */

type SortKey = 'name' | 'invoices' | 'last' | 'total'

interface Form { id?: string; name: string; vat_number: string; notes: string; active: boolean }

export function CostSuppliers() {
  const [rows, setRows] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useUrlState('q')
  const [inactive, setInactive] = useUrlState('inactive')
  // one URL key for sort + direction («cost:desc») — two useUrlState setters in one
  // handler would race (each rebuilds from the same search params)
  const [sortParam, setSortParam] = useUrlState('sort', 'name:asc')
  const [sort, dir] = sortParam.split(':') as [string, string | undefined]
  const [openId, setOpenId] = useUrlState('supplier') // '' | id | 'new'

  const load = useCallback(() => {
    return fetchSuppliers().then((res) => {
      if (res.error) setError(res.error)
      else { setError(null); setRows(res.data ?? []) }
      setLoading(false)
    })
  }, [])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const words = skey(q).split(' ').filter(Boolean)
    const out = rows.filter((r) => {
      if (!inactive && !r.active) return false
      if (words.length) {
        const s = skey(`${r.name} ${r.vat_number ?? ''} ${r.notes ?? ''}`)
        if (!words.every((w) => s.includes(w))) return false
      }
      return true
    })
    const m = dir === 'desc' ? -1 : 1
    const byName = (a: SupplierRow, b: SupplierRow) => a.name.localeCompare(b.name, 'el')
    out.sort((a, b) => {
      if (sort === 'invoices') return (a.invoices - b.invoices) * m || byName(a, b)
      if (sort === 'total') return (Number(a.total_net) - Number(b.total_net)) * m || byName(a, b)
      if (sort === 'last') return (a.last_invoice_date ?? '').localeCompare(b.last_invoice_date ?? '') * m || byName(a, b)
      return byName(a, b) * m
    })
    return out
  }, [rows, q, inactive, sort, dir])

  const clickSort = (k: SortKey) => {
    if (sort === k) setSortParam(`${k}:${dir === 'desc' ? 'asc' : 'desc'}`)
    else setSortParam(`${k}:${k === 'name' ? 'asc' : 'desc'}`)
  }
  const arrow = (k: SortKey) => (sort === k ? (dir === 'desc' ? ' ▼' : ' ▲') : '')
  const inactiveCount = rows.filter((r) => !r.active).length
  const openRow = openId && openId !== 'new' ? rows.find((r) => r.id === openId) ?? null : null

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Suppliers</h1>
          <p className="admin-page-sub">{rows.length - inactiveCount} active · {inactiveCount} inactive</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setOpenId('new')}>+ New supplier</button>
        </div>
      </div>
      <CostingTabs />

      {error && <div className="admin-error-banner" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="cst-toolbar">
        <input className="admin-input" placeholder="Search name, VAT number, notes…" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <label><input type="checkbox" checked={!!inactive} onChange={(e) => setInactive(e.target.checked ? '1' : '')} /> Show inactive</label>
        <span className="cst-spacer" />
        <span className="cst-count">{filtered.length} of {rows.length}</span>
      </div>

      <div className="cst-wrap">
        <table className="cst-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => clickSort('name')}>Name{arrow('name')}</th>
              <th>VAT number</th>
              <th>Notes</th>
              <th className="num sortable" onClick={() => clickSort('invoices')}>Invoices{arrow('invoices')}</th>
              <th className="num sortable" onClick={() => clickSort('last')}>Last invoice{arrow('last')}</th>
              <th className="num sortable" onClick={() => clickSort('total')}>Total net{arrow('total')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="cst-muted">Loading…</td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan={6} className="cst-muted">{rows.length ? 'No matches.' : 'No suppliers yet — add one, or create them inline when entering a purchase invoice.'}</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className={`cst-click${r.id === openId ? ' cst-sel' : ''}`} style={r.active ? undefined : { opacity: 0.5 }}
                  onClick={() => setOpenId(r.id)}>
                <td className="cst-strong">{r.name}{!r.active && <span className="cst-badge" style={{ marginLeft: 6 }}>inactive</span>}</td>
                <td>{r.vat_number || <span className="cst-muted">—</span>}</td>
                <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.notes ?? ''}>
                  {r.notes || <span className="cst-muted">—</span>}
                </td>
                <td className="num">
                  {r.invoices > 0
                    ? <Link to={`/admin/costing/purchases?supplier=${r.id}`} onClick={(e) => e.stopPropagation()}>{r.invoices}</Link>
                    : <span className="cst-muted">0</span>}
                </td>
                <td className="num">{fmtDate(r.last_invoice_date)}</td>
                <td className="num">{r.invoices > 0 ? fmtEur(r.total_net) : <span className="cst-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openId && (openId === 'new' || openRow) && (
        <SupplierDrawer
          key={openId}
          row={openRow}
          names={rows}
          onClose={() => setOpenId('')}
          onSaved={async (id) => { await load(); setOpenId(id) }}
        />
      )}
    </div>
  )
}

function SupplierDrawer({ row, names, onClose, onSaved }: {
  row: SupplierRow | null; names: SupplierRow[]; onClose: () => void; onSaved: (id: string) => Promise<void>
}) {
  const [form, setForm] = useState<Form>(() => row
    ? { id: row.id, name: row.name, vat_number: row.vat_number ?? '', notes: row.notes ?? '', active: row.active }
    : { name: '', vat_number: '', notes: '', active: true })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h)
  }, [onClose, saving])

  const dup = useMemo(() => {
    const k = skey(form.name)
    return k ? names.find((n) => n.id !== form.id && skey(n.name) === k) ?? null : null
  }, [form.name, form.id, names])

  const save = async () => {
    if (!form.name.trim()) { setErr('Name is required.'); return }
    setSaving(true); setErr(null)
    const res = await saveSupplier({
      id: form.id, name: form.name.trim(), vat_number: form.vat_number.trim() || null,
      notes: form.notes.trim() || null, active: form.active,
    })
    setSaving(false)
    if (res.error || !res.data) { setErr(res.error ?? 'Save failed.'); return }
    await onSaved(res.data.id)
  }

  return (
    <div className="admin-drawer-overlay" onClick={() => !saving && onClose()}>
      <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <div className="admin-drawer-head-title"><h2>{row ? row.name : 'New supplier'}</h2></div>
          <button className="admin-drawer-close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="admin-drawer-body">
          <div className="cst-grid-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ gridColumn: '1 / -1' }}>Name *
              <input className="admin-input cst-input" value={form.name} autoFocus={!row} onChange={(e) => set('name', e.target.value)} />
              {dup && <span className="cst-inline-err">A supplier named «{dup.name}» already exists{dup.active ? '' : ' (inactive)'}.</span>}
            </label>
            <label>VAT number (ΑΦΜ)
              <input className="admin-input cst-input" value={form.vat_number} inputMode="numeric" onChange={(e) => set('vat_number', e.target.value)} />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'end' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active
            </label>
            <label style={{ gridColumn: '1 / -1' }}>Notes
              <textarea className="admin-input" rows={3} style={{ fontSize: 13 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </div>

          {row && (
            <div className="cst-section">
              <h4>Invoices</h4>
              <div className="cst-kv">
                <div>Count</div>
                <div>
                  {row.invoices > 0
                    ? <Link to={`/admin/costing/purchases?supplier=${row.id}`}>{row.invoices} invoice{row.invoices === 1 ? '' : 's'} →</Link>
                    : <span className="cst-muted">None yet</span>}
                </div>
                <div>Last invoice</div><div>{fmtDate(row.last_invoice_date)}</div>
                <div>Total net</div><div>{row.invoices > 0 ? fmtEur(row.total_net) : '—'}</div>
              </div>
              {!form.active && row.invoices > 0 && (
                <div className="cst-note" style={{ marginTop: 6 }}>Inactive suppliers keep their invoices; they are only hidden from pickers.</div>
              )}
            </div>
          )}
        </div>
        <footer className="admin-drawer-foot">
          {err && <span className="cst-inline-err">{err}</span>}
          <div style={{ flex: 1 }} />
          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={onClose} disabled={saving}>Close</button>
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : form.id ? 'Save' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  )
}
