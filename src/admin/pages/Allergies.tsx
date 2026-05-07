import { useEffect, useMemo, useState } from 'react'
import {
  fetchAllergies,
  saveAllergy,
  deleteAllergy,
  type AdminAllergy,
  type SaveAllergyInput,
} from '../../lib/api/adminAllergies'

/**
 * Admin → Allergies CRUD (WEC-247).
 *
 * Companion to /admin/ingredients — ingredients link to allergies via
 * ingredient_allergies. Admin defines allergies first, then assigns them
 * when editing each ingredient.
 *
 * Designed minimal: list + add + edit + delete. Delete is gated on usage
 * by the API; we surface the friendly count if blocked.
 */

const blank: SaveAllergyInput = { nameEl: '', nameEn: '', description: '' }

export function Allergies() {
  const [list, setList] = useState<AdminAllergy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [editing, setEditing] = useState<SaveAllergyInput | null>(null)
  const [saving, setSaving] = useState(false)

  async function refresh() {
    setLoading(true); setError(null)
    const res = await fetchAllergies()
    if (res.error) setError(res.error)
    setList(res.data ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((a) =>
      a.nameEl.toLowerCase().includes(q) ||
      (a.nameEn ?? '').toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q),
    )
  }, [list, search])

  async function handleSave() {
    if (!editing) return
    setSaving(true); setError(null)
    const res = await saveAllergy(editing)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setEditing(null)
    await refresh()
  }

  async function handleDelete(a: AdminAllergy) {
    if (!confirm(`Delete allergy "${a.nameEl}"?`)) return
    setError(null)
    const res = await deleteAllergy(a.id)
    if (res.error) { setError(res.error); return }
    await refresh()
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Allergies</h1>
          <p className="admin-page-sub">{list.length} allergies. Linked to ingredients to drive customer warnings.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-primary" onClick={() => setEditing({ ...blank })}>
            + New allergy
          </button>
        </div>
      </div>

      {error && <div className="admin-error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ marginBottom: 12 }}>
        <input
          className="admin-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name (EL)</th>
              <th>Name (EN)</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Ingredients</th>
              <th style={{ textAlign: 'right' }}>Profiles</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="admin-table-empty">Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="admin-table-empty">
                {list.length === 0 ? 'No allergies yet — add the first one to start linking from ingredients.' : 'No matches.'}
              </td></tr>
            )}
            {!loading && filtered.map((a) => (
              <tr key={a.id}>
                <td>{a.nameEl}</td>
                <td>{a.nameEn || <em style={{ color: 'var(--a-text-muted)' }}>—</em>}</td>
                <td style={{ color: 'var(--a-text-muted)', fontSize: 12 }}>
                  {a.description || <em>—</em>}
                </td>
                <td style={{ textAlign: 'right' }}>{a.ingredientCount}</td>
                <td style={{ textAlign: 'right' }}>{a.profileCount}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="admin-btn admin-btn-ghost admin-btn-sm"
                    onClick={() => setEditing({ id: a.id, nameEl: a.nameEl, nameEn: a.nameEn ?? '', description: a.description ?? '' })}
                  >Edit</button>
                  {' '}
                  <button
                    className="admin-btn admin-btn-ghost admin-btn-sm"
                    style={{ color: '#b91c1c' }}
                    onClick={() => handleDelete(a)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="admin-modal-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <header className="admin-drawer-head">
              <h2>{editing.id ? 'Edit allergy' : 'New allergy'}</h2>
              <button className="admin-drawer-close" onClick={() => !saving && setEditing(null)}>×</button>
            </header>
            <div className="admin-drawer-body">
              <div className="admin-form-row">
                <label className="admin-form-label">Name (Greek) *</label>
                <input className="admin-input" autoFocus
                  value={editing.nameEl}
                  onChange={(e) => setEditing({ ...editing, nameEl: e.target.value })}
                  placeholder="π.χ. Γλουτένη"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">Name (English)</label>
                <input className="admin-input"
                  value={editing.nameEn}
                  onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                  placeholder="e.g. Gluten"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">Description</label>
                <textarea className="admin-input" rows={3}
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Optional — shown to customers on hover or in the dish modal."
                />
              </div>
            </div>
            <footer className="admin-drawer-foot">
              <div style={{ flex: 1 }} />
              <button className="admin-btn admin-btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving || !editing.nameEl.trim()}>
                {saving ? 'Saving…' : editing.id ? 'Save' : 'Create'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
