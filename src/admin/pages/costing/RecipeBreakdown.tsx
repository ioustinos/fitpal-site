import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchVariantTree,
  type RecipeComponentNode,
  type RecipeNode,
  type VariantTree,
} from '../../../lib/api/adminCosting'
import { FlagBadges, SourceBadge, fmtEur, fmtEurFine, fmtPct, fmtPerKg, fmtUnitCost } from '../../costing/shared'

/**
 * Dish recipe with cost per ingredient / cost item (WEC-866 follow-up,
 * Ioustinos 2026-10-13: «on dishes I need to see the recipe and the cost per
 * ingredient / cost item»).
 *
 * Two views of the same portion (admin_cost_variant_tree):
 *   • Recipe      — each dish line → its component → that component's recipe,
 *                   down to the purchased cost items, scaled to the plated grams.
 *   • Cost items  — the whole portion summed per purchased cost item.
 * Σ of everything at the bottom == the variant's food cost (checked in SQL for
 * all 1,369 dev variants).
 */

const fmtQty = (q: number, unit: string) => {
  const v = Number(q)
  const s = Number.isInteger(Math.round(v * 100) / 100) || v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
  return `${s.replace('.', ',')} ${unit === 'pcs' ? 'pc' : unit}`
}

const linkBadge = (s: string | null) =>
  s === 'manual' ? <span className="cst-badge cst-ok">manual</span>
    : s === 'default' ? <span className="cst-badge">default</span>
      : s === 'auto_excel' ? <span className="cst-badge cst-est" title="Auto-matched from the kitchen Excel">auto</span>
        : null

function yieldLabel(c: RecipeComponentNode): string {
  if (c.yield_mode === 'fixed') return 'fixed €/kg (Excel estimate, no recipe)'
  if (c.yield_mode === 'pct') return `yield ${Number(c.yield_pct)}%`
  if (c.yield_mode === 'output_weight') return `batch ${Number(c.raw_weight_g ?? 0).toFixed(0)} g raw → ${Number(c.output_g ?? 0).toFixed(0)} g cooked`
  return ''
}

