import { useAuthStore } from '../../store/useAuthStore'
import { useCartStore, type CartItem } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { showGoalProgress, goalStatus, goalPct, type MacroKey } from '../../lib/goals'
import { MacroIcon } from '../ui/MacroDots'

/**
 * Per-day intake strip (WEC-166 v2).
 *
 * A single-line horizontal strip that sticks just under the category nav
 * so the customer sees their running basket total for the active day no
 * matter how far they've scrolled into the menu grid. The original
 * panel lived above the grid and got scrolled past — that version is
 * gone; this strip replaces it.
 *
 * Layout: four macro cells (kcal / P / C / F) each showing icon, value,
 * and — when goals are enabled — a 2px underline bar coloured by status.
 * When goals are off or the day is empty we keep the strip but render the
 * zero state so there's no jitter as the first item is added.
 */

const ICON_KEY: Record<MacroKey, 'cal' | 'pro' | 'carb' | 'fat'> = {
  cal: 'cal', protein: 'pro', carbs: 'carb', fat: 'fat',
}

const LABEL: Record<MacroKey, { el: string; en: string }> = {
  cal:     { el: 'Θερμ.',  en: 'Cal' },
  protein: { el: 'Πρωτ.',  en: 'P'   },
  carbs:   { el: 'Υδατ.',  en: 'C'   },
  fat:     { el: 'Λιπ.',   en: 'F'   },
}

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

export function DayIntakePanel() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)

  const items = cart[activeDay] ?? []
  const m = sumDay(items)
  const withBars = showGoalProgress(user)

  const cells: Array<{ k: MacroKey; v: number; unit: string }> = [
    { k: 'cal',     v: m.cal,     unit: '' },
    { k: 'protein', v: m.protein, unit: 'g' },
    { k: 'carbs',   v: m.carbs,   unit: 'g' },
    { k: 'fat',     v: m.fat,     unit: 'g' },
  ]

  return (
    <div
      className={`menu-intake-strip${withBars ? '' : ' menu-intake-strip--numbers-only'}`}
      aria-label={lang === 'el' ? 'Διατροφική ανάλυση ημέρας' : "Nutrition breakdown for this day"}
    >
      {cells.map((c) => {
        const s = withBars ? goalStatus(c.k, c.v, user?.goals) : 'none'
        const pct = withBars ? goalPct(c.k, c.v, user?.goals) : 0
        return (
          <div key={c.k} className={`mis-cell mis-${s}`}>
            <span className="mis-icon"><MacroIcon type={ICON_KEY[c.k]} /></span>
            <span className="mis-lbl">{lang === 'el' ? LABEL[c.k].el : LABEL[c.k].en}</span>
            <span className="mis-val">{Math.round(c.v)}{c.unit}</span>
            {withBars && (
              <div className="mis-track">
                <div className="mis-fill" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
