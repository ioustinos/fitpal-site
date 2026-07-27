import { useEffect, useState } from 'react'
import {
  fetchAdminZones, createZone, saveZone, deleteZone,
  createTimeSlot, saveTimeSlot, deleteTimeSlot,
  fetchTimeSlotCatalog, friendlyTimeSlotError,
  type AdminZone, type AdminTimeSlot, type SlotWindow,
} from '../../lib/api/adminZones'

// WEC-568: normalize a stored time ('HH:MM' or 'HH:MM:SS') to 'HH:MM' so it
// matches the catalog window keys.
const hhmm = (t: string) => t.slice(0, 5)
const winKey = (from: string, to: string) => `${hhmm(from)}-${hhmm(to)}`

export function Zones() {
  const [zones, setZones] = useState<AdminZone[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [newEl, setNewEl] = useState('')

  async function refresh(keepId?: string | null) {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminZones()
    if (error) setErr(error)
    setZones(data ?? [])
    if (keepId !== undefined) setSelectedId(keepId)
    else if (!selectedId && (data?.length ?? 0) > 0) setSelectedId(data![0].id)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const selected = zones.find((z) => z.id === selectedId) ?? null

  async function handleCreate() {
    if (!newEl.trim()) return
    setErr(null)
    const { data, error } = await createZone({ nameEl: newEl.trim(), nameEn: newEl.trim() })
    if (error) { setErr(error); return }
    setNewEl('')
    await refresh(data?.id ?? null)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Delivery zones</h1>
          <p className="admin-page-sub">{zones.length} zones configured.</p>
        </div>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <div className="admin-zones-layout">
          <aside className="admin-zones-list">
            {zones.length === 0 && <div className="admin-text-muted" style={{ padding: 14 }}>No zones yet.</div>}
            {zones.map((z) => (
              <button
                key={z.id}
                className={`admin-zone-item${selectedId === z.id ? ' selected' : ''}${!z.active ? ' inactive' : ''}`}
                onClick={() => setSelectedId(z.id)}
              >
                <div className="admin-zone-item-name">{z.nameEl}</div>
                <div className="admin-zone-item-meta">
                  {z.postcodes.length} codes · {z.timeSlots.length} slots
                  {!z.active && <> · <em>inactive</em></>}
                </div>
              </button>
            ))}
            <div className="admin-inline-form" style={{ padding: 10 }}>
              <input className="admin-input" placeholder="New zone name (EL)" value={newEl} onChange={(e) => setNewEl(e.target.value)} />
              <button className="admin-btn-primary" onClick={handleCreate} disabled={!newEl.trim()}>+ Add</button>
            </div>
          </aside>

          <div className="admin-zones-editor">
            {selected ? (
              <ZoneEditor
                zone={selected}
                onSaved={() => refresh(selected.id)}
                onDeleted={() => refresh(null)}
              />
            ) : (
              <div className="admin-text-muted" style={{ padding: 40, textAlign: 'center' }}>
                Pick a zone to edit, or create a new one.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ZoneEditor({ zone, onSaved, onDeleted }: { zone: AdminZone; onSaved: () => void; onDeleted: () => void }) {
  const [form, setForm] = useState<AdminZone>(zone)
  const [pcInput, setPcInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setForm(zone) }, [zone])

  function patch<K extends keyof AdminZone>(k: K, v: AdminZone[K]) { setForm((f) => ({ ...f, [k]: v })) }

  function addPostcode() {
    const raw = pcInput.trim()
    if (!raw) return
    // Support comma or newline separated bulk paste
    const parts = raw.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean)
    const next = Array.from(new Set([...form.postcodes, ...parts]))
    patch('postcodes', next)
    setPcInput('')
  }
  function removePostcode(pc: string) {
    patch('postcodes', form.postcodes.filter((p) => p !== pc))
  }

  async function handleSave() {
    setSaving(true); setErr(null)
    const { error } = await saveZone(form)
    setSaving(false)
    if (error) { setErr(error); return }
    onSaved()
  }

  async function handleDelete() {
    if (!confirm(`Delete zone "${form.nameEl}"? All its time slots will be removed.`)) return
    setSaving(true); setErr(null)
    const { error } = await deleteZone(form.id)
    setSaving(false)
    if (error) { setErr(error); return }
    onDeleted()
  }

  // ─── Time slots (WEC-568: dropdown of canonical windows, no free time input) ─
  const [catalog, setCatalog] = useState<SlotWindow[]>([])
  const [newWin, setNewWin] = useState('')
  useEffect(() => {
    fetchTimeSlotCatalog().then(({ windows }) => {
      setCatalog(windows)
      setNewWin((prev) => prev || (windows[0] ? winKey(windows[0].from, windows[0].to) : ''))
    })
  }, [])

  async function addSlot() {
    const win = catalog.find((w) => winKey(w.from, w.to) === newWin)
    if (!win) return
    // WEC-568: block duplicate identical windows on the same zone (the old
    // default-row + retry pattern created dupes).
    if (form.timeSlots.some((s) => winKey(s.timeFrom, s.timeTo) === newWin)) {
      setErr('Αυτό το παράθυρο υπάρχει ήδη σε αυτή τη ζώνη / This window already exists on this zone')
      return
    }
    setErr(null)
    const { error } = await createTimeSlot(form.id, win.from, win.to)
    if (error) { setErr(friendlyTimeSlotError(error)); return }
    onSaved()
  }

  return (
    <div className="admin-zone-form">
      {err && <div className="admin-error-banner">{err}</div>}

      <section className="admin-form-section admin-grid-2">
        <div>
          <label className="admin-form-label">Name (EL)</label>
          <input className="admin-input" value={form.nameEl} onChange={(e) => patch('nameEl', e.target.value)} />
        </div>
        <div>
          <label className="admin-form-label">Name (EN)</label>
          <input className="admin-input" value={form.nameEn} onChange={(e) => patch('nameEn', e.target.value)} />
        </div>
        <div>
          <label className="admin-form-label">Min order override (€)</label>
          <input
            className="admin-input" type="number" min={0} step="0.5"
            value={form.minOrderAmount == null ? '' : (form.minOrderAmount / 100).toFixed(2)}
            placeholder="(use global)"
            onChange={(e) => patch('minOrderAmount', e.target.value === '' ? null : Math.round((+e.target.value || 0) * 100))}
          />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <label className="admin-form-checkbox">
            <input type="checkbox" checked={form.active} onChange={(e) => patch('active', e.target.checked)} />
            <span>Active (customers can order)</span>
          </label>
        </div>
      </section>

      <section className="admin-form-section">
        <label className="admin-form-label">Postcodes</label>
        <div className="admin-chip-wrap" style={{ marginBottom: 10 }}>
          {form.postcodes.length === 0 && <span className="admin-text-muted">No postcodes.</span>}
          {form.postcodes.map((pc) => (
            <span key={pc} className="admin-pc-chip">
              {pc}
              <button onClick={() => removePostcode(pc)} title="Remove">×</button>
            </span>
          ))}
        </div>
        <div className="admin-inline-form">
          <input
            className="admin-input" placeholder="11251, 11252 (paste comma or newline separated)"
            value={pcInput} onChange={(e) => setPcInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPostcode() } }}
          />
          <button className="admin-btn-ghost" onClick={addPostcode} disabled={!pcInput.trim()}>+ Add</button>
        </div>
      </section>

      <section className="admin-form-section">
        <div className="admin-section-head">
          <label className="admin-form-label">Time slots for this zone</label>
        </div>
        {form.timeSlots.length === 0 && <div className="admin-text-muted" style={{ marginBottom: 10 }}>No time slots yet — customers won't see delivery options for this zone.</div>}
        {form.timeSlots.map((s) => (
          <TimeSlotRow key={s.id} slot={s} catalog={catalog} onChanged={onSaved} onError={(m) => setErr(m)} />
        ))}
        <div className="admin-inline-form" style={{ marginTop: 10 }}>
          {/* WEC-568: pick a canonical window — no free time input (AM/PM trap). */}
          <select className="admin-select" value={newWin} onChange={(e) => setNewWin(e.target.value)} style={{ width: 160 }}>
            {catalog.length === 0 && <option value="">(loading…)</option>}
            {catalog.map((w) => {
              const k = winKey(w.from, w.to)
              return <option key={k} value={k}>{w.label}</option>
            })}
          </select>
          <button className="admin-btn-ghost" onClick={addSlot} disabled={!newWin}>+ Add slot</button>
        </div>
      </section>

      <div className="admin-zone-actions">
        <button className="admin-btn-danger" disabled={saving} onClick={handleDelete}>Delete zone</button>
        <div style={{ flex: 1 }} />
        <button className="admin-btn-primary" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function TimeSlotRow({ slot, catalog, onChanged, onError }: { slot: AdminTimeSlot; catalog: SlotWindow[]; onChanged: () => void; onError: (m: string) => void }) {
  // WEC-568: the slot's window is chosen from the canonical catalog — no free
  // time input. `win` is the "HH:MM-HH:MM" key; from/to are derived on save.
  const [win, setWin] = useState(winKey(slot.timeFrom, slot.timeTo))
  const [active, setActive] = useState(slot.active)
  const dirty = win !== winKey(slot.timeFrom, slot.timeTo) || active !== slot.active

  // A legacy/nonstandard slot may not be in the catalog — surface it so the row
  // still shows a value and the admin can re-pick a standard window.
  const inCatalog = catalog.some((w) => winKey(w.from, w.to) === win)

  async function save() {
    const w = catalog.find((c) => winKey(c.from, c.to) === win)
    const from = w ? w.from : slot.timeFrom
    const to = w ? w.to : slot.timeTo
    const { error } = await saveTimeSlot({ ...slot, timeFrom: from, timeTo: to, active })
    if (error) { onError(friendlyTimeSlotError(error)); return }
    onChanged()
  }
  async function del() {
    if (!confirm('Remove this time slot?')) return
    const { error } = await deleteTimeSlot(slot.id)
    if (error) { onError(friendlyTimeSlotError(error)); return }
    onChanged()
  }
  return (
    <div className="admin-inline-form" style={{ marginBottom: 6 }}>
      <select className="admin-select" value={win} onChange={(e) => setWin(e.target.value)} style={{ width: 160 }}>
        {!inCatalog && <option value={win}>{winKey(slot.timeFrom, slot.timeTo).replace('-', '–')} (legacy)</option>}
        {catalog.map((w) => {
          const k = winKey(w.from, w.to)
          return <option key={k} value={k}>{w.label}</option>
        })}
      </select>
      <label className="admin-switch"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span /></label>
      {dirty && <button className="admin-row-btn" onClick={save}>Save</button>}
      <button className="admin-row-btn danger" onClick={del}>Delete</button>
    </div>
  )
}
