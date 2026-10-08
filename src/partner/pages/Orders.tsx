/**
 * WEC-847 — the dietitian's orders view.
 *  • calories + macros per dish and per day (as the admin drawer shows them)
 *  • 🟢 target vs order PER DAY only (order items don't know which meal a
 *    dish was eaten as, so per-meal comparison would be guesswork)
 *  • 🔵 a weekly summary line (accepted by Ioustinos 2026-10-09)
 *  • the delivery point of each day, with Σπάτα/Αεροδρόμιο called out
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchOrders, fetchClients, type PartnerOrder, type OrderDay, type ClientRow, eur, dayLabel } from '../api'
import { usePartner } from '../context'

const SPECIAL = /σπάτ|σπατ|αεροδρ|spata|airport/i
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

export function Orders() {
  const partner = usePartner()
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientId, setClientId] = useState<string>('')
  useEffect(() => {
    void fetchClients().then(({ data }) => setClients(data.filter((c) => c.status === 'active')))
  }, [])
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Παραγγελίες</h1>
          <p className="admin-page-sub">Θερμίδες & macros ανά ημέρα, σε σύγκριση με τον στόχο κάθε πελάτη</p>
        </div>
        <select className="admin-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">{partner.is_internal ? 'Επιλέξτε πελάτη…' : 'Όλοι οι πελάτες'}</option>
          {clients.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
        </select>
      </div>
      {partner.is_internal && !clientId
        ? <p className="admin-text-muted">Επιλέξτε πελάτη.</p>
        : <OrdersList clientId={clientId || null} showClient={!clientId} />}
    </div>
  )
}

export function OrdersList({ clientId, showClient = false }: { clientId: string | null; showClient?: boolean }) {
  const today = new Date()
  const [from, setFrom] = useState(isoDate(new Date(today.getTime() - 28 * 864e5)))
  const [to, setTo] = useState(isoDate(new Date(today.getTime() + 14 * 864e5)))
  const [orders, setOrders] = useState<PartnerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)
    void fetchOrders(clientId, from || null, to || null).then(({ data, error }) => {
      if (cancelled) return
      if (error) setErr(error)
      setOrders(data); setLoading(false)
    })
    return () => { cancelled = true }
  }, [clientId, from, to])

  const weeks = useMemo(() => weeklySummary(orders), [orders])

  return (
    <div>
      <div className="admin-toolbar partner-range">
        <label>Από <input className="admin-input admin-input-tight" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Έως <input className="admin-input admin-input-tight" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {err && <div className="admin-error-banner">{err}</div>}
      {loading ? <div className="admin-loading">Φόρτωση…</div> : orders.length === 0 ? (
        <p className="admin-text-muted">Καμία παραγγελία στο διάστημα.</p>
      ) : (
        <>
          {!showClient && weeks.length > 0 && (
            <div className="partner-weeks">
              {weeks.map((w) => (
                <div key={w.week} className="partner-week">
                  <div className="partner-week-title">Εβδομάδα {dayLabel(w.week).slice(4)}</div>
                  <div>{w.days} ημέρες · μ.ό. <strong>{Math.round(w.avgKcal)}</strong> kcal{w.target ? ` / στόχος ${w.target}` : ''}</div>
                  {w.target ? <div className="admin-text-muted">{w.onTarget}/{w.days} ημέρες εντός ±10%</div> : null}
                </div>
              ))}
            </div>
          )}
          {orders.map((o) => <OrderCard key={o.id} o={o} showClient={showClient} />)}
        </>
      )}
    </div>
  )
}

function OrderCard({ o, showClient }: { o: PartnerOrder; showClient: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="admin-od-card partner-order">
      <div className="admin-od-card-head partner-order-head">
        <div>
          <strong>{o.orderNumber}</strong>
          {showClient && <> · {o.clientName}</>}
          {o.placedBy === 'partner' && <span className="admin-pill" style={{ marginLeft: 6 }}>από εσάς</span>}
          {o.status === 'cancelled' && <span className="admin-pill-failed" style={{ marginLeft: 6 }}>Ακυρώθηκε</span>}
        </div>
        <div className="admin-text-muted">
          {eur(o.total)}{o.partnerDiscount > 0 ? ` (έκπτωση ${eur(o.partnerDiscount)})` : ''} · {payLabel(o.paymentMethod)}
        </div>
      </div>
      <table className="admin-table admin-table-compact">
        <thead>
          <tr><th>Ημέρα</th><th>Παράδοση</th><th>kcal</th><th>P</th><th>C</th><th>F</th><th></th></tr>
        </thead>
        <tbody>
          {(o.days ?? []).map((d) => (
            <DayRow key={d.date} d={d} target={o.target} open={open === d.date} onToggle={() => setOpen(open === d.date ? null : d.date)} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DayRow({ d, target, open, onToggle }: { d: OrderDay; target: PartnerOrder['target']; open: boolean; onToggle: () => void }) {
  const place = d.fulfillment === 'pickup' ? `Παραλαβή${d.pickupLocationId ? ` (${d.pickupLocationId})` : ''}` : [d.area, d.zip].filter(Boolean).join(' ')
  const special = SPECIAL.test(`${d.zoneName ?? ''} ${d.area ?? ''} ${d.street ?? ''} ${d.pickupLocationId ?? ''}`)
  const cell = (v: number, t: number | null | undefined) => {
    if (!t) return <td>{Math.round(v)}</td>
    const diff = v - t
    const off = Math.abs(diff) / t > 0.1
    return <td className={off ? 'partner-off' : 'partner-ok'} title={`στόχος ${t}`}>{Math.round(v)} <span className="partner-diff">{diff >= 0 ? '+' : ''}{Math.round(diff)}</span></td>
  }
  return (
    <>
      <tr className={d.cancelled ? 'partner-cancelled' : ''}>
        <td>{dayLabel(d.date)}{d.cancelled ? ' · ακυρ.' : ''}</td>
        <td>
          {place || '—'}{d.timeFrom ? ` · ${d.timeFrom.slice(0, 5)}–${(d.timeTo ?? '').slice(0, 5)}` : ''}
          {special && <span className="admin-pill-warn" style={{ marginLeft: 6 }}>{d.zoneName || 'Ειδική ζώνη'}</span>}
        </td>
        {cell(d.totals.kcal, target?.kcal)}
        {cell(d.totals.protein, target?.protein)}
        {cell(d.totals.carbs, target?.carbs)}
        {cell(d.totals.fat, target?.fat)}
        <td><button className="admin-btn-ghost admin-btn-sm" onClick={onToggle}>{open ? 'Κλείσιμο' : 'Πιάτα'}</button></td>
      </tr>
      {open && (d.items ?? []).map((it, i) => (
        <tr key={i} className="partner-item-row">
          <td></td>
          <td>{it.qty}× {it.name}{it.variant ? ` — ${it.variant}` : ''}{it.comment ? <em className="admin-text-muted"> «{it.comment}»</em> : null}</td>
          <td>{(it.kcal ?? 0) * it.qty}</td><td>{(it.protein ?? 0) * it.qty}</td><td>{(it.carbs ?? 0) * it.qty}</td><td>{(it.fat ?? 0) * it.qty}</td><td></td>
        </tr>
      ))}
    </>
  )
}

function payLabel(m: string) {
  return ({ cash: 'Μετρητά', card: 'Κάρτα', link: 'Link πληρωμής', transfer: 'Τραπεζική', wallet: 'Πορτοφόλι' } as Record<string, string>)[m] ?? m
}

// Monday of the date's ISO week, computed from the date itself.
function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return d.toISOString().slice(0, 10)
}

function weeklySummary(orders: PartnerOrder[]) {
  // Sum per DATE first (two orders for the same day are one day of eating),
  // then roll the dates up into ISO weeks.
  const byDate = new Map<string, { kcal: number; target: number | null }>()
  for (const o of orders) {
    for (const d of o.days ?? []) {
      if (d.cancelled) continue
      const e = byDate.get(d.date) ?? { kcal: 0, target: o.target?.kcal ?? null }
      e.kcal += d.totals.kcal
      byDate.set(d.date, e)
    }
  }
  const map = new Map<string, { kcal: number; days: number; onTarget: number; target: number | null }>()
  for (const [date, e] of byDate) {
    const w = mondayOf(date)
    const acc = map.get(w) ?? { kcal: 0, days: 0, onTarget: 0, target: e.target }
    acc.kcal += e.kcal; acc.days += 1
    if (e.target && Math.abs(e.kcal - e.target) / e.target <= 0.1) acc.onTarget += 1
    map.set(w, acc)
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, e]) => ({ week, days: e.days, avgKcal: e.days ? e.kcal / e.days : 0, onTarget: e.onTarget, target: e.target }))
}
