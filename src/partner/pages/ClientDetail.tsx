/**
 * WEC-843 client card · WEC-844 «ως πελάτης» actions · WEC-849 plan/wallet ·
 * WEC-851 progress tracking (hidden add-on) — for one client.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  fetchClientDetail, saveClient, addMeasurement,
  type ClientDetail, type MealKey, eur, pct, fmtDate,
} from '../api'
import { usePartner } from '../context'
import { useImpersonationStore } from '../../store/useImpersonationStore'
import { useUIStore } from '../../store/useUIStore'
import { OrdersList } from './Orders'
import { Field } from './Clients'

const MEALS: Array<{ key: MealKey; label: string }> = [
  { key: 'breakfast', label: 'Πρωινό' },
  { key: 'lunch', label: 'Μεσημεριανό' },
  { key: 'dinner', label: 'Βραδινό' },
  { key: 'snack', label: 'Σνακ' },
]
const MACROS = [
  { key: 'kcal', label: 'Θερμίδες', unit: 'kcal' },
  { key: 'protein', label: 'Πρωτεΐνη', unit: 'g' },
  { key: 'carbs', label: 'Υδατάνθρακες', unit: 'g' },
  { key: 'fat', label: 'Λιπαρά', unit: 'g' },
] as const
type MacroKey = typeof MACROS[number]['key']

const SEX = [['female', 'Γυναίκα'], ['male', 'Άνδρας'], ['other', 'Άλλο']] as const
const ACTIVITY = [['sedentary', 'Καθιστική'], ['light', 'Ελαφριά'], ['moderate', 'Μέτρια'], ['active', 'Έντονη'], ['very_active', 'Πολύ έντονη']] as const
const GOAL = [['lose', 'Απώλεια βάρους'], ['maintain', 'Διατήρηση'], ['gain', 'Αύξηση']] as const

const s = (v: unknown) => (v == null ? '' : String(v))

export function ClientDetailPage() {
  const { userId = '' } = useParams()
  const partner = usePartner()
  const navigate = useNavigate()
  const [d, setD] = useState<ClientDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    const { data, error } = await fetchClientDetail(userId)
    if (error) setErr(error)
    setD(data); setLoading(false)
  }
  useEffect(() => { void load() }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // WEC-844: act as the client on the normal customer site (session swap,
  // validated server-side). Exit lands back on /partner.
  async function actAs(where: 'order' | 'plan' | 'account') {
    setActing(where); setErr(null)
    const res = await useImpersonationStore.getState().start(userId)
    setActing(null)
    if (!res.ok) { setErr(res.error ?? 'Δεν ξεκίνησε η λειτουργία πελάτη'); return }
    navigate('/')
    if (where === 'account') { useUIStore.getState().goToAccount('profile'); return }
    if (where === 'plan') useUIStore.getState().goToWalletPage()
  }

  if (loading) return <div className="admin-page"><div className="admin-loading">Φόρτωση…</div></div>
  if (!d) return <div className="admin-page"><div className="admin-error-banner">{err ?? 'Δεν βρέθηκε'}</div><Link to="/partner">← Πελάτες</Link></div>

  const p = d.profile
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <Link to="/partner" className="admin-inline-link" style={{ fontSize: 12 }}>← Πελάτες</Link>
          <h1 className="admin-page-title">{p?.name || p?.email}</h1>
          <p className="admin-page-sub">
            {p?.email}{p?.phone ? ` · ${p.phone}` : ''}
            {d.link?.ownLink && !partner.is_internal && <> · έκπτωση {pct(d.link.discountBps)} · commission {pct(d.link.commissionBps)}</>}
          </p>
        </div>
        <div className="admin-page-actions partner-actions">
          <button className="admin-btn-primary" disabled={!!acting} onClick={() => actAs('order')}>
            {acting === 'order' ? '…' : 'Παραγγελία ως πελάτης'}
          </button>
          <button className="admin-btn-secondary" disabled={!!acting} onClick={() => actAs('plan')}>
            {acting === 'plan' ? '…' : 'Νέο πλάνο / συνδρομή'}
          </button>
          <button className="admin-btn-ghost" disabled={!!acting} onClick={() => actAs('account')}>
            {acting === 'account' ? '…' : 'Λογαριασμός πελάτη'}
          </button>
        </div>
      </div>
      <p className="admin-text-muted" style={{ fontSize: 12, marginTop: -6 }}>
        «Ως πελάτης» ανοίγει το κανονικό site στον λογαριασμό του πελάτη (διευθύνσεις, αλλεργίες, προτιμήσεις, παραγγελία, πλάνο με payment link).
        Με την έξοδο θα χρειαστεί να συνδεθείτε ξανά.
      </p>
      {err && <div className="admin-error-banner">{err}</div>}

      <div className="partner-grid">
        <BodyCard d={d} userId={userId} onSaved={load} />
        <TargetsCard d={d} userId={userId} onSaved={load} />
        <PlanCard d={d} />
        <AddressesCard d={d} />
        {d.progressEnabled && <ProgressCard d={d} userId={userId} onSaved={load} />}
      </div>

      <h2 className="partner-h2">Παραγγελίες</h2>
      <OrdersList clientId={userId} />
    </div>
  )
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="admin-setting-card partner-card">
      <div className="admin-setting-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>{right}
      </div>
      <div className="admin-setting-body">{children}</div>
    </section>
  )
}

function BodyCard({ d, userId, onSaved }: { d: ClientDetail; userId: string; onSaved: () => void }) {
  const p = d.profile
  const [f, setF] = useState({
    name: s(p?.name), phone: s(p?.phone), sex: s(p?.sex), birthYear: s(p?.birthYear), heightCm: s(p?.heightCm),
    weightKg: s(p?.weightKg), activityLevel: s(p?.activityLevel), goal: s(p?.goal), dietaryNotes: s(p?.dietaryNotes),
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }))
  async function save() {
    setBusy(true); setMsg(null)
    const { error } = await saveClient(userId, { profile: f })
    setBusy(false)
    setMsg(error ? `✗ ${error}` : '✓ Αποθηκεύτηκε')
    if (!error) onSaved()
  }
  return (
    <Card title="Στοιχεία πελάτη">
      <div className="partner-form-2">
        <Field label="Ονοματεπώνυμο" value={f.name} onChange={upd('name')} />
        <Field label="Τηλέφωνο" value={f.phone} onChange={upd('phone')} />
      </div>
      {!d.bodyVisible ? (
        <div className="admin-warn-banner" style={{ marginTop: 10 }}>
          Ο πελάτης δεν έχει δώσει ακόμα συγκατάθεση για να βλέπετε σωματικά στοιχεία. Θα του ζητηθεί στην επόμενη σύνδεσή του.
        </div>
      ) : (
        <>
          <div className="partner-form-3" style={{ marginTop: 10 }}>
            <Select label="Φύλο" value={f.sex} onChange={upd('sex')} options={SEX} />
            <Field label="Έτος γέννησης" value={f.birthYear} onChange={upd('birthYear')} type="number" />
            <Field label="Ύψος (cm)" value={f.heightCm} onChange={upd('heightCm')} type="number" />
            <Field label="Βάρος (kg)" value={f.weightKg} onChange={upd('weightKg')} type="number" />
            <Select label="Δραστηριότητα" value={f.activityLevel} onChange={upd('activityLevel')} options={ACTIVITY} />
            <Select label="Στόχος" value={f.goal} onChange={upd('goal')} options={GOAL} />
          </div>
          <label style={{ display: 'block', marginTop: 10 }}>
            <span className="admin-form-label" style={{ display: 'block', fontSize: 12 }}>Διατροφικές σημειώσεις</span>
            <textarea className="admin-textarea" rows={2} style={{ width: '100%' }} value={f.dietaryNotes} onChange={upd('dietaryNotes')} />
          </label>
        </>
      )}
      <div className="admin-form-actions">
        {msg && <span className="admin-text-muted">{msg}</span>}
        <button className="admin-btn-primary" onClick={save} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</button>
      </div>
    </Card>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <label style={{ display: 'block' }}>
      <span className="admin-form-label" style={{ display: 'block', fontSize: 12, marginBottom: 3 }}>{label}</span>
      <select className="admin-select" style={{ width: '100%' }} value={value} onChange={onChange}>
        <option value="">—</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function TargetsCard({ d, userId, onSaved }: { d: ClientDetail; userId: string; onSaved: () => void }) {
  const t = d.targets
  const [daily, setDaily] = useState<Record<MacroKey, string>>({
    kcal: s(t?.kcal), protein: s(t?.protein), carbs: s(t?.carbs), fat: s(t?.fat),
  })
  const [meals, setMeals] = useState<Record<MealKey, Record<MacroKey, string>>>(() => {
    const out = {} as Record<MealKey, Record<MacroKey, string>>
    for (const m of MEALS) {
      const mm = t?.meals?.[m.key] ?? {}
      out[m.key] = { kcal: s(mm.kcal), protein: s(mm.protein), carbs: s(mm.carbs), fat: s(mm.fat) }
    }
    return out
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const mealSum = (k: MacroKey) => MEALS.reduce((a, m) => a + (Number(meals[m.key][k]) || 0), 0)

  async function save() {
    setBusy(true); setMsg(null)
    const mealsOut: Record<string, Record<string, number>> = {}
    for (const m of MEALS) {
      const row: Record<string, number> = {}
      for (const x of MACROS) if (meals[m.key][x.key] !== '') row[x.key] = Number(meals[m.key][x.key])
      if (Object.keys(row).length) mealsOut[m.key] = row
    }
    const { error } = await saveClient(userId, { targets: { ...daily, meals: mealsOut } })
    setBusy(false)
    setMsg(error ? `✗ ${error}` : '✓ Αποθηκεύτηκε')
    if (!error) onSaved()
  }

  return (
    <Card title="Στόχοι (ίδιοι κάθε μέρα)"
          right={d.plan?.dailyKcal ? <button className="admin-btn-ghost admin-btn-sm"
            onClick={() => setDaily((x) => ({ ...x, kcal: String(d.plan!.dailyKcal) }))}>Θερμίδες από το πλάνο ({d.plan.dailyKcal})</button> : null}>
      <table className="admin-table admin-table-compact partner-targets">
        <thead>
          <tr><th></th>{MACROS.map((m) => <th key={m.key}>{m.label} <span className="admin-text-muted">({m.unit})</span></th>)}</tr>
        </thead>
        <tbody>
          <tr className="partner-targets-daily">
            <td><strong>Ημέρα</strong></td>
            {MACROS.map((m) => (
              <td key={m.key}><input className="admin-input admin-input-tight" type="number" value={daily[m.key]}
                onChange={(e) => setDaily((x) => ({ ...x, [m.key]: e.target.value }))} /></td>
            ))}
          </tr>
          {MEALS.map((meal) => (
            <tr key={meal.key}>
              <td>{meal.label}</td>
              {MACROS.map((m) => (
                <td key={m.key}><input className="admin-input admin-input-tight" type="number" value={meals[meal.key][m.key]}
                  onChange={(e) => setMeals((x) => ({ ...x, [meal.key]: { ...x[meal.key], [m.key]: e.target.value } }))} /></td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="admin-text-muted">Σύνολο γευμάτων</td>
            {MACROS.map((m) => {
              const sum = mealSum(m.key); const target = Number(daily[m.key]) || 0
              const off = target > 0 && sum > 0 && Math.abs(sum - target) / target > 0.05
              return <td key={m.key} className={off ? 'partner-off' : 'admin-text-muted'}>{sum || '—'}</td>
            })}
          </tr>
        </tbody>
      </table>
      <p className="admin-text-muted" style={{ fontSize: 12 }}>
        Η σύγκριση με τις παραγγελίες γίνεται ανά ημέρα. Οι στόχοι ανά γεύμα είναι οδηγός.
      </p>
      <div className="admin-form-actions">
        {msg && <span className="admin-text-muted">{msg}</span>}
        <button className="admin-btn-primary" onClick={save} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση στόχων'}</button>
      </div>
    </Card>
  )
}

const PLAN_LEN: Record<string, string> = { '2w': '2 εβδομάδες', '1mo': '1 μήνας', '3mo': '3 μήνες' }
const PAY: Record<string, string> = { paid: 'Πληρωμένο', pending: 'Εκκρεμεί πληρωμή', pending_link_sent: 'Στάλθηκε link', failed: 'Απέτυχε', refunded: 'Επιστράφηκε' }

function PlanCard({ d }: { d: ClientDetail }) {
  const pl = d.plan
  return (
    <Card title="Πλάνο & πορτοφόλι">
      <div className="admin-kv"><span className="admin-kv-k">Υπόλοιπο πορτοφολιού</span><span className="admin-kv-v">{d.wallet ? eur(d.wallet.balance) : '—'}{d.wallet && !d.wallet.active ? ' (ανενεργό)' : ''}</span></div>
      {!pl ? <p className="admin-text-muted">Δεν έχει αγοράσει πλάνο. «Νέο πλάνο / συνδρομή» → επιλέξτε πληρωμή με link για να του σταλεί.</p> : (
        <>
          <div className="admin-kv"><span className="admin-kv-k">Πλάνο</span><span className="admin-kv-v">{PLAN_LEN[pl.planLength ?? ''] ?? pl.planLength ?? '—'} · {pl.daysPerWeek ?? '—'} ημέρες/εβδ.</span></div>
          <div className="admin-kv"><span className="admin-kv-k">Γεύματα</span><span className="admin-kv-v">{MEALS.filter((m) => pl.meals?.[m.key]).map((m) => m.label).join(', ') || '—'}</span></div>
          <div className="admin-kv"><span className="admin-kv-k">Θερμίδες/ημέρα</span><span className="admin-kv-v">{pl.dailyKcal ?? '—'}</span></div>
          <div className="admin-kv"><span className="admin-kv-k">Έναρξη → λήξη</span><span className="admin-kv-v">{fmtDate(pl.startDate)} → {fmtDate(pl.activeUntil)}</span></div>
          <div className="admin-kv"><span className="admin-kv-k">Ποσό</span><span className="admin-kv-v">{eur(pl.amount)} · {PAY[pl.paymentStatus] ?? pl.paymentStatus}</span></div>
        </>
      )}
    </Card>
  )
}

function AddressesCard({ d }: { d: ClientDetail }) {
  return (
    <Card title="Διευθύνσεις">
      {d.addresses.length === 0 ? <p className="admin-text-muted">Καμία αποθηκευμένη διεύθυνση.</p> : (
        <ul className="partner-list">
          {d.addresses.map((a, i) => (
            <li key={i}><strong>{a.label}</strong>{a.isDefault ? ' (κύρια)' : ''} — {a.street}{a.area ? `, ${a.area}` : ''}{a.zip ? ` ${a.zip}` : ''}</li>
          ))}
        </ul>
      )}
      <p className="admin-text-muted" style={{ fontSize: 12 }}>Αλλαγές διευθύνσεων, ωραρίων και αλλεργιών: «Λογαριασμός πελάτη».</p>
    </Card>
  )
}

// WEC-851 (hidden add-on): measurement history + weight trend.
function ProgressCard({ d, userId, onSaved }: { d: ClientDetail; userId: string; onSaved: () => void }) {
  const ms = d.measurements ?? []
  const [f, setF] = useState({ measuredOn: new Date().toISOString().slice(0, 10), weightKg: '', bodyFatPct: '', waistCm: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function add() {
    setBusy(true); setMsg(null)
    const { error } = await addMeasurement(userId, f)
    setBusy(false)
    if (error) { setMsg(`✗ ${error}`); return }
    setF((x) => ({ ...x, weightKg: '', bodyFatPct: '', waistCm: '', notes: '' }))
    onSaved()
  }
  if (!d.bodyVisible) {
    return <Card title="Πρόοδος"><p className="admin-text-muted">Χρειάζεται συγκατάθεση του πελάτη.</p></Card>
  }
  return (
    <Card title="Πρόοδος & μετρήσεις">
      <WeightChart points={ms.filter((m) => m.weightKg != null).map((m) => ({ x: m.measuredOn, y: Number(m.weightKg) }))} />
      {ms.length > 0 && (
        <table className="admin-table admin-table-compact" style={{ marginTop: 8 }}>
          <thead><tr><th>Ημ/νία</th><th>Βάρος</th><th>Λίπος %</th><th>Μέση</th><th>Σημ.</th></tr></thead>
          <tbody>
            {[...ms].reverse().map((m) => (
              <tr key={m.id}><td>{fmtDate(m.measuredOn)}</td><td>{m.weightKg ?? '—'}</td><td>{m.bodyFatPct ?? '—'}</td><td>{m.waistCm ?? '—'}</td><td>{m.notes ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="partner-form-5" style={{ marginTop: 10 }}>
        <Field label="Ημ/νία" value={f.measuredOn} onChange={upd('measuredOn')} type="date" />
        <Field label="Βάρος (kg)" value={f.weightKg} onChange={upd('weightKg')} type="number" />
        <Field label="Λίπος (%)" value={f.bodyFatPct} onChange={upd('bodyFatPct')} type="number" />
        <Field label="Μέση (cm)" value={f.waistCm} onChange={upd('waistCm')} type="number" />
        <Field label="Σημείωση" value={f.notes} onChange={upd('notes')} />
      </div>
      <div className="admin-form-actions">
        {msg && <span className="admin-text-muted">{msg}</span>}
        <button className="admin-btn-primary" onClick={add} disabled={busy || (!f.weightKg && !f.bodyFatPct && !f.waistCm)}>Προσθήκη μέτρησης</button>
      </div>
    </Card>
  )
}

function WeightChart({ points }: { points: Array<{ x: string; y: number }> }) {
  if (points.length < 2) return <p className="admin-text-muted" style={{ fontSize: 12 }}>Το γράφημα βάρους εμφανίζεται από 2 μετρήσεις και πάνω.</p>
  const W = 520, H = 140, P = 28
  const ys = points.map((p) => p.y)
  const min = Math.min(...ys) - 1, max = Math.max(...ys) + 1
  const sx = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1)
  const sy = (y: number) => H - P - ((y - min) * (H - 2 * P)) / (max - min || 1)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Εξέλιξη βάρους" className="partner-chart">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={sx(i)} cy={sy(p.y)} r="3.5" fill="currentColor" />
          <text x={sx(i)} y={sy(p.y) - 8} textAnchor="middle" fontSize="11">{p.y}</text>
          <text x={sx(i)} y={H - 8} textAnchor="middle" fontSize="10" opacity="0.6">{fmtDate(p.x).slice(0, 5)}</text>
        </g>
      ))}
    </svg>
  )
}
