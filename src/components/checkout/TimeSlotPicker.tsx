import { useMemo } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { formatSlots, resolveZone } from '../../lib/helpers'
import { makeTr } from '../../lib/translations'

interface TimeSlotPickerProps {
  dayIndex: number
  /** When true, renders just the slot grid without wrapper/label (parent provides those) */
  inline?: boolean
}

export function TimeSlotPicker({ dayIndex, inline = false }: TimeSlotPickerProps) {
  const lang = useUIStore((s) => s.lang)
  const delivery = useCartStore((s) => s.delivery)
  const setDelivery = useCartStore((s) => s.setDelivery)
  const timeSlots = useMenuStore((s) => s.timeSlots)
  const zones = useMenuStore((s) => s.zones)
  const t = makeTr(lang)

  const current = delivery[dayIndex]
  const selectedSlot = current?.timeSlot ?? ''

  // Resolve zone from this day's postcode (only). Area names on zones are for
  // admin organisation, never customer-facing matching.
  const currentZone = useMemo(
    () => resolveZone(current?.zip, zones),
    [current?.zip, zones],
  )

  // Union of default slots + zone-specific slots (if zone known).
  // We render the full union so admins know the whole catalog exists; zone-
  // unavailable ones are greyed out and non-clickable.
  // Sorted by actual start-time (minutes-since-midnight) so that "9:00–11:00"
  // lands before "10:00–12:00" — lexical sort of formatted strings puts "9" last.
  const { displaySlots, zoneSlotSet } = useMemo(() => {
    const defaults = formatSlots(timeSlots)
    let zoneSlots: string[] = []
    if (currentZone) {
      zoneSlots = timeSlots
        .filter((s) => s.zoneId === currentZone.id)
        .map((s) => `${s.timeFrom}–${s.timeTo}`)
    }
    const set = new Set<string>(zoneSlots)
    const unioned = Array.from(new Set<string>([...defaults, ...zoneSlots]))
    const startMin = (label: string) => {
      const start = label.split('–')[0]
      const [h, m] = start.split(':').map((n) => parseInt(n, 10) || 0)
      return h * 60 + m
    }
    unioned.sort((a, b) => startMin(a) - startMin(b))
    return { displaySlots: unioned, zoneSlotSet: currentZone ? set : null }
  }, [timeSlots, currentZone])

  function handleSelect(slot: string) {
    setDelivery(dayIndex, { ...current, timeSlot: slot })
  }

  // WEC-138 empty state: we can hit this in two cases:
  //  - settings.time_slots is empty in admin (misconfig — shouldn't happen in prod)
  //  - the resolved zone has no slots at all (also misconfig)
  //  Either way, pretending there's a grid is confusing; we render a hint
  //  so the user knows to contact support rather than blaming the site.
  const hasAnyEnabled = displaySlots.some(
    (slot) => zoneSlotSet === null || zoneSlotSet.has(slot),
  )

  const grid = !hasAnyEnabled ? (
    <div className="time-grid-empty">
      {currentZone
        ? (lang === 'el'
            ? 'Δεν υπάρχουν διαθέσιμα ωράρια παράδοσης για τη ζώνη σου. Επικοινώνησε μαζί μας.'
            : 'No delivery windows available in your zone — please contact support.')
        : (lang === 'el'
            ? 'Συμπλήρωσε πρώτα τον Τ.Κ. για να δεις τα διαθέσιμα ωράρια.'
            : 'Enter your postcode first to see available time windows.')}
    </div>
  ) : (
    <div className="time-grid">
      {displaySlots.map((slot) => {
        // If a zone is resolved, only that zone's slots are enabled; if no
        // zone resolved yet, all default slots stay enabled.
        const unavailable = zoneSlotSet !== null && !zoneSlotSet.has(slot)
        return (
          <button
            key={slot}
            className={`tslot${selectedSlot === slot ? ' sel' : ''}${unavailable ? ' unavailable' : ''}`}
            onClick={() => !unavailable && handleSelect(slot)}
            disabled={unavailable}
            title={unavailable ? (lang === 'el' ? 'Δεν είναι διαθέσιμο στη ζώνη σου' : 'Not available in your delivery zone') : undefined}
          >
            {slot}
          </button>
        )
      })}
    </div>
  )

  if (inline) return grid

  return (
    <div className="slot-section">
      <div className="slot-label">{t('deliveryTime')}</div>
      {grid}
    </div>
  )
}
