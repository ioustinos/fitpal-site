import { useEffect, useMemo, useState } from 'react'
import { fetchAdminDishes, fetchAdminCategories, type AdminDish, type AdminCategory } from '../../lib/api/adminDishes'
import { fetchDemoDishIds, DEMO_DISH_IDS_KEY } from '../../lib/api/demoDishes'
import { setSetting } from '../../lib/api/adminSettings'
import { thumbUrl } from '../../lib/imageThumb'
import { foldGreek } from '../../lib/text'

/**
 * WEC-582: "Demo Dishes Selection".
 *
 * Curates the small set of dishes shown in the subscription-wizard showcase
 * popup. Stored as a plain id list in `settings.demo_dish_ids` (no per-dish
 * column, no extra table). Toggles are local until Save, which writes the
 * setting once. Saved order is deterministic (category sort → dish order),
 * independent of the click sequence, and drives the popup's in-category order.
 *
 * Soft guidance: the popup carousel shows ~5 cards comfortably, so a per-
 * category count warns above 5 (not a hard limit — extra cards just scroll).
 */
const SOFT_MAX_PER_CAT = 5

export function DemoDishes() {
  const [dishes, setDishes] = useState<AdminDish[]>([])
  const [cats, setCats] = useState<AdminCategory[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initial, setInitial] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState(false)
  const [search, setSearch] = useState('')

  async function refresh() {
    setLoading(true); setErr(null)
    const [dRes, cRes, idRes] = await Promise.all([
      fetchAdminDishes(),
      fetchAdminCategories(),
      fetchDemoDishIds(),
    ])
    if (dRes.error) setErr(dRes.error)
    else if (cRes.error) setErr(cRes.error)
    else if (idRes.error) setErr(idRes.error)
    setDishes(dRes.data ?? [])
    setCats(cRes.data ?? [])
    const sel = new Set(idRes.data ?? [])
    setSelected(sel)
    setInitial(new Set(sel))
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  function toggle(id: string) {
    setSavedNote(false)
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Active dishes grouped by category in global sort order; search-filtered.
  const groups = useMemo(() => {
    const q = foldGreek(search.trim())
    const activeDishes = dishes.filter((d) => d.active)
    const byCat = new Map<string, AdminDish[]>()
    for (const d of activeDishes) {
      if (q && !foldGreek(`${d.nameEl} ${d.nameEn}`).includes(q)) continue
      const arr = byCat.get(d.categoryId) ?? []
      arr.push(d)
      byCat.set(d.categoryId, arr)
    }
    const orderedCats = [...cats].sort((a, b) => a.sortOrder - b.sortOrder)
    return orderedCats
      .map((c) => ({ cat: c, dishes: byCat.get(c.id) ?? [] }))
      .filter((g) => g.dishes.length > 0)
  }, [dishes, cats, search])

  // Deterministic saved order: walk categories in sort order, dishes as listed,
  // keep the selected ones. Independent of click sequence.
  function buildSavedIds(sel: Set<string>): string[] {
    const orderedCats = [...cats].sort((a, b) => a.sortOrder - b.sortOrder)
    const byCat = new Map<string, AdminDish[]>()
    for (const d of dishes) {
      const arr = byCat.get(d.categoryId) ?? []
      arr.push(d)
      byCat.set(d.categoryId, arr)
    }
    const out: string[] = []
    for (const c of orderedCats) {
      for (const d of byCat.get(c.id) ?? []) if (sel.has(d.id)) out.push(d.id)
    }
    // Any selected id whose dish isn't in the current list (e.g. deactivated)
    // is still preserved so it isn't silently dropped.
    for (const id of sel) if (!out.includes(id)) out.push(id)
    return out
  }

  async function save() {
    setSaving(true); setErr(null); setSavedNote(false)
    const { error } = await setSetting(DEMO_DISH_IDS_KEY, buildSavedIds(selected))
    if (error) { setErr(error); setSaving(false); return }
    setInitial(new Set(selected))
    setSaving(false); setSavedNote(true)
  }

  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true
    for (const id of selected) if (!initial.has(id)) return true
    return false
  }, [selected, initial])

  const totalSelected = selected.size

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Demo Dishes Selection</h1>
          <p className="admin-page-sub">
            {totalSelected} dish{totalSelected === 1 ? '' : 'es'} shown in the subscription-wizard showcase popup.
          </p>
        </div>
        <button className="admin-btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      {savedNote && <div className="admin-ok-banner">Saved. The wizard popup updates on next open.</div>}
      {err && <div className="admin-error-banner">{err}</div>}

      <div className="admin-toolbar">
        <input
          className="admin-input"
          type="search"
          placeholder="Search dishes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>

      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && groups.map(({ cat, dishes: catDishes }) => {
        const count = catDishes.filter((d) => selected.has(d.id)).length
        // count across ALL selected in this category (not just filtered view)
        const totalInCat = dishes.filter((d) => d.categoryId === cat.id && selected.has(d.id)).length
        return (
          <section key={cat.id} className="admin-demo-cat">
            <div className="admin-demo-cat-head">
              <h2>{cat.nameEl}{cat.nameEn ? ` · ${cat.nameEn}` : ''}</h2>
              <span className={`admin-demo-count${totalInCat > SOFT_MAX_PER_CAT ? ' over' : ''}`}>
                {totalInCat} selected
                {totalInCat > SOFT_MAX_PER_CAT && ' — carousel shows ~5 comfortably'}
              </span>
            </div>
            <div className="admin-demo-grid">
              {catDishes.map((d) => {
                const on = selected.has(d.id)
                return (
                  <label key={d.id} className={`admin-demo-card${on ? ' on' : ''}`}>
                    <div className="admin-demo-card-img">
                      {d.imageUrl
                        ? <img src={thumbUrl(d.imageUrl, 120)} alt="" width={44} height={44} loading="lazy" decoding="async" />
                        : <div className="admin-demo-card-noimg" />}
                    </div>
                    <div className="admin-demo-card-name">{d.nameEl || d.nameEn}</div>
                    <span className="admin-switch">
                      <input type="checkbox" checked={on} onChange={() => toggle(d.id)} />
                      <span />
                    </span>
                  </label>
                )
              })}
            </div>
            {/* count is derived above; keep the filtered-count var meaningful */}
            {search && count !== totalInCat && (
              <p className="admin-demo-hint">{count} shown match the search.</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
