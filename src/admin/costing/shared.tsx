/* eslint-disable react-refresh/only-export-components -- one small shared module (formatters + widgets) for the costing pages */
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { BaseUnit, CostFlags, CostSource } from '../../lib/api/adminCosting'
import './costing.css'

/**
 * Shared bits for /admin/costing/* (epic WEC-857). Compact by design
 * (Ioustinos: compact screens for everyone).
 */

// ── formatting ───────────────────────────────────────────────────────────────
const eur = (d: number) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d })
const EUR2 = eur(2), EUR3 = eur(3), EUR4 = eur(4)

/** € with 2 decimals (portions, invoices). */
export function fmtEur(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : EUR2.format(Number(v))
}
/** € with 3–4 decimals for small unit costs. */
export function fmtEurFine(v: number | null | undefined, digits: 3 | 4 = 4): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return (digits === 3 ? EUR3 : EUR4).format(Number(v))
}
/** Unit cost per base unit → human scale: €/kg, €/L or €/pc. */
export function fmtUnitCost(unitCost: number | null | undefined, unit: BaseUnit | string): string {
  if (unitCost === null || unitCost === undefined) return '—'
  const v = Number(unitCost)
  if (unit === 'g') return `${EUR2.format(v * 1000)}/kg`
  if (unit === 'ml') return `${EUR2.format(v * 1000)}/L`
  return `${v < 1 ? EUR4.format(v) : EUR2.format(v)}/pc`
}
/** Component cost in its own unit: g → €/kg (cooked), ml → €/L, pcs → €/pc. */
export const fmtCompCost = (v: number | null | undefined, unit: BaseUnit | string | null | undefined) =>
  fmtUnitCost(v, unit || 'g')
/** «2 pcs» / «120 g» / «50 ml» */
export function fmtQtyUnit(q: number | null | undefined, unit: BaseUnit | string | null | undefined): string {
  if (q === null || q === undefined) return '—'
  const r = Math.round(Number(q) * 100) / 100
  const u = unit || 'g'
  return `${r.toLocaleString('el-GR')} ${u === 'pcs' ? (r === 1 ? 'pc' : 'pcs') : u}`
}
/** Component cost per cooked g → €/kg. */
export const fmtPerKg = (perG: number | null | undefined) =>
  perG === null || perG === undefined ? '—' : `${EUR2.format(Number(perG) * 1000)}/kg`
export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
}
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, dd] = d.slice(0, 10).split('-')
  return `${dd}/${m}/${y}`
}
export const todayAthens = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Athens' })

/** Parse a text input as a number: accepts «1,25» or «1.25». WEC-609: text inputs, never spinners. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Greek-insensitive search key (accents, case, final sigma). */
export function skey(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim()
}

// ── badges ───────────────────────────────────────────────────────────────────
export function SourceBadge({ source, date }: { source: CostSource | null | undefined; date?: string | null }) {
  if (source === 'purchase') return <span className="cst-badge cst-ok" title="Last purchase on or before the date">purchase {fmtDate(date)}</span>
  if (source === 'standard') return <span className="cst-badge cst-est" title="Fallback price (estimate) — no purchase yet">estimated</span>
  if (source === 'unpriced') return <span className="cst-badge cst-err" title="No price — counts as €0">unpriced</span>
  return <span className="cst-badge">—</span>
}