export function RecipeBreakdown({ variantId, asOf, rev, dishId }: { variantId: string; asOf: string; rev: number; dishId: string }) {
  const [res, setRes] = useState<{ key: string; data: VariantTree | null; error: string | null } | null>(null)
  const [view, setView] = useState<'recipe' | 'items'>('recipe')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const key = `${variantId}#${asOf}#${rev}`

  useEffect(() => {
    let alive = true
    fetchVariantTree(variantId, asOf).then((r) => { if (alive) setRes({ key, data: r.data, error: r.error }) })
    return () => { alive = false }
  }, [variantId, asOf, key])

  const t = res?.data ?? null
  const loading = res?.key !== key
  const food = Number(t?.food_cost ?? 0)
  const share = (c: number) => (food > 0 ? c / food : null)

  const toggle = (path: string) => setOpen((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })
  const allPaths = (): string[] => {
    const out: string[] = []
    const walk = (node: RecipeNode, path: string) => {
      if (node.kind === 'component' && node.children.length) { out.push(path); node.children.forEach((c, i) => walk(c, `${path}/${i}`)) }
    }
    t?.lines.forEach((l, i) => { if (l.tree) walk(l.tree, `L${i}`) })
    return out
  }

  const rows: ReactNode[] = []
  const renderNode = (node: RecipeNode, path: string, depth: number) => {
    const pad = { paddingLeft: 8 + depth * 18 }
    if (node.kind === 'item') {
      rows.push(
        <tr key={path} className="cst-sub">
          <td style={pad}><span className="cst-muted">•</span> {node.name}</td>
          <td className="cst-muted">cost item</td>
          <td className="num">{fmtQty(node.qty, node.unit)} <span className="cst-muted">raw</span></td>
          <td className="num">{fmtUnitCost(node.unit_cost, node.unit)} <SourceBadge source={node.source} date={node.price_date} /></td>
          <td className="num">{fmtEurFine(node.cost, 3)}</td>
          <td className="num cst-muted">{fmtPct(share(node.cost))}</td>
        </tr>,
      )
      return
    }
    const can = node.children.length > 0
    const isOpen = open.has(path)
    rows.push(
      <tr key={path} className={depth ? 'cst-sub' : undefined}>
        <td style={pad}>
          {can
            ? <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" style={{ padding: '0 5px', marginRight: 4 }}
                onClick={() => toggle(path)} aria-expanded={isOpen}>{isOpen ? '▾' : '▸'}</button>
            : <span style={{ display: 'inline-block', width: 22 }} />}
          <Link to={`/admin/costing/components?id=${encodeURIComponent(node.id)}`}>{node.name}</Link>
          <span style={{ marginLeft: 4 }}><FlagBadges flags={node.flags} /></span>
        </td>
        <td className="cst-muted" style={{ fontSize: 11.5 }}>{yieldLabel(node)}</td>
        <td className="num">{fmtQty(node.grams, 'g')} <span className="cst-muted">cooked</span></td>
        <td className="num">{fmtPerKg(node.cost_per_g)}</td>
        <td className="num">{fmtEurFine(node.cost, 3)}</td>
        <td className="num cst-muted">{fmtPct(share(node.cost))}</td>
      </tr>,
    )
    if (can && isOpen) node.children.forEach((c, i) => renderNode(c, `${path}/${i}`, depth + 1))
  }

  if (t && view === 'recipe') {
    t.lines.forEach((l, i) => {
      const path = `L${i}`
      rows.push(
        <tr key={`h${path}`} style={{ background: 'var(--admin-bg-soft, #f9fafb)' }}>
          <td colSpan={6} style={{ fontWeight: 600, paddingTop: 7 }}>
            {l.ingredient} <span className="cst-muted" style={{ fontWeight: 400 }}>· {Number(l.grams)} g on the plate</span>
            <span style={{ marginLeft: 6 }}>{linkBadge(l.link_source)}</span>
            {l.unlinked && (
              <Link to={`/admin/costing/links?dish=${encodeURIComponent(dishId)}`} className="cst-inline-err" style={{ marginLeft: 6, fontWeight: 400 }}>
                unlinked — counted €0, link it →
              </Link>
            )}
            {!l.unlinked && <span style={{ float: 'right' }}>{fmtEur(l.line_cost)}</span>}
          </td>
        </tr>,
      )
      if (l.tree) renderNode(l.tree, path, 1)
    })
  }

  return (
    <div className="cst-section">
      <div className="cst-toolbar" style={{ marginBottom: 6 }}>
        <h4 style={{ margin: 0 }}>Recipe &amp; cost per ingredient</h4>
        <span className="cst-tabs" style={{ margin: 0, border: 0 }}>
          <a href="#" className={view === 'recipe' ? 'on' : ''} onClick={(e) => { e.preventDefault(); setView('recipe') }}>Recipe</a>
          <a href="#" className={view === 'items' ? 'on' : ''} onClick={(e) => { e.preventDefault(); setView('items') }}>By cost item</a>
        </span>
        <span className="cst-spacer" />
        {view === 'recipe' && t && (
          <>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setOpen(new Set(allPaths()))}>Expand all</button>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setOpen(new Set())}>Collapse</button>
          </>
        )}
      </div>

      {res?.error && !loading && <div className="admin-error-banner">Could not load the recipe: {res.error}</div>}
      {loading && !t && <div className="admin-loading">Loading recipe…</div>}

      {t && view === 'recipe' && (
        <div style={{ opacity: loading ? 0.6 : 1, overflowX: 'auto' }}>
          <table className="cst-table">
            <thead>
              <tr><th>Ingredient / component / cost item</th><th>Recipe</th><th className="num">Qty in this portion</th>
                <th className="num">Unit cost</th><th className="num">Cost</th><th className="num">Share of food</th></tr>
            </thead>
            <tbody>
              {rows}
              {!t.lines.length && <tr><td colSpan={6} className="cst-muted">No ingredient lines with grams.</td></tr>}
              <tr><td colSpan={4} style={{ fontWeight: 600 }}>Food cost</td><td className="num" style={{ fontWeight: 600 }}>{fmtEur(t.food_cost)}</td><td /></tr>
            </tbody>
          </table>
          <p className="cst-note" style={{ marginTop: 4 }}>
            Quantities are scaled to this portion: a component's recipe is multiplied by (grams on the plate ÷ cooked output of its batch).
            Raw quantities are as purchased, before cooking loss.
          </p>
        </div>
      )}

      {t && view === 'items' && (
        <div style={{ opacity: loading ? 0.6 : 1, overflowX: 'auto' }}>
          <table className="cst-table">
            <thead>
              <tr><th>Cost item (purchased)</th><th className="num">Raw qty in this portion</th><th className="num">Unit cost</th>
                <th>Price source</th><th className="num">Cost</th><th className="num">Share of food</th></tr>
            </thead>
            <tbody>
              {t.items.map((it) => (
                <tr key={it.id}>
                  <td><Link to={`/admin/costing/items?item=${encodeURIComponent(it.id)}`}>{it.name}</Link></td>
                  <td className="num">{fmtQty(it.qty, it.unit)}</td>
                  <td className="num">{fmtUnitCost(it.unit_cost, it.unit)}</td>
                  <td><SourceBadge source={it.source} date={it.price_date} /></td>
                  <td className="num">{fmtEurFine(it.cost, 3)}</td>
                  <td className="num cst-muted">{fmtPct(share(Number(it.cost)))}</td>
                </tr>
              ))}
              {t.leaf_components.length > 0 && (
                <>
                  <tr><td colSpan={6} className="cst-muted" style={{ paddingTop: 8, fontSize: 11.5 }}>
                    Components without a recipe (costed as a whole — enter their recipe to see the items):
                  </td></tr>
                  {t.leaf_components.map((c) => (
                    <Fragment key={c.id}>
                      <tr className="cst-sub">
                        <td><Link to={`/admin/costing/components?id=${encodeURIComponent(c.id)}`}>{c.name}</Link>{' '}<FlagBadges flags={c.flags} /></td>
                        <td className="num">{fmtQty(c.grams, 'g')} <span className="cst-muted">cooked</span></td>
                        <td className="num">{fmtPerKg(Number(c.cost) / Math.max(Number(c.grams), 1e-9))}</td>
                        <td className="cst-muted" style={{ fontSize: 11.5 }}>{c.yield_mode === 'fixed' ? 'fixed (Excel)' : 'no recipe'}</td>
                        <td className="num">{fmtEurFine(c.cost, 3)}</td>
                        <td className="num cst-muted">{fmtPct(share(Number(c.cost)))}</td>
                      </tr>
                    </Fragment>
                  ))}
                </>
              )}
              {!t.items.length && !t.leaf_components.length && <tr><td colSpan={6} className="cst-muted">Nothing costed yet.</td></tr>}
              <tr><td colSpan={4} style={{ fontWeight: 600 }}>Food cost</td><td className="num" style={{ fontWeight: 600 }}>{fmtEur(t.food_cost)}</td><td /></tr>
            </tbody>
          </table>
          {t.lines.some((l) => l.unlinked) && (
            <p className="cst-inline-err" style={{ marginTop: 4 }}>
              Some dish lines are unlinked and count €0 — <Link to={`/admin/costing/links?dish=${encodeURIComponent(dishId)}`}>link them</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
