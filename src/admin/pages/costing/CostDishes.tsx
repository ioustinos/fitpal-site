import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  applyPackaging,
  fetchCostItemOptions,
  fetchDishCosts,
  fetchDishPackaging,
  fetchVariantDetail,
  type CostFlags,
  type CostItemOption,
  type DishCostRow,
  type DishCostVariant,
  type VariantBreakdown,
} from '../../../lib/api/adminCosting'
import {
  CostingTabs,
  FlagBadges,
  HistoryChart,
  NumText,
  SearchPick,
  SourceBadge,
  fmtDate,
  fmtEur,
  fmtPct,
  fmtPerKg,
  skey,
  todayAthens,
  useUrlState,
  type PickOption,
} from '../../costing/shared'

/**
 * Admin → Costing → Dishes (WEC-866 — dish costing per variant: food +
 * packaging = product cost, % of selling price, per-dish packaging editor).
 *
 * Selling prices are VAT-inclusive. The % base is a visible, URL-persisted
 * toggle (default: net of 13% food VAT) — an open decision for the owner.
 */

const VAT = 0.13
const PAGE = 300

type Base = 'net' | 'gross'
const baseLabel = (b: Base) => (b === 'net' ? 'of net price, VAT 13%' : 'of price incl. VAT')
const priceBase = (price: number | null | undefined, b: Base): number | null => {
  const p = Number(price)
  if (!Number.isFinite(p) || p <= 0) return null
  return b === 'net' ? p / (1 + VAT) : p
}
const pctOf = (cost: number | null | undefined, price: number | null | undefined, b: Base): number | null => {
  const base = priceBase(price, b)
  if (base === null || cost === null || cost === undefined) return null
  return Number(cost) / base
}
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

// ── derived list model ───────────────────────────────────────────────────────
interface Range { min: number | null; max: number | null }
interface DishView {
  d: DishCostRow
  variants: DishCostVariant[]
  key: string
  price: Range; food: Range; pack: Range; product: Range; foodPct: Range; productPct: Range
  flags: CostFlags
  problem: boolean
}

function range(vals: Array<number | null>): Range {
  let min: number | null = null, max: number | null = null
  for (const v of vals) {
    if (v === null || !Number.isFinite(v)) continue
    if (min === null || v < min) min = v
    if (max === null || v > max) max = v
  }
  return { min, max }
}

function mergeFlags(vs: DishCostVariant[]): CostFlags {
  const out: CostFlags = {}
  for (const v of vs) {
    const f = v.flags
    if (!f) continue
    if (f.unlinked) out.unlinked = Math.max(out.unlinked ?? 0, Number(f.unlinked))
    if (f.unpriced) out.unpriced = Math.max(Number(out.unpriced ?? 0), Number(f.unpriced === true ? 1 : f.unpriced))
    if (f.estimated) out.estimated = true
    if (f.no_packaging) out.no_packaging = true
    if (f.no_version) out.no_version = true
    if (f.cycle) out.cycle = true
  }
  return out
}

function buildView(d: DishCostRow, b: Base): DishView {
  const variants = d.variants ?? []
  const flags = mergeFlags(variants)
  return {
    d, variants, key: skey(d.name + ' ' + (d.category_id ?? '') + ' ' + d.id),
    price: range(variants.map((v) => n(v.price))),
    food: range(variants.map((v) => n(v.food_cost))),
    pack: range(variants.map((v) => n(v.packaging_cost))),
    product: range(variants.map((v) => n(v.product_cost))),
    foodPct: range(variants.map((v) => pctOf(v.food_cost, v.price, b))),
    productPct: range(variants.map((v) => pctOf(v.product_cost, v.price, b))),
    flags,
    problem: !!(flags.unlinked || flags.unpriced || flags.no_packaging || flags.no_version || flags.cycle),
  }
}

const fmtRange = (r: Range, f: (v: number) => string) =>
  r.min === null ? '—' : r.max === null || Math.abs(r.max - r.min) < 0.005 ? f(r.min) : `${f(r.min)} – ${f(r.max as number)}`
const fmtPctRange = (r: Range) =>
  r.min === null ? '—' : r.max === null || Math.abs(r.max - r.min) < 0.0005 ? fmtPct(r.min) : `${fmtPct(r.min)} – ${fmtPct(r.max)}`

