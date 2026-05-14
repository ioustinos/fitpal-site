import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useMenuStore } from '../../store/useMenuStore'
import { totalCount, isDayOrderable } from '../../lib/helpers'
import { dayLabel } from '../../lib/datelabels'

/**
 * Weekly day navigation.
 *
 * Each tab shows the weekday + date, with a green cart-count badge when
 * the day has items and a dimmed state when the day is past cutoff.
 *
 * Prev/next-week toggles (`.week-toggle`) sit at the ends of the strip and
 * kick a lazy fetch for the target week when clicked.
 *
 * The cutoff countdown is rendered separately below this strip by the
 * parent (see MenuPage).
 *
 * **Day-tab visual style** — two options coexist behind a flag:
 *   - `card`: the new vertically-stacked card matching the subscription
 *     page's StartDatePicker (DOW / day-number / month abbrev). Cleaner,
 *     more visual emphasis on the date number.
 *   - `pill`: the original compact pill layout (weekday + date inline).
 *
 * Flip `DAY_TAB_STYLE` below to revert. We intentionally kept BOTH CSS
 * class trees (.day-tab / .day-card) so you can A/B without code churn.
 */
const DAY_TAB_STYLE: 'card' | 'pill' = 'card'

// 2-letter, uppercase weekday abbreviations to match the subscription
// page's StartDatePicker. Indexed by JS Date.getDay() (0=Sun..6=Sat).
const DOW_EL_2 = ['ΚΥ', 'ΔΕ', 'ΤΡ', 'ΤΕ', 'ΠΕ', 'ΠΑ', 'ΣΑ']
const DOW_EN_2 = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MONTH_EL_3 = ['ΙΑΝ', 'ΦΕΒ', 'ΜΑΡ', 'ΑΠΡ', 'ΜΑΪ', 'ΙΟΥΝ', 'ΙΟΥΛ', 'ΑΥΓ', 'ΣΕΠ', 'ΟΚΤ', 'ΝΟΕ', 'ΔΕΚ']
const MONTH_EN_3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function DayNav() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const setActiveDay = useUIStore((s) => s.setActiveDay)
  const setActiveWeekAndDay = useUIStore((s) => s.setActiveWeekAndDay)
  const cart = useCartStore((s) => s.cart)

  // Use weeksMeta for navigation — it's always complete even when dish content is lazy.
  const weeksMeta = useMenuStore((s) => s.weeksMeta)
  const weekLoading = useMenuStore((s) => s.weekLoading)
  const loadWeek = useMenuStore((s) => s.loadWeek)
  const settings = useMenuStore((s) => s.settings)

  const week = weeksMeta[activeWeek] ?? weeksMeta[0]
  const days = week?.days ?? []

  function goWeek(w: number) {
    const target = weeksMeta[w]
    if (!target) return
    // Kick lazy-fetch (no-op if already loaded/loading)
    loadWeek(target.id)
    setActiveWeekAndDay(w, 0)
  }

  if (days.length === 0) return null

  const prevMeta = weeksMeta[activeWeek - 1]
  const nextMeta = weeksMeta[activeWeek + 1]
  const prevLoading = prevMeta ? !!weekLoading[prevMeta.id] : false
  const nextLoading = nextMeta ? !!weekLoading[nextMeta.id] : false

  return (
    <div className="day-nav">
      {/* Back toggle — shown when not on first week */}
      {prevMeta && (
        <div
          className={`week-toggle${prevLoading ? ' loading' : ''}`}
          onClick={() => goWeek(activeWeek - 1)}
        >
          <div className="wt-arrow">{prevLoading ? '⟳' : '←'}</div>
          <div className="wt-label">{weekRange(prevMeta.days, lang)}</div>
        </div>
      )}

      {/* Day tabs — render either the card or pill style based on
          DAY_TAB_STYLE. Both styles preserve the same states: active,
          unavailable (past cutoff, click-through OK), closed (kitchen
          shut, non-clickable), and the green cart-count badge. */}
      {days.map((day, i) => {
        // WEC-336: cart is keyed by ISO date now — read the count for
        // this day via its `day.date`, not its position-in-week index.
        const count = totalCount(cart, day.date)
        const isClosed = !!day.inactive
        const unavailable = isClosed || !isDayOrderable(day.date, settings)
        const isActive = activeDay === i
        const baseCls = DAY_TAB_STYLE === 'card' ? 'day-card' : 'day-tab'
        const cls =
          baseCls +
          (isActive ? ' active' : '') +
          (unavailable ? ' unavailable' : '') +
          (isClosed ? ' closed' : '')

        // Date parts — used by both styles, formatted differently.
        const dObj = new Date(day.date + 'T12:00:00')
        const isEl = lang === 'el'
        const dow2 = (isEl ? DOW_EL_2 : DOW_EN_2)[dObj.getDay()]
        const dom = dObj.getDate()
        const mon3 = (isEl ? MONTH_EL_3 : MONTH_EN_3)[dObj.getMonth()]

        return (
          <div
            key={day.date}
            className={cls}
            // WEC-273: closed days are non-clickable (kitchen shut).
            // Past-cutoff days remain clickable so customers can browse.
            onClick={isClosed ? undefined : () => setActiveDay(i)}
            aria-disabled={isClosed || undefined}
            title={isClosed ? (lang === 'el' ? 'Κλειστό' : 'Closed') : undefined}
          >
            {/* X badge in the corner of closed-day tabs (WEC-273) — same
                concept in both styles, dedicated class per style for
                positioning. */}
            {isClosed && (
              <span
                className={DAY_TAB_STYLE === 'card' ? 'day-card-x' : 'day-tab-x'}
                aria-hidden="true"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </span>
            )}

            {DAY_TAB_STYLE === 'card' ? (
              <>
                <span className="day-card-dow">{dow2}</span>
                <span className="day-card-dom">{dom}</span>
                <span className="day-card-mon">{mon3}</span>
                {isClosed
                  ? <span className="day-card-closed-note">{isEl ? 'Κλειστό' : 'Closed'}</span>
                  : (count > 0 && <span className="day-card-badge" aria-label={isEl ? `${count} επιλεγμένα` : `${count} selected`}>{count}</span>)}
              </>
            ) : (
              <>
                <div className="dn">{dayLabel(day.date, lang, 'short')}</div>
                <div className="dd">{formatDate(day.date, lang)}</div>
                {isClosed
                  ? <div className="day-tab-closed-note">{isEl ? 'Κλειστό' : 'Closed'}</div>
                  : (count > 0 && <div className="day-badge">{count}</div>)}
              </>
            )}
          </div>
        )
      })}

      {/* Next toggle — when more weeks exist, normal navigable toggle.
          When the user is on the LAST loaded week we still render a slot but
          disabled with a "Coming soon" label (WEC-257). The slot keeps the
          strip's right edge anchored and signals that more weeks are
          forthcoming, instead of just disappearing. */}
      {nextMeta ? (
        <div
          className={`week-toggle${nextLoading ? ' loading' : ''}`}
          onClick={() => goWeek(activeWeek + 1)}
        >
          <div className="wt-label">{weekRange(nextMeta.days, lang)}</div>
          <div className="wt-arrow">{nextLoading ? '⟳' : '→'}</div>
        </div>
      ) : (
        <div
          className="week-toggle coming-soon"
          aria-disabled="true"
          title={lang === 'el' ? 'Σύντομα διαθέσιμο' : 'Coming soon'}
        >
          <div className="wt-label">{lang === 'el' ? 'Σύντομα διαθέσιμο' : 'Coming soon'}</div>
          <div className="wt-arrow">→</div>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}

function weekRange(days: { date: string }[], lang: 'el' | 'en'): string {
  const first = days[0]?.date
  const last = days[days.length - 1]?.date
  if (!first || !last) return ''
  const d1 = new Date(first + 'T12:00:00')
  const d2 = new Date(last + 'T12:00:00')
  const month = d2.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { month: 'short' })
  return `${d1.getDate()} – ${d2.getDate()} ${month}`
}
