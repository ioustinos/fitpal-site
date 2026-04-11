import { useState, useEffect } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { WEEK_DATA } from '../../data/menu'
import { getCutoffDate, CUTOFF_HOUR } from '../../lib/helpers'

export function CutoffBar() {
  const lang = useUIStore((s) => s.lang)
  const activeDay = useUIStore((s) => s.activeDay)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const [, forceUpdate] = useState(0)

  // Refresh every 30s to update countdown
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const week = WEEK_DATA[activeWeek] ?? WEEK_DATA[0]
  const day = week?.days[activeDay]
  if (!day) return null

  const cutoff = getCutoffDate(day.date)
  const now = new Date()
  const diff = cutoff.getTime() - now.getTime()

  if (diff <= 0) {
    return (
      <div className="cutoff-bar closed">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        {lang === 'el'
          ? 'Οι παραγγελίες για αυτή την ημέρα έχουν κλείσει'
          : 'Orders for this day are closed'}
      </div>
    )
  }

  const hours = Math.floor(diff / 3_600_000)
  const mins = Math.floor((diff % 3_600_000) / 60_000)
  const isUrgent = diff < 2 * 3_600_000

  const cutoffLabel = lang === 'el'
    ? `Παραγγελία έως ${CUTOFF_HOUR}:00`
    : `Order by ${CUTOFF_HOUR}:00`

  const countdown = hours > 0
    ? (lang === 'el' ? `${hours}ω ${mins}λ` : `${hours}h ${mins}m`)
    : (lang === 'el' ? `${mins} λεπτά` : `${mins} min`)

  return (
    <div className={`cutoff-bar${isUrgent ? ' urgent' : ''}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>{cutoffLabel}</span>
      <span className="cutoff-countdown">
        {lang === 'el' ? `Απομένουν ${countdown}` : `${countdown} left`}
      </span>
    </div>
  )
}
