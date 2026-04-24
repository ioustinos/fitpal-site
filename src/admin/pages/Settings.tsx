import { useEffect, useMemo, useState } from 'react'
import {
  fetchAllSettings, setSetting, fetchAllergies, saveAllergy, deleteAllergy,
  type SettingRow, type AdminAllergy,
} from '../../lib/api/adminSettings'

const DAY_NAMES_FULL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type WeekdayOverrides = Record<string, { dow: number; hour: number }>
type DateOverrides = Record<string, { cutoffDate: string; hour: number }>

type PaymentMethod = 'cash' | 'card' | 'link' | 'transfer' | 'wallet'
const ALL_PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'link', 'transfer', 'wallet']
const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash on delivery',
  card: 'Card online (Viva)',
  link: 'Payment link (sent later)',
  transfer: 'Bank transfer',
  wallet: 'Fitpal wallet',
}

interface ContactInfo {
  supportEmail?: string
  supportPhone?: string
  instagramUrl?: string
  facebookUrl?: string
}

export function Settings() {
  const [all, setAll] = useState<SettingRow[]>([])
  const [allergies, setAllergies] = useState<AdminAllergy[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [savingMsg, setSavingMsg] = useState<string | null>(null)

  async function refresh() {
    setLoading(true); setErr(null)
    const [s, a] = await Promise.all([fetchAllSettings(), fetchAllergies()])
    if (s.error) setErr(s.error)
    if (a.error) setErr(a.error)
    setAll(s.data ?? [])
    setAllergies(a.data ?? [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const byKey = useMemo(() => new Map(all.map((r) => [r.key, r.value])), [all])

  async function save(key: string, value: unknown) {
    setSavingMsg(null)
    const { error } = await setSetting(key, value)
    if (error) { setErr(error); return }
    setSavingMsg('Saved.')
    setTimeout(() => setSavingMsg(null), 1500)
    refresh()
  }

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Settings</h1>
      <p className="admin-page-sub">Typed editor over the settings table — touch nothing in SQL.</p>

      {err && <div className="admin-error-banner">{err}</div>}
      {savingMsg && <div className="admin-info-banner">{savingMsg}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <CutoffHourSection value={Number(byKey.get('cutoff_hour') ?? 18)} onSave={(v) => save('cutoff_hour', v)} />
          <WeekdayOverridesSection value={(byKey.get('cutoff_weekday_overrides') as WeekdayOverrides) ?? {}} onSave={(v) => save('cutoff_weekday_overrides', v)} />
          <DateOverridesSection value={(byKey.get('cutoff_date_overrides') as DateOverrides) ?? {}} onSave={(v) => save('cutoff_date_overrides', v)} />
          <MinOrderSection value={Number(byKey.get('min_order') ?? 1500)} onSave={(v) => save('min_order', v)} />
          <TimeSlotsSection value={(byKey.get('time_slots') as string[]) ?? []} onSave={(v) => save('time_slots', v)} />
          <PaymentMethodsSection value={(byKey.get('payment_methods_enabled') as PaymentMethod[]) ?? ALL_PAYMENT_METHODS} onSave={(v) => save('payment_methods_enabled', v)} />
          <ContactInfoSection value={(byKey.get('contact') as ContactInfo) ?? {}} onSave={(v) => save('contact', v)} />
          <AllergiesSection allergies={allergies} onChanged={refresh} />
          <RawJsonSection rows={all} onSaved={refresh} />
        </>
      )}
    </div>
  )
}

// ─── Sections ───────────────────────────────────────────────────────────────

function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="admin-setting-card">
      <div className="admin-setting-head">
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
      </div>
      <div className="admin-setting-body">{children}</div>
    </section>
  )
}

