import { useState } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { makeTr } from '../../lib/translations'
import { ZONES, zoneOk } from '../../lib/helpers'

interface AddressSectionProps {
  dayIndex: number
}

type Mode = 'picker' | 'form'

export function AddressSection({ dayIndex }: AddressSectionProps) {
  const lang = useUIStore((s) => s.lang)
  const user = useAuthStore((s) => s.user)
  const delivery = useCartStore((s) => s.delivery)
  const setDelivery = useCartStore((s) => s.setDelivery)
  const copyDeliveryToAll = useCartStore((s) => s.copyDeliveryToAll)
  const t = makeTr(lang)

  const current = delivery[dayIndex]
  const savedAddresses = user?.addresses ?? []

  const [mode, setMode] = useState<Mode>(savedAddresses.length > 0 ? 'picker' : 'form')
  const [form, setForm] = useState({
    street: current?.street ?? '',
    area: current?.area ?? '',
    zip: current?.zip ?? '',
    notes: current?.notes ?? '',
  })
  const [zoneError, setZoneError] = useState('')

  function handleSelect(addr: typeof savedAddresses[0]) {
    if (!zoneOk(addr.area)) {
      setZoneError(
        lang === 'el'
          ? `Η περιοχή "${addr.area}" δεν εξυπηρετείται. Παρακαλώ επίλεξε άλλη διεύθυνση.`
          : `Area "${addr.area}" is not in our delivery zone. Please select another address.`
      )
      return
    }
    setZoneError('')
    setDelivery(dayIndex, {
      street: addr.street,
      area: addr.area,
      zip: addr.zip ?? '',
      notes: addr.notes ?? '',
    })
  }

  function handleFormSave() {
    if (!form.street || !form.area) return
    if (!zoneOk(form.area)) {
      setZoneError(
        lang === 'el'
          ? `Η περιοχή "${form.area}" δεν εξυπηρετείται.`
          : `Area "${form.area}" is not in our delivery zone.`
      )
      return
    }
    setZoneError('')
    setDelivery(dayIndex, form)
  }

  return (
    <div className="addr-section">
      {savedAddresses.length > 0 && (
        <div className="addr-mode-toggle">
          <button
            className={`addr-mode-btn${mode === 'picker' ? ' active' : ''}`}
            onClick={() => setMode('picker')}
          >
            {t('savedAddresses')}
          </button>
          <button
            className={`addr-mode-btn${mode === 'form' ? ' active' : ''}`}
            onClick={() => setMode('form')}
          >
            {t('newAddress')}
          </button>
        </div>
      )}

      {mode === 'picker' && savedAddresses.length > 0 && (
        <div className="addr-picker">
          {savedAddresses.map((addr, i) => {
            const isSelected =
              current?.street === addr.street && current?.area === addr.area
            return (
              <button
                key={i}
                className={`addr-card${isSelected ? ' selected' : ''}`}
                onClick={() => handleSelect(addr)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <div>
                  <div className="addr-street">{addr.street}</div>
                  <div className="addr-area">{addr.area}{addr.zip ? `, ${addr.zip}` : ''}</div>
                </div>
                {isSelected && (
                  <svg className="addr-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}

      {mode === 'form' && (
        <div className="addr-form">
          <div className="form-row">
            <label className="form-label">{t('street')}</label>
            <input
              className="form-input"
              value={form.street}
              onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
              placeholder={lang === 'el' ? 'π.χ. Ερμού 12' : 'e.g. 12 Main Street'}
            />
          </div>
          <div className="form-row two-col">
            <div>
              <label className="form-label">{t('area')}</label>
              <input
                className="form-input"
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                placeholder={lang === 'el' ? 'Περιοχή' : 'Area'}
              />
            </div>
            <div>
              <label className="form-label">{t('zipCode')}</label>
              <input
                className="form-input"
                value={form.zip}
                onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                placeholder="12345"
              />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">{t('notes')}</label>
            <input
              className="form-input"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={lang === 'el' ? 'π.χ. 3ος όροφος, κουδούνι Σαρρής' : 'e.g. 3rd floor, ring Sarris'}
            />
          </div>
          <button
            className="btn-save-addr"
            onClick={handleFormSave}
            disabled={!form.street || !form.area}
          >
            {t('useThisAddress')}
          </button>
        </div>
      )}

      {zoneError && <div className="zone-error">{zoneError}</div>}

      {current?.street && (
        <div className="addr-copy-row">
          <button
            className="btn-copy-addr"
            onClick={() => copyDeliveryToAll(dayIndex)}
          >
            {lang === 'el' ? 'Χρήση σε όλες τις μέρες' : 'Use for all days'}
          </button>
        </div>
      )}

      {/* Zone info */}
      <div className="zone-info">
        <span className="zone-info-label">
          {lang === 'el' ? 'Διαθέσιμες ζώνες:' : 'Available zones:'}
        </span>
        {ZONES.map((z) => (
          <span key={z.name} className="zone-chip">{z.name}</span>
        ))}
      </div>
    </div>
  )
}
