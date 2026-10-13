import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchComponents, fetchComponentDetail, fetchComponentOptions, fetchCostItemOptions,
  saveComponentVersion, setComponentActive,
} from '../../../lib/api/adminCosting'
import type {
  ComponentRow, ComponentDetail, ComponentVersion, ComponentOption, CostItemOption, YieldMode, BaseUnit,
} from '../../../lib/api/adminCosting'
import {
  CostingTabs, FlagBadges, HistoryChart, NumText, SearchPick, SourceBadge,
  fmtDate, fmtEurFine, fmtPct, fmtPerKg, fmtUnitCost, skey, todayAthens, useUrlState,
} from '../../costing/shared'
import type { PickOption } from '../../costing/shared'

/**
 * /admin/costing/components — WEC-864 (Costing 7: components = recipes with
 * yield, versions + effective date, breakdown, history).
 * Deep link: ?id=<componentId> opens the detail drawer.
 */

const PAGE = 300

// ── helpers ──────────────────────────────────────────────────────────────────
function yieldLabel(mode: YieldMode | null | undefined, pct: number | null | undefined, out: number | null | undefined): string {
  if (mode === 'pct') return pct === null || pct === undefined ? '—' : `${Number(pct)}%`
  if (mode === 'output_weight') return out === null || out === undefined ? 'out —' : `out ${Number(out)} g`
  if (mode === 'fixed') return 'fixed'
  return '—'
}

function change30(r: ComponentRow): number | null {
  if (r.cost_per_g === null || r.cost_per_g_30d === null || !(Number(r.cost_per_g_30d) > 0)) return null
  return (Number(r.cost_per_g) - Number(r.cost_per_g_30d)) / Number(r.cost_per_g_30d)
}

function ChangeCell({ v }: { v: number | null }) {
  if (v === null) return <span className="cst-muted">—</span>
  if (Math.abs(v) < 0.0005) return <span className="cst-muted">0%</span>
  return <span className={v > 0 ? 'cst-pos' : 'cst-neg'}>{v > 0 ? '+' : ''}{fmtPct(v)}</span>
}

/** Map ledger cause strings onto the chart's dot classes (price / version / other). */
function chartCause(c: string | null): string {
  if (!c) return 'other'
  if (c.startsWith('purchase') || c.startsWith('invoice')) return c
  if (c.startsWith('item:')) return `purchase/standard cost change (${c})`
  if (c.startsWith('version') || c.startsWith('component')) return c
  return `other (${c})`
}

const lineKey = (l: { cost_item_id: string | null; child_component_id: string | null }) =>
  l.cost_item_id ? `i:${l.cost_item_id}` : `c:${l.child_component_id}`

/** What changed vs the previous version (lines added / removed / qty changed, yield). */
function versionDiff(v: ComponentVersion, prev: ComponentVersion | undefined): string[] {
  if (!prev) return ['first version']
  const out: string[] = []
  const a = new Map(prev.lines.map((l) => [lineKey(l), l]))
  const b = new Map(v.lines.map((l) => [lineKey(l), l]))
  for (const [k, l] of b) {
    const o = a.get(k)
    if (!o) out.push(`+ ${l.name} ${Number(l.qty)} ${l.unit}`)
    else if (Number(o.qty) !== Number(l.qty)) out.push(`${l.name} ${Number(o.qty)} → ${Number(l.qty)} ${l.unit}`)
  }
  for (const [k, l] of a) if (!b.has(k)) out.push(`− ${l.name}`)
  const ya = yieldLabel(prev.yield_mode, prev.yield_pct, prev.output_weight_g)
  const yb = yieldLabel(v.yield_mode, v.yield_pct, v.output_weight_g)
  if (ya !== yb) out.push(`yield ${ya} → ${yb}`)
  if (v.yield_mode === 'fixed' && prev.yield_mode === 'fixed' && Number(prev.fixed_cost_per_g) !== Number(v.fixed_cost_per_g)) {
    out.push(`fixed ${fmtPerKg(prev.fixed_cost_per_g)} → ${fmtPerKg(v.fixed_cost_per_g)}`)
  }
  return out.length ? out : ['no changes']
}

type SortKey = 'name' | 'category' | 'cost' | 'yield' | 'versions' | 'change' | 'used'

