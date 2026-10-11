import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchCheckRuns, fetchCostSummary, runCostCheck, type CostCheckRun, type CostSummary,
} from '../../../lib/api/adminCosting'
import { CostingTabs, fmtDate } from '../../costing/shared'

/**
 * /admin/costing — overview + nightly ledger check (WEC-861).
 *
 * The check recomputes every item / component / dish variant from scratch and
 * compares it with the cost ledger. Runs nightly on production (Netlify
 * scheduled function costing-nightly-check); «Run now» works everywhere.
 * Health = the latest run's status AND error column — never just «a row exists».
 */
export function CostingHome() {
  const [sum, setSum] = useState<CostSummary | null>(null)
  const [runs, setRuns] = useState<CostCheckRun[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [s, r] = await Promise.all([fetchCostSummary(), fetchCheckRuns(15)])
    if (s.error) setErr(s.error); else setSum(s.data)
    if (r.error) setErr((e) => e ?? r.error); else setRuns(r.data ?? [])
  }
  useEffect(() => { load() }, [])

  async function runNow() {
    setBusy(true); setErr(null)
    const r = await runCostCheck()
    setBusy(false)
    if (r.error) setErr(r.error)
    await load()
  }

  const last = sum?.last_check ?? null
  const lastBad = !!last && (last.status !== 'ok' || !!last.error)

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Costing</h1>
      <p className="admin-page-sub">Cost items, purchases, components and the product cost of every dish variant.</p>
      <CostingTabs />
      {err && <div className="admin-error-banner">{err}</div>}
      {!sum && !err && <div className="admin-loading">Loading…</div>}

      {sum && (
        <div className="cst-tiles">
          <Link to="/admin/costing/dishes" className={`cst-tile ${sum.variants_unlinked ? 'red' : 'green'}`}>
            <div className="cst-tile-k">Dish variants</div>
            <div className="cst-tile-v">{sum.variants - sum.variants_unlinked} / {sum.variants}</div>
            <div className="cst-tile-s">fully linked · {sum.variants_unlinked} with unlinked lines</div>
          </Link>
          <Link to="/admin/costing/links" className={`cst-tile ${sum.links_unconfirmed ? '' : 'green'}`}>
            <div className="cst-tile-k">Dish-line links</div>
            <div className="cst-tile-v">{sum.links_unconfirmed}</div>
            <div className="cst-tile-s">auto-matched, not yet confirmed</div>
          </Link>
          <Link to="/admin/costing/items" className={`cst-tile ${sum.items_unpriced ? 'red' : ''}`}>
            <div className="cst-tile-k">Cost items</div>
            <div className="cst-tile-v">{sum.items}</div>
            <div className="cst-tile-s">{sum.items_estimated} estimated · {sum.items_unpriced} unpriced</div>
          </Link>
          <Link to="/admin/costing/components" className="cst-tile">
            <div className="cst-tile-k">Components</div>
            <div className="cst-tile-v">{sum.components}</div>
            <div className="cst-tile-s">{sum.components_fixed} fixed-cost (Excel estimate, no recipe)</div>
          </Link>
          <Link to="/admin/costing/purchases" className="cst-tile">
            <div className="cst-tile-k">Purchase invoices</div>
            <div className="cst-tile-v">{sum.invoices}</div>
            <div className="cst-tile-s">last {fmtDate(sum.last_invoice_date)}</div>
          </Link>
          <div className={`cst-tile ${lastBad ? 'red' : last ? 'green' : ''}`}>
            <div className="cst-tile-k">Ledger check</div>
            <div className="cst-tile-v">{last ? (last.error ? 'error' : last.status === 'ok' ? 'OK' : `${last.mismatch_count} ≠`) : '—'}</div>
            <div className="cst-tile-s">
              {last ? `${new Date(last.started_at).toLocaleString('el-GR')} · ${last.values_checked} values` : 'never ran'}
              {sum.queue_pending > 0 && ` · ${sum.queue_pending} queued`}
            </div>
          </div>
        </div>
      )}

      <div className="cst-section">
        <div className="cst-toolbar">
          <h4 style={{ margin: 0 }}>Nightly ledger check</h4>
          <span className="cst-note">
            Recomputes every cost from scratch (today + every ledger date of the last 90 days) and compares it with the stored
            history. Tolerance €0.0001. Scheduled nightly on production; on dev use «Run now».
          </span>
          <span className="cst-spacer" />
          <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={busy} onClick={runNow}>
            {busy ? 'Running…' : 'Run now'}
          </button>
        </div>
        <div className="cst-wrap" style={{ maxHeight: 420 }}>
          <table className="cst-table">
            <thead>
              <tr>
                <th>Started</th><th>Trigger</th><th>Status</th><th className="num">Entities</th>
                <th className="num">Values</th><th className="num">Mismatches</th><th className="num">ms</th><th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <Fragment key={r.id}>
                  <tr className={r.mismatch_count ? 'cst-click' : ''} onClick={() => r.mismatch_count && setOpen(open === r.id ? null : r.id)}>
                    <td>{new Date(r.started_at).toLocaleString('el-GR')}</td>
                    <td>{r.trigger_source}</td>
                    <td>
                      <span className={`cst-badge ${r.error || r.status === 'error' ? 'cst-err' : r.status === 'ok' ? 'cst-ok' : r.status === 'mismatch' ? 'cst-err' : 'cst-warn'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="num">{r.entities_checked}</td>
                    <td className="num">{r.values_checked}</td>
                    <td className="num">{r.mismatch_count ? <b className="cst-pos">{r.mismatch_count} ▸</b> : 0}</td>
                    <td className="num">{r.duration_ms ?? '—'}</td>
                    <td className="cst-inline-err">{r.error}</td>
                  </tr>
                  {open === r.id && (r.mismatches ?? []).map((m, i) => (
                    <tr key={`${r.id}-${i}`} className="cst-sub">
                      <td colSpan={2}>{m.entity_type} {m.entity_id}</td>
                      <td>{fmtDate(m.date)}</td>
                      <td className="num" colSpan={2}>ledger {m.ledger ?? '∅'}</td>
                      <td className="num">recomputed {m.recomputed}</td>
                      <td className="num" colSpan={2}>Δ {m.delta ?? '—'}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {!runs.length && <tr><td colSpan={8} className="cst-muted">No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
