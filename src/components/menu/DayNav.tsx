import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { WEEK_DATA } from '../../data/menu'
import { totalCount } from '../../lib/helpers'

const DAY_LABELS_EL = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ']
const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

export function DayNav() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const setActiveDay = useUIStore((s) => s.setActiveDay)
  const setActiveWeek = useUIStore((s) => s.setActiveWeek)
  const cart = useCartStore((s) => s.cart)
  const weeks = WEEK_DATA
  const week = weeks[activeWeek] ?? weeks[0]
  const days = week.days
  const labels = lang === 'el' ? DAY_LABELS_EL : DAY_LABELS_EN

  function goWeek(w: number) {
    setActiveWeek(w)
    setActiveDay(0)
  }

  return (
    <div className="day-nav">
      {/* Back toggle — shown when not on first week */}
      {activeWeek > 0 && (
        <div className="week-toggle" onClick={() => goWeek(activeWeek - 1)}>
          <div className="wt-arrow">←</div>
          <div className="wt-label">
            {lang === 'el'
              ? (weeks[activeWeek - 1]?.labelEl ?? '')
              : (weeks[activeWeek - 1]?.labelEn ?? '')}
          </div>
        </div>
      )}

      {/* Day tabs */}
      {days.map((day, i) => {
        const count = totalCount(cart, i)
        return (
          <div
            key={day.date}
            className={`day-tab${activeDay === i ? ' active' : ''}`}
            onClick={() => setActiveDay(i)}
          >
            <div className="dn">{labels[i]}</div>
            <div className="dd">{formatDate(day.date, lang)}</div>
            {count > 0 && <div className="day-badge">{count}</div>}
          </div>
        )
      })}

      {/* Next toggle — shown when more weeks exist */}
      {activeWeek < weeks.length - 1 && (
        <div className="week-toggle" onClick={() => goWeek(activeWeek + 1)}>
          <div className="wt-arrow">→</div>
          <div className="wt-label">
            {lang === 'el'
              ? (weeks[activeWeek + 1]?.labelEl ?? '')
              : (weeks[activeWeek + 1]?.labelEn ?? '')}
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}
