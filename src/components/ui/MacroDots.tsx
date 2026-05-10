/**
 * Macro display components — matches demo.html CSS exactly
 */

export type MacroKey = 'cal' | 'pro' | 'carb' | 'fat'

// CSS class uses 'prot' (not 'pro') to match demo.html selectors
function cssType(type: MacroKey): string {
  return type === 'pro' ? 'prot' : type
}

// SVG icons matching MACRO_ICONS_SM from demo.html
//
// WEC-300: each icon ALWAYS appears next to a visible text label rendered in
// `.macro-l` (e.g. "Θερμίδες" / "Calories"). The icon is therefore *redundant*
// for assistive tech — adding aria-label here would make screen readers announce
// the macro name twice. The correct treatment is `aria-hidden="true"` +
// `focusable="false"`. If the icon ever gets used standalone (without the label
// text), use the `label` prop on the wrapper instead — caller passes a description.
export function MacroIcon({ type }: { type: MacroKey }) {
  switch (type) {
    case 'cal':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M12 22c-4 0-7-3-7-7.5 0-3 1.5-5.5 3.5-8C10.5 4 12 2 12 2s1.5 2 3.5 4.5c2 2.5 3.5 5 3.5 8C19 19 16 22 12 22z"/>
        </svg>
      )
    case 'carb':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2 22L12 2l10 20H2z"/>
        </svg>
      )
    case 'pro':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M20 14v6M17 17h6"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M2 21v-2a5 5 0 015-5h4"/>
        </svg>
      )
    case 'fat':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <ellipse cx="12" cy="12" rx="4" ry="7"/>
          <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/>
        </svg>
      )
  }
}

const THRESHOLDS: Record<MacroKey, number[]> = {
  cal:  [250, 350, 450, 550],
  pro:  [15,  25,  35,  45],
  carb: [20,  35,  50,  65],
  fat:  [8,   15,  22,  30],
}

function getLevel(type: MacroKey, value: number): number {
  const cuts = THRESHOLDS[type]
  if (value <= cuts[0]) return 1
  if (value <= cuts[1]) return 2
  if (value <= cuts[2]) return 3
  if (value <= cuts[3]) return 4
  return 5
}

interface MacroBarProps {
  cal: number
  pro: number
  carb: number
  fat: number
  labels: { kcal: string; pro: string; carb: string; fat: string }
  /** Optional pre-set 1–5 dot levels (admin-set). When provided, skip threshold calc. */
  levels?: { cal?: number; pro?: number; carb?: number; fat?: number }
}

/**
 * Card macro row — 4-col grid of cream boxes matching .macros CSS from demo.html
 * Layout per box: icon → label → dots (no numeric value, matches buildDishCard JS)
 */
export function MacroDotsRow({ cal, pro, carb, fat, labels, levels }: MacroBarProps) {
  const items: Array<{ val: number; label: string; type: MacroKey }> = [
    { val: cal,  label: labels.kcal, type: 'cal'  },
    { val: pro,  label: labels.pro,  type: 'pro'  },
    { val: carb, label: labels.carb, type: 'carb' },
    { val: fat,  label: labels.fat,  type: 'fat'  },
  ]
  return (
    <div className="macros">
      {items.map((m) => {
        const level = levels?.[m.type] ?? getLevel(m.type, m.val)
        return (
          <div key={m.type} className={`macro ${cssType(m.type)}`}>
            <div className="macro-ico">
              <MacroIcon type={m.type} />
            </div>
            <div className="macro-l">{m.label}</div>
            <div className="macro-dots">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className={`macro-dot${n <= level ? ' filled' : ''}`} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Card macro row — same 4-cell cream-box layout as MacroDotsRow but with the
 * preselected variant's real values instead of the 1-5 dot scale (WEC-254).
 *
 * Per-cell layout: icon → label → "405 kcal" / "37g". The icon row stays the
 * same shape so the card height doesn't jump when admins flip macros_display
 * between modes. Lives in `.macros .macro-vals` so .macros styling is reused
 * and only the inner row needs new CSS (smaller font, bolder weight than dots).
 */
export function MacroValuesRow({ cal, pro, carb, fat, labels }: MacroBarProps) {
  const items: Array<{ val: number; label: string; type: MacroKey; unit: string }> = [
    { val: cal,  label: labels.kcal, type: 'cal',  unit: 'kcal' },
    { val: pro,  label: labels.pro,  type: 'pro',  unit: 'g' },
    { val: carb, label: labels.carb, type: 'carb', unit: 'g' },
    { val: fat,  label: labels.fat,  type: 'fat',  unit: 'g' },
  ]
  return (
    <div className="macros macros-vals">
      {items.map((m) => (
        <div key={m.type} className={`macro ${cssType(m.type)}`}>
          <div className="macro-ico">
            <MacroIcon type={m.type} />
          </div>
          <div className="macro-l">{m.label}</div>
          <div className="macro-val">
            {Math.round(m.val)}
            <span className="macro-unit">{m.unit === 'kcal' ? '' : m.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Big numeric macro display for dish modal. Matches .dm-macro CSS from demo.html */
export function MacroBoxes({ cal, pro, carb, fat, labels }: MacroBarProps) {
  const items: Array<{ val: number; label: string; type: MacroKey; unit?: string }> = [
    { val: cal,  label: labels.kcal, type: 'cal'  },
    { val: pro,  label: labels.pro,  type: 'pro',  unit: 'g' },
    { val: carb, label: labels.carb, type: 'carb', unit: 'g' },
    { val: fat,  label: labels.fat,  type: 'fat',  unit: 'g' },
  ]
  return (
    <div className="dm-macros">
      {items.map((m) => (
        <div key={m.type} className={`dm-macro ${cssType(m.type)}`}>
          <div className="dm-macro-ico"><MacroIcon type={m.type} /></div>
          <div className="dm-macro-v">{m.val}{m.unit}</div>
          <div className="dm-macro-l">{m.label}</div>
        </div>
      ))}
    </div>
  )
}
