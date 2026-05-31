// Two-tab editor for wallet plan settings.
//   Tab 1 — Diet (dietician-owned): calorie formula, macro split per goal,
//           meal-time split.
//   Tab 2 — Pricing (operations-owned): per-meal pricing matrix, discount
//           matrix, plan-length weeks, payment methods, voucher enabled,
//           services catalog, minimum amount.
//
// Each setting is rendered as a JSON textarea editor for V1. We can build
// nicer per-key forms later — JSON is honest and lets the dietician /
// operations tweak any value without code changes.

import { useEffect, useMemo, useState } from 'react'
import { fetchAllSettings, setSetting, type SettingRow } from '../../lib/api/adminSettings'
import type { MealKey, Macro, WalletSettings } from '../../lib/wallet/types'

type PricingMatrixValue = WalletSettings['pricingMatrix']

const MEALS: MealKey[] = ['breakfast', 'lunch', 'dinner', 'snack']
const MACROS: Macro[] = ['p', 'c', 'f']
const MEAL_LABEL: Record<MealKey, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
}
const MACRO_LABEL: Record<Macro, string> = { p: 'Protein', c: 'Carbs', f: 'Fat' }

const DIET_KEYS = [
  'wallet_calorie_formula',
  'wallet_macro_split_by_goal',
  'wallet_meal_split',
] as const

const PRICING_KEYS = [
  'wallet_pricing_matrix',
  'wallet_discount_matrix',
  'wallet_plan_lengths',
  'wallet_payment_methods',
  'wallet_voucher_enabled',
  'wallet_services_catalog',
  'wallet_min_amount_cents',
] as const

const KEY_LABELS: Record<string, { title: string; desc: string }> = {
  wallet_calorie_formula: {
    title: 'Calorie formula',
    desc: 'BMR formula + activity multipliers + goal kcal adjustments. Mifflin-St Jeor is the default.',
  },
  wallet_macro_split_by_goal: {
    title: 'Macro split per goal',
    desc: 'Protein / Carbs / Fat percentages that should sum to 100 per goal. Applied inside every included meal.',
  },
  wallet_meal_split: {
    title: 'Meal-time split',
    desc: '% of daily calories supplied at each meal slot. Skipped meals are not redistributed.',
  },
  wallet_pricing_matrix: {
    title: 'Per-meal pricing matrix',
    desc: 'Regression coefficients per meal: intercept + €/kcal of P/C/F. Both perGram and perKcal forms; "active" picks which one the calculator uses.',
  },
  wallet_discount_matrix: {
    title: 'Discount matrix',
    desc: 'Discount fraction (0–1) keyed by plan length × days/week.',
  },
  wallet_plan_lengths: {
    title: 'Plan length → weeks',
    desc: 'How many calendar weeks each plan length corresponds to (e.g. 1mo = 4.33).',
  },
  wallet_payment_methods: {
    title: 'Allowed payment methods',
    desc: 'Array of payment methods offered at wallet checkout. Default: ["card","link","transfer"].',
  },
  wallet_voucher_enabled: {
    title: 'Voucher codes enabled',
    desc: 'Whether the voucher input is shown at wallet checkout.',
  },
  wallet_services_catalog: {
    title: 'Services catalog',
    desc: 'Available add-on services at wallet checkout. V1 has just dietitian-managed.',
  },
  wallet_min_amount_cents: {
    title: 'Minimum wallet purchase (cents)',
    desc: 'Sanity floor on a plan total. Prevents trivially small purchases.',
  },
}