function CutoffHourSection({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [h, setH] = useState(value)
  useEffect(() => setH(value), [value])
  return (
    <SectionCard title="Default cutoff hour" desc="Hour on the previous calendar day at which ordering closes for the next-day delivery (unless an override below applies).">
      <div className="admin-inline-form">
        <input className="admin-input" type="number" min={0} max={23} value={h} onChange={(e) => setH(Math.max(0, Math.min(23, +e.target.value || 0)))} style={{ width: 110 }} />
        <span className="admin-text-muted">:00 (24-hour)</span>
        <button className="admin-btn-primary" disabled={h === value} onClick={() => onSave(h)}>Save</button>
      </div>
    </SectionCard>
  )
}

function WeekdayOverridesSection({ value, onSave }: { value: WeekdayOverrides; onSave: (v: WeekdayOverrides) => void }) {
  const [entries, setEntries] = useState(Object.entries(value).map(([k, v]) => ({ deliveryDow: +k, cutoffDow: v.dow, hour: v.hour })))
  useEffect(() => setEntries(Object.entries(value).map(([k, v]) => ({ deliveryDow: +k, cutoffDow: v.dow, hour: v.hour }))), [value])

  const dirty = JSON.stringify(entries) !== JSON.stringify(Object.entries(value).map(([k, v]) => ({ deliveryDow: +k, cutoffDow: v.dow, hour: v.hour })))

  function add() { setEntries([...entries, { deliveryDow: 1, cutoffDow: 6, hour: 18 }]) }
  function remove(i: number) { setEntries(entries.filter((_, idx) => idx !== i)) }
  function persist() {
    const obj: WeekdayOverrides = {}
    for (const e of entries) obj[String(e.deliveryDow)] = { dow: e.cutoffDow, hour: e.hour }
    onSave(obj)
  }

  return (
    <SectionCard title="Per-weekday cutoff overrides" desc="Choose a different cutoff weekday + hour for specific delivery weekdays. Example: Monday deliveries cut off Saturday 18:00.">
      {entries.length === 0 && <div className="admin-text-muted" style={{ marginBottom: 10 }}>No overrides set.</div>}
      {entries.map((e, i) => (
        <div key={i} className="admin-inline-form">
          <label className="admin-text-muted">Deliveries on</label>
          <select className="admin-select" value={e.deliveryDow} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, deliveryDow: +ev.target.value } : x))}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES_FULL[d]}</option>)}
          </select>
          <label className="admin-text-muted">close at</label>
          <select className="admin-select" value={e.cutoffDow} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, cutoffDow: +ev.target.value } : x))}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES_FULL[d]}</option>)}
          </select>
          <input className="admin-input" type="number" min={0} max={23} value={e.hour} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, hour: Math.max(0, Math.min(23, +ev.target.value || 0)) } : x))} style={{ width: 90 }} />
          <span className="admin-text-muted">:00</span>
          <button className="admin-row-btn danger" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 8 }}>
        <button className="admin-btn-ghost" onClick={add}>+ Add override</button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={persist}>Save all</button>
      </div>
    </SectionCard>
  )
}

function DateOverridesSection({ value, onSave }: { value: DateOverrides; onSave: (v: DateOverrides) => void }) {
  const [entries, setEntries] = useState(Object.entries(value).map(([k, v]) => ({ deliveryDate: k, cutoffDate: v.cutoffDate, hour: v.hour })))
  useEffect(() => setEntries(Object.entries(value).map(([k, v]) => ({ deliveryDate: k, cutoffDate: v.cutoffDate, hour: v.hour }))), [value])

  const dirty = JSON.stringify(entries) !== JSON.stringify(Object.entries(value).map(([k, v]) => ({ deliveryDate: k, cutoffDate: v.cutoffDate, hour: v.hour })))

  function add() {
    const today = new Date().toISOString().slice(0, 10)
    const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    setEntries([...entries, { deliveryDate: today, cutoffDate: yday, hour: 18 }])
  }
  function remove(i: number) { setEntries(entries.filter((_, idx) => idx !== i)) }
  function persist() {
    const obj: DateOverrides = {}
    for (const e of entries) {
      if (!e.deliveryDate || !e.cutoffDate) continue
      obj[e.deliveryDate] = { cutoffDate: e.cutoffDate, hour: e.hour }
    }
    onSave(obj)
  }

  return (
    <SectionCard title="Per-date cutoff overrides (holidays)" desc="Keys are the delivery date. Example: Christmas Day delivery → cutoff closes 23 Dec 18:00.">
      {entries.length === 0 && <div className="admin-text-muted" style={{ marginBottom: 10 }}>No date overrides set.</div>}
      {entries.map((e, i) => (
        <div key={i} className="admin-inline-form">
          <label className="admin-text-muted">Delivery on</label>
          <input className="admin-input" type="date" value={e.deliveryDate} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, deliveryDate: ev.target.value } : x))} />
          <label className="admin-text-muted">closes</label>
          <input className="admin-input" type="date" value={e.cutoffDate} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, cutoffDate: ev.target.value } : x))} />
          <label className="admin-text-muted">at</label>
          <input className="admin-input" type="number" min={0} max={23} value={e.hour} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, hour: Math.max(0, Math.min(23, +ev.target.value || 0)) } : x))} style={{ width: 80 }} />
          <span className="admin-text-muted">:00</span>
          <button className="admin-row-btn danger" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 8 }}>
        <button className="admin-btn-ghost" onClick={add}>+ Add override</button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={persist}>Save all</button>
      </div>
    </SectionCard>
  )
}

