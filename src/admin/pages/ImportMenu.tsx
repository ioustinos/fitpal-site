import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  parseMenuCsv,
  classifyDish,
  type ParsedDish,
  type ClassifiedDishIngredient,
} from '../../lib/menu-csv/parse'
import { DishImageImporter } from '../components/DishImageImporter'

/**
 * Admin → Import menu (CSV).
 *
 * One-click flow:
 *   1. Admin picks the menu CSV (Wecook data-entry sheet, exported as CSV).
 *   2. Page parses it client-side, runs the fixed-vs-variant classifier per
 *      dish, and shows a preview pane (counts + warnings).
 *   3. Admin clicks "Import" — page POSTs structured JSON to
 *      /api/admin-import-menu, which upserts dishes/variants and refreshes
 *      the recipe rows in one server-side write.
 *   4. Page surfaces a "Now import images" handoff to /admin/dish-images
 *      so the operator finishes the round-trip without context-switching.
 *
 * Client-side parse means the preview is honest — what you see in the
 * preview is exactly what gets sent. Server-side parsing would risk drift
 * between preview and reality.
 *
 * Reusable for any future menu refresh: re-upload the CSV, click Import,
 * recipe rows get cleanly replaced. Safe to re-run.
 */

interface DishPayloadIng {
  searchKey: string
  nameEl: string
  sortOrder: number
  isVariant: boolean
  fixedGrams: number | null
  perVariant: Record<string, number>
}
interface DishPayload {
  id: string
  categoryId: string
  nameEl: string
  descEl: string
  imageUrl: string
  variants: {
    code: string
    sortOrder: number
    labelEl: string
    priceCents: number
    calories: number | null
    protein: number | null
    carbs: number | null
    fat: number | null
  }[]
  ingredients: DishPayloadIng[]
}

interface ParsedState {
  dishes: ParsedDish[]
  classified: Map<string, ClassifiedDishIngredient[]> // dish.id → ings
  dishCount: number
  variantCount: number
  ingredientCount: number
  warnings: string[]
  recipeRowCount: number
}

type ImportState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; dishesProcessed: number; variantsProcessed: number; recipeRowsInserted: number; ingredientsUpserted: number }
  | { state: 'error'; message: string }

function buildPayload(parsed: ParsedState): DishPayload[] {
  return parsed.dishes.map((d) => {
    const ings = parsed.classified.get(d.id) ?? []
    return {
      id: d.id,
      categoryId: d.categoryId,
      nameEl: d.nameEl,
      descEl: d.descEl,
      imageUrl: d.imageUrl,
      variants: d.variants.map((v) => ({
        code: v.code,
        sortOrder: v.sortOrder,
        labelEl: v.labelEl,
        priceCents: v.priceCents,
        calories: v.calories,
        protein: v.protein,
        carbs: v.carbs,
        fat: v.fat,
      })),
      ingredients: ings.map((i) => ({
        searchKey: i.searchKey,
        nameEl: i.nameEl,
        sortOrder: i.sortOrder,
        isVariant: i.isVariant,
        fixedGrams: i.fixedGrams,
        perVariant: i.perVariant,
      })),
    }
  })
}