/** Colour a cost % — green ≤30%, amber ≤40%, red above (visual cue only). */
const pctColor = (v: number | null) => (v === null ? undefined : v > 0.4 ? '#b91c1c' : v > 0.3 ? '#b45309' : '#15803d')

function UnlinkedLink({ dishId, count }: { dishId: string; count: number }) {
  return (
    <Link to={`/admin/costing/links?dish=${encodeURIComponent(dishId)}`} className="cst-badge cst-err"
      title="Dish lines without a costing component — open dish links" onClick={(e) => e.stopPropagation()}
      style={{ textDecoration: 'none' }}>
      {count} unlinked
    </Link>
  )
}

function Flags({ dishId, flags }: { dishId: string; flags: CostFlags | null | undefined }) {
  if (!flags) return null
  const { unlinked, ...rest } = flags
  return <>{unlinked ? <UnlinkedLink dishId={dishId} count={Number(unlinked)} /> : null}<FlagBadges flags={rest} /></>
}

// ── row (memoised; 322 dishes / 1369 variants) ───────────────────────────────
const DishRows = memo(function DishRows({ v, base, open, selected, onToggleOpen, onToggleSel, onOpen }: {
  v: DishView; base: Base; open: boolean; selected: boolean
  onToggleOpen: (id: string) => void; onToggleSel: (id: string) => void; onOpen: (id: string) => void
}) {
  const d = v.d
  return (
    <>
      <tr className={`cst-click${selected ? ' cst-sel' : ''}`} onClick={() => onOpen(d.id)}>
        <td onClick={(e) => e.stopPropagation()} style={{ width: 24 }}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSel(d.id)} />
        </td>
        <td>
          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm"
            style={{ padding: '0 4px', minWidth: 18, marginRight: 4 }}
            onClick={(e) => { e.stopPropagation(); onToggleOpen(d.id) }}
            title={open ? 'Collapse variants' : 'Show variants'} disabled={!v.variants.length}>
            {open ? '▾' : '▸'}
          </button>
          <span className="cst-strong">{d.name}</span>
          {!d.active && <span className="cst-badge" style={{ marginLeft: 6 }}>inactive</span>}
          {d.on_menu && <span className="cst-badge cst-ok" style={{ marginLeft: 6 }} title="On a current or future menu">menu</span>}
        </td>
        <td className="cst-muted">{d.category_id ?? '—'}</td>
        <td className="num">{v.variants.length}</td>
        <td className="num">{fmtRange(v.price, fmtEur)}</td>
        <td className="num">{fmtRange(v.food, fmtEur)}</td>
        <td className="num">{fmtRange(v.pack, fmtEur)}</td>
        <td className="num cst-strong">{fmtRange(v.product, fmtEur)}</td>
        <td className="num">{fmtPctRange(v.foodPct)}</td>
        <td className="num cst-strong" style={{ color: pctColor(v.productPct.max) }}>{fmtPctRange(v.productPct)}</td>
        <td><Flags dishId={d.id} flags={v.flags} /></td>
      </tr>
      {open && v.variants.map((x) => {
        const fp = pctOf(x.food_cost, x.price, base)
        const pp = pctOf(x.product_cost, x.price, base)
        return (
          <tr key={x.id} className="cst-sub cst-click" onClick={() => onOpen(d.id)}>
            <td />
            <td style={{ paddingLeft: 34 }}>{x.label || x.id}</td>
            <td />
            <td />
            <td className="num">{fmtEur(x.price)}</td>
            <td className="num">{fmtEur(x.food_cost)}</td>
            <td className="num">{fmtEur(x.packaging_cost)}</td>
            <td className="num cst-strong">{fmtEur(x.product_cost)}</td>
            <td className="num">{fmtPct(fp)}</td>
            <td className="num cst-strong" style={{ color: pctColor(pp) }}>{fmtPct(pp)}</td>
            <td><Flags dishId={d.id} flags={x.flags} /></td>
          </tr>
        )
      })}
    </>
  )
})

// ── page ─────────────────────────────────────────────────────────────────────
type ListRes = { key: string; data: DishCostRow[] | null; error: string | null }