function MinOrderSection({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const euros = (v / 100).toFixed(2)
  return (
    <SectionCard title="Minimum order per day" desc="Applies to every child order. A zone-specific override in Delivery zones can raise this per zone.">
      <div className="admin-inline-form">
        <span>€</span>
        <input
          className="admin-input" type="number" step="0.50" min={0}
          value={euros}
          onChange={(e) => setV(Math.round((+e.target.value || 0) * 100))}
          style={{ width: 120 }}
        />
        <span className="admin-text-muted">({v} cents)</span>
        <button className="admin-btn-primary" disabled={v === value} onClick={() => onSave(v)}>Save</button>
      </div>
    </SectionCard>
  )
}

function TimeSlotsSection({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const [slots, setSlots] = useState(value)
  useEffect(() => setSlots(value), [value])
  const dirty = JSON.stringify(slots) !== JSON.stringify(value)
  return (
    <SectionCard title="Default delivery time windows" desc='Format "HH:MM-HH:MM". Shown to customers at checkout unless a zone overrides them.'>
      {slots.map((s, i) => (
        <div key={i} className="admin-inline-form">
          <input className="admin-input" value={s} onChange={(e) => setSlots(slots.map((x, j) => j === i ? e.target.value : x))} placeholder="09:00-11:00" style={{ width: 160 }} />
          <button className="admin-row-btn danger" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 8 }}>
        <button className="admin-btn-ghost" onClick={() => setSlots([...slots, ''])}>+ Add slot</button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={() => onSave(slots.filter(Boolean))}>Save all</button>
      </div>
    </SectionCard>
  )
}

function PaymentMethodsSection({ value, onSave }: { value: PaymentMethod[]; onSave: (v: PaymentMethod[]) => void }) {
  const [enabled, setEnabled] = useState<PaymentMethod[]>(value)
  useEffect(() => setEnabled(value), [value])
  const dirty = JSON.stringify(enabled.slice().sort()) !== JSON.stringify(value.slice().sort())

  function toggle(m: PaymentMethod) {
    setEnabled(enabled.includes(m) ? enabled.filter((x) => x !== m) : [...enabled, m])
  }

  return (
    <SectionCard title="Enabled payment methods" desc="Methods offered to customers at checkout. At least one must stay enabled.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ALL_PAYMENT_METHODS.map((m) => (
          <label key={m} className="admin-form-checkbox" style={{ gap: 10 }}>
            <input type="checkbox" checked={enabled.includes(m)} onChange={() => toggle(m)} />
            <span><strong>{PAYMENT_METHOD_LABELS[m]}</strong> <code style={{ color: 'var(--a-text-muted)', fontSize: 11 }}>{m}</code></span>
          </label>
        ))}
      </div>
      <div className="admin-inline-form" style={{ marginTop: 12 }}>
        <button className="admin-btn-primary" disabled={!dirty || enabled.length === 0} onClick={() => onSave(enabled)}>
          Save
        </button>
        {enabled.length === 0 && <span className="admin-text-muted">Enable at least one method.</span>}
      </div>
    </SectionCard>
  )
}

