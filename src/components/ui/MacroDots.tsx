/**
 * Renders a 5-dot scale for a macro value.
 * Thresholds: [low, mid-low, mid, mid-high, high]
 */

const THRESHOLDS = {
  cal:  [200, 350, 500, 700, 900],
  pro:  [10,  20,  30,  45,  60],
  carb: [15,  30,  50,  70,  90],
  fat:  [8,   14,  20,  28,  36],
}

type MacroKey = keyof typeof THRESHOLDS

function getLevel(type: MacroKey, value: number): number {
  const t = THRESHOLDS[type]
  if (value <= t[0]) return 1
  if (value <= t[1]) return 2
  if (value <= t[2]) return 3
  if (value <= t[3]) return 4
  return 5
}

interface MacroDotsProps {
  type: MacroKey
  value: number
  label: string
}

export function MacroDots({ type, value, label }: MacroDotsProps) {
  const level = getLevel(type, value)
  return (
    <div className="macro-chip">
      <div className="macro-dots">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={`macro-dot${n <= level ? ` filled ${type}` : ''}`}
          />
        ))}
      </div>
      <span>{label}</span>
    </div>
  )
}

interface MacroBarProps {
  cal: number
  pro: number
  carb: number
  fat: number
  labels: { kcal: string; pro: string; carb: string; fat: string }
}

/** Full row of 4 macro dot groups for use on dish cards */
export function MacroDotsRow({ cal, pro, carb, fat, labels }: MacroBarProps) {
  return (
    <div className="dish-macros-row">
      <MacroDots type="cal"  value={cal}  label={labels.kcal} />
      <MacroDots type="pro"  value={pro}  label={labels.pro} />
      <MacroDots type="carb" value={carb} label={labels.carb} />
      <MacroDots type="fat"  value={fat}  label={labels.fat} />
    </div>
  )
}

/** Numeric macro boxes for the dish modal */
export function MacroBoxes({ cal, pro, carb, fat, labels }: MacroBarProps) {
  const items = [
    { val: cal,  label: labels.kcal, key: 'cal' },
    { val: pro,  label: labels.pro,  key: 'pro' },
    { val: carb, label: labels.carb, key: 'carb' },
    { val: fat,  label: labels.fat,  key: 'fat' },
  ]
  return (
    <div className="dm-macros">
      {items.map((m) => (
        <div key={m.key} className="dm-macro">
          <div className="dm-macro-val">{m.val}</div>
          <div className="dm-macro-label">{m.label}</div>
        </div>
      ))}
    </div>
  )
}
