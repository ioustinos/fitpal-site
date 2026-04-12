/**
 * Macro display components — matches demo.html CSS exactly
 */

type MacroKey = 'cal' | 'pro' | 'carb' | 'fat'

// CSS class uses 'prot' (not 'pro') to match demo.html selectors
function cssType(type: MacroKey): string {
  return type === 'pro' ? 'prot' : type
}

// SVG icons matching MACRO_ICONS_SM from demo.html
function MacroIcon({ type }: { type: MacroKey }) {
  switch (type) {
    case 'cal':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22c-4 0-7-3-7-7.5 0-3 1.5-5.5 3.5-8C10.5 4 12 2 12 2s1.5 2 3.5 4.5c2 2.5 3.5 5 3.5 8C19 19 16 22 12 22z"/>
        </svg>
      )
    case 'carb':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 22L12 2l10 20H2z"/>
        </svg>
      )
    case 'pro':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14v6M17 17h6"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M2 21v-2a5 5 0 015-5h4"/>
        </svg>
      )
    case 'fat':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
}

/**
 * Card macro row — 4-col grid of cream boxes matching .macros CSS from demo.html
 * Layout per box: icon → label → dots (no numeric value, matches buildDishCard JS)
 */
export function MacroDotsRow({ cal, pro, carb, fat, labels }: MacroBarProps) {
  const items: Array<{ val: number; label: string; type: MacroKey }> = [
    { val: cal,  label: labels.kcal, type: 'cal'  },
    { val: pro,  label: labels.pro,  type: 'pro'  },
    { val: carb, label: labels.carb, type: 'carb' },
    { val: fat,  label: labels.fat,  type: 'fat'  },
  ]
  return (
    <div className="macros">
      {items.map((m) => {
        const level = getLevel(m.type, m.val)
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