export function WalletSettings() {
  const [all, setAll] = useState<SettingRow[]>([])
  const [tab, setTab] = useState<'diet' | 'pricing'>('diet')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  async function refresh() {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAllSettings()
    if (error) setErr(error)
    setAll(data ?? [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const byKey = useMemo(() => new Map(all.map((r) => [r.key, r.value])), [all])

  async function save(key: string, value: unknown) {
    setSavedKey(null)
    const { error } = await setSetting(key, value)
    if (error) { setErr(error); return }
    setSavedKey(key)
    setTimeout(() => setSavedKey(null), 1500)
    refresh()
  }

  const visibleKeys = tab === 'diet' ? DIET_KEYS : PRICING_KEYS

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Wallet settings</h1>
      <p className="admin-page-sub">
        Tune the wallet plan calculator. Diet parameters are for the dietitian; pricing is for operations.
        See <code>docs/wallet-pricing-formula.md</code> for what each value does.
      </p>

      <div className="admin-tabs">
        <button className={`admin-tab${tab === 'diet' ? ' active' : ''}`} onClick={() => setTab('diet')}>Diet (dietitian)</button>
        <button className={`admin-tab${tab === 'pricing' ? ' active' : ''}`} onClick={() => setTab('pricing')}>Pricing (operations)</button>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && visibleKeys.map((key) => (
        key === 'wallet_pricing_matrix' ? (
          <PricingMatrixEditor
            key={key}
            value={byKey.get(key)}
            onSave={(v) => save(key, v)}
            justSaved={savedKey === key}
          />
        ) : (
          <SettingEditor
            key={key}
            settingKey={key}
            value={byKey.get(key)}
            onSave={(v) => save(key, v)}
            justSaved={savedKey === key}
          />
        )
      ))}
    </div>
  )
}

interface SettingEditorProps {
  settingKey: string
  value: unknown
  onSave: (v: unknown) => void
  justSaved: boolean
}

function SettingEditor({ settingKey, value, onSave, justSaved }: SettingEditorProps) {
  const initial = useMemo(() => JSON.stringify(value ?? null, null, 2), [value])
  const [text, setText] = useState(initial)
  const [parseErr, setParseErr] = useState<string | null>(null)

  useEffect(() => { setText(initial); setParseErr(null) }, [initial])

  const dirty = text !== initial
  const meta = KEY_LABELS[settingKey] ?? { title: settingKey, desc: '' }

  function handleSave() {
    try {
      const parsed = JSON.parse(text)
      setParseErr(null)
      onSave(parsed)
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  function handleReset() { setText(initial); setParseErr(null) }

  return (
    <section className="admin-setting-card">
      <div className="admin-setting-head">
        <h3>{meta.title} <code className="admin-setting-key">{settingKey}</code></h3>
        {meta.desc && <p>{meta.desc}</p>}
      </div>
      <div className="admin-setting-body">
        <textarea
          className="admin-textarea"
          rows={Math.min(20, text.split('\n').length + 1)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        {parseErr && <div className="admin-error-banner">JSON parse error: {parseErr}</div>}
        <div className="admin-inline-form" style={{ marginTop: 10 }}>
          <button className="admin-btn-primary" onClick={handleSave} disabled={!dirty}>Save</button>
          <button className="admin-btn-secondary" onClick={handleReset} disabled={!dirty}>Reset</button>
          {justSaved && <span className="admin-text-muted">Saved.</span>}
        </div>
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// PricingMatrixEditor — table-driven editor for `wallet_pricing_matrix`.
//
// Shape edited (also persisted as-is to the JSONB column):
//   {
//     active: 'perKcal' | 'perGram',
//     perGram: { p:{breakfast,lunch,dinner,snack}, c:{...}, f:{...} },   // 12 cells
//     perKcal: { p:{...}, c:{...}, f:{...} },                            // 12 cells
//     intercepts: { breakfast, lunch, dinner, snack },                   //  4 cells
//     kcalPerGram: { p, c, f },                                          //  3 cells (biology)
//   }
//
// The "Edit raw JSON" toggle exposes a textarea fallback for cases where the
// stored value is malformed or the editor can't be trusted (escape hatch).
// ──────────────────────────────────────────────────────────────────────────────
interface PricingMatrixEditorProps {
  value: unknown
  onSave: (v: unknown) => void
  justSaved: boolean
}

function emptyForm(): Record<Macro, Record<MealKey, number>> {
  const blank: Record<Macro, Record<MealKey, number>> = {
    p: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
    c: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
    f: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
  }
  return blank
}

function normalizeForEditor(raw: unknown): PricingMatrixValue {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const result: PricingMatrixValue = {
    active: (obj.active === 'perGram' || obj.active === 'perKcal') ? obj.active : 'perKcal',
    perGram: emptyForm(),
    perKcal: emptyForm(),
    intercepts: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
    kcalPerGram: { p: 4, c: 4, f: 9 },
  }

  for (const form of ['perGram', 'perKcal'] as const) {
    const src = obj[form] as Record<string, unknown> | undefined
    if (!src) continue
    // New shape: src.p.breakfast etc.
    if (src.p && typeof src.p === 'object' && 'breakfast' in (src.p as object)) {
      for (const macro of MACROS) {
        const row = src[macro] as Record<MealKey, number> | undefined
        if (!row) continue
        for (const meal of MEALS) result[form][macro][meal] = Number(row[meal]) || 0
      }
      continue
    }
    // Legacy shape: src.breakfast = { i, p, c, f }
    for (const meal of MEALS) {
      const cell = src[meal] as Record<string, number> | undefined
      if (!cell) continue
      for (const macro of MACROS) {
        result[form][macro][meal] = Number(cell[macro]) || 0
      }
      // Carry intercept off the legacy perGram row into the new intercepts field
      if (form === 'perGram' && typeof cell.i === 'number') {
        result.intercepts[meal] = cell.i
      }
    }
  }

  // Explicit intercepts on the new shape override the legacy carry.
  const intercepts = obj.intercepts as Record<MealKey, number> | undefined
  if (intercepts) {
    for (const meal of MEALS) result.intercepts[meal] = Number(intercepts[meal]) || 0
  }
  const kcalPerGram = obj.kcalPerGram as Record<Macro, number> | undefined
  if (kcalPerGram) {
    for (const macro of MACROS) result.kcalPerGram[macro] = Number(kcalPerGram[macro]) || 0
  }

  return result
}

function PricingMatrixEditor({ value, onSave, justSaved }: PricingMatrixEditorProps) {
  const normalized = useMemo(() => normalizeForEditor(value), [value])
  const [draft, setDraft] = useState<PricingMatrixValue>(normalized)
  const [rawMode, setRawMode] = useState(false)
  const [rawText, setRawText] = useState(() => JSON.stringify(normalized, null, 2))
  const [parseErr, setParseErr] = useState<string | null>(null)

  // Re-seed when the stored value changes (after a save, or after switching tabs)
  useEffect(() => {
    setDraft(normalized)
    setRawText(JSON.stringify(normalized, null, 2))
    setParseErr(null)
  }, [normalized])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(normalized),
    [draft, normalized],
  )

  function setCoeff(form: 'perGram' | 'perKcal', macro: Macro, meal: MealKey, val: string) {
    const n = val === '' || val === '-' ? 0 : Number(val)
    if (!Number.isFinite(n)) return
    setDraft((d) => ({
      ...d,
      [form]: { ...d[form], [macro]: { ...d[form][macro], [meal]: n } },
    }))
  }

  function setIntercept(meal: MealKey, val: string) {
    const n = val === '' || val === '-' ? 0 : Number(val)
    if (!Number.isFinite(n)) return
    setDraft((d) => ({ ...d, intercepts: { ...d.intercepts, [meal]: n } }))
  }

  function setKcalPerGram(macro: Macro, val: string) {
    const n = val === '' || val === '-' ? 0 : Number(val)
    if (!Number.isFinite(n)) return
    setDraft((d) => ({ ...d, kcalPerGram: { ...d.kcalPerGram, [macro]: n } }))
  }

  function handleSave() {
    if (rawMode) {
      try {
        const parsed = JSON.parse(rawText)
        setParseErr(null)
        onSave(parsed)
      } catch (e) {
        setParseErr(e instanceof Error ? e.message : 'Invalid JSON')
      }
      return
    }
    onSave(draft)
  }

  function handleReset() {
    setDraft(normalized)
    setRawText(JSON.stringify(normalized, null, 2))
    setParseErr(null)
  }

  const meta = KEY_LABELS['wallet_pricing_matrix']

  return (
    <section className="admin-setting-card">
      <div className="admin-setting-head">
        <h3>{meta.title} <code className="admin-setting-key">wallet_pricing_matrix</code></h3>
        {meta.desc && <p>{meta.desc}</p>}
      </div>
      <div className="admin-setting-body">

        {/* Form toggle: which form does the calculator actually use? */}
        <div className="admin-inline-form" style={{ marginBottom: 14, gap: 16 }}>
          <strong style={{ fontSize: 13 }}>Active form:</strong>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="pricing-active"
              checked={draft.active === 'perKcal'}
              onChange={() => setDraft((d) => ({ ...d, active: 'perKcal' }))}
            /> per kcal
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="pricing-active"
              checked={draft.active === 'perGram'}
              onChange={() => setDraft((d) => ({ ...d, active: 'perGram' }))}
            /> per gram
          </label>
        </div>

        {!rawMode && (
          <>
            <MatrixGrid
              title="Per kcal (€ per kcal of macro at meal)"
              active={draft.active === 'perKcal'}
              coeffs={draft.perKcal}
              step={0.000001}
              onChange={(macro, meal, v) => setCoeff('perKcal', macro, meal, v)}
            />
            <MatrixGrid
              title="Per gram (€ per gram of macro at meal)"
              active={draft.active === 'perGram'}
              coeffs={draft.perGram}
              step={0.000001}
              onChange={(macro, meal, v) => setCoeff('perGram', macro, meal, v)}
            />

            <h4 style={{ margin: '18px 0 8px', fontSize: 13, fontWeight: 700 }}>
              Per-meal intercept (€) — fixed floor cost, independent of macros
            </h4>
            <div className="admin-pricing-row">
              {MEALS.map((meal) => (
                <div key={meal} className="admin-pricing-cell">
                  <label>{MEAL_LABEL[meal]}</label>
                  <input
                    type="number"
                    step={0.0001}
                    className="admin-input"
                    value={draft.intercepts[meal]}
                    onChange={(e) => setIntercept(meal, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <h4 style={{ margin: '18px 0 8px', fontSize: 13, fontWeight: 700 }}>
              Macro → kcal correlation (biology; usually 4 / 4 / 9)
            </h4>
            <div className="admin-pricing-row admin-pricing-row-narrow">
              {MACROS.map((macro) => (
                <div key={macro} className="admin-pricing-cell">
                  <label>{MACRO_LABEL[macro]} (kcal/g)</label>
                  <input
                    type="number"
                    step={0.1}
                    className="admin-input"
                    value={draft.kcalPerGram[macro]}
                    onChange={(e) => setKcalPerGram(macro, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {rawMode && (
          <>
            <textarea
              className="admin-textarea"
              rows={20}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              spellCheck={false}
            />
            {parseErr && <div className="admin-error-banner">JSON parse error: {parseErr}</div>}
          </>
        )}

        <div className="admin-inline-form" style={{ marginTop: 14, gap: 10 }}>
          <button className="admin-btn-primary" onClick={handleSave} disabled={!dirty && !rawMode}>Save</button>
          <button className="admin-btn-secondary" onClick={handleReset} disabled={!dirty && !rawMode}>Reset</button>
          <button
            type="button"
            className="admin-btn-secondary"
            onClick={() => {
              if (!rawMode) setRawText(JSON.stringify(draft, null, 2))
              setRawMode((m) => !m)
              setParseErr(null)
            }}
          >
            {rawMode ? 'Back to table' : 'Edit raw JSON'}
          </button>
          {justSaved && <span className="admin-text-muted">Saved.</span>}
        </div>
      </div>
    </section>
  )
}

interface MatrixGridProps {
  title: string
  active: boolean
  coeffs: Record<Macro, Record<MealKey, number>>
  step: number
  onChange: (macro: Macro, meal: MealKey, value: string) => void
}

function MatrixGrid({ title, active, coeffs, step, onChange }: MatrixGridProps) {
  return (
    <div className={`admin-pricing-matrix${active ? ' is-active' : ''}`}>
      <div className="admin-pricing-matrix-head">
        <h4>{title}</h4>
        {active && <span className="admin-pricing-active-pill">active</span>}
      </div>
      <table className="admin-pricing-table">
        <thead>
          <tr>
            <th></th>
            {MEALS.map((meal) => <th key={meal}>{MEAL_LABEL[meal]}</th>)}
          </tr>
        </thead>
        <tbody>
          {MACROS.map((macro) => (
            <tr key={macro}>
              <th>{MACRO_LABEL[macro]}</th>
              {MEALS.map((meal) => (
                <td key={meal}>
                  <input
                    type="number"
                    step={step}
                    value={coeffs[macro][meal]}
                    onChange={(e) => onChange(macro, meal, e.target.value)}
                    className="admin-input"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