function ContactInfoSection({ value, onSave }: { value: ContactInfo; onSave: (v: ContactInfo) => void }) {
  const [form, setForm] = useState<ContactInfo>(value)
  useEffect(() => setForm(value), [value])
  const dirty = JSON.stringify(form) !== JSON.stringify(value)

  function patch<K extends keyof ContactInfo>(k: K, v: ContactInfo[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  return (
    <SectionCard title="Contact & social" desc="Customer-facing — appears in the footer and order emails.">
      <div className="admin-grid-2">
        <div>
          <label className="admin-form-label">Support email</label>
          <input className="admin-input" type="email" value={form.supportEmail ?? ''} onChange={(e) => patch('supportEmail', e.target.value)} placeholder="hello@fitpal.gr" />
        </div>
        <div>
          <label className="admin-form-label">Support phone</label>
          <input className="admin-input" type="tel" value={form.supportPhone ?? ''} onChange={(e) => patch('supportPhone', e.target.value)} placeholder="+30 210 …" />
        </div>
        <div>
          <label className="admin-form-label">Instagram URL</label>
          <input className="admin-input" type="url" value={form.instagramUrl ?? ''} onChange={(e) => patch('instagramUrl', e.target.value)} placeholder="https://instagram.com/…" />
        </div>
        <div>
          <label className="admin-form-label">Facebook URL</label>
          <input className="admin-input" type="url" value={form.facebookUrl ?? ''} onChange={(e) => patch('facebookUrl', e.target.value)} placeholder="https://facebook.com/…" />
        </div>
      </div>
      <div className="admin-inline-form" style={{ marginTop: 12 }}>
        <button className="admin-btn-primary" disabled={!dirty} onClick={() => onSave(form)}>Save</button>
      </div>
    </SectionCard>
  )
}

function AllergiesSection({ allergies, onChanged }: { allergies: AdminAllergy[]; onChanged: () => void }) {
  const [el, setEl] = useState('')
  const [en, setEn] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    if (!el.trim()) return
    setErr(null)
    const { error } = await saveAllergy({ nameEl: el.trim(), nameEn: en.trim() || el.trim(), description: desc.trim() || null })
    if (error) { setErr(error); return }
    setEl(''); setEn(''); setDesc(''); onChanged()
  }

  return (
    <SectionCard title="Allergies" desc="Master list shown in user preferences. Keep it short and unambiguous.">
      {err && <div className="admin-error-banner">{err}</div>}
      <table className="admin-table admin-table-tight">
        <thead><tr><th>Greek</th><th>English</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {allergies.map((a) => <AllergyRow key={a.id} a={a} onChanged={onChanged} />)}
          {allergies.length === 0 && <tr><td colSpan={4} className="admin-table-empty">No allergies yet.</td></tr>}
        </tbody>
      </table>
      <div className="admin-section-head" style={{ marginTop: 12 }}><strong>Add new</strong></div>
      <div className="admin-inline-form">
        <input className="admin-input" placeholder="Greek" value={el} onChange={(e) => setEl(e.target.value)} />
        <input className="admin-input" placeholder="English" value={en} onChange={(e) => setEn(e.target.value)} />
        <input className="admin-input" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="admin-btn-primary" onClick={add} disabled={!el.trim()}>Add</button>
      </div>
    </SectionCard>
  )
}

function AllergyRow({ a, onChanged }: { a: AdminAllergy; onChanged: () => void }) {
  const [nameEl, setNameEl] = useState(a.nameEl)
  const [nameEn, setNameEn] = useState(a.nameEn)
  const [desc, setDesc] = useState(a.description ?? '')
  const dirty = nameEl !== a.nameEl || nameEn !== a.nameEn || (desc || null) !== a.description
  async function save() { await saveAllergy({ id: a.id, nameEl, nameEn, description: desc || null }); onChanged() }
  async function del() { if (confirm(`Delete "${a.nameEl}"?`)) { await deleteAllergy(a.id); onChanged() } }
  return (
    <tr>
      <td><input className="admin-input admin-input-tight" value={nameEl} onChange={(e) => setNameEl(e.target.value)} /></td>
      <td><input className="admin-input admin-input-tight" value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></td>
      <td><input className="admin-input admin-input-tight" value={desc} onChange={(e) => setDesc(e.target.value)} /></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {dirty && <button className="admin-row-btn" onClick={save}>Save</button>}
        <button className="admin-row-btn danger" onClick={del}>Delete</button>
      </td>
    </tr>
  )
}

function RawJsonSection({ rows, onSaved }: { rows: SettingRow[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function startEdit(r: SettingRow) {
    setEditing(r.key)
    setText(JSON.stringify(r.value, null, 2))
    setErr(null)
  }

  async function save() {
    if (!editing) return
    try {
      const parsed = JSON.parse(text)
      const { error } = await setSetting(editing, parsed)
      if (error) { setErr(error); return }
      setEditing(null); onSaved()
    } catch { setErr('Invalid JSON.') }
  }

  return (
    <SectionCard title="Raw settings (escape hatch)" desc="For keys the typed editor doesn't cover — edit the JSON directly. Mind the shape.">
      <button className="admin-btn-ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} all {rows.length} keys</button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <table className="admin-table admin-table-tight">
            <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><code>{r.key}</code></td>
                  <td><code style={{ fontSize: 12 }}>{JSON.stringify(r.value).slice(0, 80)}</code></td>
                  <td><button className="admin-row-btn" onClick={() => startEdit(r)}>Edit JSON</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <div className="admin-modal-overlay" onClick={() => setEditing(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <header className="admin-drawer-head">
              <h2>Edit raw: <code>{editing}</code></h2>
              <button className="admin-drawer-close" onClick={() => setEditing(null)}>×</button>
            </header>
            <div className="admin-drawer-body">
              {err && <div className="admin-error-banner">{err}</div>}
              <textarea className="admin-input admin-textarea" rows={16} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13 }} />
            </div>
            <footer className="admin-drawer-foot">
              <div style={{ flex: 1 }} />
              <button className="admin-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="admin-btn-primary" onClick={save}>Save JSON</button>
            </footer>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
