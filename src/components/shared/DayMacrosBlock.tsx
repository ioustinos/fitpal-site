import { useAuthStore } from '../../store/useAuthStore'
import { useCartStore, type CartItem } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { showGoalProgress, goalStatus, goalPct, type MacroKey } from '../../lib/goals'
import { MacroIcon } from '../ui/MacroDots'

/**
 * Per-day macro summary for the live cart day. Compact horizontal layout.
 *
 * Used inside DayOrderGroup, which is shared between:
 *   - The cart sidebar (CartSidebar) — narrow column.
 *   - The checkout order summary (OrderSummary).
 *
 * Layout: ONE horizontal row with four pill-style cells (cal / pro / carb / fat).
 * Each cell: macro icon + value side-by-side (NOT stacked). When goal tracking
 * is on, a thin progress bar appears underneath, status-coloured.
 *
 * Designed to be ~24px tall in the cart context — earlier version used the big
 * `.order-macro-card` style from the orders panel, which was way too tall in
 * the cart sidebar (basically 80px per day). Fixed 2026-05-01.
 *
 * Behaviour:
 *   day has no cart items → returns null.
 *   goals enabled         → numbers + status colour + progress bar.
 *   goals disabled / guest → numbers only, neutral colour, no bar.
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
      className={`dmb-row${showBars ? ' dmb-row--with-bars' : ''}`}
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
        return (
          <div key={c.key} className={`dmb-cell dmb-${c.cls} dmb-status-${s}`}>
            <span className="dmb-inline">
              <span className={`dmb-icon dmb-icon-${c.cls}`}>
                <MacroIcon type={c.iconKey} />
              </span>
              <span className="dmb-val">
                {Math.round(value)}{c.unit && <small>{c.unit}</small>}
              </span>
            </span>
            {showBars && (
              <div className="dmb-track">
                <div
                  className="dmb-fill"
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