export function FlagBadges({ flags }: { flags: CostFlags | null | undefined }) {
  if (!flags) return null
  const out: ReactNode[] = []
  if (flags.unlinked) out.push(<span key="ul" className="cst-badge cst-err" title="Dish lines without a costing component">{flags.unlinked} unlinked</span>)
  if (flags.unpriced) out.push(<span key="up" className="cst-badge cst-err" title="Contains unpriced items (counted as €0)">unpriced</span>)
  if (flags.no_version) out.push(<span key="nv" className="cst-badge cst-err" title="No published version on this date">no version</span>)
  if (flags.estimated) out.push(<span key="es" className="cst-badge cst-est" title="Contains estimated costs (Excel / fallback price)">estimated</span>)
  if (flags.no_packaging) out.push(<span key="np" className="cst-badge cst-warn" title="No packaging set for this dish">no packaging</span>)
  if (flags.no_weight) out.push(<span key="nw" className="cst-badge cst-warn" title="A pcs line has no grams per piece — yield % cannot weigh it">weight?</span>)
  if (flags.zero_output) out.push(<span key="zo" className="cst-badge cst-err">zero output</span>)
  if (flags.cycle) out.push(<span key="cy" className="cst-badge cst-err">cycle</span>)
  if (flags.no_piece_weight) out.push(<span key="pw" className="cst-badge cst-err" title="Per-piece component without «grams per piece»: the plate's grams cannot be turned into pieces (counted as €0)">g per piece?</span>)
  return <>{out}</>
}