interface Options { items: CostItemOption[]; comps: ComponentOption[] }

// ── page ─────────────────────────────────────────────────────────────────────
export function CostComponents() {
  const [rows, setRows] = useState<ComponentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useUrlState('q')
  const [cat, setCat] = useUrlState('cat')
  const [est, setEst] = useUrlState('est')
  const [fixed, setFixed] = useUrlState('fixed')
  const [inactive, setInactive] = useUrlState('inactive')
  const [sort, setSort] = useUrlState('sort', 'name')
  const [id, setId] = useUrlState('id')
  const [opts, setOpts] = useState<Options | null>(null)
  const [optsErr, setOptsErr] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorInit | null>(null)
  const [quick, setQuick] = useState(false)
  const [detailKey, setDetailKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchComponents()
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setError(null)
    setRows(res.data ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  const loadOptions = useCallback(async (force = false) => {
    if (opts && !force) return
    const [i, c] = await Promise.all([fetchCostItemOptions(), fetchComponentOptions()])
    if (i.error || c.error) { setOptsErr(i.error ?? c.error); return }
    setOptsErr(null)
    setOpts({ items: i.data ?? [], comps: c.data ?? [] })
  }, [opts])

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'el')),
    [rows])

  const indexed = useMemo(() => rows.map((r) => ({ r, k: skey(`${r.name} ${r.category ?? ''}`), ch: change30(r) })), [rows])

  const filtered = useMemo(() => {
    const words = skey(q).split(' ').filter(Boolean)
    const desc = sort.startsWith('-')
    const key = (desc ? sort.slice(1) : sort) as SortKey
    const list = indexed.filter(({ r, k }) =>
      (inactive === '1' || r.active)
      && (!cat || (cat === '__none' ? !r.category : r.category === cat))
      && (est !== '1' || !!r.flags?.estimated)
      && (fixed !== '1' || r.yield_mode === 'fixed')
      && words.every((w) => k.includes(w)))
    const val = (x: (typeof list)[number]): number | string => {
      switch (key) {
        case 'category': return x.r.category ?? '￿'
        case 'cost': return x.r.cost_per_g ?? -1
        case 'yield': return x.r.yield_mode === 'pct' ? Number(x.r.yield_pct ?? 0) : x.r.yield_mode === 'output_weight' ? 1000 + Number(x.r.output_weight_g ?? 0) : -1
        case 'versions': return x.r.versions
        case 'change': return x.ch ?? -999
        case 'used': return x.r.used_in_dishes * 1000 + x.r.used_in_components
        default: return x.r.name
      }
    }
    list.sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = typeof va === 'string' ? va.localeCompare(vb as string, 'el') : va - (vb as number)
      return (desc ? -c : c) || a.r.name.localeCompare(b.r.name, 'el')
    })
    return list
  }, [indexed, q, cat, est, fixed, inactive, sort])

  // «Show more» limit, reset whenever the filter signature changes
  const sig = [q, cat, est, fixed, inactive, sort].join('|')
  const [lim, setLim] = useState({ sig, n: PAGE })
  const limit = lim.sig === sig ? lim.n : PAGE
  const shown = filtered.slice(0, limit)

  const th = (k: SortKey, label: string, num = false) => {
    const on = sort === k || sort === `-${k}`
    return (
      <th className={`sortable${num ? ' num' : ''}`}
          onClick={() => setSort(sort === k ? `-${k}` : k)}>
        {label}{on ? (sort.startsWith('-') ? ' ↓' : ' ↑') : ''}
      </th>
    )
  }

  const openNew = () => { void loadOptions(); setEditor({ mode: 'new' }) }
  const openQuick = () => { void loadOptions(); setQuick(true) }

  const afterSave = async (componentId: string) => {
    setEditor(null); setQuick(false)
    await load()
    void loadOptions(true)
    setDetailKey((k) => k + 1)
    if (componentId !== id) setId(componentId)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Components</h1>
          <p className="admin-page-sub">Anything that goes on a plate, costed per cooked gram. Versions with an effective date.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={openQuick}>Quick: item + yield</button>
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={openNew}>+ New component</button>
        </div>
      </div>
      <CostingTabs />

      {error && <div className="admin-error-banner" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="cst-toolbar">
        <input className="admin-input" placeholder="Search name / category…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <select className="admin-input" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 190 }}>
          <option value="">All categories</option>
          <option value="__none">(no category)</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label><input type="checkbox" checked={est === '1'} onChange={(e) => setEst(e.target.checked ? '1' : '')} /> Estimated only</label>
        <label><input type="checkbox" checked={fixed === '1'} onChange={(e) => setFixed(e.target.checked ? '1' : '')} /> Fixed-cost only</label>
        <label><input type="checkbox" checked={inactive === '1'} onChange={(e) => setInactive(e.target.checked ? '1' : '')} /> Show inactive</label>
        <span className="cst-spacer" />
        <span className="cst-count">{loading ? 'Loading…' : `${filtered.length} of ${rows.length}`}</span>
      </div>

      <div className="cst-wrap">
        <table className="cst-table">
          <thead>
            <tr>
              {th('name', 'Name')}
              {th('category', 'Category')}
              {th('cost', 'Cost / cooked kg', true)}
              {th('yield', 'Yield')}
              {th('versions', 'Versions', true)}
              {th('change', 'vs 30d', true)}
              <th>Flags</th>
              {th('used', 'Used in')}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length && <tr><td colSpan={8} className="cst-muted">Loading…</td></tr>}
            {!loading && !filtered.length && <tr><td colSpan={8} className="cst-muted">No matches.</td></tr>}
            {shown.map(({ r, ch }) => (
              <tr key={r.id} className={`cst-click${r.id === id ? ' cst-sel' : ''}`} style={r.active ? undefined : { opacity: 0.5 }}
                  onClick={() => setId(r.id)}>
                <td className="cst-strong">{r.name}{!r.active && <span className="cst-badge" style={{ marginLeft: 6 }}>inactive</span>}</td>
                <td>{r.category ?? <span className="cst-muted">—</span>}</td>
                <td className="num">{fmtPerKg(r.cost_per_g)}</td>
                <td>{yieldLabel(r.yield_mode, r.yield_pct, r.output_weight_g)}</td>
                <td className="num">
                  {r.versions}{r.drafts > 0 && <span className="cst-badge cst-warn" style={{ marginLeft: 4 }}>+{r.drafts} draft</span>}
                </td>
                <td className="num"><ChangeCell v={ch} /></td>
                <td><FlagBadges flags={r.flags} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.used_in_dishes > 0 ? `${r.used_in_dishes} ${r.used_in_dishes === 1 ? 'dish' : 'dishes'}` : <span className="cst-muted">0 dishes</span>}
                  {r.used_in_components > 0 && <span className="cst-muted"> + {r.used_in_components} comp.</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > limit && (
          <div style={{ padding: 8, textAlign: 'center' }}>
            <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setLim({ sig, n: limit + PAGE })}>
              Show more ({filtered.length - limit} left)
            </button>
          </div>
        )}
      </div>

      {id && (
        <ComponentDrawer
          key={`${id}:${detailKey}`}
          id={id}
          onClose={() => setId('')}
          onOpen={(cid) => setId(cid)}
          onEdit={(init) => { void loadOptions(); setEditor(init) }}
          onActiveChanged={() => void load()}
        />
      )}

      {editor && (
        <VersionEditor
          init={editor}
          opts={opts}
          optsErr={optsErr}
          categories={categories}
          onClose={() => setEditor(null)}
          onSaved={afterSave}
        />
      )}

      {quick && (
        <QuickForm
          opts={opts}
          optsErr={optsErr}
          categories={categories}
          onClose={() => setQuick(false)}
          onSaved={afterSave}
        />
      )}
    </div>
  )
}

