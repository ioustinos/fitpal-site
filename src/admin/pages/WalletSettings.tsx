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
    desc: 'Available add-on services at wallet checkout. V1 has just dietician-managed.',
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
        Tune the wallet plan calculator. Diet parameters are for the dietician; pricing is for operations.
        See <code>docs/wallet-pricing-formula.md</code> for what each value does.
      </p>

      <div className="admin-tabs">
        <button className={`admin-tab${tab === 'diet' ? ' active' : ''}`} onClick={() => setTab('diet')}>Diet (dietician)</button>
        <button className={`admin-tab${tab === 'pricing' ? ' active' : ''}`} onClick={() => setTab('pricing')}>Pricing (operations)</button>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && visibleKeys.map((key) => (
        <SettingEditor
          key={key}
          settingKey={key}
          value={byKey.get(key)}
          onSave={(v) => save(key, v)}
          justSaved={savedKey === key}
        />
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