export function CostDishes() {
  const [asOfUrl, setAsOf] = useUrlState('asof')
  const asOf = asOfUrl || todayAthens()
  const [baseUrl, setBase] = useUrlState('base')
  const base: Base = baseUrl === 'gross' ? 'gross' : 'net'
  const [sort, setSort] = useUrlState('sort', '-pct')
  const [cat, setCat] = useUrlState('cat')
  const [onMenu, setOnMenu] = useUrlState('menu')
  const [flag, setFlag] = useUrlState('flag')
  const [q, setQ] = useUrlState('q')
  const [dishParam, setDishParam] = useUrlState('dish')

  const [reload, setReload] = useState(0)
  const [res, setRes] = useState<ListRes | null>(null)
  const loadKey = `${asOf}#${reload}`
  useEffect(() => {
    let alive = true
    fetchDishCosts(asOf).then((r) => { if (alive) setRes({ key: loadKey, data: r.data, error: r.error }) })
    return () => { alive = false }
  }, [asOf, loadKey])
  const loading = res?.key !== loadKey
  const rows = useMemo(() => res?.data ?? [], [res])

  const [itemOpts, setItemOpts] = useState<CostItemOption[] | null>(null)
  const [itemErr, setItemErr] = useState<string | null>(null)
  useEffect(() => {
    fetchCostItemOptions().then((r) => { if (r.error) setItemErr(r.error); else setItemOpts(r.data ?? []) })
  }, [])
  const packOptions: PickOption[] = useMemo(() => (itemOpts ?? [])
    .filter((o) => o.kind === 'packaging')
    .map((o) => ({ id: o.id, label: o.name, hint: `${o.base_unit}${o.active ? '' : ' · inactive'}` })), [itemOpts])

  const views = useMemo(() => rows.map((d) => buildView(d, base)), [rows, base])
  const categories = useMemo(() => Array.from(new Set(rows.map((d) => d.category_id).filter((c): c is string => !!c))).sort(), [rows])

  const filtered = useMemo(() => {
    const words = skey(q).split(' ').filter(Boolean)
    let out = views.filter((v) => {
      if (cat && v.d.category_id !== cat) return false
      if (onMenu && !v.d.on_menu) return false
      if (flag === 'any' && !v.problem) return false
      if (flag === 'unlinked' && !v.flags.unlinked) return false
      if (flag === 'unpriced' && !v.flags.unpriced) return false
      if (flag === 'no_packaging' && !v.flags.no_packaging) return false
      if (flag === 'estimated' && !v.flags.estimated) return false
      if (words.length && !words.every((w) => v.key.includes(w))) return false
      return true
    })
    const desc = sort.startsWith('-')
    const field = desc ? sort.slice(1) : sort
    const nullLast = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return desc ? b - a : a - b
    }
    out = [...out].sort((a, b) => {
      if (field === 'name') return (desc ? -1 : 1) * a.d.name.localeCompare(b.d.name, 'el')
      if (field === 'food') return nullLast(a.food.max, b.food.max) || a.d.name.localeCompare(b.d.name, 'el')
      if (field === 'product') return nullLast(a.product.max, b.product.max) || a.d.name.localeCompare(b.d.name, 'el')
      return nullLast(a.productPct.max, b.productPct.max) || a.d.name.localeCompare(b.d.name, 'el')
    })
    return out
  }, [views, q, cat, onMenu, flag, sort])

  const [limit, setLimit] = useState(PAGE)
  const shown = filtered.slice(0, limit)

  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set())
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const toggleOpen = useCallback((id: string) => setOpenSet((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x }), [setOpenSet])
  const toggleSel = useCallback((id: string) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x }), [setSel])
  // useUrlState's setter changes every render; keep row callbacks stable so memoised rows don't re-render
  const setDishRef = useRef(setDishParam)
  useEffect(() => { setDishRef.current = setDishParam })
  const openDish = useCallback((id: string) => setDishRef.current(id), [])
  const allShownSel = shown.length > 0 && shown.every((v) => sel.has(v.d.id))
  const toggleAllShown = () => setSel((s) => {
    const x = new Set(s)
    if (allShownSel) shown.forEach((v) => x.delete(v.d.id)); else shown.forEach((v) => x.add(v.d.id))
    return x
  })

  const [bulkOpen, setBulkOpen] = useState(false)

  const sortTh = (field: string, label: string, num = true, defaultDesc = true) => {
    const active = sort === field || sort === `-${field}`
    const arrow = active ? (sort.startsWith('-') ? ' ↓' : ' ↑') : ''
    return (
      <th className={`sortable${num ? ' num' : ''}`}
        onClick={() => setSort(active ? (sort.startsWith('-') ? field : `-${field}`) : (defaultDesc ? `-${field}` : field))}>
        {label}{arrow}
      </th>
    )
  }

  const dishView = dishParam ? views.find((v) => v.d.id === dishParam) ?? null : null
  const totalVariants = useMemo(() => filtered.reduce((s, v) => s + v.variants.length, 0), [filtered])

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Costing · Dishes</h1>
      <CostingTabs />

      <div className="cst-toolbar">
        <input className="admin-input" placeholder="Search dish…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} style={{ width: 200 }} />
        <select className="admin-input" value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE) }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="admin-input" value={flag} onChange={(e) => { setFlag(e.target.value); setLimit(PAGE) }} title="Coverage flags">
          <option value="">All flags</option>
          <option value="any">Flagged (unlinked / unpriced / no packaging)</option>
          <option value="unlinked">Unlinked lines</option>
          <option value="unpriced">Unpriced</option>
          <option value="no_packaging">No packaging</option>
          <option value="estimated">Estimated</option>
        </select>
        <label><input type="checkbox" checked={!!onMenu} onChange={(e) => setOnMenu(e.target.checked ? '1' : '')} /> On menu only</label>
        <label title="Selling prices include VAT. Choose what the % columns divide by.">
          % base
          <select className="admin-input" value={base} onChange={(e) => setBase(e.target.value === 'gross' ? 'gross' : '')}>
            <option value="net">Net of VAT (13%)</option>
            <option value="gross">Incl. VAT</option>
          </select>
        </label>
        <label>
          As of
          <input type="date" className="admin-input" value={asOf} onChange={(e) => setAsOf(e.target.value === todayAthens() ? '' : e.target.value)} />
        </label>
        <span className="cst-spacer" />
        {sel.size > 0 && (
          <>
            <span className="cst-count">{sel.size} selected</span>
            <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setSel(new Set())}>Clear</button>
          </>
        )}
        <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={!sel.size} onClick={() => setBulkOpen(true)}
          title={sel.size ? '' : 'Select dishes with the checkboxes first'}>
          Apply packaging…
        </button>
        <span className="cst-count">{filtered.length} dishes · {totalVariants} variants</span>
      </div>

      {res?.error && <div className="admin-error-banner">Could not load dish costs: {res.error}</div>}
      {itemErr && <div className="admin-error-banner">Could not load packaging items: {itemErr}</div>}

      {loading && !res ? <div className="admin-loading">Loading dish costs…</div> : (
        <div className="cst-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
          <table className="cst-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>
                  <input type="checkbox" checked={allShownSel} onChange={toggleAllShown} title="Select all shown" />
                </th>
                {sortTh('name', 'Dish', false, false)}
                <th>Category</th>
                <th className="num">Var.</th>
                <th className="num">Price</th>
                {sortTh('food', 'Food cost')}
                <th className="num">Packaging</th>
                {sortTh('product', 'Product cost')}
                <th className="num" title="Food cost ÷ selling price">Food % ({baseLabel(base)})</th>
                {sortTh('pct', `Product % (${baseLabel(base)})`)}
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <DishRows key={v.d.id} v={v} base={base} open={openSet.has(v.d.id)} selected={sel.has(v.d.id)}
                  onToggleOpen={toggleOpen} onToggleSel={toggleSel} onOpen={openDish} />
              ))}
              {!shown.length && !loading && (
                <tr><td colSpan={11} className="admin-empty">No dishes match.</td></tr>
              )}
            </tbody>
          </table>
          {filtered.length > shown.length && (
            <div style={{ padding: 8, textAlign: 'center' }}>
              <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
                Show more ({filtered.length - shown.length} left)
              </button>
            </div>
          )}
        </div>
      )}
      <div className="cst-note" style={{ marginTop: 6 }}>
        Prices are gross selling prices (VAT incl.). Product cost = food + packaging. Ranges show min – max across variants;
        product % sorts by the worst variant. Costs as of {fmtDate(asOf)}.
      </div>

      {dishParam && !loading && !dishView && (
        <div className="admin-info-banner" style={{ marginTop: 8 }}>
          Dish «{dishParam}» not found. <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setDishParam('')}>Dismiss</button>
        </div>
      )}
      {dishView && (
        <DishDrawer key={dishView.d.id} view={dishView} asOf={asOf} base={base} packOptions={packOptions}
          onClose={() => setDishParam('')} onSaved={() => setReload((r) => r + 1)} />
      )}
      {bulkOpen && (
        <BulkPackaging dishIds={Array.from(sel)} dishes={rows} packOptions={packOptions}
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); setSel(new Set()); setReload((r) => r + 1) }} />
      )}
    </div>
  )
}

