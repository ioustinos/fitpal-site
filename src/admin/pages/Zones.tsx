import { useEffect, useState } from 'react'
import {
  fetchAdminZones, createZone, saveZone, deleteZone,
  createTimeSlot, saveTimeSlot, deleteTimeSlot,
  type AdminZone, type AdminTimeSlot,
} from '../../lib/api/adminZones'

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

  // ─── Time slots ─────
  const [slotFrom, setSlotFrom] = useState('09:00')
  const [slotTo, setSlotTo] = useState('11:00')
  async function addSlot() {
    if (!slotFrom || !slotTo) return
    const { error } = await createTimeSlot(form.id, slotFrom, slotTo)
    if (error) { setErr(error); return }
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
          <TimeSlotRow key={s.id} slot={s} onChanged={onSaved} />
        ))}
        <div className="admin-inline-form" style={{ marginTop: 10 }}>
          <input className="admin-input" type="time" value={slotFrom} onChange={(e) => setSlotFrom(e.target.value)} style={{ width: 120 }} />
          <span className="admin-text-muted">to</span>
          <input className="admin-input" type="time" value={slotTo} onChange={(e) => setSlotTo(e.target.value)} style={{ width: 120 }} />
          <button className="admin-btn-ghost" onClick={addSlot}>+ Add slot</button>
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

function TimeSlotRow({ slot, onChanged }: { slot: AdminTimeSlot; onChanged: () => void }) {
  const [from, setFrom] = useState(slot.timeFrom)
  const [to, setTo] = useState(slot.timeTo)
  const [active, setActive] = useState(slot.active)
  const dirty = from !== slot.timeFrom || to !== slot.timeTo || active !== slot.active

  async function save() {
    await saveTimeSlot({ ...slot, timeFrom: from, timeTo: to, active })
    onChanged()
  }
  async function del() {
    if (!confirm('Remove this time slot?')) return
    await deleteTimeSlot(slot.id)
    onChanged()
  }
  return (
    <div className="admin-inline-form" style={{ marginBottom: 6 }}>
      <input className="admin-input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 120 }} />
      <span className="admin-text-muted">to</span>
      <input className="admin-input" type="time" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 120 }} />
      <label className="admin-switch"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span /></label>
      {dirty && <button className="admin-row-btn" onClick={save}>Save</button>}
      <button className="admin-row-btn danger" onClick={del}>Delete</button>
    </div>
  )
}
