import { useEffect, useMemo, useState } from 'react'
import {
  fetchIngredients,
  saveIngredient,
  deleteIngredient,
  searchKey,
  type AdminIngredient,
  type SaveIngredientInput,
} from '../../lib/api/adminIngredients'
import { fetchAllergies, type AdminAllergy } from '../../lib/api/adminAllergies'

/**
 * Admin → Ingredients catalog CRUD (WEC-248).
 *
 * Source of truth for the ingredients dictionary. Each row links to N
 * allergies (multi-select in the editor) and gets referenced by N dishes
 * via dish_ingredients (count shown in table).
 */

const blank: SaveIngredientInput = {
  nameEl: '',
  nameEn: '',
  defaultGrams: null,
  active: true,
  allergyIds: [],
}

export function Ingredients() {
  const [list, setList] = useState<AdminIngredient[]>([])
  const [allergies, setAllergies] = useState<AdminAllergy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [editing, setEditing] = useState<SaveIngredientInput | null>(null)
  const [saving, setSaving] = useState(false)

  async function refresh() {
    setLoading(true); setError(null)
    const [iRes, aRes] = await Promise.all([fetchIngredients(), fetchAllergies()])
    if (iRes.error) setError(iRes.error)
    if (aRes.error) setError((e) => e ?? aRes.error)
    setList(iRes.data ?? [])
    setAllergies(aRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const allergyById = useMemo(() => {
    const m = new Map<string, AdminAllergy>()
    for (const a of allergies) m.set(a.id, a)
    return m
  }, [allergies])

  const filtered = useMemo(() => {
    let l = list
    if (!showInactive) l = l.filter((i) => i.active)
    const q = searchKey(search.trim())
    if (q) l = l.filter((i) => i.searchKey.includes(q) || (i.nameEn ?? '').toLowerCase().includes(search.toLowerCase()))
    return l
  }, [list, search, showInactive])

  async function handleSave() {
    if (!editing) return
    setSaving(true); setError(null)
    const res = await saveIngredient(editing)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setEditing(null)
    await refresh()
  }

  async function handleDelete(i: AdminIngredient) {
    if (!confirm(`Delete ingredient "${i.nameEl}"?`)) return
    setError(null)
    const res = await deleteIngredient(i.id)
    if (res.error) { setError(res.error); return }
    await refresh()
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Ingredients</h1>
          <p className="admin-page-sub">{list.length} ingredients in the catalog. Linked allergies drive customer warnings.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-primary" onClick={() => setEditing({ ...blank })}>
            + New ingredient
          </button>
        </div>
      </div>

      {error && <div className="admin-error-banner" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <input
          className="admin-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name (EL)</th>
              <th>Name (EN)</th>
              <th style={{ textAlign: 'right' }}>Default γρ</th>
              <th>Allergies</th>
              <th style={{ textAlign: 'right' }}>Dishes</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="admin-table-empty">Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="admin-table-empty">
                {list.length === 0 ? 'No ingredients yet — add one or run the menu CSV import.' : 'No matches.'}
              </td></tr>
            )}
            {!loading && filtered.map((i) => (
              <tr key={i.id} style={{ opacity: i.active ? 1 : 0.5 }}>
                <td>{i.nameEl}</td>
                <td>{i.nameEn || <em style={{ color: 'var(--a-text-muted)' }}>—</em>}</td>
                <td style={{ textAlign: 'right', color: 'var(--a-text-muted)' }}>
                  {i.defaultGrams != null ? i.defaultGrams : '—'}
                </td>
                <td>
                  {i.allergyIds.length === 0 && <em style={{ color: 'var(--a-text-muted)' }}>—</em>}
                  {i.allergyIds.map((aid) => {
                    const a = allergyById.get(aid)
                    if (!a) return null
                    return (
                      <span key={aid} className="admin-pill" style={{ marginRight: 4, fontSize: 11 }}>
                        {a.nameEl}
                      </span>
                    )
                  })}
                </td>
                <td style={{ textAlign: 'right' }}>{i.dishCount}</td>
                <td>{i.active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="admin-btn admin-btn-ghost admin-btn-sm"
                    onClick={() => setEditing({
                      id: i.id,
                      nameEl: i.nameEl,
                      nameEn: i.nameEn ?? '',
                      defaultGrams: i.defaultGrams,
                      active: i.active,
                      allergyIds: [...i.allergyIds],
                    })}
                  >Edit</button>
                  {' '}
                  <button
                    className="admin-btn admin-btn-ghost admin-btn-sm"
                    style={{ color: '#b91c1c' }}
                    onClick={() => handleDelete(i)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="admin-modal-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <header className="admin-drawer-head">
              <h2>{editing.id ? 'Edit ingredient' : 'New ingredient'}</h2>
              <button className="admin-drawer-close" onClick={() => !saving && setEditing(null)}>×</button>
            </header>
            <div className="admin-drawer-body">
              <div className="admin-form-row">
                <label className="admin-form-label">Name (Greek) *</label>
                <input className="admin-input" autoFocus
                  value={editing.nameEl}
                  onChange={(e) => setEditing({ ...editing, nameEl: e.target.value })}
                  placeholder="π.χ. Φιλέτο κοτόπουλο"
                />
                {editing.nameEl && (
                  <small style={{ color: 'var(--a-text-muted)', fontSize: 11 }}>
                    Search key: <code>{searchKey(editing.nameEl)}</code>
                  </small>
                )}
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">Name (English)</label>
                <input className="admin-input"
                  value={editing.nameEn}
                  onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                  placeholder="e.g. Chicken fillet"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">Default grams (optional)</label>
                <input className="admin-input" type="number" min={0} step="0.5"
                  value={editing.defaultGrams ?? ''}
                  onChange={(e) => setEditing({ ...editing, defaultGrams: e.target.value === '' ? null : Number(e.target.value) })}
                  placeholder="e.g. 100"
                />
                <small style={{ color: 'var(--a-text-muted)', fontSize: 11 }}>
                  UI default for the dish recipe editor — actual amounts live on each dish.
                </small>
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">Allergies</label>
                {allergies.length === 0 && (
                  <em style={{ color: 'var(--a-text-muted)', fontSize: 12 }}>
                    No allergies yet. Add some in /admin/allergies.
                  </em>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {allergies.map((a) => {
                    const checked = editing.allergyIds.includes(a.id)
                    return (
                      <label
                        key={a.id}
                        className={`admin-pill${checked ? ' on' : ''}`}
                        style={{ cursor: 'pointer', fontSize: 12, fontWeight: checked ? 700 : 500 }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...editing.allergyIds, a.id]
                              : editing.allergyIds.filter((x) => x !== a.id)
                            setEditing({ ...editing, allergyIds: next })
                          }}
                          style={{ display: 'none' }}
                        />
                        {a.nameEl}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="admin-form-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={editing.active}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  />
                  Active
                </label>
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