// ── sparkline ────────────────────────────────────────────────────────────────
/** Step line of [date, value] points over the last `days` days (ends today). */
export function Sparkline({ points, current, days = 90, width = 90, height = 22 }: {
  points: Array<[string, number]> | null | undefined; current?: number | null; days?: number; width?: number; height?: number
}) {
  const path = useMemo(() => {
    const today = new Date(todayAthens()).getTime()
    const start = today - days * 864e5
    const pts = (points ?? []).map(([d, v]) => [Math.max(new Date(d).getTime(), start), Number(v)] as [number, number])
    if (!pts.length && (current === null || current === undefined)) return null
    if (!pts.length || pts[0][0] > start) pts.unshift([start, pts.length ? pts[0][1] : Number(current)])
    pts.push([today, pts[pts.length - 1][1]])
    const vals = pts.map((p) => p[1]); const min = Math.min(...vals); const max = Math.max(...vals)
    const x = (t: number) => ((t - start) / (today - start)) * (width - 2) + 1
    const y = (v: number) => max === min ? height / 2 : height - 2 - ((v - min) / (max - min)) * (height - 4)
    let d = `M${x(pts[0][0]).toFixed(1)},${y(pts[0][1]).toFixed(1)}`
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i][0]).toFixed(1)} V${y(pts[i][1]).toFixed(1)}`
    return d
  }, [points, current, days, width, height])
  if (!path) return <span className="cst-muted">—</span>
  return <svg className="cst-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden><path d={path} /></svg>
}

/** Step chart for a cost history with cause markers (item / component / variant detail).
 *  - drops the 1900 «no data yet» baseline (it is not a price of 0)
 *  - keeps every purchase as a point; merges other same-value repeats (a re-save that changed nothing)
 *  - y-axis fitted to the data with padding; a flat history is drawn mid-height
 *  - real pixel width (ResizeObserver) so text and dots are never stretched
 *  - hover anywhere to read the value in force on that date */
export function HistoryChart({ rows, valueKey, height = 150, fmt }: {
  rows: Array<{ date: string; cause?: string | null } & Record<string, unknown>>; valueKey: string; height?: number
  /** axis + tooltip formatter (default: € with 3 decimals) */
  fmt?: (v: number) => string
}) {
  const f = fmt ?? ((v: number) => fmtEurFine(v, 3))
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [hover, setHover] = useState<number | null>(null)
  const [today] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w > 0) setWidth(w) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pts = useMemo(() => {
    const out: Array<{ t: number; v: number; cause: string; date: string }> = []
    for (const r of rows) {
      if (r.date < '2000-01-01') continue
      const v = Number(r[valueKey])
      if (!Number.isFinite(v)) continue
      const cause = r.cause ?? ''
      // a purchase is always a point, even at the same price; other repeats (re-saves, rebuilds) are merged
      const isPurchase = /^(purchase|invoice|item)/.test(cause)
      if (!isPurchase && out.length && Math.abs(out[out.length - 1].v - v) < 1e-9) continue
      if (out.length && out[out.length - 1].date === r.date) { out[out.length - 1] = { ...out[out.length - 1], v, cause: isPurchase ? cause : out[out.length - 1].cause }; continue }
      out.push({ t: new Date(r.date + 'T00:00:00').getTime(), v, cause, date: r.date })
    }
    return out
  }, [rows, valueKey])

  if (!pts.length) return <div className="cst-muted">No history.</div>

  const L = 74, R = 14, T = 12, B = 24
  const t0 = pts[0].t
  const t1 = Math.max(today, pts[pts.length - 1].t) + 3 * 864e5
  const vals = pts.map((p) => p.v)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi - lo < Math.max(hi, 1e-9) * 0.02) { const pad = Math.max(hi * 0.2, 1e-6); lo -= pad; hi += pad }
  else { const pad = (hi - lo) * 0.15; lo -= pad; hi += pad }
  if (lo < 0 && Math.min(...vals) >= 0) lo = 0
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (width - L - R)
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (height - T - B)

  let d = `M${x(pts[0].t)},${y(pts[0].v)}`
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t)} V${y(pts[i].v)}`
  d += ` H${x(t1)}`

  const kind = (c: string) => c.startsWith('purchase') || c.startsWith('invoice') || c.startsWith('item') ? 'price'
    : c.startsWith('version') || c.startsWith('component') ? 'version' : c.startsWith('dish') || c.startsWith('grams') ? 'grams' : 'other'
  const dfmt = (t: number) => new Date(t).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: '2-digit' })

  // x ticks: first point, today, plus up to 3 evenly spaced in between
  const ticks: number[] = [t0]
  const span = t1 - t0
  for (let k = 1; k <= 3; k++) ticks.push(t0 + (span * k) / 4)
  const yTicks = [hi, (hi + lo) / 2, lo]

  // hovered value: last point at or before the cursor date
  const hv = hover === null ? null : (() => {
    const t = t0 + ((hover - L) / (width - L - R)) * (t1 - t0)
    let p = pts[0]
    for (const q of pts) if (q.t <= t) p = q
    return { t: Math.min(Math.max(t, t0), t1), p }
  })()

  return (
    <div ref={ref} className="cst-chart-wrap">
      <svg className="cst-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
           onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = e.clientX - r.left; setHover(px >= L && px <= width - R ? px : null) }}
           onMouseLeave={() => setHover(null)}>
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} className="cst-chart-grid" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" className="cst-chart-lbl">{f(v)}</text>
          </g>
        ))}
        {ticks.map((t, i) => (
          <text key={`x${i}`} x={x(t)} y={height - 7} textAnchor={i === 0 ? 'start' : 'middle'} className="cst-chart-lbl">{dfmt(t)}</text>
        ))}
        {today >= t0 && today <= t1 && <line x1={x(today)} x2={x(today)} y1={T} y2={height - B} className="cst-chart-today" />}
        <path className="cst-chart-line" d={d} />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={4} className={`cst-dot cst-dot-${kind(p.cause)}`}>
            <title>{dfmt(p.t)} · {f(p.v)}{p.cause ? ` · ${p.cause}` : ''}</title>
          </circle>
        ))}
        {hv && (
          <g pointerEvents="none">
            <line x1={x(hv.t)} x2={x(hv.t)} y1={T} y2={height - B} className="cst-chart-cursor" />
            <g transform={`translate(${Math.min(x(hv.t) + 8, width - R - 150)},${T + 2})`}>
              <rect width={150} height={34} rx={5} className="cst-chart-tip" />
              <text x={8} y={14} className="cst-chart-tip-d">{dfmt(hv.t)}</text>
              <text x={8} y={28} className="cst-chart-tip-v">{f(hv.p.v)}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  )
}

// ── URL-persisted filters (WEC-687 house rule) ───────────────────────────────
export function useUrlState(key: string, fallback = ''): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams()
  const value = sp.get(key) ?? fallback
  // functional update: several setters called in one handler must compose,
  // not each overwrite the others from the same stale snapshot
  const set = (v: string) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev)
      if (v === fallback || v === '') next.delete(key); else next.set(key, v)
      return next
    }, { replace: true })
  }
  return [value, set]
}

// ── searchable picker ────────────────────────────────────────────────────────
export interface PickOption { id: string; label: string; hint?: string; group?: string }

