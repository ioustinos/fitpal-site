/**
 * Macro display components — matches demo.html CSS exactly
 */

export type MacroKey = 'cal' | 'pro' | 'carb' | 'fat'

// CSS class uses 'prot' (not 'pro') to match demo.html selectors
function cssType(type: MacroKey): string {
  return type === 'pro' ? 'prot' : type
}

export function MacroIcon({ type }: { type: MacroKey }) {
  switch (type) {
    case 'cal':
      return (
        <svg viewBox="0 0 450.88 450.88" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
          <g transform="translate(51.06 0)">
            <path d="M205.6,350.15c-2.49-2.54-2.86-10.51-1.65-14.35,7.01-22.42,2.15-45.82-13.04-64.23-17.39-21.06-24.19-45.18-18.73-73.88-26.98,20.16-34.88,52.84-23.48,82.55,3.96,10.31,5.62,22.39,2.08,32.77-2.24,6.57-9.82,8.98-15.72,8.9-14.85-.2-19.27-15.43-21.78-32.61-13.33,15.77-21.59,34.55-25.84,55.03-4.54,34.71,4.32,68.78,26.34,95.75l.95,7.14c.25,1.87-5.3,3.17-7.74,3.25-32.51-13.23-60.02-34.69-80.33-63.11-32.84-46.49-35.15-104.36-7.92-154.24,26.86-49.21,71.87-80.53,99.21-130.15,15.96-29.81,23.01-61.86,15.65-95.19.99-2.54,2.15-5.52,3.07-6.8,1.1-1.53,5.84-1.03,7.59-.15,18.3,9.18,32.02,22.4,45.46,37.48,17.03,19.11,28.95,40.89,38.18,64.85,11.94,30.99,16.12,62.03,13.93,95.32-.31,4.74,4.22,11.08,7.51,12.8,13.28,6.93,31.37-19.38,32.27-34.47l2.01-33.81c.1-1.62,1.65-5.44,3.11-5.81,1.75-.45,4.87.09,7.61.82,21.55,27.64,37.65,57.24,47.19,91.27,15.51,55.6,6.11,115.09-28.33,161.69-28.58,38.67-85.3,67.13-87.5,58.29-2.03-8.19,24.53-25.86,32.24-61.18,5.44-24.88.22-50.4-13.26-72.17-2.22,13.71-5.23,25.4-14.68,34.01-6.55,5.97-16.78,7.97-24.38.23Z" />
          </g>
        </svg>
      )
    case 'carb':
      return (
        <svg viewBox="0 0 460.26 460.26" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
          <g transform="translate(70.44 0)">
            <path d="M1.06,439.6c22.78-64.84,62.6-139.87,101-197.77,29.31-44.19,61.25-84.9,98.01-123.02l1.58-4.98c.37-1.17-4.73-1.59-5.79-1.41-13.1,9.64-23.92,19.51-34.89,31.57-38.76,39.31-74.83,80.45-102.87,128.11l-29.45,50.06c-7.39-18.34-11.19-33.93-14.79-51.61-7.88-42.54-3.05-84.97,13.95-124.64l6.56-2.67c1.71-.7,4.94,2.82,5.91,4.81l9.21,18.84c.38.78,2.79,2.67,3.52,3.16s2.21-2.76,2.53-3.61c2.76-34.88,16.57-65.9,39.49-92.01,13.01-14.59,27.66-26.06,43.57-37.6l4.98.11c1.36.03,2.51,3.51,2.63,4.89l2.45,28.4c20.43-24.39,43.08-41.54,71.98-52.62C249.75,6.42,280.05.99,311.41,0c1.84-.06,5.8,1.6,7.06,2.79,4.07,3.83-6.37,12.58-12.14,28.11-6.78,18.24-10.63,36.78-13.13,56.17-2.88,22.35-11.99,40.86-25.53,59.81,16.97,1.52,30.92-9.95,36.92-5.71,1.65,1.17,3.88,6.65,3.45,8.71-8.28,40.28-31.05,84.74-67.43,103.75l-32.3,16.88c13.88,10.99,35.11,5.29,37.13,12.18.62,2.11-.65,7.32-2.38,9.16-20.66,21.86-46.3,37.6-75.6,45.76-33.72,9.39-66.69,14.23-101.49,17.74-5.29,7-9.87,14.15-12.65,22.17l-24.67,71.18c-3.06,8.82-10.53,13.57-18.76,10.68-7.79-2.73-11.98-10.82-8.82-19.82Z" />
          </g>
        </svg>
      )
    case 'pro':
      return (
        <svg viewBox="0 0 460.89 460.89" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
          <g transform="translate(11.07 0)">
            <path d="M131.4,458.15c-37.56,7.91-75.73-1.5-103.64-26.52C5.07,411.3,1.4,375.91.08,344.41c-2.21-52.58,44.64-85.85,60.53-133.55,8.23-24.69,9.45-49.88,9.28-75.88-.16-25.05,6.86-48.71,18.21-70.48,8.13-15.58,19.42-27.4,33.17-37.98C142.04,10.54,165.72,1.29,192.58.18c37.55-1.55,72.9,7.05,107.69,20.41s62.71,29.48,90.29,51.16c31.54,24.79,46.85,58.87,47.18,98.85.19,22.52,3.62,43.91-3.45,66.13-9.32,29.25-27.5,55.07-54.34,70.53l-48.25,27.78c-25.02,14.4-47.88,29.51-69.97,48.22-22.66,19.21-44.52,37.88-70.22,53-18.46,10.86-38.18,17.27-60.11,21.89ZM120.37,400.21c32.67-6.4,59.57-20.04,84.11-40.48,20.59-17.14,40.1-33.77,61.76-49.67,25.8-18.93,53.02-33.59,80.88-49.03,23.63-13.09,43.03-30.38,56.66-52.94,24.21-40.07,15.22-86.07-19.79-116.32-48.19-41.65-118.6-70.24-182.94-73.18-16.88-.77-31.8,4.18-46.65,10.48-23.46,9.96-39.84,26.57-51,48.93-11.87,23.8-15.98,47.31-14.44,74.07,1.43,25.06-4.63,50.5-13.3,73.75-13.33,35.74-42.88,62.29-53.21,95.37-4.94,15.82-5.47,35.99,5.43,49.5,21.7,26.89,58.53,36.17,92.5,29.52Z" />
            <path d="M213.24,327.16c-23.75,19.43-47.68,35.29-75.2,47.17-23.91,10.32-50.23,11.13-73.03-2.28-17.83-10.49-24.42-32.68-18.82-52.26,8.18-28.57,29.58-47.73,42.21-72.72,16.61-32.86,20.77-68.63,21.08-105.07.16-19.19,2.81-38.03,12.01-54.68,16.29-29.51,48.04-46.64,82.12-47.39,38.93-.85,88.62,17.22,123.94,36.18,19.07,10.24,34.82,24.23,47.95,41.42,26.93,35.24,17.27,78.84-15.59,108.82-29.66,27.07-74.64,41.86-103.45,65.44l-43.22,35.37ZM231.91,182.65c8.14-10.39,16.88-22.03,29.45-27.51,13.87-6.05,37.48,6.76,63.75,2.58,2.82-.45,6.93-5.68,6.87-8.38s-3.6-7.98-6.53-8.8l-44.82-12.55c-19.39-5.43-36.02-11.73-51.73-24.42-12.73-10.28-36.61-27.04-42.24-19.1s10.81,25.42,22.36,35.68c10,8.88,14.77,21.68,7.07,33.54l-13.21,20.33-32.96,54.86-24.93,43.92c-1.39,2.45.64,8.69,2.48,8.18l7.02-1.93,52.08-64.06,25.36-32.37Z" />
          </g>
        </svg>
      )
    case 'fat':
      return (
        <svg viewBox="0 0 454.46 454.46" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
          <g transform="translate(40.88 0)">
            <path d="M254.09,326.83c-41.84,30.7-107.58,28.55-146.6-10.16-24.91-24.71-39.31-58.43-35.38-94.26,4.06-37.07,33.19-89.8,52.54-124.5L178.22,4.78l6.66-4.49c1.74-1.17,6.84,1.41,7.99,3.28,25.31,41.11,48.99,81.52,71.32,124.31,12.14,23.26,22.29,46.04,30.87,70.6,6.21,17.77,8.2,35.3,4.19,54.11-6.14,28.79-20.94,56.46-45.17,74.24ZM269.05,224.74c-.5-6.02-5.72-10.4-10.6-10.46-4.37-.06-11.43,4.38-11.28,9.78.78,28.48-15.32,52.36-41.29,63.11-5.87,2.43-8.36,10.07-6.5,14.77,8.98,22.65,74.85-14.45,69.66-77.2Z" />
            <path d="M295.54,394.81c-7.6,1.9-18.53,9.03-18.34,17.14.31,13.22-3.87,24.29-18.25,28.65-55.14,16.72-114.22,17.95-170.95,5.65-7.66-1.66-15.16-5.36-20.67-9.5-15.06-11.3-.47-24.97-4.09-33.46-3.3-7.73-12.11-12.13-20.27-13.6-17.73-3.21-41.87-9.35-42.94-23.22-1.68-21.86,59.1-35.9,86.02-37.57,50.96,53.01,139.37,56.46,191.99,6.64,3.73-3.54,9.57-7.19,14.92-6.57,24.12,2.82,59.43,7.06,69.26,23.35,4.84,8.02,1.93,17.98-5.5,23.39-7.6,5.53-17.15,8.08-26.41,10.39l-34.78,8.7Z" />
            <path d="M372.57,424.43c3.51,23.28-66.9,22.34-67.34,1.43-.42-19.79,63.86-24.55,67.34-1.43Z" />
          </g>
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
