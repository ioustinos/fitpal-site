import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode, MouseEvent as RMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchComponents, fetchComponentDetail, fetchComponentOptions, fetchCostItemOptions,
  saveComponentVersion, setComponentActive, COOKING_METHODS, cookingLabel,
  fetchComponentPreview, discardComponentDraft, deleteUnpublishedComponent,
} from '../../../lib/api/adminCosting'
import { ComponentRecipeTree } from './RecipeBreakdown'
import { nodeRatio, nodeReference, nodeUnitCost, treeNodeRows, yieldLabel as recipeYieldLabel } from '../../costing/recipeTree'
import type {
  ComponentRow, ComponentDetail, ComponentBreakdown, ComponentVersion, ComponentOption, CostItemOption, YieldMode, BaseUnit, CookingMethod,
  ComponentPreview, RecipeNode,
} from '../../../lib/api/adminCosting'
import {
  CostingTabs, FlagBadges, HistoryChart, NumText, SearchPick,
  fmtCompCost, fmtDate, fmtEur, fmtEurFine, fmtPct, fmtPerKg, fmtQtyUnit, skey, todayAthens, useUrlState,
} from '../../costing/shared'
import type { PickOption } from '../../costing/shared'

/**
 * /admin/costing/components — WEC-864 (Costing 7: components = recipes with
 * yield, versions + effective date, breakdown, history).
 * Deep link: ?id=<componentId> opens the detail drawer.
 */

const PAGE = 300

