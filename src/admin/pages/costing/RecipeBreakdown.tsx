import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchComponentTree,
  fetchVariantTree,
  type ComponentTree,
  type RecipeNode,
  type VariantTree,
} from '../../../lib/api/adminCosting'
import { FlagBadges, Section, Segmented, ShareBar, SourceBadge, fmtCompCost, fmtEur, fmtEurFine, fmtQtyUnit, fmtUnitCost } from '../../costing/shared'
import { fmtQty, nodeRatio, treeNodeRows } from '../../costing/recipeTree'

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

const linkBadge = (s: string | null) =>
  s === 'manual' ? <span className="cst-badge cst-ok">manual</span>
    : s === 'default' ? <span className="cst-badge">default</span>
      : s === 'auto_excel' ? <span className="cst-badge cst-est" title="Auto-matched from the kitchen Excel">auto</span>
        : null

/** Same tree for a component (WEC-864, Ioustinos 11/11: «the detailed tree of the dish is the perfect UI»):
 *  its recipe exploded to cost items, for one whole batch or per 1 kg cooked / 1 piece. */
export function ComponentRecipeTree({ componentId, asOf, unit }: { componentId: string; asOf: string; unit: string }) {
  return <RecipeBreakdown componentId={componentId} asOf={asOf} rev={0} dishId="" componentUnit={unit} />
}

/** component tree → the shape the dish view renders (its direct lines become the top-level rows) */
const asVariantTree = (c: ComponentTree): VariantTree => ({
  variant_id: c.component_id, date: c.date, food_cost: Number(c.cost), packaging_cost: 0, product_cost: Number(c.cost),
  lines: [], items: c.items, leaf_components: c.leaf_components,
})

