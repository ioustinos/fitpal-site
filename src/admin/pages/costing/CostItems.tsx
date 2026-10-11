import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchCostItems, fetchCostItemDetail, saveCostItem,
  type BaseUnit, type CostItemDetail, type CostItemInput, type CostItemRow, type ItemKind,
} from '../../../lib/api/adminCosting'
import {
  CostingTabs, HistoryChart, NumText, SourceBadge, Sparkline,
  fmtDate, fmtEur, fmtEurFine, fmtUnitCost, skey, useUrlState,
} from '../../costing/shared'

/**
 * /admin/costing/items — cost items (WEC-862: cost items + suppliers screens).
 * Everything we buy (food + packaging): current unit cost from the ledger,
 * source badge, 90-day sparkline, usage. Drawer edits the item and shows its
 * purchase history, price chart and where-used. No delete — «Active» only.
 */

const PAGE = 300
/** Human scale per base unit: €/kg for g, €/L for ml, €/pc for pcs. */
const HUMAN: Record<BaseUnit, { label: string; factor: number }> = {
  g: { label: '€/kg', factor: 1000 }, ml: { label: '€/L', factor: 1000 }, pcs: { label: '€/pc', factor: 1 },
}
const round = (v: number, d = 6) => Number(v.toFixed(d))
/** Comparable current cost in human units (€/kg, €/L, €/pc). */
const humanCost = (r: CostItemRow) => (r.unit_cost === null ? -1 : Number(r.unit_cost) * HUMAN[r.base_unit].factor)

type SortKey = 'name' | 'cost' | 'usage'

interface Form {
  id?: string
  name: string
  kind: ItemKind
  category: string
  base_unit: BaseUnit
  grams_per_unit: number | null
  default_pack_label: string
  default_base_qty_per_pack: number | null
  vat_pct: number | null
  /** standard cost in human units (€/kg, €/L, €/pc) */
  std_human: number | null
  active: boolean
  notes: string
}

const blank: Form = {
  name: '', kind: 'food', category: '', base_unit: 'g', grams_per_unit: null, default_pack_label: '',
  default_base_qty_per_pack: 1000, vat_pct: 13, std_human: null, active: true, notes: '',
}

function toForm(r: CostItemRow): Form {
  return {
    id: r.id, name: r.name, kind: r.kind, category: r.category ?? '', base_unit: r.base_unit,
    grams_per_unit: r.grams_per_unit === null ? null : Number(r.grams_per_unit),
    default_pack_label: r.default_pack_label ?? '',
    default_base_qty_per_pack: Number(r.default_base_qty_per_pack),
    vat_pct: round(Number(r.default_vat_rate) * 100, 4),
    std_human: r.standard_cost_per_unit === null ? null : round(Number(r.standard_cost_per_unit) * HUMAN[r.base_unit].factor),
    active: r.active, notes: r.notes ?? '',
  }
}