// ── helpers ──────────────────────────────────────────────────────────────────
function yieldLabel(mode: YieldMode | null | undefined, pct: number | null | undefined, out: number | null | undefined, unit: BaseUnit = 'g'): string {
  if (mode === 'pct') return pct === null || pct === undefined ? '—' : `${Number(pct)}%`
  if (mode === 'output_weight') return out === null || out === undefined ? 'out —' : `out ${Number(out)} ${unit === 'pcs' ? 'pcs' : unit}`
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
  if (c.startsWith('item:')) return `purchase / fallback price change (${c})`
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

type SortKey = 'name' | 'type' | 'method' | 'category' | 'cost' | 'yield' | 'versions' | 'change' | 'used'

interface Options { items: CostItemOption[]; comps: ComponentOption[] }

// ── page ─────────────────────────────────────────────────────────────────────
export function CostComponents() {
  const [rows, setRows] = useState<ComponentRow[]>([])
  // cooked ÷ raw of each component's version in force — drives the editor's linked raw ↔ cooked inputs
  const ratios = useMemo(() => new Map(rows.map((r) => [r.id, r.yield_ratio === null || r.yield_ratio === undefined ? null : Number(r.yield_ratio)])), [rows])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useUrlState('q')
  const [cat, setCat] = useUrlState('cat')
  const [est, setEst] = useUrlState('est')
  const [fixed, setFixed] = useUrlState('fixed')
  const [typ, setTyp] = useUrlState('type') // '' | single | multi
  const [inactive, setInactive] = useUrlState('inactive')
  const [sort, setSort] = useUrlState('sort', 'name')
  const [id, setId] = useUrlState('id')
  const [opts, setOpts] = useState<Options | null>(null)
  const [optsErr, setOptsErr] = useState<string | null>(null)
  // drawer session: a new / duplicated component keeps its drawer (and unsaved edits) after it gets an id
  const [newSeed, setNewSeed] = useState<EditInit | null>(null)
  const [adopted, setAdopted] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [quickItem, setQuickItem] = useUrlState('quick') // cost item id from «Make component» on /items
  const [quick, setQuickRaw] = useState(!!quickItem)
  const setQuick = (v: boolean) => { setQuickRaw(v); if (!v && quickItem) setQuickItem('') }
  // drawer «back» trail when drilling from a recipe line into a sub-component
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([])

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
  // arriving from «Make component» on a cost item: the quick form is already open, load its pickers
  useEffect(() => { if (quickItem) void loadOptions() }, [quickItem, loadOptions])

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
      && (!typ || r.type === typ)
      && words.every((w) => k.includes(w)))
    const val = (x: (typeof list)[number]): number | string => {
      switch (key) {
        case 'category': return x.r.category ?? '￿'
        case 'type': return x.r.type
        case 'method': return cookingLabel(x.r.cooking_method, x.r.cooking_method_other) ?? '￿'
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
  }, [indexed, q, cat, est, fixed, typ, inactive, sort])

  // «Show more» limit, reset whenever the filter signature changes
  const sig = [q, cat, est, fixed, typ, inactive, sort].join('|')
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

  const openNew = () => {
    void loadOptions(); setTrail([]); setAdopted(null); setNewSeed(emptyInit()); setSession((n) => n + 1); setId('')
  }
  const openRow = (rid: string) => { setTrail([]); setNewSeed(null); setAdopted(null); setSession((n) => n + 1); setId(rid) }
  const openQuick = () => { void loadOptions(); setQuick(true) }

  const afterSave = async (componentId: string) => {
    setQuick(false)
    await load()
    void loadOptions(true)
    openRow(componentId)
  }
  const isNewSession = !!newSeed && (!id || id === adopted)
  const drawerKey = isNewSession ? `new:${session}` : `id:${id}:${session}`

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Components</h1>
          <p className="admin-page-sub">Anything that goes on a plate, costed per cooked gram — or per piece. Versions with an effective date.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={openQuick}>+ From a cost item</button>
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={openNew}>+ New component</button>
        </div>
      </div>
      <CostingTabs />

      {error && <div className="admin-error-banner" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="cst-toolbar">
        <input className="admin-input" placeholder="Search name / category…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <select className="admin-input" value={typ} onChange={(e) => setTyp(e.target.value)} style={{ width: 150 }}>
          <option value="">All types</option>
          <option value="single">Απλό (1 ingredient)</option>
          <option value="multi">Σύνθετο (recipe)</option>
        </select>
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
              {th('type', 'Type')}
              {th('method', 'Cooking')}
              {th('category', 'Category')}
              {th('cost', 'Cost', true)}
              {th('yield', 'Yield')}
              {th('versions', 'Versions', true)}
              {th('change', 'vs 30d', true)}
              <th>Flags</th>
              {th('used', 'Used in')}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length && <tr><td colSpan={10} className="cst-muted">Loading…</td></tr>}
            {!loading && !filtered.length && <tr><td colSpan={10} className="cst-muted">No matches.</td></tr>}
            {shown.map(({ r, ch }) => (
              <tr key={r.id} className={`cst-click${r.id === id ? ' cst-sel' : ''}`} style={r.active ? undefined : { opacity: 0.5 }}
                  onClick={() => openRow(r.id)}>
                <td className="cst-strong cst-name"><div>{r.name}{!r.active && <span className="cst-badge" style={{ marginLeft: 6 }}>inactive</span>}</div></td>
                <td>{r.type === 'single'
                  ? <span className="cst-badge" title="One cost item + yield">Απλό</span>
                  : <span className="cst-badge cst-ok" title={r.yield_mode === 'fixed' ? 'Fixed estimate, no recipe lines yet' : `${r.lines} recipe lines`}>Σύνθετο{r.yield_mode === 'fixed' ? ' · fixed' : ''}</span>}</td>
                <td>{cookingLabel(r.cooking_method, r.cooking_method_other) ?? <span className="cst-muted">—</span>}</td>
                <td>{r.category ?? <span className="cst-muted">—</span>}</td>
                <td className="num">{fmtCompCost(r.cost_per_g, r.base_unit)}</td>
                <td>{yieldLabel(r.yield_mode, r.yield_pct, r.output_weight_g, r.base_unit)}</td>
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

      {(id || newSeed) && (
        <ComponentDrawer
          key={drawerKey}
          id={id || null}
          seed={isNewSession ? newSeed : null}
          back={trail.length ? trail[trail.length - 1] : null}
          onBack={() => {
            const t = trail[trail.length - 1]; setTrail(trail.slice(0, -1)); setNewSeed(null); setAdopted(null)
            setSession((n) => n + 1); if (t) setId(t.id)
          }}
          onClose={() => { setTrail([]); setNewSeed(null); setAdopted(null); setId('') }}
          onOpen={(cid, fromName) => { setTrail([...trail, { id, name: fromName }]); setNewSeed(null); setSession((n) => n + 1); setId(cid) }}
          onDuplicate={(seed, from) => {
            setTrail([...trail, from]); setAdopted(null); setNewSeed(seed); setSession((n) => n + 1); setId('')
          }}
          onCreated={(cid) => { setAdopted(cid); setId(cid) }}
          onChanged={() => { void load(); void loadOptions(true) }}
          needOptions={() => void loadOptions()}
          opts={opts} optsErr={optsErr} categories={categories} ratios={ratios}
        />
      )}

      {quick && (
        <QuickForm
          presetItemId={quickItem || null}
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
type CompKind = 'recipe' | 'single' | 'fixed' | 'empty'

function componentKind(b: ComponentBreakdown): CompKind {
  if (b.yield_mode === 'fixed') return 'fixed'
  if (!b.lines.length) return 'empty'
  return b.lines.length === 1 && b.lines[0].kind === 'item' ? 'single' : 'recipe'
}

const KIND_BADGE: Record<CompKind, [string, string]> = {
  recipe: ['cst-ok', 'Σύνθετο · recipe'],
  single: ['', 'Απλό · single ingredient'],
  fixed: ['cst-warn', 'Σύνθετο · fixed estimate, no recipe'],
  empty: ['cst-err', 'No lines'],
}

/** chip list that shows the first 12 and a «+N more» toggle */
function Chips({ items, more, onMore }: { items: ReactNode[]; more: boolean; onMore: () => void }) {
  const LIMIT = 12
  const shown = more ? items : items.slice(0, LIMIT)
  return (
    <div className="cst-chips">
      {shown}
      {!more && items.length > LIMIT && (
        <button className="cst-chip cst-chip-more" onClick={onMore}>+{items.length - LIMIT} more</button>
      )}
    </div>
  )
}

const round1 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10)
const fmtG = (v: number | null | undefined) => {
  const r = round1(v)
  return r === null ? '—' : `${r.toLocaleString('el-GR')} g`
}
const perLabelOf = (u: BaseUnit) => (u === 'pcs' ? 'piece' : u === 'ml' ? 'litre' : 'cooked kg')

// ── editor state (WEC-864, Ioustinos 11/11: view, edit, new and duplicate are the same drawer) ──
interface EdLine { key: number; ref: string | null; qty: number | null; note: string }
type MethodSel = CookingMethod | 'na'
interface EditForm {
  name: string; category: string; notes: string | null
  method: MethodSel; other: string
  unit: BaseUnit; gpu: number | null
  effective: string
  mode: YieldMode; pct: number | null; outW: number | null
  /** € per cooked kg / litre / piece (display unit) */
  fixed: number | null
  vnotes: string
  lines: EdLine[]
}
interface EditInit {
  componentId: string | null
  draftId: string | null
  /** version the form was copied from (label only) */
  fromNo: number | null
  /** name of the component this is a copy of (label only) */
  copyOf: string | null
  form: EditForm
}

let lineSeq = 1
const fixedFactorOf = (u: BaseUnit) => (u === 'pcs' ? 1 : 1000)

function emptyInit(): EditInit {
  return {
    componentId: null, draftId: null, fromNo: null, copyOf: null,
    form: {
      name: '', category: '', notes: null, method: 'na', other: '', unit: 'g', gpu: null,
      effective: todayAthens(), mode: 'pct', pct: 100, outW: null, fixed: null, vnotes: '',
      lines: [{ key: lineSeq++, ref: null, qty: null, note: '' }],
    },
  }
}

function initFrom(comp: ComponentDetail['component'], v: ComponentVersion | undefined, how: 'draft' | 'version' | 'duplicate'): EditInit {
  const unit = (comp.base_unit ?? 'g') as BaseUnit
  return {
    componentId: how === 'duplicate' ? null : comp.id,
    draftId: how === 'draft' && v ? v.id : null,
    fromNo: v?.version_no ?? null,
    copyOf: how === 'duplicate' ? comp.name : null,
    form: {
      name: how === 'duplicate' ? `${comp.name} (αντίγραφο)` : comp.name,
      category: comp.category ?? '', notes: comp.notes,
      method: comp.cooking_method ?? 'na', other: comp.cooking_method_other ?? '',
      unit, gpu: comp.grams_per_unit ?? null,
      effective: how === 'draft' && v ? v.effective_from.slice(0, 10) : todayAthens(),
      mode: v?.yield_mode ?? 'pct',
      pct: v ? (v.yield_pct === null ? null : Number(v.yield_pct)) : 100,
      outW: v?.output_weight_g === null || v?.output_weight_g === undefined ? null : Number(v.output_weight_g),
      fixed: v?.fixed_cost_per_g === null || v?.fixed_cost_per_g === undefined ? null
        : Math.round(Number(v.fixed_cost_per_g) * fixedFactorOf(unit) * 10000) / 10000,
      vnotes: how === 'draft' && v ? v.notes ?? '' : '',
      lines: (v?.lines ?? []).map((l) => ({ key: lineSeq++, ref: lineKey(l), qty: Number(l.qty), note: l.note ?? '' })),
    },
  }
}

interface DrawerProps {
  id: string | null
  /** set → the drawer opens straight in edit mode (new component / duplicate) */
  seed: EditInit | null
  back: { id: string; name: string } | null; onBack: () => void
  onClose: () => void; onOpen: (id: string, fromName: string) => void
  onDuplicate: (seed: EditInit, from: { id: string; name: string }) => void
  /** a new component got its id (first Save draft / Publish) */
  onCreated: (id: string) => void
  /** something was saved — reload the list */
  onChanged: () => void
  needOptions: () => void
  opts: Options | null; optsErr: string | null; categories: string[]; ratios: Map<string, number | null>
}

function ComponentDrawer(p: DrawerProps) {
  const { id, back, onBack, onClose, onOpen } = p
  const [asOf, setAsOf] = useState('')
  const [d, setD] = useState<ComponentDetail | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [edit, setEdit] = useState<EditInit | null>(p.seed)
  const [editRev, setEditRev] = useState(0)

  useEffect(() => {
    if (!id) return
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
    const res = await setComponentActive(d.component.id, next)
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    setTick((t) => t + 1); p.onChanged()
  }

  const startEdit = (init: EditInit) => { p.needOptions(); setEdit(init); setEditRev((r) => r + 1) }

  const b = d?.breakdown
  const total = b ? (b.total_cost ?? b.lines.reduce((s, l) => s + Number(l.line_cost || 0), 0)) : 0
  const versions = d?.versions ?? []
  const published = versions.filter((v) => v.status === 'published')
  const inForce = versions.find((v) => v.id === b?.version_id) ?? published[0] ?? versions[0]
  const openDraft = versions.find((v) => v.status === 'draft')
  const comp = d?.component
  const kind = b ? componentKind(b) : null
  const U = (b?.unit ?? comp?.base_unit ?? 'g') as BaseUnit
  const fmtC = (v: number | null | undefined) => fmtCompCost(v, U)
  const fmtOut = (v: number | null | undefined) => (U === 'g' ? fmtG(v) : fmtQtyUnit(v, U))
  const perLabel = perLabelOf(U)

  // the ledger starts at 1900 with «no version yet» = 0 €/kg; that is not a price, drop it
  const histRows = useMemo(
    () => (d?.history ?? [])
      .filter((h) => !h.flags?.no_version)
      .map((h) => ({ date: h.date, cost_per_g: Number(h.cost_per_g), cause: chartCause(h.cause) })),
    [d])

  // history · used in · versions — shown under both the view and the editor
  const lower = d && b && comp ? (<>
    <div className="cst-section">
      <h4>Cost history <span className="cst-muted" style={{ fontWeight: 400 }}>· per {perLabel}</span></h4>
      <HistoryChart rows={histRows} valueKey="cost_per_g" fmt={fmtC} />
      <div className="cst-legend">
        <span><i style={{ background: '#2563eb' }} />price change</span>
        <span><i style={{ background: '#f59e0b' }} />new version</span>
        <span><i style={{ background: '#6b7280' }} />other</span>
      </div>
    </div>

    {(d.dishes.length > 0 || d.parents.length > 0) && (
      <div className="cst-section">
        {d.dishes.length > 0 && (<>
          <h4>Dishes <span className="cst-muted" style={{ fontWeight: 400 }}>· {d.dishes.length}</span></h4>
          <Chips more={showAll} onMore={() => setShowAll(true)} items={d.dishes.map((x, i) => (
            <Link key={`d:${x.id}:${i}`} className="cst-chip" to={`/admin/costing/dishes?dish=${encodeURIComponent(x.id)}`}
                  title={`dish line «${x.ingredient}» · ${x.source}`}>{x.name}</Link>))} />
        </>)}
        {d.parents.length > 0 && (<>
          <h4 style={{ marginTop: d.dishes.length ? 10 : 0 }}>Inside recipes <span className="cst-muted" style={{ fontWeight: 400 }}>· {d.parents.length}</span></h4>
          <Chips more={showAll} onMore={() => setShowAll(true)} items={d.parents.map((x) => (
            <a key={`c:${x.id}`} href="#" className="cst-chip cst-chip-comp" title="recipe that contains this component"
               onClick={(e) => { e.preventDefault(); onOpen(x.id, comp.name) }}>{x.name}</a>))} />
        </>)}
      </div>
    )}

    <details className="cst-section cst-details" open={versions.length > 1}>
      <summary><h4 style={{ display: 'inline' }}>Versions ({versions.length})</h4></summary>
      <div className="cst-wrap" style={{ maxHeight: 'none', marginTop: 6 }}>
        <table className="cst-table">
          <thead><tr>
            <th>Ver.</th><th>From</th><th>Yield</th><th>What changed</th><th />
          </tr></thead>
          <tbody>
            {versions.map((v, i) => (
              <tr key={v.id} className={b.version_id === v.id || edit?.draftId === v.id ? 'cst-sel' : undefined}>
                <td className="cst-strong" style={{ whiteSpace: 'nowrap' }}>
                  v{v.version_no}{v.status === 'draft' && <span className="cst-badge cst-warn" style={{ marginLeft: 4 }}>draft</span>}
                  {b.version_id === v.id && <div className="cst-note">in force</div>}
                  {edit?.draftId === v.id && <div className="cst-note">editing</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.effective_from)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{yieldLabel(v.yield_mode, v.yield_pct, v.output_weight_g, U)}{v.yield_mode === 'fixed' && ` ${fmtC(v.fixed_cost_per_g)}`}</td>
                <td style={{ fontSize: 12 }}>
                  {versionDiff(v, versions.slice(i + 1).find((x) => x.status === 'published') ?? versions[i + 1]).slice(0, 6).map((t, j) => <div key={j}>{t}</div>)}
                  {v.notes && <div className="cst-note">{v.notes}</div>}
                  <div className="cst-note">{v.created_by ?? 'system'} · {new Date(v.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {!edit && (v.status === 'draft'
                    ? <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => startEdit(initFrom(comp, v, 'draft'))}>Edit draft</button>
                    : <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => startEdit(initFrom(comp, v, 'version'))}>Copy to new</button>)}
                </td>
              </tr>
            ))}
            {!versions.length && <tr><td colSpan={5} className="cst-muted">No versions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </details>
  </>) : null

  return (
    <div className="admin-drawer-overlay" onClick={() => { if (!edit) onClose() }}>
      <div className="admin-drawer cst-drawer-wide cst-drawer-xwide" onClick={(e) => e.stopPropagation()}>
        {edit ? (
          <EditPane
            key={editRev}
            init={edit}
            d={d}
            lower={lower}
            back={back} onBack={onBack} onClose={onClose}
            opts={p.opts} optsErr={p.optsErr} categories={p.categories} ratios={p.ratios}
            onCreated={p.onCreated}
            onSaved={(draftId) => {
              setTick((t) => t + 1); p.onChanged()
              if (draftId) setEdit((e) => (e ? { ...e, draftId } : e))
            }}
            onExit={() => { setEdit(null); setTick((t) => t + 1) }}
          />
        ) : (<>
          <header className="admin-drawer-head">
            <div className="admin-drawer-head-title" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              {back && (
                <a href="#" className="cst-back" onClick={(e) => { e.preventDefault(); onBack() }}>← {back.name}</a>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>{comp?.name ?? 'Component'}</h2>
                {kind && <span className={`cst-badge ${KIND_BADGE[kind][0]}`}>{KIND_BADGE[kind][1]}</span>}
                {comp && !comp.active && <span className="cst-badge cst-warn">inactive</span>}
              </div>
              {comp?.category && <span className="cst-note">{comp.category}</span>}
            </div>
            <button className="admin-drawer-close" onClick={onClose}>×</button>
          </header>
          <div className="admin-drawer-body" style={{ padding: '12px 18px 24px' }}>
            {err && <div className="admin-error-banner" style={{ marginBottom: 8 }}>{err}</div>}
            {loading && !d && <div className="admin-loading">Loading…</div>}
            {d && b && comp && kind && (
              <>
                <div className="cst-toolbar" style={{ marginBottom: 12 }}>
                  <label>Costs as of
                    <input type="date" className="admin-input" value={asOf || d.as_of} onChange={(e) => setAsOf(e.target.value)} style={{ width: 145 }} />
                  </label>
                  {asOf && <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setAsOf('')}>Today</button>}
                  {loading && <span className="cst-count">Loading…</span>}
                  <span className="cst-spacer" />
                  <button className="admin-btn admin-btn-primary admin-btn-sm"
                          title={openDraft ? `Continue the saved draft v${openDraft.version_no}` : 'Edit here; Save draft as often as you like, Publish when done'}
                          onClick={() => startEdit(openDraft ? initFrom(comp, openDraft, 'draft') : initFrom(comp, inForce, 'version'))}>
                    {openDraft ? `Continue draft v${openDraft.version_no}` : kind === 'fixed' ? 'Add recipe' : 'Edit'}
                  </button>
                  <button className="admin-btn admin-btn-secondary admin-btn-sm" title="Start a new component pre-filled with this recipe"
                          onClick={() => { p.needOptions(); p.onDuplicate(initFrom(comp, openDraft ?? inForce, 'duplicate'), { id: comp.id, name: comp.name }) }}>
                    Duplicate
                  </button>
                  <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={toggleActive}>
                    {comp.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>

                {/* ── summary ── */}
                <div className="cst-tiles cst-tiles-tight">
                  <div className="cst-tile">
                    <div className="cst-tile-k">Cost per {perLabel}</div>
                    <div className="cst-tile-v">{fmtC(b.cost_per_g)}</div>
                    <div className="cst-tile-s"><FlagBadges flags={b.flags} />{!b.flags?.estimated && !b.flags?.unpriced && 'from purchases'}</div>
                  </div>
                  <div className="cst-tile">
                    {kind === 'single' ? (<>
                      <div className="cst-tile-k">Yield</div>
                      <div className="cst-tile-v">{Number(b.yield_pct)}%</div>
                      <div className="cst-tile-s">{U === 'pcs' ? `${fmtQtyUnit(b.raw_pieces, 'pcs')} in → ${fmtOut(b.output_g)} out` : `${fmtG(b.raw_weight_g)} raw → ${fmtG(b.output_g)} cooked`}</div>
                    </>) : kind === 'fixed' ? (<>
                      <div className="cst-tile-k">Batch</div>
                      <div className="cst-tile-v cst-muted">—</div>
                      <div className="cst-tile-s">no recipe lines</div>
                    </>) : (<>
                      <div className="cst-tile-k">Batch</div>
                      <div className="cst-tile-v">{fmtEurFine(total, 3)}</div>
                      <div className="cst-tile-s">
                        {b.yield_mode === 'pct'
                          ? (U === 'pcs' ? `${fmtQtyUnit(b.raw_pieces, 'pcs')} in → ${fmtOut(b.output_g)} (${Number(b.yield_pct)}%)` : `${fmtG(b.raw_weight_g)} raw → ${fmtG(b.output_g)} cooked (${Number(b.yield_pct)}%)`)
                          : `${b.lines.length} lines → ${fmtOut(b.output_g)}${U === 'g' ? ' cooked' : ''}`}
                      </div>
                    </>)}
                  </div>
                  <div className="cst-tile">
                    <div className="cst-tile-k">Version in force</div>
                    <div className="cst-tile-v">{b.version_no ? `v${b.version_no}` : '—'}</div>
                    <div className="cst-tile-s">{b.version_no ? `since ${fmtDate(b.effective_from)} · ${published.length} published` : 'no published version'}{openDraft && ` · draft v${openDraft.version_no} open`}</div>
                  </div>
                  <div className="cst-tile">
                    <div className="cst-tile-k">Used in</div>
                    <div className="cst-tile-v">{d.dishes.length}</div>
                    <div className="cst-tile-s">{d.dishes.length === 1 ? 'dish line' : 'dish lines'} · {d.parents.length} recipes</div>
                  </div>
                </div>

                {/* ── ingredients: same expandable tree as the dish drawer ── */}
                {kind === 'fixed' ? (
                  <div className="cst-section">
                    <h4>Raw ingredients</h4>
                    <div className="cst-empty">
                      <div className="cst-strong">No recipe yet.</div>
                      <div>The cost is a fixed estimate of <b>{fmtC(b.cost_per_g)}</b> carried over from the kitchen Excel.
                        It will not follow ingredient prices until a version with recipe lines is added.</div>
                    </div>
                  </div>
                ) : (
                  <ComponentRecipeTree key={`${comp.id}:${d.as_of}:${b.version_id}`} componentId={comp.id} asOf={d.as_of} unit={U} />
                )}

                {lower}
              </>
            )}
          </div>
        </>)}
      </div>
    </div>
  )
}

// ── edit mode of the drawer ─────────────────────────────────────────────────
function EditPane({ init, d, lower, back, onBack, onClose, opts, optsErr, categories, ratios, onCreated, onSaved, onExit }: {
  init: EditInit; d: ComponentDetail | null; lower: ReactNode
  back: { id: string; name: string } | null; onBack: () => void; onClose: () => void
  opts: Options | null; optsErr: string | null; categories: string[]; ratios: Map<string, number | null>
  onCreated: (id: string) => void
  onSaved: (draftId: string | null) => void
  onExit: () => void
}) {
  const [f, setF] = useState<EditForm>(init.form)
  const set = (patch: Partial<EditForm>) => setF((x) => ({ ...x, ...patch }))
  const [compId, setCompId] = useState<string | null>(init.componentId)
  const [draftId, setDraftId] = useState<string | null>(init.draftId)
  const [snap, setSnap] = useState(() => JSON.stringify(init.form))
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const dirty = JSON.stringify(f) !== snap
  const U = f.unit
  const perWord = perLabelOf(U)
  const outWord = U === 'pcs' ? 'pieces' : U === 'ml' ? 'ml' : 'cooked g'

  const versions = d?.versions ?? []
  const draftNo = versions.find((v) => v.id === draftId)?.version_no ?? null
  const nextNo = versions.reduce((m, v) => Math.max(m, v.version_no), 0) + 1

  // ── pickers ──
  const unitOf = useMemo(() => new Map((opts?.items ?? []).map((i) => [i.id, i.base_unit])), [opts])
  const compUnitOf = useMemo(() => new Map((opts?.comps ?? []).map((c) => [c.id, c.base_unit ?? 'g'])), [opts])
  const pickOpts = useMemo<PickOption[]>(() => {
    if (!opts) return []
    const items = opts.items.map((i) => ({
      id: `i:${i.id}`, label: i.name, hint: `item · ${i.base_unit}${i.kind === 'packaging' ? ' · packaging' : ''}${i.active ? '' : ' · inactive'}`,
    }))
    const comps = opts.comps.filter((c) => c.id !== compId).map((c) => ({
      id: `c:${c.id}`, label: c.name, hint: `component${(c.base_unit ?? 'g') === 'pcs' ? ' · per piece' : ''}${c.category ? ` · ${c.category}` : ''}${c.active ? '' : ' · inactive'}`,
    }))
    return [...items, ...comps].sort((a, b) => a.label.localeCompare(b.label, 'el'))
  }, [opts, compId])

  // ── live preview (nothing is written) ──
  const usedLines = f.lines.filter((l) => l.ref && l.qty !== null && l.qty > 0)
  const payload = JSON.stringify({
    date: f.effective || todayAthens(), base_unit: U, grams_per_unit: U === 'pcs' ? f.gpu : null,
    yield_mode: f.mode, yield_pct: f.pct, output_weight_g: f.outW,
    fixed_cost_per_g: f.fixed === null ? null : f.fixed / fixedFactorOf(U),
    lines: usedLines.map((l) => ({
      idx: l.key,
      cost_item_id: l.ref!.startsWith('i:') ? l.ref!.slice(2) : null,
      child_component_id: l.ref!.startsWith('c:') ? l.ref!.slice(2) : null,
      qty: l.qty,
    })),
  })
  const [pv, setPv] = useState<{ key: string; data: ComponentPreview | null; error: string | null } | null>(null)
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      void fetchComponentPreview(JSON.parse(payload)).then((r) => { if (alive) setPv({ key: payload, data: r.data, error: r.error }) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [payload])
  const pvd = pv?.data ?? null
  const stale = pv?.key !== payload
  const byIdx = useMemo(() => new Map((pvd?.children ?? []).map((c) => [Number(c.idx), c])), [pvd])
  const totalCost = Number(pvd?.cost ?? 0)
  const share = (c: number) => (totalCost > 0 ? c / totalCost : null)
  const toggle = (path: string) => setOpen((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })
  const allPaths = (): string[] => {
    const out: string[] = []
    const walk = (node: RecipeNode, path: string) => {
      if (node.kind === 'component' && node.children.length) { out.push(path); node.children.forEach((c, i) => walk(c, `${path}/${i}`)) }
    }
    for (const l of f.lines) { const n = byIdx.get(l.key); if (n) walk(n, `E${l.key}`) }
    return out
  }

  // ── linked Raw ↔ Cooked (WEC-864, Ioustinos 11/11) ──
  // stored quantity: cost item → raw (as bought); component → cooked (its output unit)
  const setLine = (key: number, patch: Partial<EdLine>) => setF((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
  const lineRatio = (l: EdLine): number | null => {
    const ref = l.ref
    if (!ref) return null
    if (ref.startsWith('c:')) {
      if ((compUnitOf.get(ref.slice(2)) ?? 'g') === 'pcs') return null
      const n = byIdx.get(l.key)
      const fromPv = n && n.kind === 'component' ? nodeRatio(n) : null
      const r = fromPv ?? ratios.get(ref.slice(2)); return r && r > 0 ? r : null
    }
    if (unitOf.get(ref.slice(2)) === 'pcs') return null
    return f.mode === 'pct' && f.pct && f.pct > 0 ? f.pct / 100 : null
  }
  const r1 = (v: number) => Math.round(v * 10) / 10
  const r4 = (v: number) => Math.round(v * 10000) / 10000
  const storedRaw = (l: EdLine) => !l.ref || l.ref.startsWith('i:')
  const rawOf = (l: EdLine): number | null => {
    if (l.qty === null) return null
    if (storedRaw(l)) return l.qty
    const r = lineRatio(l); return r ? r1(l.qty / r) : null
  }
  const cookedOf = (l: EdLine): number | null => {
    if (l.qty === null) return null
    if (!storedRaw(l)) return l.qty
    const r = lineRatio(l); return r ? r1(l.qty * r) : null
  }
  const setRaw = (l: EdLine, v: number | null) => {
    if (storedRaw(l)) return setLine(l.key, { qty: v })
    const r = lineRatio(l); setLine(l.key, { qty: v === null || !r ? null : r4(v * r) })
  }
  const setCooked = (l: EdLine, v: number | null) => {
    if (!storedRaw(l)) return setLine(l.key, { qty: v })
    const r = lineRatio(l); setLine(l.key, { qty: v === null || !r ? null : r4(v / r) })
  }
  const isPcs = (ref: string | null) => !!ref && (ref.startsWith('c:') ? (compUnitOf.get(ref.slice(2)) ?? 'g') === 'pcs' : unitOf.get(ref.slice(2)) === 'pcs')
  const isMl = (ref: string | null) => !!ref && (ref.startsWith('c:') ? compUnitOf.get(ref.slice(2)) === 'ml' : unitOf.get(ref.slice(2)) === 'ml')

  // Σ Raw / Σ Cooked of the lines (Ioustinos 11/11: «a sum to see how much the whole thing would weigh»)
  const sums = f.lines.reduce((a, l) => {
    if (!l.ref || l.qty === null) return a
    if (isPcs(l.ref)) return { ...a, pcs: a.pcs + l.qty }
    const rw = rawOf(l), ck = cookedOf(l)
    return { ...a, raw: a.raw + (rw ?? 0), cooked: a.cooked + (ck ?? 0), missing: a.missing + (ck === null ? 1 : 0) }
  }, { raw: 0, cooked: 0, missing: 0, pcs: 0 })

  // ── kind badge, from what is on screen ──
  const kind: CompKind = f.mode === 'fixed' ? 'fixed' : !usedLines.length ? 'empty'
    : usedLines.length === 1 && usedLines[0].ref!.startsWith('i:') ? 'single' : 'recipe'

  // ── save ──
  const validate = (strict: boolean): string | null => {
    if (!f.name.trim()) return 'Name is required.'
    if (f.method === 'other' && !f.other.trim()) return 'Type the cooking method (or pick another).'
    if (!f.effective) return 'Effective date is required.'
    if (U === 'pcs' && f.gpu !== null && f.gpu <= 0) return 'Grams per piece must be greater than 0.'
    if (f.mode === 'fixed') return f.fixed === null || f.fixed < 0 ? `Enter the fixed € per ${perWord}.` : null
    if (f.mode === 'pct' && (f.pct === null || f.pct <= 0)) return 'Yield % must be greater than 0.'
    if (f.mode === 'output_weight' && (f.outW === null || f.outW <= 0)) return `Batch output (${outWord}) must be greater than 0.`
    const refs = usedLines.map((l) => l.ref)
    if (new Set(refs).size !== refs.length) return 'The same item / component appears twice — merge the lines.'
    if (!strict) return null
    const touched = f.lines.filter((l) => l.ref || l.qty !== null)
    if (!touched.length) return 'Add at least one line.'
    for (const [i, l] of touched.entries()) {
      if (!l.ref) return `Line ${i + 1}: pick an item or component.`
      if (l.qty === null || l.qty <= 0) return `Line ${i + 1}: quantity must be greater than 0.`
    }
    return null
  }
  const incomplete = f.mode === 'fixed' ? 0 : f.lines.filter((l) => (l.ref || l.qty !== null) && !(l.ref && l.qty !== null && l.qty > 0)).length

  const save = async (publish: boolean) => {
    const v = validate(publish)
    if (v) { setErr(v); return }
    if (publish && !confirm(`Publish this version effective ${fmtDate(f.effective)}? Published versions are read-only.`)) return
    setSaving(true); setErr(null)
    const snapshot = JSON.stringify(f)
    const res = await saveComponentVersion({
      component_id: compId,
      name: f.name.trim(),
      category: f.category.trim() || null,
      notes: f.notes,
      cooking_method: f.method === 'na' ? null : f.method,
      cooking_method_other: f.method === 'other' ? f.other.trim() : null,
      base_unit: U,
      grams_per_unit: U === 'pcs' ? f.gpu : null,
      draft_id: draftId,
      effective_from: f.effective,
      yield_mode: f.mode,
      yield_pct: f.mode === 'pct' ? f.pct : null,
      output_weight_g: f.mode === 'output_weight' ? f.outW : null,
      fixed_cost_per_g: f.mode === 'fixed' ? (f.fixed ?? 0) / fixedFactorOf(U) : null,
      publish,
      version_notes: f.vnotes.trim() || null,
      lines: f.mode === 'fixed' ? [] : usedLines.map((l) => ({
        cost_item_id: l.ref!.startsWith('i:') ? l.ref!.slice(2) : null,
        child_component_id: l.ref!.startsWith('c:') ? l.ref!.slice(2) : null,
        qty: l.qty ?? 0,
        note: l.note.trim() || null,
      })),
    })
    setSaving(false)
    if (res.error) { setErr(res.error); return }
    const { component_id, version_id } = res.data!
    if (!compId) { setCompId(component_id); onCreated(component_id) }
    if (publish) { onSaved(null); onExit(); return }
    setDraftId(version_id); setSnap(snapshot); setSavedAt(new Date())
    onSaved(version_id)
  }

  const leave = (then: () => void) => {
    if (dirty && !confirm('Leave without saving your changes?')) return
    then()
  }
  const cancel = () => leave(() => (compId ? onExit() : onClose()))

  const discard = async () => {
    if (!draftId) return
    if (!confirm(`Discard draft${draftNo ? ` v${draftNo}` : ''}? Its lines are deleted; published versions are not touched.`)) return
    setSaving(true)
    const res = await discardComponentDraft(draftId)
    if (res.error) { setSaving(false); setErr(res.error); return }
    const anyOther = versions.some((v) => v.id !== draftId)
    if (compId && !anyOther && confirm('This component has no other version. Delete the component too?')) {
      const del = await deleteUnpublishedComponent(compId)
      setSaving(false)
      if (del.error) { setErr(del.error); return }
      onSaved(null); onClose(); return
    }
    setSaving(false)
    onSaved(null)
    if (compId) onExit(); else onClose()
  }

  // links inside the tree navigate away — ask first when there are unsaved changes
  const guardLinks = (e: RMouseEvent) => {
    if (!dirty || !(e.target as HTMLElement).closest('a[href]')) return
    if (!confirm('Leave without saving your changes?')) { e.preventDefault(); e.stopPropagation() }
  }

  const status = compId
    ? (draftId ? `Editing draft${draftNo ? ` v${draftNo}` : ''}` : `New version v${nextNo}${init.fromNo ? ` · from v${init.fromNo}` : ''}`)
    : init.copyOf ? `New component · copy of «${init.copyOf}»` : 'New component'
  const saveNote = saving ? 'Saving…' : dirty ? 'unsaved changes' : savedAt
    ? `draft saved ${savedAt.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}` : draftId ? 'draft saved' : ''

  // ── preview tiles ──
  const fmtC = (v: number | null | undefined) => fmtCompCost(v, U)
  const fmtOut = (v: number | null | undefined) => (U === 'g' ? fmtG(v) : fmtQtyUnit(v, U))
  const rawIn = U === 'pcs' ? `${fmtQtyUnit(pvd?.raw_pieces, 'pcs')} in` : `${fmtG(pvd?.raw_weight_g)} raw`

  const rows: ReactNode[] = []
  f.lines.forEach((l) => {
    const n = byIdx.get(l.key) ?? null
    const path = `E${l.key}`
    const can = !!n && n.kind === 'component' && n.children.length > 0
    const isOpen = open.has(path)
    const r = lineRatio(l)
    const pcs = isPcs(l.ref)
    const raw = storedRaw(l)
    rows.push(
      <tr key={path} className="cst-edit-row">
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchPick options={pickOpts} value={l.ref} onChange={(v) => setLine(l.key, { ref: v })} placeholder="Search item or component…" width="100%" />
            </div>
            {can && (
              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm cst-tree-toggle" style={{ flex: 'none', marginLeft: 0 }}
                      title={isOpen ? 'Hide its recipe' : 'Show its recipe'}
                      onClick={() => toggle(path)} aria-expanded={isOpen}>{isOpen ? '▾' : '▸'}</button>
            )}
            <button className="admin-btn admin-btn-ghost admin-btn-sm" title="Remove line" style={{ padding: '0 6px', flex: 'none' }}
                    onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((y) => y.key !== l.key) }))}>×</button>
          </div>
          <input className="admin-input cst-input cst-line-note" value={l.note} placeholder="note"
                 onChange={(e) => setLine(l.key, { note: e.target.value })} />
        </td>
        <td className="cst-muted" style={{ fontSize: 11.5 }}>
          {!l.ref ? '' : l.ref.startsWith('i:') ? 'cost item' : n && n.kind === 'component' ? recipeYieldLabel(n) : 'component'}
          {n && n.kind === 'component' && <div><FlagBadges flags={n.flags} /></div>}
        </td>
        {pcs ? (
          <td className="num" colSpan={2}><NumText value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} width={70} /> <span className="cst-muted">pcs</span></td>
        ) : (<>
          <td className="num" title={raw ? 'Saved as raw (as bought)' : r ? `Raw = cooked ÷ ${r1(r * 100)}% yield` : 'No yield known for this line'}>
            <NumText value={rawOf(l)} onChange={(v) => setRaw(l, v)} width={84} disabled={!raw && !r} />
          </td>
          <td className="num" title={!raw ? 'Saved as cooked' : r ? `Cooked = raw × ${r1(r * 100)}% yield` : (f.mode === 'pct' ? 'Set the yield %' : 'Per-line cooked weight needs «Yield %» mode')}>
            <NumText value={cookedOf(l)} onChange={(v) => setCooked(l, v)} width={84} disabled={raw && !r} />
            <div className="cst-note" style={{ textAlign: 'right' }}>{isMl(l.ref) ? 'ml' : 'g'}{r ? ` · ${r1(r * 100)}%` : ''}</div>
          </td>
        </>)}
        <td className="num">{n ? nodeUnitCost(n) : ''}</td>
        <td>{n ? nodeReference(n) : ''}</td>
        <td className="num">{n ? fmtEurFine(n.cost, 3) : ''}</td>
        <td className="num cst-muted">{n ? fmtPct(share(Number(n.cost))) : ''}</td>
      </tr>,
    )
    if (can && isOpen && n.kind === 'component') n.children.forEach((c, i) => rows.push(...treeNodeRows(c, `${path}/${i}`, 1, open, toggle, share)))
  })

  return (<>
    <header className="admin-drawer-head">
      <div className="admin-drawer-head-title" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, flex: 1, minWidth: 0 }}>
        {back && (
          <a href="#" className="cst-back" onClick={(e) => { e.preventDefault(); leave(onBack) }}>← {back.name}</a>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input className="admin-input cst-title-input" value={f.name} placeholder="Component name, e.g. Καρότο σωτέ"
                 autoFocus={!compId} onChange={(e) => set({ name: e.target.value })} />
          <select className="admin-input" style={{ width: 150 }} value={f.method} title="Cooking method"
                  onChange={(e) => set({ method: e.target.value as MethodSel })}>
            <option value="na">Cooking: N/A</option>
            {COOKING_METHODS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
          {f.method === 'other' && (
            <input className="admin-input" style={{ width: 130 }} value={f.other} placeholder="which method?" onChange={(e) => set({ other: e.target.value })} />
          )}
          <span className={`cst-badge ${KIND_BADGE[kind][0]}`}>{KIND_BADGE[kind][1]}</span>
        </div>
        <input className="admin-input" list="cst-comp-cats-e" style={{ width: 260 }} value={f.category} placeholder="Category"
               onChange={(e) => set({ category: e.target.value })} />
        <datalist id="cst-comp-cats-e">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <button className="admin-drawer-close" onClick={() => leave(onClose)}>×</button>
    </header>
    <div className="admin-drawer-body" style={{ padding: '12px 18px 24px' }} onClickCapture={guardLinks}>
      <div className="cst-toolbar cst-edit-bar" style={{ marginBottom: 12 }}>
        <span className="cst-badge cst-warn">{status}</span>
        <span className="cst-note">{saveNote}</span>
        <span className="cst-spacer" />
        {draftId && <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={saving} onClick={() => void discard()}>Discard draft</button>}
        <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={saving} onClick={cancel}>Cancel</button>
        <button className="admin-btn admin-btn-secondary admin-btn-sm" disabled={saving} onClick={() => void save(false)}
                title="Keeps this as a draft — no new version, saves over the same draft every time">Save draft</button>
        <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={saving} onClick={() => void save(true)}>Publish</button>
      </div>
      {err && <div className="admin-error-banner" style={{ marginBottom: 8 }}>{err}</div>}
      {incomplete > 0 && <div className="cst-note" style={{ marginBottom: 6 }}>{incomplete} incomplete {incomplete === 1 ? 'line is' : 'lines are'} left out of the preview and of «Save draft».</div>}

      {/* ── summary: same tiles, now with inputs ── */}
      <div className="cst-tiles cst-tiles-tight">
        <div className="cst-tile">
          <div className="cst-tile-k">Cost per{' '}
            <select className="cst-tile-select" value={U} onChange={(e) => set({ unit: e.target.value as BaseUnit })}>
              <option value="g">cooked kg</option>
              <option value="ml">litre</option>
              <option value="pcs">piece</option>
            </select>
          </div>
          <div className="cst-tile-v" style={{ opacity: stale ? 0.5 : 1 }}>{fmtC(pvd?.cost_per_g)}</div>
          <div className="cst-tile-s">
            {U === 'pcs'
              ? <span title="Turns a dish's grams into pieces (80 g ÷ 80 = 1). Empty = that dish line costs €0 and is flagged.">g / piece <NumText value={f.gpu} onChange={(v) => set({ gpu: v })} width={60} placeholder="80" /></span>
              : pv?.error ? <span className="cst-inline-err">{pv.error}</span> : 'live preview · not saved'}
          </div>
        </div>
        <div className="cst-tile">
          <div className="cst-tile-k">
            <select className="cst-tile-select" value={f.mode} onChange={(e) => set({ mode: e.target.value as YieldMode })}>
              <option value="pct">Yield %</option>
              <option value="output_weight">Batch output</option>
              <option value="fixed">Fixed € per {perWord}</option>
            </select>
          </div>
          <div className="cst-tile-v">
            {f.mode === 'pct' && <><NumText value={f.pct} onChange={(v) => set({ pct: v })} width={70} placeholder={U === 'pcs' ? '100' : '60'} /> <span className="cst-muted" style={{ fontSize: 14 }}>%</span></>}
            {f.mode === 'output_weight' && <><NumText value={f.outW} onChange={(v) => set({ outW: v })} width={80} placeholder={U === 'pcs' ? '40' : '350'} /> <span className="cst-muted" style={{ fontSize: 14 }}>{outWord}</span></>}
            {f.mode === 'fixed' && <><NumText value={f.fixed} onChange={(v) => set({ fixed: v })} width={80} placeholder="4,20" /> <span className="cst-muted" style={{ fontSize: 14 }}>€</span></>}
          </div>
          <div className="cst-tile-s">{f.mode === 'fixed' ? 'no recipe lines' : `${rawIn} → ${fmtOut(pvd?.output_g)}${U === 'g' ? ' cooked' : ''} · batch ${fmtEurFine(pvd?.cost ?? null, 3)}`}</div>
        </div>
        <div className="cst-tile">
          <div className="cst-tile-k">Effective from</div>
          <div className="cst-tile-v"><input type="date" className="admin-input" value={f.effective} onChange={(e) => set({ effective: e.target.value })} style={{ width: 150 }} /></div>
          <div className="cst-tile-s">prices previewed as of this date</div>
        </div>
        <div className="cst-tile">
          <div className="cst-tile-k">Used in</div>
          <div className="cst-tile-v">{d ? d.dishes.length : '—'}</div>
          <div className="cst-tile-s">{d ? `${d.dishes.length === 1 ? 'dish line' : 'dish lines'} · ${d.parents.length} recipes` : 'new component'}</div>
        </div>
      </div>

      {/* ── ingredients: the same tree, with editable top-level lines ── */}
      <div className="cst-section">
        <div className="cst-toolbar" style={{ marginBottom: 6 }}>
          <h4 style={{ margin: 0 }}>Raw ingredients</h4>
          <span className="cst-note">whole batch · live</span>
          <span className="cst-spacer" />
          {f.mode !== 'fixed' && (<>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setOpen(new Set(allPaths()))}>Expand all</button>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setOpen(new Set())}>Collapse</button>
          </>)}
        </div>
        {optsErr && <div className="cst-inline-err">Could not load items/components: {optsErr}</div>}
        {f.mode === 'fixed' ? (
          <div className="cst-empty">
            <div className="cst-strong">Fixed estimate — no recipe lines.</div>
            <div>Switch the second tile to «Yield %» or «Batch output» to enter the recipe.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', opacity: stale && pv ? 0.75 : 1 }}>
            <table className="cst-table">
              <thead>
                <tr><th style={{ width: '30%' }}>Ingredient / component / cost item</th><th>Recipe</th>
                  <th className="num">Raw <span className="cst-muted" style={{ fontWeight: 400 }}>· this batch</span></th>
                  <th className="num">Cooked</th><th className="num">Unit cost</th><th>Reference</th><th className="num">Cost</th><th className="num">Share</th></tr>
              </thead>
              <tbody>
                {rows}
                {!opts && !optsErr && <tr><td colSpan={8} className="cst-muted">Loading items and components…</td></tr>}
                <tr>
                  <td colSpan={8}>
                    <button className="admin-btn admin-btn-ghost admin-btn-sm"
                            onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { key: lineSeq++, ref: null, qty: null, note: '' }] }))}>
                      + Add line
                    </button>
                  </td>
                </tr>
                <tr className="cst-sum-row">
                  <td colSpan={2} style={{ fontWeight: 600 }}>Total weight
                    {sums.pcs > 0 && <span className="cst-muted" style={{ fontWeight: 400 }}> · + {fmtQtyUnit(sums.pcs, 'pcs')} not in grams</span>}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtG(sums.raw)}</td>
                  <td className="num" style={{ fontWeight: 600 }}
                      title={sums.missing ? `${sums.missing} line(s) have no cooked weight yet (no yield known) — not counted` : 'Σ of the Cooked column'}>
                    {sums.missing ? '≥ ' : ''}{fmtG(sums.cooked)}</td>
                  <td colSpan={4} className="cst-muted" style={{ fontSize: 11.5 }}>
                    {sums.missing > 0 && `${sums.missing} line(s) without a cooked weight not counted`}</td>
                </tr>
                <tr>
                  <td colSpan={6} style={{ fontWeight: 600 }}>Cost of this batch
                    <span className="cst-muted" style={{ fontWeight: 400 }}> · {fmtOut(pvd?.output_g)}{U === 'g' ? ' cooked' : ''}</span></td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtEur(pvd?.cost ?? 0)}</td><td />
                </tr>
              </tbody>
            </table>
            <p className="cst-note" style={{ marginTop: 4 }}>
              Type in Raw or Cooked — the other follows the yield. A cost item is saved as raw (as bought) and uses this component's yield %;
              a component is saved as cooked and uses its own yield. Expand a component to see its own recipe.
            </p>
          </div>
        )}
        <label className="cst-note" style={{ display: 'block', marginTop: 8 }}>Version note
          <input className="admin-input cst-input" value={f.vnotes} onChange={(e) => set({ vnotes: e.target.value })}
                 placeholder="π.χ. +10 ml λάδι" style={{ width: '100%', marginTop: 2 }} />
        </label>
      </div>

      {lower}
    </div>
  </>)
}

