/* eslint-disable react-refresh/only-export-components -- one small shared module (formatters + widgets) for the costing pages */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import type React from 'react'
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
export function SourceBadge({ source, date, invoiceId }: { source: CostSource | null | undefined; date?: string | null; invoiceId?: string | null }) {
  if (source === 'purchase' && invoiceId) {
    return (
      <Link className="cst-badge cst-ok cst-badge-link" to={`/admin/costing/purchases?inv=${encodeURIComponent(invoiceId)}`}
            title="Open the purchase this price comes from" onClick={(e) => e.stopPropagation()}>
        purchase {fmtDate(date)} ↗
      </Link>
    )
  }
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

// ── what moved a cost (chart dots + legend) ─────────────────────────────────
export type ChangeKind = 'price' | 'recipe' | 'dish' | 'sale' | 'recalc' | 'other'
export const CHANGE_KINDS: Record<ChangeKind, { label: string; hint: string; color: string }> = {
  price: { label: 'Purchase price', hint: 'a new purchase (or fallback price) of a cost item', color: '#2563eb' },
  recipe: { label: 'Recipe change', hint: 'a new published version of a component recipe', color: '#f59e0b' },
  dish: { label: 'Dish change', hint: 'grams of a dish line, its component link or its packaging changed', color: '#a855f7' },
  sale: { label: 'Selling price change', hint: 'the dish variant got a new selling price', color: '#0d9488' },
  recalc: { label: 'Full recalculation', hint: 'bulk import / rebuild — recalculated with the prices of that date', color: '#94a3b8' },
  other: { label: 'Manual fix', hint: 'a one-off correction', color: '#64748b' },
}
export function changeKind(cause: string | null | undefined): ChangeKind {
  const c = (cause ?? '').toLowerCase()
  if (/^(purchase|invoice|item)/.test(c)) return 'price'
  if (/^(version|component)/.test(c)) return 'recipe'
  if (/^(grams|dish|cost_dish|packaging|link)/.test(c)) return 'dish'
  if (c.startsWith('sale_price')) return 'sale'
  if (c.startsWith('rebuild')) return 'recalc'
  return 'other'
}

/**
 * Cost history chart (item / component / dish drawers).
 *  - step line + soft area: a cost holds until the next change
 *  - every point is a dot coloured by what caused it; hover a dot for date, value, change and cause
 *  - hover anywhere else to read the value in force on that date
 *  - legend lists only the causes present
 *  - drops the 1900 «no data yet» baseline; merges same-value repeats except purchases
 */
export function HistoryChart({ rows, valueKey, height = 190, fmt }: {
  rows: Array<{ date: string; cause?: string | null } & Record<string, unknown>>; valueKey: string; height?: number
  /** axis + tooltip formatter (default: € with 3 decimals) */
  fmt?: (v: number) => string
}) {
  const f = fmt ?? ((v: number) => fmtEurFine(v, 3))
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<{ px: number; dot: number | null } | null>(null)
  const [today] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })
  const gid = `cstg${useId().replace(/:/g, '')}`
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w > 0) setWidth(w) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pts = useMemo(() => {
    const out: Array<{ t: number; v: number; cause: string; kind: ChangeKind; date: string }> = []
    for (const r of rows) {
      if (r.date < '2000-01-01') continue
      const v = Number(r[valueKey])
      if (!Number.isFinite(v)) continue
      const cause = r.cause ?? ''
      const kind = changeKind(cause)
      if (kind !== 'price' && out.length && Math.abs(out[out.length - 1].v - v) < 1e-9) continue
      if (out.length && out[out.length - 1].date === r.date) {
        const prev = out[out.length - 1]
        out[out.length - 1] = { ...prev, v, cause: kind === 'price' ? cause : prev.cause, kind: kind === 'price' ? kind : prev.kind }
        continue
      }
      out.push({ t: new Date(r.date + 'T00:00:00').getTime(), v, cause, kind, date: r.date })
    }
    return out
  }, [rows, valueKey])

  if (!pts.length) return <div className="cst-empty-chart">No cost history yet.</div>

  const L = 64, R = 16, T = 16, B = 26
  const t0 = pts[0].t
  const t1 = Math.max(today, pts[pts.length - 1].t) + 2 * 864e5
  const vals = pts.map((p) => p.v)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi - lo < Math.max(hi, 1e-9) * 0.02) { const pad = Math.max(hi * 0.25, 1e-6); lo -= pad; hi += pad }
  else { const pad = (hi - lo) * 0.2; lo -= pad; hi += pad }
  if (lo < 0 && Math.min(...vals) >= 0) lo = 0
  const plotW = width - L - R
  const x = (t: number) => L + ((t - t0) / Math.max(t1 - t0, 1)) * plotW
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (height - T - B)

  let line = `M${x(pts[0].t)},${y(pts[0].v)}`
  for (let i = 1; i < pts.length; i++) line += ` H${x(pts[i].t)} V${y(pts[i].v)}`
  line += ` H${x(t1)}`
  const area = `${line} V${height - B} H${x(t0)} Z`

  const dfmt = (t: number) => new Date(t).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const ticks = [0, 1, 2, 3, 4].map((k) => t0 + ((t1 - t0) * k) / 4)
  const yTicks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3)
  const present = (Object.keys(CHANGE_KINDS) as ChangeKind[]).filter((k) => pts.some((p) => p.kind === k))
  const last = pts[pts.length - 1]

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left, py = e.clientY - r.top
    if (px < L || px > width - R) { setHover(null); return }
    let best: number | null = null, bd = 12
    pts.forEach((p, i) => { const dd = Math.hypot(x(p.t) - px, y(p.v) - py); if (dd < bd) { bd = dd; best = i } })
    setHover({ px, dot: best })
  }

  // tooltip content: a dot → that change; elsewhere → the value in force on the cursor date
  const tip = hover === null ? null : (() => {
    if (hover.dot !== null) {
      const p = pts[hover.dot], prev = hover.dot > 0 ? pts[hover.dot - 1] : null
      const delta = prev && prev.v ? (p.v - prev.v) / prev.v : null
      return { cx: x(p.t), date: dfmt(p.t), v: p.v, delta, kind: p.kind as ChangeKind | null, cause: p.cause }
    }
    const t = t0 + ((hover.px - L) / plotW) * (t1 - t0)
    let p = pts[0]
    for (const q of pts) if (q.t <= t) p = q
    return { cx: hover.px, date: dfmt(t), v: p.v, delta: null, kind: null, cause: '' }
  })()

  return (
    <div ref={ref} className="cst-chart-wrap">
      <svg className="cst-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} className={i === 0 ? 'cst-chart-axis' : 'cst-chart-grid'} />
            <text x={L - 8} y={y(v) + 3.5} textAnchor="end" className="cst-chart-lbl">{f(v)}</text>
          </g>
        ))}
        {ticks.map((t, i) => (
          <text key={`x${i}`} x={x(t)} y={height - 8} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="cst-chart-lbl">{dfmt(t)}</text>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        {today >= t0 && today <= t1 && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={T} y2={height - B} className="cst-chart-today" />
            <text x={x(today) - 4} y={T + 9} textAnchor="end" className="cst-chart-lbl cst-chart-lbl-today">today</text>
          </g>
        )}
        <path className="cst-chart-line" d={line} />
        {tip && hover?.dot === null && <line x1={tip.cx} x2={tip.cx} y1={T} y2={height - B} className="cst-chart-cursor" />}
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={hover?.dot === i ? 6.5 : 4.5}
                  fill={CHANGE_KINDS[p.kind].color} className="cst-dot" />
        ))}
      </svg>
      <span className="cst-chart-now" style={{ top: y(last.v) - 11 }}>{f(last.v)}</span>
      {tip && (
        <div className="cst-chart-tooltip" style={{ left: Math.min(Math.max(tip.cx, 90), width - 90), top: 4 }}>
          <div className="cst-chart-tooltip-d">{tip.date}</div>
          <div className="cst-chart-tooltip-v">
            {f(tip.v)}
            {tip.delta !== null && Math.abs(tip.delta) > 1e-6 && (
              <span className={tip.delta > 0 ? 'cst-up' : 'cst-down'}> {tip.delta > 0 ? '▲' : '▼'} {Math.abs(tip.delta * 100).toFixed(1)}%</span>
            )}
          </div>
          {tip.kind && (
            <div className="cst-chart-tooltip-c"><i style={{ background: CHANGE_KINDS[tip.kind].color }} />{CHANGE_KINDS[tip.kind].label}
              {tip.kind === 'price' && /purchase:./.test(tip.cause) && <span> · {tip.cause.replace(/^purchase:/, 'invoice ')}</span>}
            </div>
          )}
          {!tip.kind && <div className="cst-chart-tooltip-c">in force on this date</div>}
        </div>
      )}
      <div className="cst-legend">
        {present.map((k) => (
          <span key={k} title={CHANGE_KINDS[k].hint}><i style={{ background: CHANGE_KINDS[k].color }} />{CHANGE_KINDS[k].label}</span>
        ))}
        <span className="cst-legend-hint">Hover a dot to see what changed</span>
      </div>
    </div>
  )
}

