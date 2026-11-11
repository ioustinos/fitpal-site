import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { RecipeComponentNode, RecipeNode } from '../../lib/api/adminCosting'
import { FlagBadges, ShareBar, SourceBadge, fmtCompCost, fmtEurFine, fmtQtyUnit, fmtUnitCost } from './shared'

/** WEC-864: tree rows shared by the dish drawer, the component drawer and the component editor. */

export const fmtQty = (q: number, unit: string) => {
  const v = Number(q)
  const s = Number.isInteger(Math.round(v * 100) / 100) || v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
  return `${s.replace('.', ',')} ${unit === 'pcs' ? 'pc' : unit}`
}

export function yieldLabel(c: RecipeComponentNode): string {
  if (c.yield_mode === 'fixed') return 'fixed €/kg (Excel estimate, no recipe)'
  if (c.yield_mode === 'pct') return `yield ${Number(c.yield_pct)}%`
  if (c.yield_mode === 'output_weight') return `batch ${Number(c.raw_weight_g ?? 0).toFixed(0)} g raw → ${Number(c.output_g ?? 0).toFixed(0)} g cooked`
  return ''
}

/** cooked ÷ raw of a component node in the tree (null when unknown) */
export const nodeRatio = (n: RecipeComponentNode): number | null => {
  const raw = Number(n.raw_weight_g ?? 0), out = Number(n.output_g ?? 0)
  return raw > 0 && out > 0 && (n.unit ?? 'g') !== 'pcs' ? out / raw : null
}

/** «Unit cost» cell content for a tree node */
export const nodeUnitCost = (n: RecipeNode): ReactNode =>
  n.kind === 'item' ? fmtUnitCost(n.unit_cost, n.unit) : fmtCompCost(n.cost_per_g, n.unit ?? 'g')

/** «Reference» cell content: the purchase / fallback price for an item, the version in force for a component */
export const nodeReference = (n: RecipeNode): ReactNode =>
  n.kind === 'item'
    ? <SourceBadge source={n.source} date={n.price_date} invoiceId={n.invoice_id} />
    : n.version_no
      ? <span className="cst-badge" title="Recipe version in force on this date">v{n.version_no} · from {n.effective_from ? new Date(n.effective_from).toLocaleDateString('el-GR') : '—'}</span>
      : <span className="cst-muted">—</span>

/**
 * Rows for one tree node and (when open) its children — shared by the dish drawer, the component
 * drawer and the component editor so all three look exactly the same (Ioustinos 11/11).
 * Columns: Ingredient · Recipe · Raw · Cooked · Unit cost · Reference · Cost · Share [· trailing cells]
 */
export function treeNodeRows(node: RecipeNode, path: string, depth: number, open: Set<string>,
  toggle: (path: string) => void, share: (c: number) => number | null, trailing = 0): ReactNode[] {
  const out: ReactNode[] = []
  const pad = { paddingLeft: 8 + depth * 22 }
  const tail = Array.from({ length: trailing }, (_, i) => <td key={`t${i}`} />)
  if (node.kind === 'item') {
    out.push(
      <tr key={path} className="cst-sub">
        <td style={pad}><span className="cst-muted">•</span>{' '}
          <Link to={`/admin/costing/items?item=${encodeURIComponent(node.id)}`}>{node.name}</Link></td>
        <td className="cst-muted">cost item</td>
        <td className="num">{fmtQty(node.qty, node.unit)}</td>
        <td className="num cst-muted">—</td>
        <td className="num">{nodeUnitCost(node)}</td>
        <td>{nodeReference(node)}</td>
        <td className="num">{fmtEurFine(node.cost, 3)}</td>
        <td className="num"><ShareBar value={share(node.cost)} muted={depth > 1} /></td>
        {tail}
      </tr>,
    )
    return out
  }
  const can = node.children.length > 0
  const isOpen = open.has(path)
  const r = nodeRatio(node)
  const u = node.unit ?? 'g'
  out.push(
    <tr key={path} className={depth ? 'cst-sub' : undefined}>
      <td style={pad}>
        <span className="cst-muted">•</span>{' '}
        <Link to={`/admin/costing/components?id=${encodeURIComponent(node.id)}`}>{node.name}</Link>
        <span style={{ marginLeft: 4 }}><FlagBadges flags={node.flags} /></span>
        {can && (
          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm cst-tree-toggle"
                  title={isOpen ? 'Hide its recipe' : 'Show its recipe'}
                  onClick={() => toggle(path)} aria-expanded={isOpen}>{isOpen ? '▾' : '▸'}</button>
        )}
      </td>
      <td className="cst-muted" style={{ fontSize: 11.5, minWidth: 150 }}>{yieldLabel(node)}</td>
      <td className="num">{u === 'pcs' ? '—' : r ? fmtQty(Number(node.grams) / r, 'g') : '—'}</td>
      <td className="num">{fmtQtyUnit(node.grams, u)}</td>
      <td className="num">{nodeUnitCost(node)}</td>
      <td>{nodeReference(node)}</td>
      <td className="num">{fmtEurFine(node.cost, 3)}</td>
      <td className="num"><ShareBar value={share(node.cost)} muted={depth > 1} /></td>
      {tail}
    </tr>,
  )
  if (can && isOpen) node.children.forEach((c, i) => out.push(...treeNodeRows(c, `${path}/${i}`, depth + 1, open, toggle, share, trailing)))
  return out
}

