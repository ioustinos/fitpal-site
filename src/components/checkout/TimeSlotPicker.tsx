import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { SLOTS } from '../../lib/helpers'
import { makeTr } from '../../lib/translations'

interface TimeSlotPickerProps {
  dayIndex: number
}

export function TimeSlotPicker({ dayIndex }: TimeSlotPickerProps) {
  const lang = useUIStore((s) => s.lang)
  const delivery = useCartStore((s) => s.delivery)
  const setDelivery = useCartStore((s) => s.setDelivery)
  const t = makeTr(lang)

  const current = delivery[dayIndex]
  const selectedSlot = current?.timeSlot ?? ''

  function handleSelect(slot: string) {
    setDelivery(dayIndex, { ...current, timeSlot: slot })
  }

  return (
    <div className="slot-section">
      <div className="slot-label">{t('deliveryTime')}</div>
      <div className="slot-grid">
        {SLOTS.map((slot) => (
          <button
            key={slot}
            className={`slot-btn${selectedSlot === slot ? ' active' : ''}`}
            onClick={() => handleSelect(slot)}
          >
            {slot}
          </button>
        ))}
      </div>
    </div>
  )
}
