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

// Greek Excel reads «;»-separated CSV with decimal commas.
const dec = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

// WEC-889: the dietitian invoices Fitpal for the commission PLUS 24% output VAT.
// Display-only — never stored. Commission itself stays net (already net of the
// 13% food VAT on the order base, WEC-885).
const COMMISSION_VAT_RATE = 0.24
const vatOf = (commissionCents: number) => Math.round(commissionCents * COMMISSION_VAT_RATE)

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

  // WEC-889: output VAT (24%) the dietitian adds on top of the commission.
  const vat = vatOf(tot.commission)
  const commissionWithVat = tot.commission + vat

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
    const head = ['Ημερομηνία', 'Πελάτης', 'Αναφορά', 'Τύπος', 'Πληρωμή', 'Κατάσταση πληρωμής', 'Ποσό', 'Βάση commission', 'Ποσοστό', 'Commission', 'ΦΠΑ (24%)', 'Σύνολο με ΦΠΑ', 'Εξοφλημένο', 'Υπόλοιπο']
    const rows = lines.map((l) => [
      fmtDate(l.occurred_at), l.client_name ?? '', l.ref ?? '', l.source_type === 'order' ? 'Παραγγελία' : 'Πλάνο',
      l.payment_method ?? '', l.payment_status ?? '', dec(l.gross), dec(l.base),
      pct(l.rate_bps), dec(l.commission), dec(vatOf(l.commission)), dec(l.commission + vatOf(l.commission)), dec(l.paid_out), dec(l.outstanding),
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
          <p className="admin-page-sub">Το commission υπολογίζεται στην αξία των πιάτων πριν από εκπτώσεις και κουπόνια, και μόνο όταν πληρωθεί η παραγγελία. Στο commission προστίθεται ΦΠΑ 24% κατά την τιμολόγηση προς τη Fitpal.</p>
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
        <Stat title="Commission" value={eur(tot.commission)} hint={`σε ${eur(tot.base)} αξία πιάτων (πληρωμένες)`} />
        <Stat title="ΦΠΑ (24%)" value={eur(vat)} hint="στο commission, κατά την τιμολόγηση" />
        <Stat title="Σύνολο με ΦΠΑ" value={eur(commissionWithVat)} hint="ποσό τιμολογίου προς Fitpal" />
        <Stat title="Εξοφλημένο" value={eur(tot.paid)} />
        <Stat title="Οφειλόμενο" value={eur(tot.outstanding)} />
      </div>

      {loading ? <div className="admin-loading">Φόρτωση…</div> : (
        <>
          {perClient.length > 1 && (
            <>
              <h2 className="partner-h2">Ανά πελάτη</h2>
              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact partner-stack">
                  <thead><tr><th>Πελάτης</th><th>Κινήσεις</th><th>Τζίρος</th><th>Commission</th></tr></thead>
                  <tbody>{perClient.map((c) => <tr key={c.name}><td className="ps-full"><strong>{c.name}</strong></td><td data-label="Κινήσεις">{c.n}</td><td data-label="Τζίρος">{eur(c.gross)}</td><td data-label="Commission">{eur(c.commission)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          <h2 className="partner-h2">Κινήσεις</h2>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-compact partner-stack">
              <thead><tr><th>Ημ/νία</th><th>Πελάτης</th><th>Αναφορά</th><th>Ποσό</th><th>Βάση commission</th><th>%</th><th>Commission</th><th>Κατάσταση</th></tr></thead>
              <tbody>
                {lines.length === 0 && <tr><td colSpan={8} className="admin-table-empty">Καμία κίνηση.</td></tr>}
                {lines.map((l) => (
                  <tr key={l.source_type + l.source_id}>
                    <td data-label="Ημ/νία">{fmtDate(l.occurred_at)}</td>
                    <td data-label="Πελάτης">{l.client_name}</td>
                    <td data-label="Αναφορά">{l.ref}{l.source_type === 'wallet_plan' ? '' : l.payment_method === 'wallet' ? ' · πορτοφόλι' : ''}</td>
                    <td data-label="Ποσό">{eur(l.gross)}</td>
                    <td data-label="Βάση commission">{eur(l.base)}</td>
                    <td data-label="%">{pct(l.rate_bps)}</td>
                    <td data-label="Commission"><strong>{eur(l.commission)}</strong></td>
                    <td data-label="Κατάσταση">{l.commission === 0 ? <span className="admin-text-muted">—</span>
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
