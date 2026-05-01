import { useAuthStore } from '../../store/useAuthStore'
import { useCartStore, type CartItem } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { showGoalProgress, goalStatus, goalPct, type MacroKey } from '../../lib/goals'
import { MacroIcon } from '../ui/MacroDots'

/**
 * Per-day macro summary for the live cart day.
 *
 * Shared between:
 *   - The cart sidebar (CartSidebar.tsx) — under each day's items.
 *   - The checkout order summary (OrderSummary.tsx, indirectly via the cart
 *     refactor in DayOrderGroup) — same layout, same data, same colours so
 *     the customer sees identical breakdown across surfaces.
 *
 * Visual design (redesigned 2026-04-30 — was a slim cgb-cell strip; now the
 * polished `order-macro-card` look used elsewhere in the app):
 *
 *   - 4-cell horizontal grid: Calories / Protein / Carbs / Fat.
 *   - Each cell gets a soft pastel background + matching border based on
 *     macro type (cal/protein/carbs/fat). Same palette as the order
 *     detail / goals-history surfaces, so the customer never sees two
 *     "macro card" looks side-by-side.
 *   - Big number, label, MacroIcon, optional progress bar.
 *   - Progress bar appears only when `showGoalProgress(user)` is true,
 *     anchored to the user's configured goal max/min, status-coloured
 *     (green/yellow/red).
 *
 * Behaviour matrix:
 *   day has no cart items   → returns null (caller doesn't render it)
 *   goals enabled           → numbers + status colour + progress bar
 *   goals disabled / guest  → numbers only, neutral pill, no bar
 */

interface CellSpec {
  key: MacroKey
  cls: 'cal' | 'protein' | 'carbs' | 'fat'
  iconKey: 'cal' | 'pro' | 'carb' | 'fat'
  unit: string
}

const CELLS: CellSpec[] = [
  { key: 'cal',     cls: 'cal',     iconKey: 'cal',  unit: '' },
  { key: 'protein', cls: 'protein', iconKey: 'pro',  unit: 'g' },
  { key: 'carbs',   cls: 'carbs',   iconKey: 'carb', unit: 'g' },
  { key: 'fat',     cls: 'fat',     iconKey: 'fat',  unit: 'g' },
]

const LABEL: Record<MacroKey, { el: string; en: string }> = {
  cal:     { el: 'Θερμίδες',     en: 'Calories' },
  protein: { el: 'Πρωτεΐνη',     en: 'Protein' },
  carbs:   { el: 'Υδατάνθρακες', en: 'Carbs' },
  fat:     { el: 'Λιπαρά',       en: 'Fat' },
}

function sumDay(items: CartItem[]) {
  return items.reduce(
    (a, i) => ({
      cal:     a.cal     + (i.macros?.cal  ?? 0) * i.qty,
      protein: a.protein + (i.macros?.pro  ?? 0) * i.qty,
      carbs:   a.carbs   + (i.macros?.carb ?? 0) * i.qty,
      fat:     a.fat     + (i.macros?.fat  ?? 0) * i.qty,
    }),
    { cal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

export function DayMacrosBlock({ dayIndex }: { dayIndex: number }) {
  const user = useAuthStore((s) => s.user)
  const lang = useUIStore((s) => s.lang)
  const cart = useCartStore((s) => s.cart)

  const items = cart[dayIndex] ?? []
  if (items.length === 0) return null

  const showBars = showGoalProgress(user)
  const m = sumDay(items)

  return (
    <div
      className={`order-macros-row${showBars ? '' : ' order-macros-row--numbers-only'}`}
      aria-label={
        showBars
          ? (lang === 'el' ? 'Πρόοδος στόχων' : 'Goal progress')
          : (lang === 'el' ? 'Διατροφικά στοιχεία' : 'Nutrition')
      }
    >
      {CELLS.map((c) => {
        const value = m[c.key]
        const s = showBars ? goalStatus(c.key, value, user?.goals) : 'none'
        const pct = showBars ? goalPct(c.key, value, user?.goals) : 0
        const label = lang === 'el' ? LABEL[c.key].el : LABEL[c.key].en
        return (
          <div key={c.key} className={`order-macro-card ${c.cls}`} data-goal-status={s}>
            <div className={`order-macro-icon ${c.cls}`}>
              <MacroIcon type={c.iconKey} />
            </div>
            <span className="order-macro-label">{label}</span>
            <span className="order-macro-val">
              {Math.round(value)}{c.unit && <small>{c.unit}</small>}
            </span>
            {showBars && (
              <div className="order-macro-bar">
                <div
                  className="order-macro-bar-fill"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