// ── layout building blocks shared by the item / component / dish drawers ──────
/** A drawer section: strong title, optional muted subtitle, actions on the right, separator above. */
export function Section({ title, sub, actions, children, className }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string
}) {
  return (
    <section className={`cst-sec${className ? ` ${className}` : ''}`}>
      {/* a div, not <header>: the customer site's global header {} (sticky, dark) leaks into the admin */}
      <div className="cst-sec-h">
        <h3>{title}{sub && <span className="cst-sec-sub">{sub}</span>}</h3>
        {actions && <div className="cst-sec-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** Segmented control (two or three mutually exclusive views). */
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: Array<[T, ReactNode]>
}) {
  return (
    <div className="cst-seg" role="tablist">
      {options.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k}
                className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

/** Share of a total as a bar + percentage (recipe trees, cost-item lists, packaging). */
export function ShareBar({ value, muted }: { value: number | null | undefined; muted?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="cst-muted">—</span>
  const w = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={`cst-share${muted ? ' cst-share-muted' : ''}`} title={fmtPct(value)}>
      <span className="cst-share-track"><span style={{ width: `${w}%` }} /></span>
      <em>{fmtPct(value, value < 0.1 ? 1 : 0)}</em>
    </div>
  )
}

/** Summary tile (key / big value / small line). */
export function Tile({ k, v, s, tone }: { k: ReactNode; v: ReactNode; s?: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'dim' }) {
  return (
    <div className={`cst-tile${tone ? ` cst-tile-${tone}` : ''}`}>
      <div className="cst-tile-k">{k}</div>
      <div className="cst-tile-v">{v}</div>
      {s !== undefined && <div className="cst-tile-s">{s}</div>}
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
  const listRef = useRef<HTMLDivElement>(null)
  // The list floats in a portal (position: fixed) so a scrolling table (.cst-wrap) can never clip it;
  // it opens upwards when there is not enough room below the input.
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - 8, above = r.top - 8
      const w = Math.max(r.width, 260)
      const left = Math.min(r.left, window.innerWidth - w - 8)
      if (below >= 200 || below >= above) setPos({ left, top: r.bottom + 2, width: w, maxH: Math.min(280, below) })
      else setPos({ left, bottom: window.innerHeight - r.top + 2, width: w, maxH: Math.min(280, above) })
    }
    const raf = requestAnimationFrame(place)
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])
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
      {open && pos && createPortal(
        <div ref={listRef} className="cst-pick-list cst-pick-float"
             style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH }}>
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
        </div>,
        document.body,
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
