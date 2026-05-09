import { useEffect, useState } from 'react'
import {
  fetchAdminTags, saveTag, deleteTag,
  type AdminTag, type TagPlacement,
} from '../../lib/api/adminDishes'

/**
 * Standalone Tags admin page (WEC-256 polish).
 *
 * Same CRUD as the Tags modal in /admin/dishes but accessible from the
 * sidebar directly. Includes the WEC-256 placement column so each tag
 * decides where it renders on the dish card / modal.
 */

const TAG_PLACEMENTS: Array<{ value: TagPlacement; label: string }> = [
  { value: 'top_left',     label: 'Top-left (overlay)' },
  { value: 'top_right',    label: 'Top-right (overlay, under discount)' },
  { value: 'bottom_left',  label: 'Bottom-left (overlay)' },
  { value: 'under_title',  label: 'Under title (inline chip)' },
]

export function Tags() {
  const [tags, setTags] = useState<AdminTag[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [newEl, setNewEl] = useState('')
  const [newEn, setNewEn] = useState('')
  const [newBg, setNewBg] = useState('#0a7b4a')
  const [newFg, setNewFg] = useState('#ffffff')
  // Default to under_title — most tags are descriptors (Vegan, High-Pro)
  // that read better as inline chips than as image overlays.
  const [newPlacement, setNewPlacement] = useState<TagPlacement>('under_title')

  async function refresh() {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminTags()
    if (error) setErr(error)
    setTags(data ?? [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  async function add() {
    if (!newEl.trim()) return
    setErr(null)
    const { error } = await saveTag({
      labelEl: newEl.trim(), labelEn: newEn.trim() || newEl.trim(),
      bgColor: newBg, fontColor: newFg, sortOrder: tags.length,
      placement: newPlacement,
    })
    if (error) { setErr(error); return }
    setNewEl(''); setNewEn('')
    refresh()
  }

  async function del(t: AdminTag) {
    if (!confirm(`Delete tag "${t.labelEl}"?`)) return
    setErr(null)
    const { error } = await deleteTag(t.id)
    if (error) { setErr(error); return }
    refresh()
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Tags</h1>
          <p className="admin-page-sub">Coloured chips attached to dishes — placement controls where each renders on the card.</p>
        </div>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <table className="admin-table admin-table-tight">
            <thead><tr><th>Preview</th><th>Label (EL)</th><th>Label (EN)</th><th>Bg</th><th>Fg</th><th>Placement</th><th></th></tr></thead>
            <tbody>
              {tags.map((t) => <TagRow key={t.id} t={t} onChanged={refresh} onDelete={() => del(t)} />)}
              {tags.length === 0 && <tr><td colSpan={7} className="admin-table-empty">No tags yet.</td></tr>}
            </tbody>
          </table>

          <div className="admin-section-head" style={{ marginTop: 20 }}><strong>Add new</strong></div>
          <div className="admin-inline-form">
            <input className="admin-input" placeholder="Label (EL)" value={newEl} onChange={(e) => setNewEl(e.target.value)} />
            <input className="admin-input" placeholder="Label (EN)" value={newEn} onChange={(e) => setNewEn(e.target.value)} />
            <input className="admin-input admin-color-input" type="color" value={newBg} onChange={(e) => setNewBg(e.target.value)} title="Background" />
            <input className="admin-input admin-color-input" type="color" value={newFg} onChange={(e) => setNewFg(e.target.value)} title="Font" />
            <select className="admin-select" value={newPlacement} onChange={(e) => setNewPlacement(e.target.value as TagPlacement)}>
              {TAG_PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button className="admin-btn-primary" onClick={add} disabled={!newEl.trim()}>Add</button>
          </div>
        </>
      )}
    </div>
  )
}

function TagRow({ t, onChanged, onDelete }: { t: AdminTag; onChanged: () => void; onDelete: () => void }) {
  const [labelEl, setLabelEl] = useState(t.labelEl)
  const [labelEn, setLabelEn] = useState(t.labelEn)
  const [bg, setBg] = useState(t.bgColor)
  const [fg, setFg] = useState(t.fontColor)
  const [placement, setPlacement] = useState<TagPlacement>(t.placement)
  const dirty = labelEl !== t.labelEl || labelEn !== t.labelEn || bg !== t.bgColor || fg !== t.fontColor || placement !== t.placement
  async function save() {
    await saveTag({ id: t.id, labelEl, labelEn, bgColor: bg, fontColor: fg, sortOrder: t.sortOrder, placement })
    onChanged()
  }
  return (
    <tr>
      <td><span className="admin-tag-preview" style={{ background: bg, color: fg }}>{labelEl || '—'}</span></td>
      <td><input className="admin-input admin-input-tight" value={labelEl} onChange={(e) => setLabelEl(e.target.value)} /></td>
      <td><input className="admin-input admin-input-tight" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} /></td>
      <td><input className="admin-input admin-color-input" type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></td>
      <td><input className="admin-input admin-color-input" type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></td>
      <td>
        <select className="admin-select admin-input-tight" value={placement} onChange={(e) => setPlacement(e.target.value as TagPlacement)}>
          {TAG_PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {dirty && <button className="admin-row-btn" onClick={save}>Save</button>}
        <button className="admin-row-btn danger" onClick={onDelete}>Delete</button>
      </td>
    </tr>
  )
}