// ── packaging rows editor (shared by drawer + bulk panel) ────────────────────
interface PackRow { uid: number; cost_item_id: string | null; qty: number | null }
let uidSeq = 1
const newRow = (cost_item_id: string | null = null, qty: number | null = 1): PackRow => ({ uid: uidSeq++, cost_item_id, qty })

function PackRowsEditor({ rows, setRows, options, disabled }: {
  rows: PackRow[]; setRows: (f: (r: PackRow[]) => PackRow[]) => void; options: PickOption[]; disabled?: boolean
}) {
  return (
    <table className="cst-table">
      <thead>
        <tr><th>Packaging item</th><th className="num" style={{ width: 110 }}>Qty / portion</th><th style={{ width: 40 }} /></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.uid}>
            <td>
              <SearchPick options={options} value={r.cost_item_id} placeholder="Search packaging…"
                onChange={(id) => setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, cost_item_id: id } : x)))} />
            </td>
            <td className="num">
              <NumText value={r.qty} width={80} disabled={disabled}
                onChange={(v) => setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, qty: v } : x)))} />
            </td>
            <td>
              <button className="admin-btn admin-btn-ghost admin-btn-sm" title="Remove" disabled={disabled}
                onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>×</button>
            </td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={3} className="cst-muted">No packaging.</td></tr>}
      </tbody>
    </table>
  )
}