export function ImportMenu() {
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedState | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importState, setImportState] = useState<ImportState>({ state: 'idle' })

  async function handleFile(file: File) {
    setCsvFile(file)
    setParsed(null)
    setParseError(null)
    setImportState({ state: 'idle' })
    try {
      const text = await file.text()
      const result = parseMenuCsv(text)
      const classified = new Map<string, ClassifiedDishIngredient[]>()
      let recipeRowCount = 0
      for (const d of result.dishes) {
        const ings = classifyDish(d)
        classified.set(d.id, ings)
        for (const i of ings) {
          recipeRowCount += 1 // one dish_ingredients row
          if (i.isVariant) recipeRowCount += Object.keys(i.perVariant).length
        }
      }
      setParsed({
        dishes: result.dishes,
        classified,
        dishCount: result.summary.dishCount,
        variantCount: result.summary.variantCount,
        ingredientCount: result.summary.ingredientCount,
        warnings: result.summary.warnings,
        recipeRowCount,
      })
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    }
  }

  async function runImport() {
    if (!parsed) return
    setImportState({ state: 'running' })

    const { data: { session } } = await supabase.auth.getSession()
    const jwt = session?.access_token
    if (!jwt) {
      setImportState({ state: 'error', message: 'No admin session — log in again.' })
      return
    }

    try {
      const res = await fetch('/api/admin-import-menu', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dishes: buildPayload(parsed) }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setImportState({ state: 'error', message: body.error ?? `HTTP ${res.status}` })
        return
      }
      setImportState({
        state: 'done',
        dishesProcessed: body.dishesProcessed,
        variantsProcessed: body.variantsProcessed,
        recipeRowsInserted: body.recipeRowsInserted,
        ingredientsUpserted: body.ingredientsUpserted,
      })
    } catch (err) {
      setImportState({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Import menu</h1>
          <p className="admin-page-sub">
            Upload the Wecook menu CSV. Dishes, variants, and ingredient recipes get inserted in one pass.
            After this, head to <a href="/admin/dish-images">Dish images</a> to pull the images from Drive into Storage.
          </p>
        </div>
      </div>

      {/* Step 1: file upload */}
      <div className="admin-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>1. Pick a CSV</h3>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
        {csvFile && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          {csvFile.name} · {(csvFile.size / 1024).toFixed(1)} KB
        </span>}
        {parseError && (
          <div className="admin-error" style={{ marginTop: 8 }}>Parse failed: {parseError}</div>
        )}
      </div>

      {/* Step 2: preview */}
      {parsed && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>2. Review what will be imported</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <Stat label="Dishes" value={parsed.dishCount} />
            <Stat label="Variants" value={parsed.variantCount} />
            <Stat label="Unique ingredients" value={parsed.ingredientCount} />
            <Stat label="Recipe rows" value={parsed.recipeRowCount} />
          </div>
          {parsed.warnings.length > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-warn, #fff7ed)', borderRadius: 6 }}>
              <strong style={{ fontSize: 12 }}>{parsed.warnings.length} warning{parsed.warnings.length === 1 ? '' : 's'}:</strong>
              <ul style={{ fontSize: 11, marginTop: 4, paddingLeft: 18 }}>
                {parsed.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
                {parsed.warnings.length > 10 && <li>… and {parsed.warnings.length - 10} more</li>}
              </ul>
            </div>
          )}

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>Per-dish breakdown ({parsed.dishCount} rows)</summary>
            <div className="admin-table-wrap" style={{ marginTop: 8 }}>
              <table className="admin-table admin-table-tight">
                <thead><tr><th>ID</th><th>Category</th><th>Name</th><th>V</th><th>Fix</th><th>Var</th></tr></thead>
                <tbody>
                  {parsed.dishes.map((d) => {
                    const ings = parsed.classified.get(d.id) ?? []
                    const fixed = ings.filter((i) => !i.isVariant).length
                    const variant = ings.filter((i) => i.isVariant).length
                    return (
                      <tr key={d.id}>
                        <td><code>{d.id}</code></td>
                        <td>{d.categoryId}</td>
                        <td>{d.nameEl}</td>
                        <td>{d.variants.length}</td>
                        <td>{fixed}</td>
                        <td>{variant}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {/* Step 3: import */}
      {parsed && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>3. Import</h3>
          {importState.state === 'idle' && (
            <button
              className="admin-btn admin-btn-primary"
              onClick={runImport}
              disabled={parsed.dishes.length === 0}
            >
              Import {parsed.dishCount} dishes
            </button>
          )}
          {importState.state === 'running' && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Working… (large imports can take 10–20 seconds)
            </p>
          )}
          {importState.state === 'done' && (
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)' }}>✓ Imported successfully</p>
              <ul style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                <li>{importState.dishesProcessed} dishes upserted</li>
                <li>{importState.variantsProcessed} variants upserted</li>
                <li>{importState.ingredientsUpserted} ingredients in catalog</li>
                <li>{importState.recipeRowsInserted} recipe rows inserted</li>
              </ul>

              {/* WEC-244: image import button right here so the operator
                  doesn't have to navigate to /admin/dish-images. Same
                  component used on that page — single source of truth. */}
              <div style={{ marginTop: 16 }}>
                <h4 style={{ fontSize: 13, marginBottom: 6 }}>4. Import images</h4>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Pulls the dishes' Drive image URLs into Supabase Storage. Runs serially.
                </p>
                <DishImageImporter
                  dishIds={parsed?.dishes.map((d) => d.id)}
                  reloadKey={Date.now()}
                />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  Or visit <a href="/admin/dish-images">Dish images</a> to manage all imports across the catalog.
                </p>
              </div>
            </div>
          )}
          {importState.state === 'error' && (
            <div className="admin-error">{importState.message}</div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value.toLocaleString()}</div>
    </div>
  )
}
