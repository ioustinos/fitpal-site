import { useAuthStore } from '../../store/useAuthStore'
import { useCartStore, type CartItem } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { showGoalProgress, goalStatus, goalPct, type MacroKey } from '../../lib/goals'
import { MacroIcon } from '../ui/MacroDots'

/**
 * Per-day macro summary (+ goal progress bars when goals are enabled).
 *
 * Shared by the cart sidebar (WEC-164) and the checkout order summary
 * (WEC-165) so the two surfaces never drift apart. Goal classification logic
 * lives in `src/lib/goals.ts` (WEC-163) — this component is purely the
 * "live cart day" flavour; the Account → Orders surface (WEC-167) uses the
 * same helpers against stored order macros.
 *
 * Behaviour matrix:
 *
 *   showGoalProgress(user) = true  → kcal + P/C/F numbers + coloured status +
 *                                    progress bars (anchored against the
 *                                    user's current goal max/min).
 *   showGoalProgress(user) = false → numbers only, neutral styling, no bars.
 *   day has no cart items          → renders nothing (returns null).
 *
 * The numbers come from `cart[dayIndex]` — each item's variant macros × qty,
 * summed across the day. Same for both surfaces.
 *
 * Layout: 4-column grid. Each cell stacks an icon+value on top, optionally a
 * 3px progress bar underneath. CSS lives in `.cart-goal-bars` +
 * `.cart-goal-bars--numbers-only` + `.cgb-*` (class names kept for backwards
 * compat with the WEC-141 stylesheet).
 */

function sumDay(items: CartItem[]) {
  return items.reduce(
    (a, i) => ({
      cal: a.cal + (i.macros?.cal ?? 0) * i.qty,
      protein: a.protein + (i.macros?.pro ?? 0) * i.qty,
      carbs: a.carbs + (i.macros?.carb ?? 0) * i.qty,
      fat: a.fat + (i.macros?.fat ?? 0) * i.qty,
    }),
    { cal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

// MacroIcon uses 'cal' | 'pro' | 'carb' | 'fat' — map our keys to its.
const ICON_KEY: Record<MacroKey, 'cal' | 'pro' | 'carb' | 'fat'> = {
  cal: 'cal', protein: 'pro', carbs: 'carb', fat: 'fat',
}

export function DayMacrosBlock({ dayIndex }: { dayIndex: number }) {
  const user = useAuthStore((s) => s.user)
  const lang = useUIStore((s) => s.lang)
  const cart = useCartStore((s) => s.cart)

  const items = cart[dayIndex] ?? []
  if (items.length === 0) return null

  const showBars = showGoalProgress(user)

  const m = sumDay(items)
  const bars: Array<{ k: MacroKey; v: number }> = [
    { k: 'cal',     v: m.cal },
    { k: 'protein', v: m.protein },
    { k: 'carbs',   v: m.carbs },
    { k: 'fat',     v: m.fat },
  ]

  return (
    <div
      className={`cart-goal-bars${showBars ? '' : ' cart-goal-bars--numbers-only'}`}
      aria-label={
        showBars
          ? (lang === 'el' ? 'Πρόοδος στόχων' : 'Goal progress')
          : (lang === 'el' ? 'Διατροφικά στοιχεία' : 'Nutrition')
      }
    >
      {bars.map((b) => {
        const s = showBars ? goalStatus(b.k, b.v, user?.goals) : 'none'
        const pct = showBars ? goalPct(b.k, b.v, user?.goals) : 0
        return (
          <div key={b.k} className={`cgb-cell cgb-${s}`}>
            <div className="cgb-top">
              <span className="cgb-icon"><MacroIcon type={ICON_KEY[b.k]} /></span>
              <span className="cgb-val">{Math.round(b.v)}</span>
            </div>
            {showBars && (
              <div className="cgb-track">
                <div className="cgb-fill" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