function validatePack(rows: PackRow[]): { items: Array<{ cost_item_id: string; qty: number }>; error: string | null } {
  const items: Array<{ cost_item_id: string; qty: number }> = []
  const seen = new Set<string>()
  for (const [i, r] of rows.entries()) {
    if (!r.cost_item_id) return { items, error: `Row ${i + 1}: pick a packaging item.` }
    if (r.qty === null || !(r.qty > 0)) return { items, error: `Row ${i + 1}: quantity must be a number above 0.` }
    if (seen.has(r.cost_item_id)) return { items, error: `Row ${i + 1}: the same item appears twice.` }
    seen.add(r.cost_item_id)
    items.push({ cost_item_id: r.cost_item_id, qty: r.qty })
  }
  return { items, error: null }
}

// ── dish detail drawer ───────────────────────────────────────────────────────
type Detail = { breakdown: VariantBreakdown; history: Array<{ date: string; product_cost: number; cause: string | null }> }
type DetailRes = { key: string; data: Detail | null; error: string | null }

const linkSourceBadge = (s: string | undefined) =>
  s === 'manual' ? <span className="cst-badge cst-ok">manual</span>
    : s === 'default' ? <span className="cst-badge">default</span>
      : s === 'auto_excel' ? <span className="cst-badge cst-est" title="Auto-matched from the kitchen Excel">auto</span>
        : s ? <span className="cst-badge">{s}</span> : null

