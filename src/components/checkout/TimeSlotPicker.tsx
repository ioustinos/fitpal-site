import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { formatSlots } from '../../lib/helpers'
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
  const t = makeTr(lang)

  const current = delivery[dayIndex]
  const selectedSlot = current?.timeSlot ?? ''
  const displaySlots = formatSlots(timeSlots)

  function handleSelect(slot: string) {
    setDelivery(dayIndex, { ...current, timeSlot: slot })
  }

  const grid = (
    <div className="time-grid">
      {displaySlots.map((slot) => (
        <button
          key={slot}
          className={`tslot${selectedSlot === slot ? ' sel' : ''}`}
          onClick={() => handleSelect(slot)}
        >
          {slot}
        </button>
      ))}
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
