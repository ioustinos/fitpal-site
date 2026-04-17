import { useState, useEffect } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { getCutoffDate } from '../../lib/helpers'

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

  const weeks = useMenuStore((s) => s.weeks)
  const settings = useMenuStore((s) => s.settings)
  const week = weeks[activeWeek] ?? weeks[0]
  const day = week?.days[activeDay]
  if (!day) return null

  const cutoff = getCutoffDate(day.date, settings)
  const now = new Date()
  const diff = cutoff.getTime() - now.getTime()

  if (diff <= 0) {
    return (
      <div className="cutoff-bar closed">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
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

  // Format cutoff label — include day name so user knows *which* day at 18:00
  const cutoffHour = cutoff.getHours()
  const dayNamesEl = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ']
  const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const cutoffDayName = (lang === 'el' ? dayNamesEl : dayNamesEn)[cutoff.getDay()]
  const cutoffLabel = lang === 'el'
    ? `Παραγγελία έως ${cutoffDayName} ${cutoffHour}:00`
    : `Order by ${cutoffDayName} ${cutoffHour}:00`

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