function DishDrawer({ view, asOf, base, packOptions, onClose, onSaved }: {
  view: DishView; asOf: string; base: Base; packOptions: PickOption[]; onClose: () => void; onSaved: () => void
}) {
  const d = view.d
  const [variantId, setVariantId] = useState<string | null>(view.variants[0]?.id ?? null)
  const [rev, setRev] = useState(0)
  const [det, setDet] = useState<DetailRes | null>(null)
  const detKey = `${variantId}#${asOf}#${rev}`
  useEffect(() => {
    if (!variantId) return
    let alive = true
    fetchVariantDetail(variantId, asOf).then((r) => {
      if (!alive) return
      setDet({
        key: detKey, error: r.error,
        data: r.data ? { breakdown: r.data.breakdown, history: (r.data.history ?? []).map((h) => ({ date: h.date, product_cost: Number(h.product_cost), cause: h.cause })) } : null,
      })
    })
    return () => { alive = false }
  }, [variantId, asOf, detKey])
  const detLoading = !!variantId && det?.key !== detKey

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // packaging editor
  const [packRev, setPackRev] = useState(0)
  const [pack, setPack] = useState<{ key: number; rows: PackRow[]; error: string | null } | null>(null)
  useEffect(() => {
    let alive = true
    fetchDishPackaging(d.id).then((r) => {
      if (!alive) return
      setPack({ key: packRev, error: r.error, rows: (r.data ?? []).map((x) => newRow(x.cost_item_id, x.qty_per_portion)) })
    })
    return () => { alive = false }
  }, [d.id, packRev])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const setPackRows = (f: (r: PackRow[]) => PackRow[]) => {
    setPack((p) => (p ? { ...p, rows: f(p.rows) } : p)); setDirty(true); setSaveErr(null)
  }
  const savePack = async () => {
    if (!pack) return
    const { items, error } = validatePack(pack.rows)
    if (error) { setSaveErr(error); return }
    setSaving(true); setSaveErr(null)
    const r = await applyPackaging([d.id], items, true)
    setSaving(false)
    if (r.error) { setSaveErr(r.error); return }
    setDirty(false); setPackRev((x) => x + 1); setRev((x) => x + 1); onSaved()
  }

  const b = det?.data?.breakdown ?? null // stale breakdown stays visible (dimmed) while the next one loads
  const hist = det?.data?.history ?? []
  const product = n(b?.product_cost) ?? 0
  const share = (c: number | null | undefined) => (product > 0 && c !== null && c !== undefined ? Number(c) / product : null)
  const unlinkedCount = b ? b.lines.filter((l) => l.unlinked).length : 0

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer cst-drawer-wide" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2 style={{ fontSize: 16 }}>{d.name}</h2>
          <span className="cst-muted" style={{ fontSize: 12, marginLeft: 8 }}>{d.category_id ?? ''} · as of {fmtDate(asOf)}</span>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </header>
        <div className="admin-drawer-body" style={{ fontSize: 13 }}>
          {!view.variants.length && <div className="admin-empty">This dish has no variants.</div>}
          {view.variants.length > 0 && (
            <div className="cst-tabs" style={{ marginTop: 0 }}>
              {view.variants.map((v) => (
                <a key={v.id} href="#" className={v.id === variantId ? 'on' : ''}
                  onClick={(e) => { e.preventDefault(); setVariantId(v.id) }}>
                  {v.label || v.id} <span className="cst-muted">{fmtEur(v.price)}</span>
                </a>
              ))}
            </div>
          )}

          {det?.error && det.key === detKey && <div className="admin-error-banner">Could not load variant cost: {det.error}</div>}
          {detLoading && !b && <div className="admin-loading">Loading…</div>}

          {b && (
            <div style={{ opacity: detLoading ? 0.6 : 1 }}>
              <div className="cst-foot-totals" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', paddingLeft: 0 }}>
                <span>Food <b>{fmtEur(b.food_cost)}</b></span>
                <span>Packaging <b>{fmtEur(b.packaging_cost)}</b></span>
                <span>Product <b>{fmtEur(b.product_cost)}</b></span>
                <span>Price <b>{fmtEur(b.price)}</b> <span className="cst-muted">(net {fmtEur(priceBase(b.price, 'net'))})</span></span>
                <span>Food % <b>{fmtPct(pctOf(b.food_cost, b.price, base))}</b></span>
                <span>Product % <b style={{ color: pctColor(pctOf(b.product_cost, b.price, base)) }}>{fmtPct(pctOf(b.product_cost, b.price, base))}</b>
                  <span className="cst-muted"> {baseLabel(base)}</span></span>
                <span><Flags dishId={d.id} flags={b.flags} /></span>
              </div>

              <div className="cst-section">
                <h4>
                  Food lines
                  {unlinkedCount > 0 && (
                    <Link to={`/admin/costing/links?dish=${encodeURIComponent(d.id)}`} className="cst-inline-err" style={{ marginLeft: 8, fontWeight: 400 }}>
                      {unlinkedCount} unlinked — fix in Dish links →
                    </Link>
                  )}
                </h4>
                <table className="cst-table">
                  <thead>
                    <tr>
                      <th>Ingredient</th><th>Component</th><th>Link</th>
                      <th className="num">Grams</th><th className="num">Cost / kg</th><th className="num">Line cost</th><th className="num">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.lines.map((l) => (
                      <tr key={l.ingredient_id} style={l.unlinked ? { color: '#991b1b' } : undefined}>
                        <td>{l.ingredient}</td>
                        <td>
                          {l.unlinked || !l.component_id
                            ? <Link to={`/admin/costing/links?dish=${encodeURIComponent(d.id)}`} className="cst-inline-err">unlinked — link it</Link>
                            : <Link to={`/admin/costing/components?id=${encodeURIComponent(l.component_id)}`}>{l.component ?? l.component_id}</Link>}
                          {l.flags && <span style={{ marginLeft: 4 }}><FlagBadges flags={l.flags} /></span>}
                        </td>
                        <td>{linkSourceBadge(l.link_source)}</td>
                        <td className="num">{Number(l.grams).toLocaleString('el-GR')}</td>
                        <td className="num">{l.unlinked ? '—' : fmtPerKg(n(l.cost_per_g))}</td>
                        <td className="num">{l.unlinked ? '—' : fmtEur(l.line_cost)}</td>
                        <td className="num cst-muted">{l.unlinked ? '—' : fmtPct(share(n(l.line_cost)))}</td>
                      </tr>
                    ))}
                    {!b.lines.length && <tr><td colSpan={7} className="cst-muted">No ingredient lines with grams.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="cst-section">
                <h4>Packaging (this variant)</h4>
                <table className="cst-table">
                  <thead>
                    <tr><th>Item</th><th>Source</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Line cost</th><th className="num">Share</th></tr>
                  </thead>
                  <tbody>
                    {b.packaging.map((p) => (
                      <tr key={p.cost_item_id}>
                        <td>{p.name}</td>
                        <td><SourceBadge source={p.source} /></td>
                        <td className="num">{Number(p.qty).toLocaleString('el-GR')}</td>
                        <td className="num">{fmtEur(p.unit_cost)}</td>
                        <td className="num">{fmtEur(p.line_cost)}</td>
                        <td className="num cst-muted">{fmtPct(share(n(p.line_cost)))}</td>
                      </tr>
                    ))}
                    {!b.packaging.length && <tr><td colSpan={6}><span className="cst-badge cst-warn">no packaging</span></td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="cst-section">
                <h4>Product cost history</h4>
                <HistoryChart rows={hist} valueKey="product_cost" />
                <div className="cst-legend">
                  <span><i style={{ background: '#2563eb' }} />price</span>
                  <span><i style={{ background: '#f59e0b' }} />recipe version</span>
                  <span><i style={{ background: '#a855f7' }} />grams</span>
                  <span><i style={{ background: '#6b7280' }} />other</span>
                </div>
              </div>
            </div>
          )}

          <div className="cst-section" style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
            <h4>Packaging set for this dish <span className="cst-muted" style={{ fontWeight: 400 }}>(applies to every variant)</span></h4>
            {pack?.error && <div className="admin-error-banner">Could not load packaging: {pack.error}</div>}
            {!pack ? <div className="admin-loading">Loading…</div> : (
              <>
                <PackRowsEditor rows={pack.rows} setRows={setPackRows} options={packOptions} disabled={saving} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={saving}
                    onClick={() => setPackRows((rs) => [...rs, newRow()])}>+ Add item</button>
                  <span className="cst-spacer" />
                  {saveErr && <span className="cst-inline-err">{saveErr}</span>}
                  {dirty && (
                    <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={saving}
                      onClick={() => { setDirty(false); setSaveErr(null); setPackRev((x) => x + 1) }}>Reset</button>
                  )}
                  <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={saving || !dirty} onClick={savePack}>
                    {saving ? 'Saving…' : 'Save packaging'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── bulk packaging panel ─────────────────────────────────────────────────────
function BulkPackaging({ dishIds, dishes, packOptions, onClose, onDone }: {
  dishIds: string[]; dishes: DishCostRow[]; packOptions: PickOption[]; onClose: () => void; onDone: () => void
}) {
  const [rows, setRowsState] = useState<PackRow[]>(() => [newRow()])
  const setRows = (f: (r: PackRow[]) => PackRow[]) => { setRowsState(f); setErr(null) }
  const [mode, setMode] = useState<'replace' | 'add'>('replace')
  const [copyFrom, setCopyFrom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dishOptions: PickOption[] = useMemo(() => dishes
    .filter((d) => d.packaging_items > 0)
    .map((d) => ({ id: d.id, label: d.name, hint: `${d.packaging_items} item${d.packaging_items === 1 ? '' : 's'}` })), [dishes])
  const names = useMemo(() => {
    const m = new Map(dishes.map((d) => [d.id, d.name]))
    return dishIds.map((id) => m.get(id) ?? id)
  }, [dishes, dishIds])

  const loadFrom = async (id: string | null) => {
    setCopyFrom(id)
    if (!id) return
    setBusy(true); setErr(null)
    const r = await fetchDishPackaging(id)
    setBusy(false)
    if (r.error) { setErr(r.error); return }
    setRowsState((r.data ?? []).map((x) => newRow(x.cost_item_id, x.qty_per_portion)))
  }

  const apply = async () => {
    const { items, error } = validatePack(rows)
    if (error) { setErr(error); return }
    if (!items.length && mode === 'add') { setErr('Add at least one item.'); return }
    if (mode === 'replace' && !items.length &&
      !confirm(`Remove ALL packaging from ${dishIds.length} dish(es)?`)) return
    if (mode === 'replace' && items.length &&
      !confirm(`Replace the packaging of ${dishIds.length} dish(es) with this set of ${items.length} item(s)?`)) return
    setBusy(true); setErr(null)
    const r = await applyPackaging(dishIds, items, mode === 'replace')
    setBusy(false)
    if (r.error) { setErr(r.error); return }
    onDone()
  }

  return (
    <div className="admin-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: '96vw' }}>
        <header className="admin-drawer-head">
          <h2 style={{ fontSize: 16 }}>Apply packaging to {dishIds.length} dish{dishIds.length === 1 ? '' : 'es'}</h2>
          <button className="admin-drawer-close" onClick={() => !busy && onClose()}>×</button>
        </header>
        <div className="admin-drawer-body" style={{ fontSize: 13 }}>
          <div className="cst-note" style={{ marginBottom: 8 }} title={names.join('\n')}>
            {names.slice(0, 6).join(', ')}{names.length > 6 ? ` and ${names.length - 6} more` : ''}
          </div>
          <div className="cst-toolbar">
            <label>Copy from dish</label>
            <SearchPick options={dishOptions} value={copyFrom} onChange={(id) => loadFrom(id)} placeholder="Pick a dish with packaging…" width={280} />
          </div>
          <PackRowsEditor rows={rows} setRows={setRows} options={packOptions} disabled={busy} />
          <div style={{ marginTop: 6 }}>
            <button className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setRows((rs) => [...rs, newRow()])}>+ Add item</button>
          </div>
          <div className="cst-toolbar" style={{ marginTop: 10 }}>
            <label><input type="radio" name="cst-bulk-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace each dish's packaging with this set</label>
            <label><input type="radio" name="cst-bulk-mode" checked={mode === 'add'} onChange={() => setMode('add')} /> Add / update these items (keep the rest)</label>
          </div>
          {err && <div className="cst-inline-err">{err}</div>}
        </div>
        <footer className="admin-drawer-foot">
          <div style={{ flex: 1 }} />
          <button className="admin-btn admin-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="admin-btn admin-btn-primary" onClick={apply} disabled={busy}>{busy ? 'Applying…' : 'Apply'}</button>
        </footer>
      </div>
    </div>
  )
}
