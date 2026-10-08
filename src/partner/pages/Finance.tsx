/**
 * WEC-848 — the dietitian's financial view (read-only; 🟢 only Fitpal marks
 * payouts). Commission is earned only on money actually collected (🟢):
 * orders paid by card/link/cash/transfer and plan purchases. Orders paid from
 * the wallet show 0 — the commission was earned when the plan was paid.
 * Monthly CSV = the statement the dietitian invoices Fitpal against.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchFinance, type CommissionLine, eur, pct, fmtDate } from '../api'
import { usePartner } from '../context'

function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]
}

export function Finance() {
  const partner = usePartner()
  const now = new Date()
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [all, setAll] = useState(false)
  const [lines, setLines] = useState<CommissionLine[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)
    const [f, t] = all ? [null, null] : monthRange(ym)
    void fetchFinance(f, t).then(({ data, error }) => {
      if (cancelled) return
      if (error) setErr(error)
      setLines(data); setLoading(false)
    })
    return () => { cancelled = true }
  }, [ym, all])

  const tot = useMemo(() => lines.reduce((a, l) => ({
    gross: a.gross + (l.order_status === 'cancelled' ? 0 : l.gross),
    base: a.base + l.base, commission: a.commission + l.commission,
    paid: a.paid + l.paid_out, outstanding: a.outstanding + l.outstanding,
  }), { gross: 0, base: 0, commission: 0, paid: 0, outstanding: 0 }), [lines])

  const perClient = useMemo(() => {
    const m = new Map<string, { name: string; gross: number; commission: number; n: number }>()
    for (const l of lines) {
      const e = m.get(l.client_user_id) ?? { name: l.client_name ?? '—', gross: 0, commission: 0, n: 0 }
      e.gross += l.order_status === 'cancelled' ? 0 : l.gross; e.commission += l.commission; e.n += 1
      m.set(l.client_user_id, e)
    }
    return [...m.values()].sort((a, b) => b.gross - a.gross)
  }, [lines])

  function exportCsv() {
    const head = ['Ημερομηνία', 'Πελάτης', 'Αναφορά', 'Τύπος', 'Πληρωμή', 'Κατάσταση πληρωμής', 'Ποσό', 'Βάση commission', 'Ποσοστό', 'Commission', 'Εξοφλημένο', 'Υπόλοιπο']
    const rows = lines.map((l) => [
      fmtDate(l.occurred_at), l.client_name ?? '', l.ref ?? '', l.source_type === 'order' ? 'Παραγγελία' : 'Πλάνο',
      l.payment_method ?? '', l.payment_status ?? '', (l.gross / 100).toFixed(2), (l.base / 100).toFixed(2),
      pct(l.rate_bps), (l.commission / 100).toFixed(2), (l.paid_out / 100).toFixed(2), (l.outstanding / 100).toFixed(2),
    ])
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fitpal-commission-${partner.name.replace(/\s+/g, '-')}-${all ? 'all' : ym}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Οικονομικά</h1>
          <p className="admin-page-sub">Το commission υπολογίζεται μόνο σε ό,τι έχει πληρωθεί. Οι παραγγελίες από πορτοφόλι δεν έχουν commission — υπολογίστηκε στην αγορά του πλάνου.</p>
        </div>
        <div className="partner-actions">
          <input className="admin-input admin-input-tight" type="month" value={ym} disabled={all} onChange={(e) => setYm(e.target.value)} />
          <label className="admin-text-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Όλα
          </label>
          <button className="admin-btn-secondary" onClick={exportCsv} disabled={!lines.length}>Statement (CSV)</button>
        </div>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      <div className="admin-stats-grid">
        <Stat title="Τζίρος" value={eur(tot.gross)} />
        <Stat title="Commission" value={eur(tot.commission)} hint={`σε ${eur(tot.base)} πληρωμένα`} />
        <Stat title="Εξοφλημένο" value={eur(tot.paid)} />
        <Stat title="Οφειλόμενο" value={eur(tot.outstanding)} />
      </div>

      {loading ? <div className="admin-loading">Φόρτωση…</div> : (
        <>
          {perClient.length > 1 && (
            <>
              <h2 className="partner-h2">Ανά πελάτη</h2>
              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact">
                  <thead><tr><th>Πελάτης</th><th>Κινήσεις</th><th>Τζίρος</th><th>Commission</th></tr></thead>
                  <tbody>{perClient.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.n}</td><td>{eur(c.gross)}</td><td>{eur(c.commission)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          <h2 className="partner-h2">Κινήσεις</h2>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-compact">
              <thead><tr><th>Ημ/νία</th><th>Πελάτης</th><th>Αναφορά</th><th>Ποσό</th><th>Πληρώθηκε</th><th>%</th><th>Commission</th><th>Κατάσταση</th></tr></thead>
              <tbody>
                {lines.length === 0 && <tr><td colSpan={8} className="admin-table-empty">Καμία κίνηση.</td></tr>}
                {lines.map((l) => (
                  <tr key={l.source_type + l.source_id}>
                    <td>{fmtDate(l.occurred_at)}</td>
                    <td>{l.client_name}</td>
                    <td>{l.ref}{l.source_type === 'wallet_plan' ? '' : l.payment_method === 'wallet' ? ' · πορτοφόλι' : ''}</td>
                    <td>{eur(l.gross)}</td>
                    <td>{eur(l.base)}</td>
                    <td>{pct(l.rate_bps)}</td>
                    <td>{eur(l.commission)}</td>
                    <td>{l.commission === 0 ? <span className="admin-text-muted">—</span>
                      : l.outstanding === 0 ? <span className="admin-pill-paid">Εξοφλήθηκε</span>
                      : l.outstanding < 0 ? <span className="admin-pill-warn">Επιστροφή {eur(-l.outstanding)}</span>
                      : <span className="admin-pill-pending">Οφείλεται</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-title">{title}</div>
      <div className="admin-stat-value">{value}</div>
      {hint && <div className="admin-stat-hint">{hint}</div>}
    </div>
  )
}