/**
 * Compact search-as-you-type picker (items / components). Keyboard: ↑ ↓ Enter Esc.
 * `onCreate` adds a «+ create «text»» row (inline create).
 */
export function SearchPick({ options, value, onChange, placeholder, onCreate, autoFocus, width }: {
  options: PickOption[]; value: string | null; onChange: (id: string | null, opt?: PickOption) => void
  placeholder?: string; onCreate?: (text: string) => void; autoFocus?: boolean; width?: number | string
}) {
  const sel = options.find((o) => o.id === value) ?? null
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const list = useMemo(() => {
    const k = skey(q)
    const words = k.split(' ').filter(Boolean)
    const res = words.length ? options.filter((o) => { const s = skey(o.label + ' ' + (o.hint ?? '')); return words.every((w) => s.includes(w)) }) : options
    return res.slice(0, 40)
  }, [q, options])
  const pick = (o: PickOption) => { onChange(o.id, o); setOpen(false); setQ('') }
  return (
    <div className="cst-pick" ref={ref} style={{ width }}>
      <input
        className="admin-input cst-input"
        value={open ? q : (sel?.label ?? '')}
        placeholder={placeholder ?? 'Search…'}
        autoFocus={autoFocus}
        onFocus={() => { setOpen(true); setQ(''); setHi(0) }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
        onKeyDown={(e) => {
          const max = list.length + (onCreate && q.trim() ? 1 : 0)
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, max - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') {
            e.preventDefault()
            if (hi < list.length) pick(list[hi]); else if (onCreate && q.trim()) { onCreate(q.trim()); setOpen(false); setQ('') }
          } else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && (
        <div className="cst-pick-list">
          {list.map((o, i) => (
            <div key={o.id} className={`cst-pick-opt${i === hi ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(o) }}>
              <span>{o.label}</span>{o.hint && <span className="cst-muted"> {o.hint}</span>}
            </div>
          ))}
          {onCreate && q.trim() && (
            <div className={`cst-pick-opt cst-pick-create${hi === list.length ? ' on' : ''}`}
                 onMouseDown={(e) => { e.preventDefault(); onCreate(q.trim()); setOpen(false); setQ('') }}>
              + Create «{q.trim()}»
            </div>
          )}
          {!list.length && !(onCreate && q.trim()) && <div className="cst-pick-opt cst-muted">No matches</div>}
        </div>
      )}
    </div>
  )
}

/** Plain text numeric input (no spinner). Calls onChange with the parsed number (or null). */
export function NumText({ value, onChange, width = 80, placeholder, align = 'right', disabled }: {
  value: number | null | undefined; onChange: (v: number | null) => void; width?: number; placeholder?: string
  align?: 'left' | 'right'; disabled?: boolean
}) {
  const [txt, setTxt] = useState(value === null || value === undefined ? '' : String(value))
  const last = useRef(value)
  useEffect(() => {
    if (value !== last.current) { last.current = value; setTxt(value === null || value === undefined ? '' : String(value)) }
  }, [value])
  return (
    <input
      className="admin-input cst-input" inputMode="decimal" style={{ width, textAlign: align }} placeholder={placeholder}
      disabled={disabled} value={txt}
      onChange={(e) => { setTxt(e.target.value); const n = parseNum(e.target.value); last.current = n; onChange(n) }}
    />
  )
}

/** Tabs strip used at the top of every costing page. */
export function CostingTabs() {
  const tabs: Array<[string, string]> = [
    ['/admin/costing', 'Overview'], ['/admin/costing/dishes', 'Dishes'], ['/admin/costing/components', 'Components'],
    ['/admin/costing/items', 'Cost items'], ['/admin/costing/purchases', 'Purchases'], ['/admin/costing/suppliers', 'Suppliers'],
    ['/admin/costing/links', 'Dish links'],
  ]
  return (
    <nav className="cst-tabs">
      {tabs.map(([p, l]) => (
        <NavLink key={p} to={p} end={p === '/admin/costing'} className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>
      ))}
    </nav>
  )
}
