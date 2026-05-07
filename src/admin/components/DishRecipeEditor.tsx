import { useEffect, useMemo, useState } from 'react'
import type { AdminVariant } from '../../lib/api/adminDishes'
import { fetchIngredients, searchKey, type AdminIngredient } from '../../lib/api/adminIngredients'

/**
 * Dish recipe editor (WEC-249).
 *
 * Renders one row per ingredient assigned to the dish:
 *   - Ingredient picker (datalist over the catalog; new names auto-create
 *     a catalog row at save-time — no separate "Add ingredient to catalog"
 *     step required).
 *   - Mode toggle: Fixed (one grams field, applies to every variant) /
 *     Variable (compact per-variant grams inputs, one per variant).
 *   - Trash to remove.
 *
 * Lives inside the existing /admin/dishes drawer; receives `value` + raises
 * `onChange` so the parent owns the form state. Save-time persistence is
 * the parent's job (calls saveDishRecipe alongside saveDish).
 */

export interface RecipeRow {
  /** Stable React key — does NOT round-trip to the DB. */
  _key: string
  /** Catalog row id, or null if the admin typed a name that needs auto-creating. */
  ingredientId: string | null
  nameEl: string
  isVariant: boolean
  fixedGrams: number | null
  /** key = variant.id (the dish_variants.id, e.g. "5-1") */
  perVariant: Record<string, number>
  sortOrder: number
}

interface Props {
  dishId: string
  variants: AdminVariant[]
  value: RecipeRow[]
  onChange: (rows: RecipeRow[]) => void
}

const newKey = (): string => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function DishRecipeEditor({ variants, value, onChange }: Props) {
  const [catalog, setCatalog] = useState<AdminIngredient[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)

  // Load the ingredients catalog once. <100 KB at full scale, fine to slurp.
  useEffect(() => {
    let cancelled = false
    fetchIngredients().then((res) => {
      if (cancelled) return
      setCatalog(res.data ?? [])
      setLoadingCatalog(false)
    })
    return () => { cancelled = true }
  }, [])

  // search_key → catalog row, for resolving names typed in the picker.
  const catalogBySK = useMemo(() => {
    const m = new Map<string, AdminIngredient>()
    for (const i of catalog) m.set(i.searchKey, i)
    return m
  }, [catalog])

  function update(idx: number, patch: Partial<RecipeRow>) {
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function add() {
    onChange([
      ...value,
      {
        _key: newKey(),
        ingredientId: null,
        nameEl: '',
        isVariant: false,
        fixedGrams: null,
        perVariant: {},
        sortOrder: value.length,
      },
    ])
  }

  function handleNameChange(idx: number, name: string) {
    const sk = searchKey(name)
    const match = catalogBySK.get(sk)
    update(idx, {
      nameEl: name,
      ingredientId: match?.id ?? null,
    })
  }

  function handleModeChange(idx: number, isVariant: boolean) {
    if (isVariant) {
      // Switching to Variable: distribute current fixedGrams across variants
      // (or leave existing perVariant if it has values).
      const row = value[idx]
      const seed: Record<string, number> = {}
      for (const v of variants) {
        seed[v.id] = row.perVariant[v.id] ?? row.fixedGrams ?? 0
      }
      update(idx, { isVariant: true, fixedGrams: null, perVariant: seed })
    } else {
      // Switching to Fixed: collapse to the first non-zero perVariant value
      // if any, otherwise 0.
      const row = value[idx]
      const firstVal = Object.values(row.perVariant).find((g) => g > 0) ?? 0
      update(idx, { isVariant: false, fixedGrams: firstVal })
    }
  }

  return (
    <div className="admin-recipe-editor">
      {loadingCatalog && (
        <div className="admin-text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Loading ingredients catalog…
        </div>
      )}

      <datalist id="admin-recipe-ingredient-options">
        {catalog.map((i) => <option key={i.id} value={i.nameEl} />)}
      </datalist>

      {value.length === 0 && (
        <div className="admin-text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          No ingredients yet — add one to start building the recipe.
        </div>
      )}

      {value.map((r, idx) => {
        const isUnknown = r.nameEl.trim() && r.ingredientId == null
        return (
          <div key={r._key} className="admin-recipe-row">
            {/* Ingredient picker */}
            <div className="admin-recipe-row-name">
              <input
                className="admin-input"
                list="admin-recipe-ingredient-options"
                placeholder="Όνομα συστατικού"
                value={r.nameEl}
                onChange={(e) => handleNameChange(idx, e.target.value)}
              />
              {isUnknown && (
                <small style={{ color: '#b45309', fontSize: 11 }}>
                  Νέο συστατικό — θα δημιουργηθεί στον κατάλογο κατά την αποθήκευση
                </small>
              )}
            </div>

            {/* Mode toggle */}
            <div className="admin-recipe-row-mode">
              <label style={{ fontSize: 12 }}>
                <input
                  type="radio"
                  name={`mode-${r._key}`}
                  checked={!r.isVariant}
                  onChange={() => handleModeChange(idx, false)}
                />{' '}
                Fixed
              </label>
              <label style={{ fontSize: 12 }}>
                <input
                  type="radio"
                  name={`mode-${r._key}`}
                  checked={r.isVariant}
                  onChange={() => handleModeChange(idx, true)}
                />{' '}
                Variable
              </label>
            </div>

            {/* Grams input(s) */}
            <div className="admin-recipe-row-grams">
              {!r.isVariant && (
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  step="0.5"
                  placeholder="γρ"
                  value={r.fixedGrams ?? ''}
                  onChange={(e) =>
                    update(idx, { fixedGrams: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              )}
              {r.isVariant && (
                <div className="admin-recipe-row-variants">
                  {variants.map((v, vi) => (
                    <div key={v.id} className="admin-recipe-variant-cell">
                      <label className="admin-recipe-variant-label">v{vi + 1}</label>
                      <input
                        className="admin-input"
                        type="number"
                        min={0}
                        step="0.5"
                        placeholder="γρ"
                        value={r.perVariant[v.id] ?? ''}
                        onChange={(e) => {
                          const n = e.target.value === '' ? 0 : Number(e.target.value)
                          update(idx, { perVariant: { ...r.perVariant, [v.id]: n } })
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delete */}
            <button
              type="button"
              className="admin-recipe-del"
              onClick={() => remove(idx)}
              title="Remove ingredient from this dish"
            >×</button>
          </div>
        )
      })}

      <button type="button" className="admin-btn admin-btn-ghost" onClick={add} style={{ marginTop: 8 }}>
        + Add ingredient
      </button>
    </div>
  )
}