// ── detail drawer ────────────────────────────────────────────────────────────
function ComponentDrawer({ id, onClose, onOpen, onEdit, onActiveChanged }: {
  id: string; onClose: () => void; onOpen: (id: string) => void
  onEdit: (init: EditorInit) => void; onActiveChanged: () => void
}) {
  const [asOf, setAsOf] = useState('')
  const [d, setD] = useState<ComponentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      const res = await fetchComponentDetail(id, asOf || null)
      if (!alive) return
      setLoading(false)
      if (res.error) { setErr(res.error); return }
      setErr(null); setD(res.data)
    })()
    return () => { alive = false }
  }, [id, asOf, tick])

  const toggleActive = async () => {
    if (!d) return
    const next = !d.component.active
    if (!next && !confirm(`Deactivate «${d.component.name}»? It stays in history and existing recipes.`)) return
    setBusy(true)
    const res = await setComponentActive(id, next)
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    setTick((t) => t + 1); onActiveChanged()
  }

  const b = d?.breakdown
  const total = b ? (b.total_cost ?? b.lines.reduce((s, l) => s + Number(l.line_cost || 0), 0)) : 0
  const versions = d?.versions ?? []
  const latestPublished = versions.find((v) => v.status === 'published')
  const comp = d?.component
  const meta = comp ? { componentId: comp.id, name: comp.name, category: comp.category, notes: comp.notes } : null

  const histRows = useMemo(
    () => (d?.history ?? []).map((h) => ({ date: h.date, cost_per_g: Number(h.cost_per_g), cause: chartCause(h.cause) })),
    [d])

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer cst-drawer-wide" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <div className="admin-drawer-head-title">
            <h2>{comp?.name ?? 'Component'}</h2>
            {comp?.category && <span className="admin-drawer-placed">{comp.category}</span>}
            {comp && !comp.active && <span className="cst-badge cst-warn">inactive</span>}
          </div>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </header>
        <div className="admin-drawer-body" style={{ padding: '10px 16px' }}>
          {err && <div className="admin-error-banner" style={{ marginBottom: 8 }}>{err}</div>}
          {loading && !d && <div className="admin-loading">Loading…</div>}
          {d && b && meta && (
            <>
              <div className="cst-toolbar">
                <label>As of
                  <input type="date" className="admin-input" value={asOf || d.as_of} onChange={(e) => setAsOf(e.target.value)} style={{ width: 150 }} />
                </label>
                {asOf && <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setAsOf('')}>Today</button>}
                {loading && <span className="cst-count">Loading…</span>}
                <span className="cst-spacer" />
                <button className="admin-btn admin-btn-primary admin-btn-sm"
                        onClick={() => onEdit({ mode: 'version', meta, from: latestPublished ?? versions[0] })}>
                  New version
                </button>
                <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={toggleActive}>
                  {comp!.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>

              <div className="cst-section">
                <div className="cst-kv" style={{ gridTemplateColumns: '130px 1fr 130px 1fr' }}>
                  <div>Cost / cooked kg</div><div className="cst-strong">{fmtPerKg(b.cost_per_g)} <FlagBadges flags={b.flags} /></div>
                  <div>Version</div>
                  <div>{b.version_no ? `v${b.version_no} · from ${fmtDate(b.effective_from)}` : <span className="cst-badge cst-err">no published version</span>}</div>
                  <div>Total batch cost</div><div>{b.yield_mode === 'fixed' ? '—' : fmtEurFine(total)}</div>
                  <div>Yield</div><div>{yieldLabel(b.yield_mode, b.yield_pct, b.output_weight_g)}</div>
                  <div>Raw weight</div><div>{b.raw_weight_g !== undefined && b.raw_weight_g !== null ? `${Math.round(Number(b.raw_weight_g) * 10) / 10} g` : '—'}</div>
                  <div>Output (cooked)</div><div>{b.output_g !== undefined && b.output_g !== null ? `${Math.round(Number(b.output_g) * 10) / 10} g` : '—'}</div>
                </div>
              </div>

              <div className="cst-section">
                <h4>Breakdown at {fmtDate(d.as_of)}</h4>
                {b.yield_mode === 'fixed' && !b.lines.length
                  ? <div className="cst-note">Fixed cost per cooked kg (no recipe lines).</div>
                  : (
                    <div className="cst-wrap" style={{ maxHeight: 'none' }}>
                      <table className="cst-table">
                        <thead><tr>
                          <th>Line</th><th className="num">Qty</th><th className="num">Unit cost</th><th>Price source</th>
                          <th className="num">Line cost</th><th className="num">Share</th><th>Flags</th>
                        </tr></thead>
                        <tbody>
                          {b.lines.map((l, i) => (
                            <tr key={`${l.kind}:${l.id}:${i}`}>
                              <td>
                                {l.kind === 'component'
                                  ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(l.id) }}>{l.name}</a>
                                  : l.name}
                                {l.kind === 'component' && <span className="cst-badge" style={{ marginLeft: 4 }}>component</span>}
                              </td>
                              <td className="num">{Number(l.qty)} {l.kind === 'component' ? 'g cooked' : l.unit}</td>
                              <td className="num">{l.kind === 'component' ? fmtPerKg(l.unit_cost) : fmtUnitCost(l.unit_cost, l.unit as BaseUnit)}</td>
                              <td>{l.kind === 'item' ? <SourceBadge source={l.source} date={l.price_date} /> : <span className="cst-muted">ledger</span>}</td>
                              <td className="num">{fmtEurFine(l.line_cost)}</td>
                              <td className="num">{total > 0 ? fmtPct(Number(l.line_cost) / total) : '—'}</td>
                              <td><FlagBadges flags={l.flags} /></td>
                            </tr>
                          ))}
                          {!b.lines.length && <tr><td colSpan={7} className="cst-muted">No lines.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

              <div className="cst-section">
                <h4>Cost history (per cooked g)</h4>
                <HistoryChart rows={histRows} valueKey="cost_per_g" fmt={fmtPerKg} />
                <div className="cst-legend">
                  <span><i style={{ background: '#2563eb' }} />price change (purchase / standard cost)</span>
                  <span><i style={{ background: '#f59e0b' }} />version change</span>
                  <span><i style={{ background: '#6b7280' }} />other</span>
                </div>
              </div>

              <div className="cst-section">
                <h4>Versions ({versions.length})</h4>
                <div className="cst-wrap" style={{ maxHeight: 'none' }}>
                  <table className="cst-table">
                    <thead><tr>
                      <th>Ver.</th><th>Status</th><th>Effective from</th><th>Yield</th><th>What changed</th><th>Who / when</th><th />
                    </tr></thead>
                    <tbody>
                      {versions.map((v, i) => (
                        <tr key={v.id} className={b.version_id === v.id ? 'cst-sel' : undefined}>
                          <td className="cst-strong">v{v.version_no}</td>
                          <td>{v.status === 'draft' ? <span className="cst-badge cst-warn">draft</span> : <span className="cst-badge cst-ok">published</span>}</td>
                          <td>{fmtDate(v.effective_from)}</td>
                          <td>{yieldLabel(v.yield_mode, v.yield_pct, v.output_weight_g)}{v.yield_mode === 'fixed' && ` ${fmtPerKg(v.fixed_cost_per_g)}`}</td>
                          <td style={{ fontSize: 12 }}>
                            {versionDiff(v, versions.slice(i + 1).find((p) => p.status === 'published') ?? versions[i + 1]).map((t, j) => <div key={j}>{t}</div>)}
                            {v.notes && <div className="cst-note">«{v.notes}»</div>}
                          </td>
                          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            {v.created_by ?? <span className="cst-muted">system</span>}
                            <div className="cst-muted">{new Date(v.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</div>
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {v.status === 'draft'
                              ? <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => onEdit({ mode: 'draft', meta, from: v })}>Edit draft</button>
                              : <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => onEdit({ mode: 'version', meta, from: v })}>New version from this</button>}
                          </td>
                        </tr>
                      ))}
                      {!versions.length && <tr><td colSpan={7} className="cst-muted">No versions yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="cst-section" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                <div>
                  <h4>Used in dishes ({d.dishes.length})</h4>
                  {!d.dishes.length && <div className="cst-muted" style={{ fontSize: 12 }}>Not linked to any dish.</div>}
                  <div style={{ fontSize: 12.5, maxHeight: 260, overflow: 'auto' }}>
                    {d.dishes.map((x, i) => (
                      <div key={`${x.id}:${i}`} style={{ padding: '2px 0' }}>
                        <Link to={`/admin/costing/dishes?dish=${encodeURIComponent(x.id)}`}>{x.name}</Link>
                        <span className="cst-muted"> · {x.ingredient} · {x.source}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4>Used in components ({d.parents.length})</h4>
                  {!d.parents.length && <div className="cst-muted" style={{ fontSize: 12 }}>None.</div>}
                  <div style={{ fontSize: 12.5 }}>
                    {d.parents.map((p) => (
                      <div key={p.id} style={{ padding: '2px 0' }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); onOpen(p.id) }}>{p.name}</a>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── version editor ───────────────────────────────────────────────────────────
interface CompMeta { componentId: string; name: string; category: string | null; notes: string | null }
type EditorInit =
  | { mode: 'new' }
  | { mode: 'version'; meta: CompMeta; from?: ComponentVersion }
  | { mode: 'draft'; meta: CompMeta; from: ComponentVersion }

interface EdLine { key: number; ref: string | null; qty: number | null; note: string }

let lineSeq = 1

function VersionEditor({ init, opts, optsErr, categories, onClose, onSaved }: {
  init: EditorInit; opts: Options | null; optsErr: string | null; categories: string[]
  onClose: () => void; onSaved: (componentId: string) => void
}) {
  const meta = init.mode === 'new' ? null : init.meta
  const from = init.mode === 'new' ? undefined : init.from
  const [name, setName] = useState(meta?.name ?? '')
  const [category, setCategory] = useState(meta?.category ?? '')
  const [effective, setEffective] = useState(init.mode === 'draft' ? from!.effective_from.slice(0, 10) : todayAthens())
  const [mode, setMode] = useState<YieldMode>(from?.yield_mode ?? 'pct')
  const [pct, setPct] = useState<number | null>(from?.yield_pct ?? (from ? null : 100))
  const [outW, setOutW] = useState<number | null>(from?.output_weight_g ?? null)
  const [fixedKg, setFixedKg] = useState<number | null>(
    from?.fixed_cost_per_g !== null && from?.fixed_cost_per_g !== undefined ? Math.round(Number(from.fixed_cost_per_g) * 1000 * 10000) / 10000 : null)
  const [vnotes, setVnotes] = useState(init.mode === 'draft' ? from!.notes ?? '' : '')
  const [lines, setLines] = useState<EdLine[]>(() =>
    (from?.lines ?? []).map((l) => ({ key: lineSeq++, ref: lineKey(l), qty: Number(l.qty), note: l.note ?? '' })))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const unitOf = useMemo(() => new Map((opts?.items ?? []).map((i) => [i.id, i.base_unit])), [opts])
  const pickOpts = useMemo<PickOption[]>(() => {
    if (!opts) return []
    const self = meta?.componentId
    const items = opts.items.map((i) => ({
      id: `i:${i.id}`, label: i.name, hint: `item · ${i.base_unit}${i.kind === 'packaging' ? ' · packaging' : ''}${i.active ? '' : ' · inactive'}`,
    }))
    const comps = opts.comps.filter((c) => c.id !== self).map((c) => ({
      id: `c:${c.id}`, label: c.name, hint: `component${c.category ? ` · ${c.category}` : ''}${c.active ? '' : ' · inactive'}`,
    }))
    return [...items, ...comps].sort((a, b) => a.label.localeCompare(b.label, 'el'))
  }, [opts, meta?.componentId])

  const setLine = (key: number, patch: Partial<EdLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const unitLabel = (ref: string | null) =>
    !ref ? '' : ref.startsWith('c:') ? 'g cooked' : (unitOf.get(ref.slice(2)) ?? '')

  const validate = (): string | null => {
    if (init.mode === 'new' && !name.trim()) return 'Name is required.'
    if (!effective) return 'Effective date is required.'
    if (mode === 'fixed') {
      if (fixedKg === null || fixedKg < 0) return 'Enter the fixed € per cooked kg.'
      return null
    }
    if (mode === 'pct' && (pct === null || pct <= 0)) return 'Yield % must be greater than 0.'
    if (mode === 'output_weight' && (outW === null || outW <= 0)) return 'Batch cooked grams must be greater than 0.'
    const used = lines.filter((l) => l.ref || l.qty !== null)
    if (!used.length) return 'Add at least one line.'
    for (const [i, l] of used.entries()) {
      if (!l.ref) return `Line ${i + 1}: pick an item or component.`
      if (l.qty === null || l.qty <= 0) return `Line ${i + 1}: quantity must be greater than 0.`
    }
    const refs = used.map((l) => l.ref)
    if (new Set(refs).size !== refs.length) return 'The same item / component appears twice — merge the lines.'
    return null
  }

  const save = async (publish: boolean) => {
    const v = validate()
    if (v) { setErr(v); return }
    if (publish && !confirm(`Publish this version effective ${fmtDate(effective)}? Published versions are read-only.`)) return
    setSaving(true); setErr(null)
    const used = mode === 'fixed' ? [] : lines.filter((l) => l.ref)
    const res = await saveComponentVersion({
      component_id: meta?.componentId ?? null,
      name: name.trim(),
      category: category.trim() || null,
      notes: meta?.notes ?? null,
      draft_id: init.mode === 'draft' ? init.from.id : null,
      effective_from: effective,
      yield_mode: mode,
      yield_pct: mode === 'pct' ? pct : null,
      output_weight_g: mode === 'output_weight' ? outW : null,
      fixed_cost_per_g: mode === 'fixed' ? (fixedKg ?? 0) / 1000 : null,
      publish,
      version_notes: vnotes.trim() || null,
      lines: used.map((l) => ({
        cost_item_id: l.ref!.startsWith('i:') ? l.ref!.slice(2) : null,
        child_component_id: l.ref!.startsWith('c:') ? l.ref!.slice(2) : null,
        qty: l.qty ?? 0,
        note: l.note.trim() || null,
      })),
    })
    setSaving(false)
    if (res.error) { setErr(res.error); return }
    onSaved(res.data!.component_id)
  }

  const title = init.mode === 'new' ? 'New component'
    : init.mode === 'draft' ? `Edit draft v${init.from.version_no} — ${meta!.name}`
      : `New version — ${meta!.name}${from ? ` (from v${from.version_no})` : ''}`

  return (
    <div className="admin-modal-overlay" style={{ zIndex: 110 }} onClick={() => !saving && onClose()}>
      <div className="admin-modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2>{title}</h2>
          <button className="admin-drawer-close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="admin-drawer-body" style={{ padding: '10px 16px' }}>
          <div className="cst-grid-form">
            <label>Name{init.mode === 'new' ? ' *' : ''}
              <input className="admin-input cst-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="π.χ. Καρότο σωτέ" autoFocus={init.mode === 'new'} />
            </label>
            <label>Category
              <input className="admin-input cst-input" list="cst-comp-cats" value={category} onChange={(e) => setCategory(e.target.value)} />
            </label>
            <label>Effective from *
              <input type="date" className="admin-input cst-input" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </label>
            <label>Yield mode
              <select className="admin-input cst-input" value={mode} onChange={(e) => setMode(e.target.value as YieldMode)}>
                <option value="pct">Yield % of raw weight</option>
                <option value="output_weight">Batch output (cooked g)</option>
                <option value="fixed">Fixed € per cooked kg</option>
              </select>
            </label>
            {mode === 'pct' && <label>Yield %<NumText value={pct} onChange={setPct} width={100} placeholder="e.g. 60" /></label>}
            {mode === 'output_weight' && <label>Batch cooked grams<NumText value={outW} onChange={setOutW} width={110} placeholder="e.g. 350" /></label>}
            {mode === 'fixed' && <label>€ per cooked kg<NumText value={fixedKg} onChange={setFixedKg} width={110} placeholder="e.g. 4,20" /></label>}
          </div>
          <datalist id="cst-comp-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>

          {mode !== 'fixed' && (
            <div className="cst-section">
              <h4>Lines</h4>
              {optsErr && <div className="cst-inline-err">Could not load items/components: {optsErr}</div>}
              {!opts && !optsErr && <div className="cst-note">Loading items and components…</div>}
              <table className="cst-table">
                <thead><tr><th style={{ width: '45%' }}>Item or component</th><th className="num">Qty</th><th>Unit</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td><SearchPick options={pickOpts} value={l.ref} onChange={(v) => setLine(l.key, { ref: v })} placeholder="Search item or component…" width="100%" /></td>
                      <td className="num"><NumText value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} width={80} /></td>
                      <td className="cst-muted">{unitLabel(l.ref)}</td>
                      <td><input className="admin-input cst-input" value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} style={{ width: '100%' }} /></td>
                      <td><button className="admin-btn admin-btn-ghost admin-btn-sm" title="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>×</button></td>
                    </tr>
                  ))}
                  {!lines.length && <tr><td colSpan={5} className="cst-muted">No lines yet.</td></tr>}
                </tbody>
              </table>
              <button className="admin-btn admin-btn-ghost admin-btn-sm" style={{ marginTop: 6 }}
                      onClick={() => setLines((ls) => [...ls, { key: lineSeq++, ref: null, qty: null, note: '' }])}>
                + Add line
              </button>
            </div>
          )}

          <div className="cst-grid-form" style={{ marginTop: 8 }}>
            <label style={{ gridColumn: '1 / -1' }}>Version note
              <input className="admin-input cst-input" value={vnotes} onChange={(e) => setVnotes(e.target.value)} placeholder="π.χ. +10 ml λάδι" />
            </label>
          </div>
        </div>
        <footer className="admin-drawer-foot" style={{ padding: '10px 16px' }}>
          {err ? <div className="admin-error-banner" style={{ flex: 1, margin: 0 }}>{err}</div> : <div style={{ flex: 1 }} className="cst-note">
            Saving creates {init.mode === 'draft' ? 'no new version (updates this draft)' : 'a new version'}; published versions are read-only.
          </div>}
          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => void save(false)} disabled={saving}>Save draft</button>
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => void save(true)} disabled={saving}>{saving ? 'Saving…' : 'Publish'}</button>
        </footer>
      </div>
    </div>
  )
}

// ── quick form: one raw item + yield % ───────────────────────────────────────
function QuickForm({ opts, optsErr, categories, onClose, onSaved }: {
  opts: Options | null; optsErr: string | null; categories: string[]
  onClose: () => void; onSaved: (componentId: string) => void
}) {
  const [itemId, setItemId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [pct, setPct] = useState<number | null>(null)
  const [effective, setEffective] = useState(todayAthens())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const itemOpts = useMemo<PickOption[]>(
    () => (opts?.items ?? []).filter((i) => i.kind === 'food').map((i) => ({ id: i.id, label: i.name, hint: `${i.base_unit}${i.active ? '' : ' · inactive'}` })),
    [opts])
  const item = opts?.items.find((i) => i.id === itemId) ?? null

  const save = async () => {
    if (!item) { setErr('Pick the raw item.'); return }
    if (!name.trim()) { setErr('Name is required.'); return }
    if (pct === null || pct <= 0) { setErr('Yield % must be greater than 0.'); return }
    if (!effective) { setErr('Effective date is required.'); return }
    setSaving(true); setErr(null)
    const res = await saveComponentVersion({
      name: name.trim(), category: category.trim() || null, effective_from: effective,
      yield_mode: 'pct', yield_pct: pct, publish: true,
      lines: [{ cost_item_id: item.id, qty: 100 }],
    })
    setSaving(false)
    if (res.error) { setErr(res.error); return }
    onSaved(res.data!.component_id)
  }

  return (
    <div className="admin-modal-overlay" style={{ zIndex: 110 }} onClick={() => !saving && onClose()}>
      <div className="admin-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2>Quick component — raw item + yield</h2>
          <button className="admin-drawer-close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="admin-drawer-body" style={{ padding: '10px 16px' }}>
          <p className="cst-note" style={{ marginTop: 0 }}>
            For simple prepared items (e.g. Καρότα, 60%): creates a published component with one line of 100 {item?.base_unit ?? 'units'} of the item and the yield %.
          </p>
          {optsErr && <div className="cst-inline-err">Could not load items: {optsErr}</div>}
          <div className="cst-grid-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ gridColumn: '1 / -1' }}>Raw item *
              {opts
                ? <SearchPick options={itemOpts} value={itemId} autoFocus width="100%"
                    onChange={(v, o) => { setItemId(v); if (o && !name.trim()) setName(o.label) }} placeholder="Search cost item…" />
                : <span className="cst-note">Loading…</span>}
            </label>
            <label>Name *<input className="admin-input cst-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Category<input className="admin-input cst-input" list="cst-comp-cats-q" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
            <label>Yield % *<NumText value={pct} onChange={setPct} width={100} placeholder="e.g. 60" /></label>
            <label>Effective from *<input type="date" className="admin-input cst-input" value={effective} onChange={(e) => setEffective(e.target.value)} /></label>
          </div>
          <datalist id="cst-comp-cats-q">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <footer className="admin-drawer-foot" style={{ padding: '10px 16px' }}>
          {err ? <div className="admin-error-banner" style={{ flex: 1, margin: 0 }}>{err}</div> : <div style={{ flex: 1 }} />}
          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Create & publish'}</button>
        </footer>
      </div>
    </div>
  )
}