// ── quick form: one raw item + yield % ───────────────────────────────────────
function QuickForm({ opts, optsErr, categories, presetItemId, onClose, onSaved }: {
  opts: Options | null; optsErr: string | null; categories: string[]; presetItemId?: string | null
  onClose: () => void; onSaved: (componentId: string) => void
}) {
  const [itemId, setItemId] = useState<string | null>(presetItemId ?? null)
  // '' = not picked yet, 'na' = no cooking method (no parenthesis in the name)
  const [method, setMethod] = useState<CookingMethod | 'na' | ''>('')
  const [base, setBase] = useState<string | null>(null) // null = follow the item name
  const [other, setOther] = useState('')
  const [category, setCategory] = useState('')
  const [pct, setPct] = useState<number | null>(null)
  const [effective, setEffective] = useState(todayAthens())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const itemOpts = useMemo<PickOption[]>(
    () => (opts?.items ?? []).filter((i) => i.kind === 'food').map((i) => ({ id: i.id, label: i.name, hint: `${i.base_unit}${i.active ? '' : ' · inactive'}` })),
    [opts])
  const item = opts?.items.find((i) => i.id === itemId) ?? null
  const label = method && method !== 'na' ? cookingLabel(method, other) : null
  const baseName = (base ?? item?.name ?? '').trim()
  const name = baseName ? (label ? `${baseName} (${label})` : baseName) : ''

  const save = async () => {
    if (!item) { setErr('Pick the raw item.'); return }
    if (!method) { setErr('Pick the cooking method (or N/A).'); return }
    if (!baseName) { setErr('Name is required.'); return }
    if (method === 'other' && !other.trim()) { setErr('Type the cooking method.'); return }
    if (pct === null || pct <= 0) { setErr('Yield % must be greater than 0.'); return }
    if (!effective) { setErr('Effective date is required.'); return }
    setSaving(true); setErr(null)
    const res = await saveComponentVersion({
      name, category: category.trim() || null, effective_from: effective,
      cooking_method: method === 'na' ? null : method, cooking_method_other: method === 'other' ? other.trim() : null,
      // per-piece item → per-piece component (1 piece in, yield % of pieces out); g / ml → per gram / ml
      base_unit: item.base_unit, grams_per_unit: item.base_unit === 'pcs' ? (item.grams_per_unit ?? null) : null,
      yield_mode: 'pct', yield_pct: pct, publish: true,
      lines: [{ cost_item_id: item.id, qty: item.base_unit === 'pcs' ? 1 : 100 }],
    })
    setSaving(false)
    if (res.error) { setErr(res.error); return }
    onSaved(res.data!.component_id)
  }

  return (
    <div className="admin-modal-overlay" style={{ zIndex: 110 }} onClick={() => !saving && onClose()}>
      <div className="admin-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2>New component from a cost item</h2>
          <button className="admin-drawer-close" onClick={() => !saving && onClose()}>×</button>
        </header>
        <div className="admin-drawer-body" style={{ padding: '10px 16px' }}>
          <p className="cst-note" style={{ marginTop: 0 }}>
            One raw item + how it is cooked + yield (e.g. Καρότα, βραστό, 70%). Creates a published component with one line of {item?.base_unit === 'pcs' ? '1 piece' : `100 ${item?.base_unit ?? 'units'}`} of the item{item?.base_unit === 'pcs' ? ', costed per piece' : ''}.
          </p>
          {optsErr && <div className="cst-inline-err">Could not load items: {optsErr}</div>}
          <div className="cst-grid-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ gridColumn: '1 / -1' }}>Raw item *
              {opts
                ? <SearchPick options={itemOpts} value={itemId} autoFocus={!presetItemId} width="100%"
                    onChange={(v) => setItemId(v)} placeholder="Search cost item…" />
                : <span className="cst-note">Loading…</span>}
            </label>
            <label>Cooking method *
              <select className="admin-input cst-input" value={method} onChange={(e) => setMethod(e.target.value as CookingMethod | 'na' | '')}>
                <option value="">— pick —</option>
                <option value="na">N/A (no method)</option>
                {COOKING_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            {method === 'other'
              ? <label>Which method? *<input className="admin-input cst-input" value={other} autoFocus onChange={(e) => setOther(e.target.value)} placeholder="e.g. καπνιστό" /></label>
              : <div />}
            <label style={{ gridColumn: '1 / -1' }}>Name (defaults to the item name)
              <input className="admin-input cst-input" value={base ?? item?.name ?? ''} onChange={(e) => setBase(e.target.value)} placeholder="pick an item" />
            </label>
            <div style={{ gridColumn: '1 / -1', fontSize: 13 }}>
              <span className="cst-note">Will be saved as: </span>
              {name ? <b>{name}</b> : <span className="cst-muted">pick an item and a method</span>}
            </div>
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
