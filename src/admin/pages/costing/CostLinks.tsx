import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchLinksReview, fetchComponentOptions, fetchDefaultLinks,
  setLink, confirmLinks, clearLink, setDefaultLink,
  type LinkReviewDish, type LinkSource, type ComponentOption, type DefaultLinkRow,
} from '../../../lib/api/adminCosting'
import { CostingTabs, SearchPick, skey, useUrlState, type PickOption } from '../../costing/shared'

/**
 * /admin/costing/links — review dish-line → component links (WEC-865, Costing 8).
 *
 * Links are PER DISH LINE (generic customer names hide different mixes per
 * dish). The Excel auto-match wrote unconfirmed 'auto_excel' links; lines
 * without one fall back to the ingredient's default link, else are unlinked.
 * The review payload is ~730 KB, so every action updates local state
 * optimistically (rollback on error) and «Refresh» re-fetches on demand.
 */

type Line = LinkReviewDish['lines'][number]
type Chip = 'open' | 'unlinked' | 'auto' | 'default' | 'weak'
const CHIPS: Array<[Chip, string]> = [
  ['open', 'All open'], ['unlinked', 'Unlinked'], ['auto', 'Unconfirmed auto'], ['default', 'Via default'], ['weak', 'Weak / ambiguous dish match'],
]
const PAGE = 300

const loadAll = () => Promise.all([fetchLinksReview(), fetchComponentOptions(), fetchDefaultLinks()])
type Loaded = Awaited<ReturnType<typeof loadAll>>

const needsAttention = (l: Line) => !l.component_id || !l.confirmed
const isWeakNote = (n: string | null) => !!n && (n.includes('πιάτο weak') || n.includes('πιάτο ambiguous'))

function gramsText(l: Line): string {
  const vals = l.grams.map((g) => Number(g.grams))
  if (!vals.length) return '—'
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','))
  return vals.every((v) => v === vals[0]) ? fmt(vals[0]) : vals.map(fmt).join('/')
}

function SrcBadge({ line }: { line: Line }) {
  if (!line.component_id) return <span className="cst-badge cst-err">—</span>
  const ok = line.confirmed ? ' ✓' : ''
  if (line.source === 'manual') return <span className={`cst-badge ${line.confirmed ? 'cst-ok' : 'cst-warn'}`} title="Set by hand">manual{ok}</span>
  if (line.source === 'auto_excel') return <span className={`cst-badge ${line.confirmed ? 'cst-ok' : 'cst-est'}`} title="Auto-matched from the kitchen Excel">auto{ok}</span>
  if (line.source === 'default') return <span className="cst-badge cst-warn" title="No link for this dish — costed via the ingredient's default component">default</span>
  return <span className="cst-badge">—</span>
}

interface RowActions {
  pick: (dishId: string, line: Line, componentId: string) => void
  confirm: (dishId: string, line: Line) => void
  clear: (dishId: string, line: Line) => void
}

const LineRow = memo(function LineRow({ dishId, dish, line, options, busy, actions }: {
  dishId: string; dish: LinkReviewDish; line: Line; options: PickOption[]; busy: boolean; actions: RowActions
}) {
  const explicit = line.source === 'auto_excel' || line.source === 'manual'
  const gramsTitle = line.grams.map((g) => `${dish.variants?.find((v) => v.id === g.variant_id)?.label ?? g.variant_id}: ${g.grams} g`).join('\n')
  return (
    <tr style={busy ? { opacity: 0.6 } : undefined}>
      <td style={{ paddingLeft: 18 }}>{line.ingredient}</td>
      <td className="num" title={gramsTitle} style={{ whiteSpace: 'nowrap' }}>{gramsText(line)}</td>
      <td style={{ minWidth: 260 }}>
        <SearchPick
          options={options}
          value={line.component_id}
          placeholder={line.component_id ? 'Search component…' : 'Unlinked — pick component…'}
          onChange={(id) => { if (id && id !== line.component_id) actions.pick(dishId, line, id) }}
        />
      </td>
      <td><SrcBadge line={line} /></td>
      <td style={{ fontSize: 11, color: '#9ca3af', maxWidth: 320 }}>
        {line.match_note && <span style={isWeakNote(line.match_note) ? { color: '#b45309' } : undefined}>{line.match_note}</span>}
      </td>
      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
        <button
          className="admin-btn admin-btn-secondary admin-btn-sm" style={{ padding: '2px 8px' }}
          disabled={busy || !line.component_id || line.confirmed}
          title={line.component_id ? 'Confirm this component for this dish line' : 'Pick a component first'}
          onClick={() => actions.confirm(dishId, line)}
        >✓</button>{' '}
        <button
          className="admin-btn admin-btn-ghost admin-btn-sm" style={{ padding: '2px 8px' }}
          disabled={busy || !explicit}
          title={explicit ? 'Remove this dish link (falls back to the ingredient default, if any)' : 'No dish link to clear'}
          onClick={() => actions.clear(dishId, line)}
        >clear</button>
      </td>
    </tr>
  )
})

