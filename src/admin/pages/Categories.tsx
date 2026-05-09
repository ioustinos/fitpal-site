import { useEffect, useState } from 'react'
import {
  fetchAdminCategories, saveCategory, deleteCategory,
  type AdminCategory,
} from '../../lib/api/adminDishes'

/**
 * Standalone Categories admin page (WEC-256 polish).
 *
 * Same CRUD as the Categories modal that lives inside /admin/dishes —
 * surfaced here so the sidebar can link to it directly. The Dishes page
 * still has the "Categories" button for in-context editing; this page is
 * the shortcut from the main nav.
 */
export function Categories() {
  const [cats, setCats] = useState<AdminCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [newEl, setNewEl] = useState('')
  const [newEn, setNewEn] = useState('')

  async function refresh() {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminCategories()
    if (error) setErr(error)
    setCats(data ?? [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  async function add() {
    if (!newEl.trim()) return
    setErr(null)
    const { error } = await saveCategory({
      nameEl: newEl.trim(), nameEn: newEn.trim() || newEl.trim(),
      sortOrder: cats.length, active: true,
    })
    if (error) { setErr(error); return }
    setNewEl(''); setNewEn('')
    refresh()
  }

  async function del(c: AdminCategory) {
    setErr(null)
    const { error } = await deleteCategory(c.id)
    if (error) { setErr(error); return }
    refresh()
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Categories</h1>
          <p className="admin-page-sub">Master list of dish categories — drives the customer menu sections.</p>
        </div>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <table className="admin-table admin-table-tight">
            <thead><tr><th>Name (EL)</th><th>Name (EN)</th><th>Dishes</th><th></th></tr></thead>
            <tbody>
              {cats.map((c) => <CategoryRow key={c.id} c={c} onChanged={refresh} onDelete={() => del(c)} />)}
              {cats.length === 0 && <tr><td colSpan={4} className="admin-table-empty">No categories yet.</td></tr>}
            </tbody>
          </table>
          <div className="admin-section-head" style={{ marginTop: 20 }}><strong>Add new</strong></div>
          <div className="admin-inline-form">
            <input className="admin-input" placeholder="Name (EL)" value={newEl} onChange={(e) => setNewEl(e.target.value)} />
            <input className="admin-input" placeholder="Name (EN)" value={newEn} onChange={(e) => setNewEn(e.target.value)} />
            <button className="admin-btn-primary" onClick={add} disabled={!newEl.trim()}>Add</button>
          </div>
        </>
      )}
    </div>
  )
}

function CategoryRow({ c, onChanged, onDelete }: { c: AdminCategory; onChanged: () => void; onDelete: () => void }) {
  const [nameEl, setNameEl] = useState(c.nameEl)
  const [nameEn, setNameEn] = useState(c.nameEn)
  const [active, setActive] = useState(c.active)
  const dirty = nameEl !== c.nameEl || nameEn !== c.nameEn || active !== c.active
  async function save() {
    await saveCategory({ id: c.id, nameEl, nameEn, sortOrder: c.sortOrder, active })
    onChanged()
  }
  return (
    <tr>
      <td><input className="admin-input admin-input-tight" value={nameEl} onChange={(e) => setNameEl(e.target.value)} /></td>
      <td><input className="admin-input admin-input-tight" value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></td>
      <td style={{ color: 'var(--a-text-muted)' }}>{c.dishCount ?? 0}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <label className="admin-switch"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span /></label>
        {dirty && <button className="admin-row-btn" onClick={save}>Save</button>}
        <button className="admin-row-btn danger" onClick={onDelete}>Delete</button>
      </td>
    </tr>
  )
}
