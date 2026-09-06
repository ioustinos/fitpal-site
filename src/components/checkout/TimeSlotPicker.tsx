import { useEffect, useMemo } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { formatSlots, resolveZone } from '../../lib/helpers'
import { makeTr } from '../../lib/translations'
import { useStorefront } from '../../lib/storefront/StoreProvider'

/**
 * WEC-712: a company/reseller store has its own fixed delivery window(s),
 * held as a `time_slots` row in `store_settings`. Accepts the same shapes the
 * global setting uses — "09:00-11:00" strings or {from,to} / {time_from,time_to}
 * objects — and normalises to the "HH:MM–HH:MM" label the grid renders.
 */
function storeSlotLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const pad = (t: string) => {
    const p = String(t).trim().split(':')
    return `${(p[0] ?? '').padStart(2, '0')}:${(p[1] ?? '00').padStart(2, '0')}`
  }
  return raw
    .map((s) => {
      if (typeof s === 'string') {
        const [a, b] = s.split(/[-–]/)
        return a && b ? `${pad(a)}–${pad(b)}` : ''
      }
      if (s && typeof s === 'object') {
        const o = s as { from?: string; to?: string; time_from?: string; time_to?: string }
        const a = o.from ?? o.time_from
        const b = o.to ?? o.time_to
        return a && b ? `${pad(a)}–${pad(b)}` : ''
      }
      return ''
    })
    .filter(Boolean)
}

interface TimeSlotPickerProps {
  /** WEC-336: ISO delivery date this picker controls slots for. */
  dayDate: string
  /** When true, renders just the slot grid without wrapper/label (parent provides those) */
  inline?: boolean
}

export function TimeSlotPicker({ dayDate, inline = false }: TimeSlotPickerProps) {
  const lang = useUIStore((s) => s.lang)
  const delivery = useCartStore((s) => s.delivery)
  const setDelivery = useCartStore((s) => s.setDelivery)
  const timeSlots = useMenuStore((s) => s.timeSlots)
  const zones = useMenuStore((s) => s.zones)
  const storefront = useStorefront()
  const storefrontSettings = storefront.settings as Record<string, unknown>
  const isMainStore = storefront.isMain
  const t = makeTr(lang)

  const current = delivery[dayDate]
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
    // WEC-712: on a store with its own fixed window(s), that list IS the grid.
    // Zone slots do not apply — the delivery address is the company's, fixed,
    // and possibly outside every retail zone. Showing the retail windows here
    // would offer the customer a choice the server then rejects.
    const storeSlots = storeSlotLabels(storefrontSettings.time_slots)
    if (!isMainStore && storeSlots.length > 0) {
      return { displaySlots: storeSlots, zoneSlotSet: null }
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSlots, currentZone, isMainStore, storefrontSettings])

  function handleSelect(slot: string) {
    setDelivery(dayDate, { ...current, timeSlot: slot })
  }

  // WEC-525: never let an unselectable slot remain the active selection.
  // Two ways to get here: prefs prefilled a slot the zone doesn't offer, or
  // the customer picked a slot and THEN changed zip to a zone without it.
  // The button renders disabled/greyed, but the store still held the value —
  // presence-only validation passed and the server rejected at submit.
  // Clearing re-runs validation, which now shows "no delivery time selected".
  useEffect(() => {
    if (selectedSlot && zoneSlotSet !== null && !zoneSlotSet.has(selectedSlot)) {
      setDelivery(dayDate, { ...current, timeSlot: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlot, zoneSlotSet, dayDate])

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
        ? t('coNoSlotsInZone')
        : t('coEnterPostcodeFirst')}
    </div>
  ) : (
    <div className="time-grid">
      {displaySlots.map((slot) => {
        // If a zone is resolved, only that zone's slots are enabled; if no
        // zone resolved yet, all default slots stay enabled.
        const unavailable = zoneSlotSet !== null && !zoneSlotSet.has(slot)
        const isSelected = selectedSlot === slot
        return (
          <button
            key={slot}
            type="button"
            className={`tslot${isSelected ? ' sel' : ''}${unavailable ? ' unavailable' : ''}`}
            onClick={() => !unavailable && handleSelect(slot)}
            disabled={unavailable}
            // WEC-302: expose the selected state to assistive tech. Visual-only
            // selection was a false negative for screen readers AND test
            // automation alike. aria-pressed is the right pattern for buttons
            // acting like toggles (vs aria-selected which is for listbox/tab).
            aria-pressed={isSelected}
            title={unavailable ? t('coSlotNotAvailable') : undefined}
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
