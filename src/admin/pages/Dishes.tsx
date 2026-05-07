import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchAdminDishes,
  fetchAdminCategories,
  fetchAdminTags,
  saveDish,
  saveDishRecipe,
  deleteDish,
  toggleDishActive,
  saveCategory,
  deleteCategory,
  saveTag,
  deleteTag,
  uploadDishImage,
  type AdminDish,
  type AdminVariant,
  type AdminCategory,
  type AdminTag,
} from '../../lib/api/adminDishes'
import { fetchDishRecipe } from '../../lib/api/dishRecipe'
import { DishRecipeEditor, type RecipeRow } from '../components/DishRecipeEditor'
import { supabase } from '../../lib/supabase'
import { parseIngredientList } from '../../lib/menu-csv/parse'

type LangTab = 'el' | 'en'

export function Dishes() {
  const [dishes, setDishes] = useState<AdminDish[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [tags, setTags] = useState<AdminTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string | 'all'>('all')
  const [filterTag, setFilterTag] = useState<string | 'all'>('all')
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all')

  const [editing, setEditing] = useState<AdminDish | null>(null)
  const [isNew, setIsNew] = useState(false)

  const [showCats, setShowCats] = useState(false)
  const [showTags, setShowTags] = useState(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    const [dr, cr, tr] = await Promise.all([fetchAdminDishes(), fetchAdminCategories(), fetchAdminTags()])
    if (dr.error) setError(dr.error)
    if (cr.error) setError(cr.error)
    if (tr.error) setError(tr.error)
    setDishes(dr.data ?? [])
    setCategories(cr.data ?? [])
    setTags(tr.data ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return dishes.filter((d) => {
      if (filterCategory !== 'all' && d.categoryId !== filterCategory) return false
      if (filterTag !== 'all' && !d.tagIds.includes(filterTag)) return false
      if (filterActive === 'active' && !d.active) return false
      if (filterActive === 'inactive' && d.active) return false
      if (needle) {
        const hay = `${d.nameEl} ${d.nameEn}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [dishes, search, filterCategory, filterTag, filterActive])

  function openNew() {
    if (categories.length === 0) {
      alert('Create a category first (Manage categories).')
      setShowCats(true)
      return
    }
    setEditing({
      id: '',
      categoryId: categories[0].id,
      nameEl: '', nameEn: '', descEl: '', descEn: '',
      imageUrl: null, emoji: null, discountPct: 0, active: true,
      previewCal: 3, previewPro: 3, previewCarb: 3, previewFat: 3,
      createdAt: '', updatedAt: '',
      variants: [],
      tagIds: [],
    })
    setIsNew(true)
  }

  function openEdit(d: AdminDish) {
    setEditing({ ...d })
    setIsNew(false)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Dishes</h1>
          <p className="admin-page-sub">{filtered.length} of {dishes.length} dishes</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn-ghost" onClick={() => setShowCats(true)}>Categories</button>
          <button className="admin-btn-ghost" onClick={() => setShowTags(true)}>Tags</button>
          <button className="admin-btn-primary" onClick={openNew}>+ New dish</button>
        </div>
      </div>

      <div className="admin-toolbar">
        <input
          className="admin-input"
          type="search"
          placeholder="Search name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="admin-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.nameEl}</option>)}
        </select>
        <select className="admin-select" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
          <option value="all">All tags</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.labelEl}</option>)}
        </select>
        <select className="admin-select" value={filterActive} onChange={(e) => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}>
          <option value="all">Active + inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>

      {error && <div className="admin-error-banner">{error}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th>Name (EL)</th>
                <th>Name (EN)</th>
                <th>Category</th>
                <th>Variants</th>
                <th>Active</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="admin-table-empty">No dishes match.</td></tr>
              )}
              {filtered.map((d) => (
                <tr key={d.id} onClick={() => openEdit(d)} style={{ cursor: 'pointer' }}>
                  <td>
                    {d.imageUrl
                      ? <img src={d.imageUrl} alt="" className="admin-dish-thumb" />
                      : <div className="admin-dish-thumb admin-dish-thumb-empty">{d.emoji ?? '🍽️'}</div>
                    }
                  </td>
                  <td>{d.nameEl}</td>
                  <td style={{ color: 'var(--a-text-muted)' }}>{d.nameEn}</td>
                  <td>{d.categoryNameEl ?? d.categoryId}</td>
                  <td>{d.variants.length}</td>
                  <td>
                    <label className="admin-switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={d.active}
                        onChange={async (e) => {
                          await toggleDishActive(d.id, e.target.checked)
                          refresh()
                        }}
                      />
                      <span />
                    </label>
                  </td>
                  <td style={{ color: 'var(--a-text-muted)', fontSize: 12 }}>{new Date(d.updatedAt).toLocaleString('en-GB')}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="admin-row-btn" onClick={() => openEdit(d)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DishDrawer
          dish={editing}
          isNew={isNew}
          categories={categories}
          tags={tags}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
          onDeleted={() => { setEditing(null); refresh() }}
        />
      )}

      {showCats && (
        <CategoriesModal
          categories={categories}
          onClose={() => setShowCats(false)}
          onChanged={refresh}
        />
      )}

      {showTags && (
        <TagsModal
          tags={tags}
          onClose={() => setShowTags(false)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

// ─── Dish drawer ──────────────────────────────────────────────────────────

function DishDrawer({
  dish, isNew, categories, tags, onClose, onSaved, onDeleted,
}: {
  dish: AdminDish
  isNew: boolean
  categories: AdminCategory[]
  tags: AdminTag[]
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [form, setForm] = useState<AdminDish>(dish)
  const [lang, setLang] = useState<LangTab>('el')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [imageMode, setImageMode] = useState<'upload' | 'url'>(dish.imageUrl ? 'url' : 'upload')
  const fileInput = useRef<HTMLInputElement>(null)

  // WEC-249: recipe state — loaded on mount for existing dishes, persisted
  // alongside the dish on save. Empty for new dishes; admin builds it before
  // first save.
  const [recipe, setRecipe] = useState<RecipeRow[]>([])
  useEffect(() => {
    if (isNew || !dish.id) return
    let cancelled = false
    fetchDishRecipe(dish.id).then((res) => {
      if (cancelled || !res.data) return
      const rows: RecipeRow[] = res.data.ingredients.map((ing, i) => {
        const perVariant: Record<string, number> = {}
        for (const a of res.data!.variantAmounts) {
          if (a.ingredientId === ing.ingredientId) perVariant[a.variantId] = Number(a.grams)
        }
        return {
          _key: `${ing.ingredientId}-${i}`,
          ingredientId: ing.ingredientId,
          nameEl: ing.nameEl,
          isVariant: ing.isVariant,
          fixedGrams: ing.fixedGrams != null ? Number(ing.fixedGrams) : null,
          perVariant,
          sortOrder: ing.sortOrder,
        }
      })
      setRecipe(rows)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dish.id])

  function patch<K extends keyof AdminDish>(key: K, value: AdminDish[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setErr(null)
    const tmpId = form.id || `tmp-${Date.now().toString(36)}`
    const { url, error } = await uploadDishImage(file, tmpId)
    setUploading(false)
    if (error) { setErr(error); return }
    patch('imageUrl', url)
  }

  // Import from URL (Drive link, public CDN, etc.) → server downloads + uploads
  // to Supabase Storage and rewrites dishes.image_url. Mirrors the bulk-import
  // flow on /admin/dish-images, but for a single dish from inside the drawer.
  // Disabled for new dishes: the function needs a real dishes.id row to update.
  async function handleImportFromUrl() {
    if (isNew || !form.id) { setErr('Save the dish first, then import its image from a URL.'); return }
    if (!form.imageUrl || !/^https?:\/\//i.test(form.imageUrl)) { setErr('Paste a URL first (https://…).'); return }
    setUploading(true)
    setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) { setErr('Not authenticated'); setUploading(false); return }
      const res = await fetch('/api/admin-import-dish-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dishId: form.id, sourceUrl: form.imageUrl, force: true }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setErr(body.error ?? `HTTP ${res.status}`)
      } else if (body.publicUrl) {
        patch('imageUrl', body.publicUrl)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setUploading(false)
  }

  // ─── WEC-251: Bidirectional Variants ↔ Recipe sync ────────────────────
  // Two operations on the same data, used when the admin has built one side
  // (text labels OR structured recipe) and wants to derive the other side
  // mechanically instead of typing it twice.
  //
  // Round-trip-safe format: "<name> (<grams>γρ)" — same shape parseIngredientList
  // recognises, so labels generated from a recipe parse cleanly back into the
  // same recipe.

  // Direction: text → ingredients. For each variant, parse its label looking
  // for "(Xγρ)" markers, aggregate per ingredient across variants, and apply
  // the same fixed-vs-variable classifier the CSV importer uses.
  function recipeFromVariantLabels() {
    setErr(null)
    if (form.variants.length === 0) { setErr('Add at least one variant first.'); return }

    const parsed = form.variants.map((v) => ({ variantId: v.id, ings: parseIngredientList(v.labelEl) }))
    const total = parsed.reduce((n, p) => n + p.ings.length, 0)
    if (total === 0) { setErr('No "(Xγρ)" patterns found in any variant label — nothing to parse.'); return }

    if (recipe.length > 0 && !confirm('Replace the current recipe with what is parsed from the variant labels?')) return

    // Aggregate per searchKey, preserving first-seen order across variants.
    const byKey = new Map<string, { name: string; perVariant: Record<string, number>; order: number }>()
    let nextOrder = 0
    for (const { variantId, ings } of parsed) {
      for (const ing of ings) {
        let row = byKey.get(ing.searchKey)
        if (!row) {
          row = { name: ing.name, perVariant: {}, order: ++nextOrder }
          byKey.set(ing.searchKey, row)
        }
        row.perVariant[variantId] = (row.perVariant[variantId] ?? 0) + ing.grams
      }
    }

    // Classify: same grams in every variant → Fixed; otherwise Variable.
    const rows: RecipeRow[] = []
    let i = 0
    for (const [, info] of byKey) {
      const distinct = new Set(Object.values(info.perVariant))
      const presentInAll = Object.keys(info.perVariant).length === form.variants.length
      const isVariant = !(distinct.size === 1 && presentInAll)
      if (isVariant) {
        for (const v of form.variants) {
          if (info.perVariant[v.id] == null) info.perVariant[v.id] = 0
        }
      }
      rows.push({
        _key: `gen-${Date.now().toString(36)}-${i}`,
        // ingredientId stays null — saveDishRecipe resolves by search_key,
        // creating catalog rows for any new names. Keeps this generator
        // independent of the catalog state in DishRecipeEditor.
        ingredientId: null,
        nameEl: info.name,
        isVariant,
        fixedGrams: isVariant ? null : Array.from(distinct)[0],
        perVariant: isVariant ? info.perVariant : {},
        sortOrder: info.order,
      })
      i++
    }
    setRecipe(rows)
  }

  // Direction: ingredients → text. For each variant, walk the recipe rows
  // and build "<name> (<grams>γρ), …" from the ones with grams > 0 in that
  // variant. Empty grams are skipped so the label stays clean for variants
  // where a Variable ingredient is absent.
  function labelsFromRecipe() {
    setErr(null)
    if (recipe.length === 0) { setErr('Add ingredients first.'); return }
    if (form.variants.length === 0) { setErr('Add at least one variant first.'); return }

    const hasLabels = form.variants.some((v) => v.labelEl.trim().length > 0)
    if (hasLabels && !confirm('Overwrite the current variant labels with text generated from the recipe?')) return

    const sorted = [...recipe].sort((a, b) => a.sortOrder - b.sortOrder)
    const newVariants = form.variants.map((v) => {
      const parts: string[] = []
      for (const r of sorted) {
        const grams = r.isVariant ? (r.perVariant[v.id] ?? 0) : (r.fixedGrams ?? 0)
        if (grams > 0 && r.nameEl.trim()) {
          // Render integers as integers ("200γρ"), halves with one decimal
          // ("12.5γρ"). String(num) already does this in JS — no formatter
          // needed.
          parts.push(`${r.nameEl.trim()} (${String(grams)}γρ)`)
        }
      }
      return { ...v, labelEl: parts.join(', ') }
    })
    patch('variants', newVariants)
  }

  async function handleSave() {
    if (!form.nameEl.trim()) { setErr('Greek name is required'); return }
    if (form.variants.length === 0) { setErr('At least one variant is required'); return }
    for (const v of form.variants) {
      if (!v.labelEl.trim()) { setErr('Every variant needs a Greek label'); return }
      if (v.price <= 0) { setErr('Every variant needs a price > 0'); return }
    }
    setSaving(true)
    setErr(null)
    const { data: saveData, error } = await saveDish({
      id: isNew ? undefined : form.id,
      categoryId: form.categoryId,
      nameEl: form.nameEl.trim(),
      nameEn: form.nameEn.trim() || form.nameEl.trim(),
      descEl: form.descEl,
      descEn: form.descEn,
      imageUrl: form.imageUrl,
      emoji: form.emoji,
      discountPct: form.discountPct,
      active: form.active,
      previewCal: form.previewCal, previewPro: form.previewPro,
      previewCarb: form.previewCarb, previewFat: form.previewFat,
      variants: form.variants,
      tagIds: form.tagIds,
    })
    if (error) { setSaving(false); setErr(error); return }

    // WEC-249: persist recipe alongside dish + variants. Recipe rows
    // reference variants by id; saveDish above may have re-issued IDs for
    // brand-new variants, so we re-fetch the persisted variant ids.
    const dishId = saveData?.id ?? form.id
    if (dishId) {
      // Map old (form) variant ids → persisted ids by sortOrder, since
      // saveDish replaces variants and assigns new ids for brand-new ones.
      // For existing dishes whose variants kept their ids, the map is identity.
      const { data: freshVariants } = await import('../../lib/supabase').then(({ supabase }) =>
        supabase.from('dish_variants').select('id, sort_order').eq('dish_id', dishId).order('sort_order'),
      )
      const idBySort = new Map<number, string>()
      for (const v of (freshVariants ?? []) as Array<{ id: string; sort_order: number }>) {
        idBySort.set(v.sort_order, v.id)
      }
      const remappedRecipe = recipe.map((r) => {
        const perVariant: Record<string, number> = {}
        for (let i = 0; i < form.variants.length; i++) {
          const oldId = form.variants[i].id
          const newId = idBySort.get(i) ?? oldId
          if (r.perVariant[oldId] != null) perVariant[newId] = r.perVariant[oldId]
        }
        return { ...r, perVariant }
      })

      const { error: recipeErr } = await saveDishRecipe(
        dishId,
        remappedRecipe.map((r) => ({
          ingredientId: r.ingredientId,
          nameEl: r.nameEl,
          isVariant: r.isVariant,
          fixedGrams: r.fixedGrams,
          perVariant: r.perVariant,
          sortOrder: r.sortOrder,
        })),
      )
      if (recipeErr) {
        setSaving(false)
        setErr(`Recipe save failed: ${recipeErr}`)
        return
      }
    }

    setSaving(false)
    onSaved()
  }

  async function handleDelete() {
    if (!confirm(`Delete "${form.nameEl}"? Past orders referencing it will keep their snapshot.`)) return
    setSaving(true)
    const { error } = await deleteDish(form.id)
    setSaving(false)
    if (error) { setErr(error); return }
    onDeleted()
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2>{isNew ? 'New dish' : form.nameEl || '—'}</h2>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </header>

        <div className="admin-drawer-body">
          {err && <div className="admin-error-banner">{err}</div>}

          {/* External code — the slug used everywhere (CSV, URLs, admin search). */}
          {/* Read-only on existing dishes (renaming would orphan past order rows). */}
          <section className="admin-form-section">
            <label className="admin-form-label">Code</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13, padding: '6px 10px',
                background: 'var(--a-bg)', border: '1px dashed var(--a-border)',
                borderRadius: 6, userSelect: 'text', minWidth: 200,
              }}>
                {form.id || (isNew ? '(auto-generated on save)' : '—')}
              </code>
              {!isNew && form.id && (
                <button
                  type="button"
                  className="admin-btn-ghost"
                  onClick={() => navigator.clipboard.writeText(form.id)}
                  title="Copy code to clipboard"
                >
                  Copy
                </button>
              )}
            </div>
          </section>

          {/* Image */}
          <section className="admin-form-section">
            <label className="admin-form-label">Image</label>
            <div className="admin-img-preview">
              {form.imageUrl
                ? <img src={form.imageUrl} alt="" />
                : <div className="admin-img-empty">No image</div>
              }
            </div>
            <div className="admin-tab-row">
              <button className={`admin-tab${imageMode === 'upload' ? ' active' : ''}`} onClick={() => setImageMode('upload')}>Upload</button>
              <button className={`admin-tab${imageMode === 'url' ? ' active' : ''}`} onClick={() => setImageMode('url')}>Paste URL</button>
            </div>
            {imageMode === 'upload' ? (
              <>
                <input
                  ref={fileInput} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
                />
                <button className="admin-btn-ghost" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading ? 'Uploading…' : 'Choose file'}
                </button>
                {form.imageUrl && <button className="admin-btn-ghost" onClick={() => patch('imageUrl', null)}>Remove</button>}
              </>
            ) : (
              <>
                <input
                  className="admin-input" type="url" placeholder="https://…"
                  value={form.imageUrl ?? ''}
                  onChange={(e) => patch('imageUrl', e.target.value || null)}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="admin-btn-ghost"
                    disabled={uploading || isNew || !form.id || !form.imageUrl}
                    onClick={handleImportFromUrl}
                    title={isNew ? 'Save the dish first, then import' : 'Download from this URL and host on Supabase Storage'}
                  >
                    {uploading ? 'Importing…' : 'Import to Storage'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--a-text-muted)' }}>
                    Drive links and any public image URL. Hosts the file on our CDN so the original can disappear.
                  </span>
                </div>
              </>
            )}
          </section>

          {/* Bilingual name + desc */}
          <section className="admin-form-section">
            <div className="admin-tab-row">
              <button className={`admin-tab${lang === 'el' ? ' active' : ''}`} onClick={() => setLang('el')}>EL</button>
              <button className={`admin-tab${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>EN</button>
            </div>
            <label className="admin-form-label">Name ({lang.toUpperCase()})</label>
            <input
              className="admin-input"
              value={lang === 'el' ? form.nameEl : form.nameEn}
              onChange={(e) => patch(lang === 'el' ? 'nameEl' : 'nameEn', e.target.value)}
              placeholder={lang === 'el' ? 'π.χ. Κοτόπουλο λεμονάτο' : 'e.g. Lemon chicken'}
            />
            <label className="admin-form-label" style={{ marginTop: 12 }}>Description ({lang.toUpperCase()})</label>
            <textarea
              className="admin-input admin-textarea"
              value={lang === 'el' ? form.descEl : form.descEn}
              onChange={(e) => patch(lang === 'el' ? 'descEl' : 'descEn', e.target.value)}
              rows={3}
            />
          </section>

          {/* Category + tags + emoji + discount + active */}
          <section className="admin-form-section admin-grid-2">
            <div>
              <label className="admin-form-label">Category</label>
              <select className="admin-select" value={form.categoryId} onChange={(e) => patch('categoryId', e.target.value)}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.nameEl}</option>)}
              </select>
            </div>
            <div>
              <label className="admin-form-label">Emoji (optional)</label>
              <input
                className="admin-input" maxLength={3}
                value={form.emoji ?? ''}
                onChange={(e) => patch('emoji', e.target.value || null)}
              />
            </div>
            <div>
              <label className="admin-form-label">Discount %</label>
              <input
                className="admin-input" type="number" min={0} max={100}
                value={form.discountPct}
                onChange={(e) => patch('discountPct', Math.max(0, Math.min(100, +e.target.value || 0)))}
              />
            </div>
            <div style={{ alignSelf: 'end' }}>
              <label className="admin-form-checkbox">
                <input type="checkbox" checked={form.active} onChange={(e) => patch('active', e.target.checked)} />
                <span>Active (visible to customers)</span>
              </label>
            </div>
          </section>

          {/* Tags */}
          <section className="admin-form-section">
            <label className="admin-form-label">Tags</label>
            <div className="admin-chip-wrap">
              {tags.length === 0 && <span className="admin-text-muted">No tags yet. Add some via the Tags button.</span>}
              {tags.map((t) => {
                const on = form.tagIds.includes(t.id)
                return (
                  <button
                    key={t.id}
                    className={`admin-chip${on ? ' on' : ''}`}
                    style={on ? { background: t.bgColor, color: t.fontColor, borderColor: t.bgColor } : undefined}
                    onClick={() => patch('tagIds', on ? form.tagIds.filter((x) => x !== t.id) : [...form.tagIds, t.id])}
                  >
                    {t.labelEl}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Preview macro dots */}
          <section className="admin-form-section">
            <label className="admin-form-label">Preview macro dots (1–5 — shown on menu cards)</label>
            <div className="admin-dots-grid">
              {(['previewCal', 'previewPro', 'previewCarb', 'previewFat'] as const).map((k) => (
                <div key={k}>
                  <div className="admin-dots-label">{k.replace('preview', '').replace('Cal', 'Calories').replace('Pro', 'Protein').replace('Carb', 'Carbs').replace('Fat', 'Fat')}</div>
                  <input
                    className="admin-input" type="number" min={1} max={5}
                    value={form[k]}
                    onChange={(e) => patch(k, Math.max(1, Math.min(5, +e.target.value || 3)) as 1 | 2 | 3 | 4 | 5)}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Variants */}
          <section className="admin-form-section">
            <div className="admin-section-head">
              <label className="admin-form-label">Variants</label>
              <button
                className="admin-btn-ghost"
                onClick={() =>
                  patch('variants', [
                    ...form.variants,
                    { id: `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, dishId: form.id, labelEl: '', labelEn: '', price: 0, calories: 0, protein: 0, carbs: 0, fat: 0, sortOrder: form.variants.length, isDefault: false },
                  ])
                }
              >
                + Add variant
              </button>
            </div>
            {form.variants.length === 0 && <div className="admin-text-muted">At least one variant is required.</div>}
            {form.variants.length > 0 && (
              <div className="admin-variant-headers">
                <span title="Default variant — the one selected when the dish modal opens"></span>
                <span>Code</span>
                <span>Label EL</span>
                <span>Label EN</span>
                <span>Price €</span>
                <span>kcal</span>
                <span>Pro</span>
                <span>Carb</span>
                <span>Fat</span>
                <span></span>
              </div>
            )}
            {form.variants.map((v, i) => (
              <VariantRow
                key={v.id}
                v={v}
                onChange={(nv) => patch('variants', form.variants.map((x, j) => (j === i ? nv : x)))}
                onDelete={() => patch('variants', form.variants.filter((_, j) => j !== i))}
                onSetDefault={() =>
                  // Single-default invariant: only one variant can be flagged
                  // is_default at a time per dish. Clearing the others on the
                  // client keeps the form in sync with the post-save state.
                  patch('variants', form.variants.map((x, j) => ({ ...x, isDefault: j === i })))
                }
              />
            ))}
          </section>

          {/* WEC-251: Bidirectional sync — derive one side from the other. */}
          {/* Sits between Variants and Recipe because both directions are equally */}
          {/* common: legacy dishes have ingredient text in variant labels, new */}
          {/* dishes are built recipe-first and the labels need filling in. */}
          <section className="admin-sync-bar" aria-label="Sync variants and recipe">
            <button
              type="button"
              className="admin-btn-ghost admin-sync-btn"
              onClick={labelsFromRecipe}
              title="Build variant labels from the recipe rows below"
            >
              ↑ Generate labels from recipe
            </button>
            <span className="admin-sync-hint">⇅ keep in sync</span>
            <button
              type="button"
              className="admin-btn-ghost admin-sync-btn"
              onClick={recipeFromVariantLabels}
              title='Parse "(Xγρ)" patterns from variant labels and populate the recipe'
            >
              ↓ Generate recipe from labels
            </button>
          </section>

          {/* Recipe — fixed + per-variant ingredient amounts (WEC-249). */}
          <section className="admin-form-section">
            <div className="admin-section-head">
              <label className="admin-form-label">Recipe</label>
            </div>
            <DishRecipeEditor
              dishId={form.id}
              variants={form.variants}
              value={recipe}
              onChange={setRecipe}
            />
          </section>
        </div>

        <footer className="admin-drawer-foot">
          {!isNew && <button className="admin-btn-danger" disabled={saving} onClick={handleDelete}>Delete</button>}
          <div style={{ flex: 1 }} />
          <button className="admin-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="admin-btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : isNew ? 'Create dish' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function VariantRow({ v, onChange, onDelete, onSetDefault }: { v: AdminVariant; onChange: (v: AdminVariant) => void; onDelete: () => void; onSetDefault: () => void }) {
  function num(n: string): number { return Math.max(0, +n || 0) }
  // The variant's code (212-1) IS its primary key. Once persisted it can't
  // change without orphaning order rows that snapshot it, so we display it
  // read-only post-save. For never-saved rows (id starts with "new-") we
  // leave it blank — Postgres assigns one server-side at save time.
  const persisted = !!v.id && !v.id.startsWith('new-')
  return (
    <div className="admin-variant-row">
      <button
        type="button"
        className={`admin-variant-default${v.isDefault ? ' on' : ''}`}
        onClick={onSetDefault}
        title={v.isDefault ? 'Default variant (shown when modal opens)' : 'Set as default variant'}
        aria-label="Set as default variant"
      >
        {v.isDefault ? '★' : '☆'}
      </button>
      <div className="admin-variant-code" title={persisted ? `Variant code (used in past orders): ${v.id}` : 'Auto-generated on save'}>
        {persisted ? v.id : '—'}
      </div>
      <input className="admin-input" placeholder="Label EL" value={v.labelEl} onChange={(e) => onChange({ ...v, labelEl: e.target.value })} />
      <input className="admin-input" placeholder="Label EN" value={v.labelEn} onChange={(e) => onChange({ ...v, labelEn: e.target.value })} />
      <input className="admin-input numeric" type="number" step="0.01" min={0} placeholder="€"
        value={v.price === 0 ? '' : (v.price / 100).toFixed(2)}
        onChange={(e) => onChange({ ...v, price: Math.round((+e.target.value || 0) * 100) })}
      />
      <input className="admin-input numeric" type="number" min={0} placeholder="kcal" value={v.calories || ''} onChange={(e) => onChange({ ...v, calories: num(e.target.value) })} />
      <input className="admin-input numeric" type="number" min={0} placeholder="g" value={v.protein || ''} onChange={(e) => onChange({ ...v, protein: num(e.target.value) })} />
      <input className="admin-input numeric" type="number" min={0} placeholder="g" value={v.carbs || ''} onChange={(e) => onChange({ ...v, carbs: num(e.target.value) })} />
      <input className="admin-input numeric" type="number" min={0} placeholder="g" value={v.fat || ''} onChange={(e) => onChange({ ...v, fat: num(e.target.value) })} />
      <button className="admin-variant-del" onClick={onDelete} title="Remove variant">×</button>
    </div>
  )
}

// ─── Categories modal ─────────────────────────────────────────────────────

function CategoriesModal({ categories, onClose, onChanged }: { categories: AdminCategory[]; onClose: () => void; onChanged: () => void }) {
  const [newEl, setNewEl] = useState('')
  const [newEn, setNewEn] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    if (!newEl.trim()) return
    setErr(null)
    const { error } = await saveCategory({
      nameEl: newEl.trim(), nameEn: newEn.trim() || newEl.trim(),
      sortOrder: categories.length, active: true,
    })
    if (error) { setErr(error); return }
    setNewEl(''); setNewEn('')
    onChanged()
  }

  async function del(c: AdminCategory) {
    setErr(null)
    const { error } = await deleteCategory(c.id)
    if (error) { setErr(error); return }
    onChanged()
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2>Categories</h2>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </header>
        <div className="admin-drawer-body">
          {err && <div className="admin-error-banner">{err}</div>}
          <table className="admin-table admin-table-tight">
            <thead><tr><th>Name (EL)</th><th>Name (EN)</th><th>Dishes</th><th></th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <CategoryEditRow key={c.id} c={c} onChanged={onChanged} onDelete={() => del(c)} />
              ))}
            </tbody>
          </table>
          <div className="admin-section-head" style={{ marginTop: 20 }}>
            <strong>Add new</strong>
          </div>
          <div className="admin-inline-form">
            <input className="admin-input" placeholder="Name (EL)" value={newEl} onChange={(e) => setNewEl(e.target.value)} />
            <input className="admin-input" placeholder="Name (EN)" value={newEn} onChange={(e) => setNewEn(e.target.value)} />
            <button className="admin-btn-primary" onClick={add} disabled={!newEl.trim()}>Add</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CategoryEditRow({ c, onChanged, onDelete }: { c: AdminCategory; onChanged: () => void; onDelete: () => void }) {
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

// ─── Tags modal ───────────────────────────────────────────────────────────

function TagsModal({ tags, onClose, onChanged }: { tags: AdminTag[]; onClose: () => void; onChanged: () => void }) {
  const [newEl, setNewEl] = useState('')
  const [newEn, setNewEn] = useState('')
  const [newBg, setNewBg] = useState('#0a7b4a')
  const [newFg, setNewFg] = useState('#ffffff')
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    if (!newEl.trim()) return
    setErr(null)
    const { error } = await saveTag({
      labelEl: newEl.trim(), labelEn: newEn.trim() || newEl.trim(),
      bgColor: newBg, fontColor: newFg, sortOrder: tags.length,
    })
    if (error) { setErr(error); return }
    setNewEl(''); setNewEn('')
    onChanged()
  }

  async function del(t: AdminTag) {
    if (!confirm(`Delete tag "${t.labelEl}"?`)) return
    setErr(null)
    const { error } = await deleteTag(t.id)
    if (error) { setErr(error); return }
    onChanged()
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <h2>Tags</h2>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </header>
        <div className="admin-drawer-body">
          {err && <div className="admin-error-banner">{err}</div>}
          <table className="admin-table admin-table-tight">
            <thead><tr><th>Preview</th><th>Label (EL)</th><th>Label (EN)</th><th>Bg</th><th>Fg</th><th></th></tr></thead>
            <tbody>
              {tags.map((t) => <TagEditRow key={t.id} t={t} onChanged={onChanged} onDelete={() => del(t)} />)}
            </tbody>
          </table>
          <div className="admin-section-head" style={{ marginTop: 20 }}>
            <strong>Add new</strong>
          </div>
          <div className="admin-inline-form">
            <input className="admin-input" placeholder="Label (EL)" value={newEl} onChange={(e) => setNewEl(e.target.value)} />
            <input className="admin-input" placeholder="Label (EN)" value={newEn} onChange={(e) => setNewEn(e.target.value)} />
            <input className="admin-input admin-color-input" type="color" value={newBg} onChange={(e) => setNewBg(e.target.value)} title="Background" />
            <input className="admin-input admin-color-input" type="color" value={newFg} onChange={(e) => setNewFg(e.target.value)} title="Font" />
            <button className="admin-btn-primary" onClick={add} disabled={!newEl.trim()}>Add</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TagEditRow({ t, onChanged, onDelete }: { t: AdminTag; onChanged: () => void; onDelete: () => void }) {
  const [labelEl, setLabelEl] = useState(t.labelEl)
  const [labelEn, setLabelEn] = useState(t.labelEn)
  const [bg, setBg] = useState(t.bgColor)
  const [fg, setFg] = useState(t.fontColor)
  const dirty = labelEl !== t.labelEl || labelEn !== t.labelEn || bg !== t.bgColor || fg !== t.fontColor
  async function save() {
    await saveTag({ id: t.id, labelEl, labelEn, bgColor: bg, fontColor: fg, sortOrder: t.sortOrder })
    onChanged()
  }
  return (
    <tr>
      <td><span className="admin-tag-preview" style={{ background: bg, color: fg }}>{labelEl || '—'}</span></td>
      <td><input className="admin-input admin-input-tight" value={labelEl} onChange={(e) => setLabelEl(e.target.value)} /></td>
      <td><input className="admin-input admin-input-tight" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} /></td>
      <td><input className="admin-input admin-color-input" type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></td>
      <td><input className="admin-input admin-color-input" type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {dirty && <button className="admin-row-btn" onClick={save}>Save</button>}
        <button className="admin-row-btn danger" onClick={onDelete}>Delete</button>
      </td>
    </tr>
  )
}
