// WEC-338 — "When would you like to start?" picker for the subscription page.
//
// Horizontal row of upcoming day chips. Days are disabled when:
//   - Past cutoff (via isDayOrderable + AppSettings)
//   - The kitchen is closed (any active weekly_menus row lists the date in
//     inactive_dates[])
//
// We don't render gaps — closed days are present-but-disabled so the chip
// row stays visually rhythmic and the user sees that we know about that
// date. Default-selects the first eligible day on mount.
//
// UI-only: the selected date is held in the parent (`value`/`onChange`),
// but NOT persisted to the wallet_plans row yet. That migration is deferred.

import { useEffect, useMemo } from 'react'
import { useMenuStore } from '../../store/useMenuStore'
import { isDayOrderable } from '../../lib/helpers'

interface StartDatePickerProps {
  lang: 'el' | 'en'
  /** YYYY-MM-DD or null if nothing chosen yet (or no eligible days). */
  value: string | null
  onChange: (next: string) => void
  /** How many days to render. Reference shows 8. */
  daysCount?: number
  /**
   * WEC-360: minimum lead time in days before the first selectable start
   * date. The dietitian team needs ~1 business day to build the plan, so
   * the earliest start is the day-after-tomorrow (lead = 2), never tomorrow.
   */
  minLeadDays?: number
}

const DOW_EL = ['Κυ', 'Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα']
const DOW_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_EL = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαϊ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO YYYY-MM-DD for a local Date. */
function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function StartDatePicker({ lang, value, onChange, daysCount = 8, minLeadDays = 2 }: StartDatePickerProps) {
  const isEl = lang === 'el'
  const settings = useMenuStore((s) => s.settings)
  const weeksMeta = useMenuStore((s) => s.weeksMeta)

  /* Collect every inactive date across all active weekly menus. The kitchen
     is "closed" on these dates so we mark them disabled regardless of cutoff. */
  const inactiveDates = useMemo(() => {
    const set = new Set<string>()
    for (const w of weeksMeta) {
      for (const d of w.days) if (d.inactive) set.add(d.date)
    }
    return set
  }, [weeksMeta])

  /* Build the day window. WEC-360: it starts at today + `minLeadDays` (not
     today) so tomorrow is never offered — the dietitian team needs ~1
     business day to build the plan. Cutoff + kitchen-closed rules still
     apply on top of the lead-time floor. */
  const days = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const now = new Date()
    const out: Array<{
      iso: string
      jsDay: number
      dom: number
      monthIdx: number
      orderable: boolean
      inactive: boolean
    }> = []
    for (let i = 0; i < daysCount; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + minLeadDays + i)
      const iso = toIso(d)
      const inactive = inactiveDates.has(iso)
      const orderable = !inactive && isDayOrderable(iso, settings, now)
      out.push({
        iso,
        jsDay: d.getDay(),
        dom: d.getDate(),
        monthIdx: d.getMonth(),
        orderable,
        inactive,
      })
    }
    return out
  }, [daysCount, minLeadDays, settings, inactiveDates])

  /* Default-select the first eligible day on mount (or whenever the
     existing selection becomes invalid). */
  useEffect(() => {
    const firstEligible = days.find((d) => d.orderable)
    if (!firstEligible) return
    if (!value || !days.find((d) => d.iso === value)?.orderable) {
      onChange(firstEligible.iso)
    }
  }, [days, value, onChange])

  return (
    <div className="wpv2-startdate">
      <div className="wpv2-startdate-row">
        {days.map((d) => {
          const disabled = !d.orderable
          const sel = d.iso === value
          return (
            <button
              key={d.iso}
              type="button"
              className={`wpv2-startdate-chip${sel ? ' sel' : ''}${disabled ? ' disabled' : ''}`}
              disabled={disabled}
              onClick={() => onChange(d.iso)}
              title={
                d.inactive
                  ? (isEl ? 'Κλειστή κουζίνα' : 'Kitchen closed')
                  : disabled
                    ? (isEl ? 'Πέρασε η ώρα παραγγελιάς' : 'Past order cutoff')
                    : undefined
              }
            >
              <span className="wpv2-startdate-dow">{(isEl ? DOW_EL : DOW_EN)[d.jsDay]}</span>
              <span className="wpv2-startdate-dom">{d.dom}</span>
              <span className="wpv2-startdate-mon">{(isEl ? MONTH_EL : MONTH_EN)[d.monthIdx]}</span>
            </button>
          )
        })}
      </div>
      <div className="wpv2-startdate-hint">
        {isEl
          ? 'Θα σε καλέσει η Διαιτολογική μας ομάδα εντός 1 εργάσιμης ημέρας για να χτίσετε μαζί τα γεύματά σου.'
          : 'Our dietitian team will call you within 1 business day to build your meals together.'}
      </div>
    </div>
  )
}