export function CostLinks() {
  const [data, setData] = useState<LinkReviewDish[] | null>(null)
  const [comps, setComps] = useState<ComponentOption[]>([])
  const [defaults, setDefaults] = useState<DefaultLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(() => new Set())

  const [tab, setTab] = useUrlState('tab', 'review')
  const [chip, setChip] = useUrlState('f', 'open')
  const [q, setQ] = useUrlState('q')
  const [showConf, setShowConf] = useUrlState('conf')
  const [dishParam, setDishParam] = useUrlState('dish')
  const [dq, setDq] = useUrlState('dq')

  const apply = useCallback(([r, c, d]: Loaded) => {
    const err = r.error || c.error || d.error
    if (err) setError(err)
    if (r.data) setData(r.data.map((x) => ({ ...x, lines: x.lines ?? [] })))
    if (c.data) setComps(c.data)
    if (d.data) setDefaults(d.data)
    setLoading(false)
  }, [])
  useEffect(() => {
    let cancelled = false
    void loadAll().then((res) => { if (!cancelled) apply(res) })
    return () => { cancelled = true }
  }, [apply])
  const refresh = () => { setLoading(true); setError(null); void loadAll().then(apply) }

  // «Show more» page size resets whenever the filter changes (derived, no effect).
  const filterKey = [chip, q, showConf, dishParam].join('\u0001')
  const [more, setMore] = useState<{ key: string; n: number }>({ key: '', n: PAGE })
  const limit = more.key === filterKey ? more.n : PAGE

  const compOptions = useMemo<PickOption[]>(() => comps.map((c) => ({
    id: c.id, label: c.name, hint: [c.category, c.active ? null : 'inactive'].filter(Boolean).join(' · ') || undefined,
  })), [comps])
  const compName = useMemo(() => new Map(comps.map((c) => [c.id, c.name])), [comps])
  const defaultsMap = useMemo(() => new Map(defaults.map((d) => [d.ingredient_id, d])), [defaults])

  // ── local state helpers ────────────────────────────────────────────────────
  // Latest values for the stable row handlers (rows are memoised).
  const dataRef = useRef(data)
  const defaultsRef = useRef(defaultsMap)
  const compNameRef = useRef(compName)
  useLayoutEffect(() => { dataRef.current = data; defaultsRef.current = defaultsMap; compNameRef.current = compName })

  const patchLines = (dishId: string, fn: (l: Line) => Line) =>
    setData((prev) => prev && prev.map((d) => (d.dish_id === dishId ? { ...d, lines: d.lines.map(fn) } : d)))
  const restoreDish = (snapshot: LinkReviewDish) =>
    setData((prev) => prev && prev.map((d) => (d.dish_id === snapshot.dish_id ? snapshot : d)))
  /** Roll back ONE line (other lines of the dish may have saved meanwhile). */
  const restoreLine = (dishId: string, prevLine: Line) =>
    patchLines(dishId, (l) => (l.ingredient_id === prevLine.ingredient_id ? prevLine : l))
  const snapshotOf = (dishId: string) => dataRef.current?.find((d) => d.dish_id === dishId) ?? null
  const markBusy = (key: string, on: boolean) => setBusy((prev) => {
    const n = new Set(prev); if (on) n.add(key); else n.delete(key); return n
  })

  // Stable for the memoised rows; reads fresh values through the refs above.
  const [actions] = useState<RowActions>(() => {
    const write = async (dishId: string, prevLine: Line, componentId: string) => {
      const ing = prevLine.ingredient_id
      const key = `${dishId}|${ing}`
      patchLines(dishId, (l) => (l.ingredient_id === ing
        ? { ...l, component_id: componentId, component: compNameRef.current.get(componentId) ?? l.component, source: 'manual' as LinkSource, confirmed: true }
        : l))
      markBusy(key, true)
      const res = await setLink(dishId, ing, componentId, true)
      markBusy(key, false)
      if (res.error) { restoreLine(dishId, prevLine); setError(`Save failed: ${res.error}`) }
    }
    return {
      pick: (dishId, line, componentId) => { void write(dishId, line, componentId) },
      confirm: (dishId, line) => { if (line.component_id) void write(dishId, line, line.component_id) },
      clear: async (dishId, line) => {
        if (line.source === 'auto_excel' && !confirm(`Remove the auto-matched link «${line.component}» for «${line.ingredient}»?`)) return
        const key = `${dishId}|${line.ingredient_id}`
        const def = defaultsRef.current.get(line.ingredient_id)
        patchLines(dishId, (l) => (l.ingredient_id === line.ingredient_id
          ? { ...l, component_id: def?.component_id ?? null, component: def?.component ?? null, source: def ? 'default' : null, confirmed: false, match_note: null }
          : l))
        markBusy(key, true)
        const res = await clearLink(dishId, line.ingredient_id)
        markBusy(key, false)
        if (res.error) { restoreLine(dishId, line); setError(`Clear failed: ${res.error}`) }
      },
    }
  })

  async function confirmDish(dish: LinkReviewDish) {
    const explicitOpen = dish.lines.filter((l) => (l.source === 'auto_excel' || l.source === 'manual') && !l.confirmed)
    const viaDefault = dish.lines.filter((l) => l.source === 'default' && l.component_id)
    if (!explicitOpen.length && !viaDefault.length) return
    const snap = snapshotOf(dish.dish_id)
    const key = `dish|${dish.dish_id}`
    patchLines(dish.dish_id, (l) => {
      if ((l.source === 'auto_excel' || l.source === 'manual') && !l.confirmed) return { ...l, confirmed: true }
      if (l.source === 'default' && l.component_id) return { ...l, source: 'manual', confirmed: true }
      return l
    })
    markBusy(key, true)
    let err: string | null = null
    if (explicitOpen.length) err = (await confirmLinks(dish.dish_id)).error
    for (const l of viaDefault) {
      if (err) break
      err = (await setLink(dish.dish_id, l.ingredient_id, l.component_id as string, true)).error
    }
    markBusy(key, false)
    if (err) {
      if (snap) restoreDish(snap)
      setError(`Confirm failed: ${err} — some lines may have been saved; press Refresh to see the server state.`)
    }
  }

  // ── defaults ───────────────────────────────────────────────────────────────
  /** Re-point local lines that are costed via the default of this ingredient. */
  function applyDefaultLocally(ingId: string, comp: { id: string; name: string } | null) {
    setData((prev) => prev && prev.map((d) => {
      if (!d.lines.some((l) => l.ingredient_id === ingId && (l.source === 'default' || l.source === null))) return d
      return {
        ...d,
        lines: d.lines.map((l) => {
          if (l.ingredient_id !== ingId || (l.source !== 'default' && l.source !== null)) return l
          return comp
            ? { ...l, component_id: comp.id, component: comp.name, source: 'default' as LinkSource, confirmed: false }
            : { ...l, component_id: null, component: null, source: null, confirmed: false }
        }),
      }
    }))
  }

  async function changeDefault(ingId: string, ingName: string, componentId: string | null) {
    if (componentId === null && !confirm(`Remove the default component for «${ingName}»? Lines costed via it become unlinked.`)) return
    const prevDefaults = defaults
    const prevData = dataRef.current
    const name = componentId ? compName.get(componentId) ?? '?' : ''
    setDefaults((p) => {
      const rest = p.filter((d) => d.ingredient_id !== ingId)
      return componentId
        ? [...rest, { ingredient_id: ingId, component_id: componentId, ingredient: ingName, component: name }].sort((a, b) => a.ingredient.localeCompare(b.ingredient, 'el'))
        : rest
    })
    applyDefaultLocally(ingId, componentId ? { id: componentId, name } : null)
    markBusy(`def|${ingId}`, true)
    const res = await setDefaultLink(ingId, componentId)
    markBusy(`def|${ingId}`, false)
    if (res.error) { setDefaults(prevDefaults); setData(prevData); setError(`Default save failed: ${res.error}`) }
  }

  const [newDefIng, setNewDefIng] = useState<string | null>(null)
  const [newDefComp, setNewDefComp] = useState<string | null>(null)

  const ingredientOptions = useMemo<PickOption[]>(() => {
    const m = new Map<string, { name: string; dishes: number }>()
    for (const d of data ?? []) for (const l of d.lines) {
      const e = m.get(l.ingredient_id); if (e) e.dishes++; else m.set(l.ingredient_id, { name: l.ingredient, dishes: 1 })
    }
    return [...m.entries()]
      .filter(([id]) => !defaultsMap.has(id))
      .map(([id, v]) => ({ id, label: v.name, hint: `${v.dishes} dish${v.dishes === 1 ? '' : 'es'}` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'el'))
  }, [data, defaultsMap])

  // ── summary ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let total = 0, explicit = 0, viaDefault = 0, unlinked = 0, unconfirmed = 0
    for (const d of data ?? []) for (const l of d.lines) {
      total++
      if (!l.component_id) unlinked++
      else if (l.source === 'default') viaDefault++
      else explicit++
      if (l.component_id && !l.confirmed) unconfirmed++
    }
    return { total, explicit, viaDefault, unlinked, unconfirmed }
  }, [data])

  // ── filtering ──────────────────────────────────────────────────────────────
  const view = useMemo(() => {
    const words = skey(q).split(' ').filter(Boolean)
    const out: Array<{ dish: LinkReviewDish; lines: Line[] }> = []
    let lineCount = 0
    for (const d of data ?? []) {
      if (dishParam) {
        if (d.dish_id !== dishParam) continue
        out.push({ dish: d, lines: d.lines }); lineCount += d.lines.length; continue
      }
      const dishKey = skey(d.dish)
      const dishHit = words.length > 0 && words.every((w) => dishKey.includes(w))
      const weakDish = chip === 'weak' && d.lines.some((l) => isWeakNote(l.match_note))
      if (chip === 'weak' && !weakDish) continue
      const lines = d.lines.filter((l) => {
        if (!showConf && !needsAttention(l)) return false
        if (chip === 'unlinked' && l.component_id) return false
        if (chip === 'auto' && !(l.source === 'auto_excel' && !l.confirmed)) return false
        if (chip === 'default' && l.source !== 'default') return false
        if (words.length && !dishHit) {
          const k = skey(`${l.ingredient} ${l.component ?? ''}`)
          if (!words.every((w) => k.includes(w))) return false
        }
        return true
      })
      if (!lines.length) continue
      out.push({ dish: d, lines }); lineCount += lines.length
    }
    return { groups: out, lineCount }
  }, [data, q, chip, showConf, dishParam])

  const shown = useMemo(() => {
    const res: Array<{ dish: LinkReviewDish; lines: Line[] }> = []
    let n = 0
    for (const g of view.groups) {
      if (n >= limit) break
      const take = g.lines.slice(0, Math.max(0, limit - n))
      res.push({ dish: g.dish, lines: take }); n += take.length
    }
    return { groups: res, n }
  }, [view, limit])

  const defaultsShown = useMemo(() => {
    const words = skey(dq).split(' ').filter(Boolean)
    return words.length ? defaults.filter((d) => { const k = skey(`${d.ingredient} ${d.component}`); return words.every((w) => k.includes(w)) }) : defaults
  }, [defaults, dq])

  const dishName = dishParam ? data?.find((d) => d.dish_id === dishParam)?.dish ?? dishParam : null

  return (
    <div className="admin-page">
      <div className="admin-page-head" style={{ marginBottom: 8 }}>
        <div>
          <h1 className="admin-page-title">Dish links</h1>
          <p className="admin-page-sub">Each dish line (customer ingredient) → the costing component actually plated in that dish.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-secondary admin-btn-sm" disabled={loading} onClick={refresh}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>
      <CostingTabs />

      {error && (
        <div className="admin-error-banner" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <Stat k="Lines" v={stats.total} />
          <Stat k="Linked explicitly" v={stats.explicit} />
          <Stat k="Via default" v={stats.viaDefault} tone="warn" />
          <Stat k="Unlinked" v={stats.unlinked} tone="err" />
          <Stat k="Unconfirmed" v={stats.unconfirmed} tone="warn" />
        </div>
      )}

      <div className="admin-tabs" style={{ marginBottom: 10 }}>
        <button className={`admin-tab${tab === 'review' ? ' active' : ''}`} onClick={() => setTab('review')}>Review lines</button>
        <button className={`admin-tab${tab === 'defaults' ? ' active' : ''}`} onClick={() => setTab('defaults')}>Defaults per ingredient ({defaults.length})</button>
      </div>

      {loading && !data && <div className="admin-loading">Loading links…</div>}

      {data && tab === 'review' && (
        <>
          <div className="cst-toolbar">
            {dishParam ? (
              <>
                <span className="cst-badge cst-est" style={{ fontSize: 12, padding: '4px 8px' }}>Dish: {dishName}</span>
                <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setDishParam('')}>× show all dishes</button>
              </>
            ) : (
              <>
                <input className="admin-input" style={{ width: 240 }} placeholder="Search dish or ingredient…" value={q} onChange={(e) => setQ(e.target.value)} />
                {CHIPS.map(([id, label]) => (
                  <button key={id}
                    className={`admin-btn admin-btn-sm ${chip === id ? 'admin-btn-primary' : 'admin-btn-ghost'}`}
                    style={{ padding: '3px 9px' }}
                    onClick={() => setChip(id)}>{label}</button>
                ))}
                <label><input type="checkbox" checked={!!showConf} onChange={(e) => setShowConf(e.target.checked ? '1' : '')} /> show confirmed too</label>
              </>
            )}
            <span className="cst-spacer" />
            <span className="cst-count">{view.groups.length} dishes · {view.lineCount} lines{shown.n < view.lineCount ? ` (showing ${shown.n})` : ''}</span>
          </div>

          <div className="cst-wrap">
            <table className="cst-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th className="num">Grams</th>
                  <th>Component</th>
                  <th>Source</th>
                  <th>Match note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {!shown.groups.length && (
                  <tr><td colSpan={6} className="admin-empty" style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>
                    {dishParam ? 'This dish has no costed lines.' : 'Nothing needs attention with these filters.'}
                  </td></tr>
                )}
                {shown.groups.map(({ dish, lines }) => {
                  const open = dish.lines.filter(needsAttention).length
                  const unl = dish.lines.filter((l) => !l.component_id).length
                  const canConfirm = dish.lines.some((l) => l.component_id && !l.confirmed)
                  const dBusy = busy.has(`dish|${dish.dish_id}`)
                  return [
                    <tr key={`h-${dish.dish_id}`} className="cst-sub">
                      <td colSpan={6} style={{ background: '#f8fafc', borderTop: '1px solid #e5e7eb' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <Link to={`/admin/costing/dishes?dish=${encodeURIComponent(dish.dish_id)}`} className="cst-strong" style={{ color: '#111827' }}>{dish.dish}</Link>
                          <span className="cst-muted" style={{ fontSize: 11 }}>{dish.lines.length} {dish.lines.length === 1 ? 'line' : 'lines'}</span>
                          {unl > 0 && <span className="cst-badge cst-err">{unl} unlinked</span>}
                          {open - unl > 0 && <span className="cst-badge cst-warn">{open - unl} unconfirmed</span>}
                          {open === 0 && <span className="cst-badge cst-ok">all confirmed</span>}
                          <span className="cst-spacer" />
                          <button className="admin-btn admin-btn-secondary admin-btn-sm" style={{ padding: '2px 8px' }}
                            disabled={!canConfirm || dBusy} onClick={() => void confirmDish(dish)}
                            title="Confirm every linked line of this dish (lines via default get their own manual link)">
                            {dBusy ? 'Confirming…' : 'Confirm all in dish'}
                          </button>
                        </div>
                      </td>
                    </tr>,
                    ...lines.map((l) => (
                      <LineRow key={`${dish.dish_id}|${l.ingredient_id}`} dishId={dish.dish_id} dish={dish} line={l}
                        options={compOptions} busy={busy.has(`${dish.dish_id}|${l.ingredient_id}`) || dBusy} actions={actions} />
                    )),
                  ]
                })}
              </tbody>
            </table>
          </div>
          {shown.n < view.lineCount && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setMore({ key: filterKey, n: limit + PAGE })}>
                Show more ({view.lineCount - shown.n} left)
              </button>
            </div>
          )}
        </>
      )}

      {data && tab === 'defaults' && (
        <>
          <p className="cst-note" style={{ margin: '0 0 8px' }}>
            Fallback component for an ingredient when a dish has no own link. Lines costed this way stay «unconfirmed» until a dish link is set.
          </p>
          <div className="cst-toolbar">
            <input className="admin-input" style={{ width: 220 }} placeholder="Search defaults…" value={dq} onChange={(e) => setDq(e.target.value)} />
            <span className="cst-spacer" />
            <span style={{ fontSize: 12, color: '#4b5563' }}>Add default:</span>
            <SearchPick options={ingredientOptions} value={newDefIng} onChange={(id) => setNewDefIng(id)} placeholder="Ingredient…" width={200} />
            <SearchPick options={compOptions} value={newDefComp} onChange={(id) => setNewDefComp(id)} placeholder="Component…" width={240} />
            <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={!newDefIng || !newDefComp}
              onClick={() => {
                if (!newDefIng || !newDefComp) return
                const ingName = ingredientOptions.find((o) => o.id === newDefIng)?.label ?? '?'
                void changeDefault(newDefIng, ingName, newDefComp)
                setNewDefIng(null); setNewDefComp(null)
              }}>Add</button>
          </div>
          <div className="cst-wrap">
            <table className="cst-table">
              <thead><tr><th>Ingredient</th><th>Default component</th><th className="num">Lines via default</th><th></th></tr></thead>
              <tbody>
                {!defaultsShown.length && <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>No defaults.</td></tr>}
                {defaultsShown.map((d) => (
                  <DefaultRow key={d.ingredient_id} row={d} options={compOptions} busy={busy.has(`def|${d.ingredient_id}`)}
                    viaCount={countVia(data, d.ingredient_id)}
                    onChange={(cid) => void changeDefault(d.ingredient_id, d.ingredient, cid)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: number; tone?: 'err' | 'warn' }) {
  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', background: '#fff', fontSize: 12, color: '#6b7280',
      ...(tone === 'err' && v > 0 ? { borderColor: '#fecaca', background: '#fef2f2' } : {}),
      ...(tone === 'warn' && v > 0 ? { borderColor: '#fed7aa', background: '#fff7ed' } : {}),
    }}>
      {k} <b style={{ color: '#111827', fontSize: 14, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString('el-GR')}</b>
    </div>
  )
}

function countVia(data: LinkReviewDish[], ingId: string): number {
  let n = 0
  for (const d of data) for (const l of d.lines) if (l.ingredient_id === ingId && l.source === 'default') n++
  return n
}

function DefaultRow({ row, options, busy, viaCount, onChange }: {
  row: DefaultLinkRow; options: PickOption[]; busy: boolean; viaCount: number; onChange: (componentId: string | null) => void
}) {
  return (
    <tr style={busy ? { opacity: 0.6 } : undefined}>
      <td>{row.ingredient}</td>
      <td style={{ minWidth: 280 }}>
        <SearchPick options={options} value={row.component_id} onChange={(id) => { if (id && id !== row.component_id) onChange(id) }} />
      </td>
      <td className="num">{viaCount}</td>
      <td style={{ textAlign: 'right' }}>
        <button className="admin-btn admin-btn-ghost admin-btn-sm" style={{ padding: '2px 8px' }} disabled={busy} onClick={() => onChange(null)}>remove</button>
      </td>
    </tr>
  )
}