export function RecipeBreakdown({ variantId, componentId, componentUnit, asOf, rev, dishId }: {
  variantId?: string; componentId?: string; componentUnit?: string; asOf: string; rev: number; dishId: string
}) {
  const isComp = !!componentId
  const [scale, setScale] = useState<'batch' | 'unit'>('batch')
  const [res, setRes] = useState<{ key: string; data: VariantTree | null; comp: ComponentTree | null; error: string | null } | null>(null)
  const [view, setView] = useState<'recipe' | 'items'>('recipe')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const unitQty = componentUnit === 'pcs' ? 1 : 1000
  const key = `${variantId ?? componentId}#${asOf}#${rev}#${scale}`

  useEffect(() => {
    let alive = true
    if (componentId) {
      fetchComponentTree(componentId, asOf, scale === 'unit' ? unitQty : null)
        .then((r) => { if (alive) setRes({ key, data: r.data ? asVariantTree(r.data) : null, comp: r.data, error: r.error }) })
    } else if (variantId) {
      fetchVariantTree(variantId, asOf).then((r) => { if (alive) setRes({ key, data: r.data, comp: null, error: r.error }) })
    }
    return () => { alive = false }
  }, [variantId, componentId, asOf, key, scale, unitQty])

  const t = res?.data ?? null
  const ct = res?.comp ?? null
  const where = isComp ? (scale === 'batch' ? 'this batch' : componentUnit === 'pcs' ? '1 piece' : '1 kg cooked') : 'this portion'
  const loading = res?.key !== key
  // dish: share of the whole dish (food + packaging), so food lines and packaging add up to 100%;
  // component: share of the component's batch
  const whole = Number((isComp ? t?.food_cost : t?.product_cost) ?? 0)
  const share = (c: number) => (whole > 0 ? c / whole : null)

  const toggle = (path: string) => setOpen((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })
  const allPaths = (): string[] => {
    const out: string[] = []
    const walk = (node: RecipeNode, path: string) => {
      if (node.kind === 'component' && node.children.length) { out.push(path); node.children.forEach((c, i) => walk(c, `${path}/${i}`)) }
    }
    t?.lines.forEach((l, i) => { if (l.tree) walk(l.tree, `L${i}`) })
    ct?.root.children.forEach((c, i) => walk(c, `C${i}`))
    return out
  }

  const rows: ReactNode[] = []
  const renderNode = (node: RecipeNode, path: string, depth: number) =>
    rows.push(...treeNodeRows(node, path, depth, open, toggle, share))

  if (ct && view === 'recipe') ct.root.children.forEach((c, i) => renderNode(c, `C${i}`, 0))
  if (t && view === 'recipe') {
    t.lines.forEach((l, i) => {
      const path = `L${i}`
      rows.push(
        <tr key={`h${path}`} style={{ background: 'var(--admin-bg-soft, #f9fafb)' }}>
          <td colSpan={8} style={{ fontWeight: 600, paddingTop: 7 }}>
            {l.ingredient} <span className="cst-muted" style={{ fontWeight: 400 }}>· {Number(l.grams)} g on the plate{l.unit === 'pcs' && <> = {l.qty === null || l.qty === undefined ? '? pieces' : fmtQtyUnit(l.qty, 'pcs')}</>}</span>
            {l.flags?.no_piece_weight && <span className="cst-inline-err" style={{ marginLeft: 6, fontWeight: 400 }}>set «grams per piece» on the component — counted €0</span>}
            <span style={{ marginLeft: 6 }}>{linkBadge(l.link_source)}</span>
            {!l.unlinked && dishId && (
              <Link to={`/admin/costing/links?dish=${encodeURIComponent(dishId)}`} className="cst-note" style={{ marginLeft: 8, fontWeight: 400 }}
                    title="Change which component this ingredient is costed with">change link →</Link>
            )}
            {l.unlinked && (
              <Link to={`/admin/costing/links?dish=${encodeURIComponent(dishId)}`} className="cst-inline-err" style={{ marginLeft: 6, fontWeight: 400 }}>
                unlinked — counted €0, link it →
              </Link>
            )}
          </td>
        </tr>,
      )
      if (l.tree) renderNode(l.tree, path, 1)
    })
  }

  return (
    <Section
      title={isComp ? 'Raw ingredients' : 'Recipe & cost per ingredient'}
      sub={isComp ? (scale === 'batch' ? 'whole batch' : componentUnit === 'pcs' ? 'per piece' : 'per kg cooked') : 'this portion'}
      actions={<>
        {isComp && (
          <Segmented value={scale} onChange={setScale}
            options={[['batch', 'Whole batch'], ['unit', componentUnit === 'pcs' ? 'Per piece' : 'Per kg cooked']]} />
        )}
        <Segmented value={view} onChange={setView} options={[['recipe', 'Recipe'], ['items', 'By cost item']]} />
        {view === 'recipe' && t && (<>
          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setOpen(new Set(allPaths()))}>Expand all</button>
          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setOpen(new Set())}>Collapse</button>
        </>)}
      </>}
    >
      {res?.error && !loading && <div className="admin-error-banner">Could not load the recipe: {res.error}</div>}
      {loading && !t && <div className="admin-loading">Loading recipe…</div>}

      {t && view === 'recipe' && (
        <div style={{ opacity: loading ? 0.6 : 1, overflowX: 'auto' }}>
          <table className="cst-table">
            <thead>
              <tr><th>Ingredient / component / cost item</th><th title="How each component is made: its yield, or its batch (raw → cooked). Purchased = a cost item bought as is.">Yield</th><th className="num">Raw <span className="cst-muted" style={{ fontWeight: 400 }}>· {where}</span></th>
                <th className="num">Cooked</th><th className="num">Unit cost</th><th>Reference</th><th className="num">Cost</th><th className="num">{isComp ? 'Share of component' : 'Share of dish'}</th></tr>
            </thead>
            <tbody>
              {rows}
              {!isComp && !t.lines.length && <tr><td colSpan={8} className="cst-muted">No ingredient lines with grams.</td></tr>}
              {isComp && !ct?.root.children.length && <tr><td colSpan={8} className="cst-muted">No recipe lines — the cost is a fixed estimate.</td></tr>}
              {isComp && ct && ct.root.children.length > 0 && (() => {
                // Σ Raw / Σ Cooked of the recipe lines (Ioustinos 11/11)
                let raw = 0, cooked = 0, missing = 0
                const kids = ct.root.children
                const single = kids.length === 1 && kids[0].kind === 'item'
                for (const n of kids) {
                  if (n.kind === 'item') {
                    // single-ingredient component: its yield %; in a mixed recipe an item goes in as it is
                    if (n.unit === 'pcs') { missing++; continue }
                    raw += Number(n.qty)
                    if (single && ct.root.yield_mode === 'pct') cooked += Number(n.qty) * Number(ct.root.yield_pct ?? 0) / 100
                    else if (single) missing++
                    else cooked += Number(n.qty)
                    continue
                  }
                  if ((n.unit ?? 'g') === 'pcs') continue
                  const r = nodeRatio(n)
                  if (r) raw += Number(n.grams) / r
                  cooked += Number(n.grams)
                }
                return (
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 600 }}>Total weight</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtQty(raw, 'g')}</td>
                    <td className="num" style={{ fontWeight: 600 }} title={missing ? 'Some lines have no cooked weight (pieces, or no yield) — not counted' : 'Σ of what goes into the pot: components at their cooked weight, cost items as they are'}>
                      {missing ? (cooked > 0 ? `≥ ${fmtQty(cooked, 'g')}` : '—') : fmtQty(cooked, 'g')}</td>
                    <td colSpan={4} />
                  </tr>
                )
              })()}
              <tr><td colSpan={6} style={{ fontWeight: 600 }}>{isComp ? `Cost of ${where}` : 'Food cost'}{isComp && ct && <span className="cst-muted" style={{ fontWeight: 400 }}> · {fmtQtyUnit(ct.qty, ct.unit)}{ct.unit === 'g' ? ' cooked' : ''}</span>}</td><td className="num" style={{ fontWeight: 600 }}>{fmtEur(t.food_cost)}</td><td /></tr>
            </tbody>
          </table>
          <p className="cst-note" style={{ marginTop: 4 }}>
            Quantities are scaled to {where}: a component's recipe is multiplied by (quantity used ÷ cooked output of its batch).
            Raw quantities are as purchased, before cooking loss.
          </p>
        </div>
      )}

      {t && view === 'items' && (
        <div style={{ opacity: loading ? 0.6 : 1, overflowX: 'auto' }}>
          <table className="cst-table">
            <thead>
              <tr><th>Cost item (purchased)</th><th className="num">Raw qty in {where}</th><th className="num">Unit cost</th>
                <th>Price source</th><th className="num">Cost</th><th className="num">{isComp ? 'Share of component' : 'Share of dish'}</th></tr>
            </thead>
            <tbody>
              {t.items.map((it) => (
                <tr key={it.id}>
                  <td><Link to={`/admin/costing/items?item=${encodeURIComponent(it.id)}`}>{it.name}</Link></td>
                  <td className="num">{fmtQty(it.qty, it.unit)}</td>
                  <td className="num">{fmtUnitCost(it.unit_cost, it.unit)}</td>
                  <td><SourceBadge source={it.source} date={it.price_date} invoiceId={it.invoice_id} /></td>
                  <td className="num">{fmtEurFine(it.cost, 3)}</td>
                  <td className="num"><ShareBar value={share(Number(it.cost))} /></td>
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
                        <td className="num">{fmtQtyUnit(c.grams, c.unit)}{(c.unit ?? 'g') === 'g' && <span className="cst-muted"> cooked</span>}</td>
                        <td className="num">{fmtCompCost(Number(c.cost) / Math.max(Number(c.grams), 1e-9), c.unit)}</td>
                        <td className="cst-muted" style={{ fontSize: 11.5 }}>{c.yield_mode === 'fixed' ? 'fixed (Excel)' : 'no recipe'}</td>
                        <td className="num">{fmtEurFine(c.cost, 3)}</td>
                        <td className="num"><ShareBar value={share(Number(c.cost))} /></td>
                      </tr>
                    </Fragment>
                  ))}
                </>
              )}
              {!t.items.length && !t.leaf_components.length && <tr><td colSpan={6} className="cst-muted">Nothing costed yet.</td></tr>}
              <tr><td colSpan={4} style={{ fontWeight: 600 }}>{isComp ? `Cost of ${where}` : 'Food cost'}</td><td className="num" style={{ fontWeight: 600 }}>{fmtEur(t.food_cost)}</td><td /></tr>
            </tbody>
          </table>
          {t.lines.some((l) => l.unlinked) && (
            <p className="cst-inline-err" style={{ marginTop: 4 }}>
              Some dish lines are unlinked and count €0 — <Link to={`/admin/costing/links?dish=${encodeURIComponent(dishId)}`}>link them</Link>.
            </p>
          )}
        </div>
      )}
    </Section>
  )
}