export function CostItems() {
  const [rows, setRows] = useState<CostItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useUrlState('q')
  const [kind, setKind] = useUrlState('kind')
  const [cat, setCat] = useUrlState('cat')
  const [only, setOnly] = useUrlState('only') // '' | 'unpriced' | 'estimated'
  const [inactive, setInactive] = useUrlState('inactive')
  // one URL key for sort + direction («cost:desc») — two useUrlState setters in one
  // handler would race (each rebuilds from the same search params)
  const [sortParam, setSortParam] = useUrlState('sort', 'name:asc')
  const [sort, dir] = sortParam.split(':') as [string, string | undefined]
  const [openId, setOpenId] = useUrlState('item') // '' | id | 'new'

  const load = useCallback(() => {
    return fetchCostItems().then((res) => {
      if (res.error) setError(res.error)
      else { setError(null); setRows(res.data ?? []) }
      setLoading(false)
    })
  }, [])
  useEffect(() => { void load() }, [load])

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'el')),
    [rows])

  const counts = useMemo(() => ({
    unpriced: rows.filter((r) => r.active && r.source === 'unpriced').length,
    estimated: rows.filter((r) => r.active && r.source === 'standard').length,
    inactive: rows.filter((r) => !r.active).length,
  }), [rows])

  const filtered = useMemo(() => {
    const words = skey(q).split(' ').filter(Boolean)
    const out = rows.filter((r) => {
      if (!inactive && !r.active) return false
      if (kind && r.kind !== kind) return false
      if (cat && (r.category ?? '') !== cat) return false
      if (only === 'unpriced' && r.source !== 'unpriced') return false
      if (only === 'estimated' && r.source !== 'standard') return false
      if (words.length) {
        const s = skey(`${r.name} ${r.category ?? ''} ${r.default_pack_label ?? ''}`)
        if (!words.every((w) => s.includes(w))) return false
      }
      return true
    })
    const m = dir === 'desc' ? -1 : 1
    const byName = (a: CostItemRow, b: CostItemRow) => a.name.localeCompare(b.name, 'el')
    out.sort((a, b) => {
      if (sort === 'cost') return (humanCost(a) - humanCost(b)) * m || byName(a, b)
      if (sort === 'usage') return ((a.used_in_dishes - b.used_in_dishes) || (a.used_in_components - b.used_in_components)) * m || byName(a, b)
      return byName(a, b) * m
    })
    return out
  }, [rows, q, kind, cat, only, inactive, sort, dir])

  // «Show more» paging; resets whenever the filter signature changes
  const sig = [q, kind, cat, only, inactive, sort, dir].join('|')
  const [page, setPage] = useState({ sig, n: PAGE })
  const limit = page.sig === sig ? page.n : PAGE
  const visible = filtered.slice(0, limit)

  const clickSort = (k: SortKey) => {
    if (sort === k) setSortParam(`${k}:${dir === 'desc' ? 'asc' : 'desc'}`)
    else setSortParam(`${k}:${k === 'name' ? 'asc' : 'desc'}`)
  }
  const arrow = (k: SortKey) => (sort === k ? (dir === 'desc' ? ' ▼' : ' ▲') : '')

  const openRow = openId && openId !== 'new' ? rows.find((r) => r.id === openId) ?? null : null

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Cost items</h1>
          <p className="admin-page-sub">
            {rows.length - counts.inactive} active · {counts.estimated} estimated · {counts.unpriced} unpriced · {counts.inactive} inactive
          </p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setOpenId('new')}>+ New item</button>
        </div>
      </div>
      <CostingTabs />

      {error && <div className="admin-error-banner" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="cst-toolbar">
        <input className="admin-input" placeholder="Search name, category, pack…" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <select className="admin-input" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          <option value="food">Food</option>
          <option value="packaging">Packaging</option>
        </select>
        <select className="admin-input" value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label><input type="checkbox" checked={only === 'unpriced'} onChange={(e) => setOnly(e.target.checked ? 'unpriced' : '')} /> Unpriced only</label>
        <label><input type="checkbox" checked={only === 'estimated'} onChange={(e) => setOnly(e.target.checked ? 'estimated' : '')} /> Estimated only</label>
        <label><input type="checkbox" checked={!!inactive} onChange={(e) => setInactive(e.target.checked ? '1' : '')} /> Show inactive</label>
        <span className="cst-spacer" />
        <span className="cst-count">{filtered.length} of {rows.length}</span>
      </div>

      <div className="cst-wrap">
        <table className="cst-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => clickSort('name')}>Name{arrow('name')}</th>
              <th>Kind</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Default pack</th>
              <th className="num">VAT</th>
              <th className="num sortable" onClick={() => clickSort('cost')}>Current cost{arrow('cost')}</th>
              <th>Source</th>
              <th>90 days</th>
              <th className="num sortable" onClick={() => clickSort('usage')}>Used in{arrow('usage')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="cst-muted">Loading…</td></tr>}
            {!loading && !filtered.length && <tr><td colSpan={10} className="cst-muted">{rows.length ? 'No matches.' : 'No cost items yet.'}</td></tr>}
            {visible.map((r) => (
              <tr key={r.id} className={`cst-click${r.id === openId ? ' cst-sel' : ''}`} style={r.active ? undefined : { opacity: 0.5 }}
                  onClick={() => setOpenId(r.id)}>
                <td className="cst-strong">{r.name}{!r.active && <span className="cst-badge" style={{ marginLeft: 6 }}>inactive</span>}</td>
                <td>{r.kind === 'packaging' ? <span className="cst-badge">packaging</span> : 'food'}</td>
                <td>{r.category ?? <span className="cst-muted">—</span>}</td>
                <td>{r.base_unit}{r.base_unit === 'pcs' && r.grams_per_unit ? <span className="cst-muted"> ({Number(r.grams_per_unit)} g)</span> : null}</td>
                <td>{r.default_pack_label || <span className="cst-muted">—</span>} <span className="cst-muted">{Number(r.default_base_qty_per_pack)} {r.base_unit}</span></td>
                <td className="num">{round(Number(r.default_vat_rate) * 100, 2)}%</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {r.source === 'unpriced' ? <span className="cst-muted">—</span> : fmtUnitCost(r.unit_cost, r.base_unit)}
                </td>
                <td><SourceBadge source={r.source} date={r.price_date} /></td>
                <td><Sparkline points={r.spark} current={r.unit_cost} /></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {r.used_in_components || r.used_in_dishes
                    ? <>{r.used_in_components} comp · {r.used_in_dishes} dishes</>
                    : <span className="cst-muted">unused</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > limit && (
          <div style={{ padding: 8, textAlign: 'center' }}>
            <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setPage({ sig, n: limit + PAGE })}>
              Show more ({filtered.length - limit} left)
            </button>
          </div>
        )}
      </div>

      {openId && (openId === 'new' || openRow) && (
        <ItemDrawer
          key={openId}
          row={openRow}
          categories={categories}
          onClose={() => setOpenId('')}
          onSaved={async (id) => { await load(); setOpenId(id) }}
        />
      )}
    </div>
  )
}

// ── drawer ───────────────────────────────────────────────────────────────────
function ItemDrawer({ row, categories, onClose, onSaved }: {
  row: CostItemRow | null; categories: string[]; onClose: () => void; onSaved: (id: string) => Promise<void>
}) {
  const [form, setForm] = useState<Form>(() => (row ? toForm(row) : { ...blank }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<CostItemDetail | null>(null)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [detailTick, setDetailTick] = useState(0)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const id = row?.id
  useEffect(() => {
    if (!id) return
    let alive = true
    fetchCostItemDetail(id).then((res) => {
      if (!alive) return
      if (res.error) setDetailErr(res.error); else { setDetailErr(null); setDetail(res.data) }
    })
    return () => { alive = false }
  }, [id, detailTick])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h)
  }, [onClose, saving])

  const human = HUMAN[form.base_unit]
  const stdBase = form.std_human === null ? null : form.std_human / human.factor

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Name is required.'
    if (form.default_base_qty_per_pack === null || form.default_base_qty_per_pack <= 0) return `Default pack size must be a positive number of ${form.base_unit}.`
    if (form.vat_pct === null || form.vat_pct < 0 || form.vat_pct > 100) return 'VAT must be a percentage between 0 and 100 (e.g. 13).'
    if (form.std_human !== null && form.std_human < 0) return 'Standard cost cannot be negative.'
    if (form.grams_per_unit !== null && form.grams_per_unit <= 0) return 'Grams per piece must be positive (or empty).'
    return null
  }

  const save = async () => {
    const v = validate()
    if (v) { setErr(v); return }
    setSaving(true); setErr(null)
    const input: CostItemInput = {
      id: form.id,
      name: form.name.trim(),
      kind: form.kind,
      category: form.category.trim() || null,
      base_unit: form.base_unit,
      grams_per_unit: form.base_unit === 'pcs' ? form.grams_per_unit : null,
      default_pack_label: form.default_pack_label.trim() || null,
      default_base_qty_per_pack: form.default_base_qty_per_pack as number,
      default_vat_rate: round((form.vat_pct as number) / 100, 6),
      standard_cost_per_unit: stdBase === null ? null : round(stdBase, 8),
      active: form.active,
      notes: form.notes.trim() || null,
    }
    const res = await saveCostItem(input)
    setSaving(false)
    if (res.error || !res.data) { setErr(res.error ?? 'Save failed.'); return }
    setForm((f) => ({ ...f, id: res.data!.id }))
    setDetailTick((t) => t + 1)
    await onSaved(res.data.id)
  }

  const chartRows = useMemo(
    () => (detail?.history ?? []).map((h) => ({ date: h.date, unit_cost: h.unit_cost, cause: h.cause })),
    [detail])
  const unitChanged = !!row && row.base_unit !== form.base_unit && (row.purchases > 0 || row.used_in_components > 0)

  return (
    <div className="admin-drawer-overlay" onClick={() => !saving && onClose()}>
      <div className="admin-drawer cst-drawer-wide" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <div className="admin-drawer-head-title">
            <h2>{row ? row.name : 'New cost item'}</h2>
            {row && (
              <span className="cst-note">
                {fmtUnitCost(row.unit_cost, row.base_unit)} <SourceBadge source={row.source} date={row.price_date} />
              </span>
            )}
          </div>
          <button className="admin-drawer-close" onClick={() => !saving && onClose()}>×</button>
        </header>

        <div className="admin-drawer-body">
          <div className="cst-grid-form">
            <label style={{ gridColumn: '1 / -1' }}>Name *
              <input className="admin-input cst-input" value={form.name} autoFocus={!row} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label>Kind
              <select className="admin-input cst-input" value={form.kind} onChange={(e) => set('kind', e.target.value as ItemKind)}>
                <option value="food">Food</option>
                <option value="packaging">Packaging</option>
              </select>
            </label>
            <label>Category
              <input className="admin-input cst-input" list="cst-item-cats" value={form.category} onChange={(e) => set('category', e.target.value)} />
              <datalist id="cst-item-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label>Base unit
              <select className="admin-input cst-input" value={form.base_unit} onChange={(e) => set('base_unit', e.target.value as BaseUnit)}>
                <option value="g">g (grams)</option>
                <option value="ml">ml (millilitres)</option>
                <option value="pcs">pcs (pieces)</option>
              </select>
              {unitChanged && <span className="cst-inline-err">Changing the unit re-reads existing purchase/recipe quantities in the new unit.</span>}
            </label>
            {form.base_unit === 'pcs' && (
              <label>Grams per piece (optional)
                <NumText value={form.grams_per_unit} onChange={(v) => set('grams_per_unit', v)} width={120} align="left" placeholder="e.g. 60" />
              </label>
            )}
            <label>Default pack label
              <input className="admin-input cst-input" value={form.default_pack_label} placeholder="e.g. Σακί 5 kg" onChange={(e) => set('default_pack_label', e.target.value)} />
            </label>
            <label>Default pack size ({form.base_unit} per pack) *
              <NumText value={form.default_base_qty_per_pack} onChange={(v) => set('default_base_qty_per_pack', v)} width={120} align="left" />
            </label>
            <label>Default VAT (%) *
              <NumText value={form.vat_pct} onChange={(v) => set('vat_pct', v)} width={80} align="left" placeholder="13" />
            </label>
            <label>Standard cost ({human.label}, net)
              <NumText value={form.std_human} onChange={(v) => set('std_human', v)} width={120} align="left" placeholder="empty = none" />
              <span className="cst-note">
                {form.base_unit === 'pcs'
                  ? 'Stored as € per piece'
                  : <>Stored per {form.base_unit}: {human.label} ÷ 1000{stdBase !== null ? <> = {stdBase.toFixed(6)} €/{form.base_unit}</> : null}</>}
                {'. '}Used only until the first purchase.
              </span>
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'end' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active
            </label>
            <label style={{ gridColumn: '1 / -1' }}>Notes
              <textarea className="admin-input" rows={2} style={{ fontSize: 13 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </div>
          {row?.source_ref && <div className="cst-note" style={{ marginTop: 6 }}>Source: {row.source_ref}</div>}
          {!form.active && row && (row.used_in_components > 0 || row.used_in_dishes > 0) && (
            <div className="cst-inline-err" style={{ marginTop: 6 }}>
              Inactive items stay in existing recipes and keep being costed; they are only hidden from lists and pickers.
            </div>
          )}

          {row && (
            <>
              {detailErr && <div className="admin-error-banner" style={{ marginTop: 10 }}>{detailErr}</div>}
              {!detail && !detailErr && <div className="cst-muted" style={{ marginTop: 10 }}>Loading history…</div>}
              {detail && (
                <>
                  <div className="cst-section">
                    <h4>Price history</h4>
                    <HistoryChart rows={chartRows} valueKey="unit_cost" fmt={(v) => fmtEurFine(v, 4)} />
                    <div className="cst-note">Chart values in € per {row.base_unit} (net). Current: {fmtUnitCost(detail.current.unit_cost, row.base_unit)}</div>
                  </div>

                  <div className="cst-section">
                    <h4>Purchases ({detail.purchases.length})</h4>
                    {detail.purchases.length === 0
                      ? <div className="cst-muted">No purchases yet — cost comes from the standard cost{row.source === 'unpriced' ? ' (none set: counted as €0)' : ''}.</div>
                      : (
                        <div className="cst-wrap" style={{ maxHeight: 260 }}>
                          <table className="cst-table">
                            <thead>
                              <tr>
                                <th>Date</th><th>Supplier</th><th>Invoice</th><th>Pack</th>
                                <th className="num">Qty</th><th className="num">Net / pack</th><th className="num">Unit cost</th><th className="num">VAT</th><th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.purchases.map((p) => (
                                <tr key={p.line_id} style={p.exclude_from_costing ? { opacity: 0.55 } : undefined}>
                                  <td>{fmtDate(p.invoice_date)}</td>
                                  <td>{p.supplier ?? <span className="cst-muted">—</span>}</td>
                                  <td>{p.invoice_number ?? <span className="cst-muted">—</span>}</td>
                                  <td>{p.pack_label || <span className="cst-muted">—</span>} <span className="cst-muted">{Number(p.base_qty_per_pack)} {row.base_unit}</span></td>
                                  <td className="num">{Number(p.qty_packs)}</td>
                                  <td className="num">{fmtEur(p.net_price_per_pack)}</td>
                                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtUnitCost(p.unit_cost, row.base_unit)}</td>
                                  <td className="num">{round(Number(p.vat_rate) * 100, 2)}%</td>
                                  <td>
                                    {p.exclude_from_costing && <span className="cst-badge cst-warn" title="Excluded from costing">excluded</span>}
                                    {detail.current.purchase_line_id === p.line_id && <span className="cst-badge cst-ok">current</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                  </div>

                  <div className="cst-section">
                    <h4>Where used</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12.5 }}>
                      <div>
                        <div className="cst-note" style={{ marginBottom: 4 }}>Components ({detail.components.length})</div>
                        {detail.components.length === 0 && <div className="cst-muted">None</div>}
                        {detail.components.map((c) => <div key={c.id}>{c.name}</div>)}
                      </div>
                      <div>
                        <div className="cst-note" style={{ marginBottom: 4 }}>Dishes ({detail.dishes.length})</div>
                        {detail.dishes.length === 0 && <div className="cst-muted">None</div>}
                        {detail.dishes.map((d) => (
                          <div key={d.id}>{d.name} <span className="cst-muted">× {Number(d.qty)}</span></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
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
