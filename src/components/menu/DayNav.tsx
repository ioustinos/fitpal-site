import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { WEEK_DATA } from '../../data/menu'
import { totalCount, getCutoffDate } from '../../lib/helpers'

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

  return (
    <div className="day-nav-wrap">
      {/* Week selector */}
      {weeks.length > 1 && (
        <div className="week-selector">
          {weeks.map((w, i) => (
            <button
              key={w.id}
              className={`week-btn${activeWeek === i ? ' active' : ''}`}
              onClick={() => { setActiveWeek(i); setActiveDay(0) }}
            >
              {lang === 'el' ? w.labelEl : w.labelEn}
            </button>
          ))}
        </div>
      )}

      {/* Day pills */}
      <div className="day-nav">
        {days.map((day, i) => {
          const count = totalCount(cart, i)
          const cutoff = getCutoffDate(day.date)
          const now = new Date()
          const isPast = now > cutoff

          return (
            <button
              key={day.date}
              className={`day-btn${activeDay === i ? ' active' : ''}${isPast ? ' past' : ''}`}
              onClick={() => setActiveDay(i)}
            >
              <span className="day-short">{labels[i]}</span>
              <span className="day-date">{formatDate(day.date, lang)}</span>
              {count > 0 && <span className="day-badge">{count}</span>}
              {isPast && <span className="day-past-label">{lang === 'el' ? 'Έκλεισε' : 'Closed'}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}
