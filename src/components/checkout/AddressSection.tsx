import { useState, useEffect, useCallback, useRef } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useAuthStore, type Address } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { makeTr } from '../../lib/translations'
import { zipInZone } from '../../lib/helpers'
import { useToast } from '../ui/Toast'

interface AddressSectionProps {
  dayIndex: number
}

/**
 * Modes:
 *   selected — an address is already set for this day; shows the summary card with Edit / Change
 *   edit     — form pre-populated from the selected saved address; "Save changes" appears on any change
 *   change   — picker with saved addresses, none pre-selected; user picks a different one
 *   form     — blank form for adding a brand-new address
 */
type Mode = 'selected' | 'edit' | 'change' | 'form'

const ADDR_ICONS: Record<string, string> = {
  Home: '🏠', Σπίτι: '🏠',
  Office: '🏢', Γραφείο: '🏢',
  Work: '🏢', Δουλειά: '🏢',
  Gym: '🏋️', Γυμναστήριο: '🏋️',
}

function addrIcon(addr: Address, _lang: 'el' | 'en'): string {
  return ADDR_ICONS[addr.labelEn] || ADDR_ICONS[addr.labelEl] || '📍'
}

export function AddressSection({ dayIndex }: AddressSectionProps) {
  const lang = useUIStore((s) => s.lang)
  const user = useAuthStore((s) => s.user)
  const updateAddresses = useAuthStore((s) => s.updateAddresses)
  const delivery = useCartStore((s) => s.delivery)
  const setDelivery = useCartStore((s) => s.setDelivery)
  const copyDeliveryToAll = useCartStore((s) => s.copyDeliveryToAll)
  const cart = useCartStore((s) => s.cart)
  const t = makeTr(lang)
  const toast = useToast((s) => s.show)

  const zones = useMenuStore((s) => s.zones)

  const current = delivery[dayIndex]
  const savedAddresses = (user?.addresses ?? []) as Address[]
  const activeDayCount = Object.keys(cart).filter((k) => (cart[Number(k)]?.length ?? 0) > 0).length

  // Find the saved address object that matches the current delivery's addrId
  const selectedAddr = current?.addrId
    ? savedAddresses.find((a) => a.id === current.addrId) ?? null
    : null

  // Determine initial mode
  const getInitialMode = (): Mode => {
    if (selectedAddr) return 'selected'
    if (savedAddresses.length > 0) return 'change'
    return 'form'
  }

  const [mode, setMode] = useState<Mode>(getInitialMode)
  const [form, setForm] = useState({
    street: '',
    area: '',
    zip: '',
    floor: '',
    doorbell: '',
    notes: '',
  })
  const [editOriginal, setEditOriginal] = useState(form) // snapshot to detect changes
  const [zoneStatus, setZoneStatus] = useState<'valid' | 'invalid' | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [addrName, setAddrName] = useState('')

  // When delivery gets an addrId (e.g. prepopulation after login, "use for all days"),
  // always switch to selected mode — addrId means a saved address was set programmatically
  useEffect(() => {
    if (!current?.addrId) return
    const addr = savedAddresses.find((a) => a.id === current.addrId)
    if (!addr) return
    if (mode === 'edit') return // only skip if actively editing that same address
    setMode('selected')
  }, [current?.addrId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync local form FROM store when delivery changes externally (e.g. copyDeliveryToAll)
  const prevStreetRef = useRef(current?.street)
  useEffect(() => {
    if (!current?.street) return
    // Only sync if the store changed from outside (not from our own auto-apply)
    if (current.street !== prevStreetRef.current && current.street !== form.street) {
      setForm({
        street: current.street || '',
        area: current.area || '',
        zip: current.zip || '',
        floor: current.floor || '',
        doorbell: current.doorbell || '',
        notes: current.notes || '',
      })
      if (current.zip) {
        setZoneStatus(zipInZone(current.zip, zones) ? 'valid' : 'invalid')
      } else {
        setZoneStatus(null)
      }
    }
    prevStreetRef.current = current.street
  }, [current?.street, current?.area, current?.zip, current?.floor, current?.doorbell, current?.notes]) // eslint-disable-line react-hooks/exhaustive-deps

  // When new-address form fields change AND are valid, auto-apply to delivery.
  // Zone validity is strictly postcode-based.
  const autoApplyForm = useCallback(() => {
    if (mode !== 'form') return
    if (!form.street || !form.area || !form.zip) return
    if (!zipInZone(form.zip, zones)) return

    setDelivery(dayIndex, {
      street: form.street,
      area: form.area,
      zip: form.zip || '',
      floor: form.floor || '',
      doorbell: form.doorbell || '',
      notes: form.notes || '',
    })
  }, [mode, form, dayIndex, setDelivery])

  useEffect(() => {
    autoApplyForm()
  }, [autoApplyForm])

  // Area is free text — no zone validation fires on it.
  const handleAreaChange = (value: string) => {
    setForm((f) => ({ ...f, area: value }))
  }

  // Zone match is postcode-only. Empty zip → no status yet; non-empty → valid or invalid.
  const handleZipChange = (value: string) => {
    setForm((f) => ({ ...f, zip: value }))
    const clean = value.trim()
    if (!clean) { setZoneStatus(null); return }
    setZoneStatus(zipInZone(clean, zones) ? 'valid' : 'invalid')
  }

  // Select a saved address from picker
  function handleSelectAddress(addr: Address) {
    setDelivery(dayIndex, {
      street: addr.street,
      area: addr.area,
      zip: addr.zip ?? '',
      floor: addr.floor ?? '',
      doorbell: addr.doorbell ?? '',
      notes: addr.notes ?? '',
      addrId: addr.id,
    })
    setMode('selected')
  }

  // "Edit" — open form with current saved address data
  function handleEdit() {
    if (!selectedAddr) return
    const snapshot = {
      street: selectedAddr.street,
      area: selectedAddr.area,
      zip: selectedAddr.zip ?? '',
      floor: selectedAddr.floor ?? '',
      doorbell: selectedAddr.doorbell ?? '',
      notes: selectedAddr.notes ?? '',
    }
    setForm(snapshot)
    setEditOriginal(snapshot)
    setZoneStatus(selectedAddr.zip && zipInZone(selectedAddr.zip, zones) ? 'valid' : null)
    setMode('edit')
  }

  // "Change" — go to picker with nothing pre-selected
  function handleChange() {
    setMode('change')
  }

  // Back from edit or change → return to selected view
  function handleBackToSelected() {
    setMode('selected')
  }

  // Save edited address changes
  function handleSaveEdit() {
    if (!selectedAddr) return
    const updatedAddr: Address = {
      ...selectedAddr,
      street: form.street,
      area: form.area,
      zip: form.zip,
      floor: form.floor,
      doorbell: form.doorbell,
      notes: form.notes,
    }
    // Update in saved addresses
    const newAddresses = savedAddresses.map((a) =>
      a.id === selectedAddr.id ? updatedAddr : a
    )
    updateAddresses(newAddresses)
    // Update delivery
    setDelivery(dayIndex, {
      street: form.street,
      area: form.area,
      zip: form.zip || '',
      floor: form.floor || '',
      doorbell: form.doorbell || '',
      notes: form.notes || '',
      addrId: selectedAddr.id,
    })
    toast(lang === 'el' ? 'Διεύθυνση ενημερώθηκε!' : 'Address updated!')
    setMode('selected')
  }

  // Enter form mode for a new address (clear form)
  function handleNewAddress() {
    setForm({ street: '', area: '', zip: '', floor: '', doorbell: '', notes: '' })
    setDelivery(dayIndex, { street: '', area: '', zip: '', floor: '', doorbell: '', notes: '' })
    setZoneStatus(null)
    setMode('form')
  }

  // Go back to picker/change from new-address form
  function handleBackFromForm() {
    if (savedAddresses.length > 0) {
      // If there was a previously selected address, go back to selected
      if (selectedAddr) {
        handleSelectAddress(selectedAddr)
      } else {
        setMode('change')
      }
    }
  }

  // "Use for all days"
  function handleCopyToAll() {
    copyDeliveryToAll(dayIndex)
    toast(lang === 'el' ? 'Διεύθυνση αντιγράφηκε σε όλες τις ημέρες' : 'Address copied to all days')
  }

  // Save new address to profile
  function handleSaveAddress() {
    if (!addrName.trim()) return
    const newId = 'a' + Date.now()
    const newAddr: Address = {
      id: newId,
      labelEl: addrName.trim(),
      labelEn: addrName.trim(),
      street: form.street,
      area: form.area,
      zip: form.zip,
      floor: form.floor,
      doorbell: form.doorbell,
      notes: form.notes,
    }
    updateAddresses([...savedAddresses, newAddr])
    // Select the newly saved address
    setDelivery(dayIndex, {
      street: form.street,
      area: form.area,
      zip: form.zip || '',
      floor: form.floor || '',
      doorbell: form.doorbell || '',
      notes: form.notes || '',
      addrId: newId,
    })
    setSavingName(false)
    setAddrName('')
    setMode('selected')
    toast(lang === 'el' ? 'Διεύθυνση αποθηκεύτηκε!' : 'Address saved!')
  }

  // Detect whether edit form has changed from original
  const editHasChanges =
    form.street !== editOriginal.street ||
    form.area !== editOriginal.area ||
    form.zip !== editOriginal.zip ||
    form.floor !== editOriginal.floor ||
    form.doorbell !== editOriginal.doorbell ||
    form.notes !== editOriginal.notes

  const formComplete = form.street && form.area && form.zip && zoneStatus === 'valid'

  // ─── Selected mode: shows the current address with Edit / Change actions ─────

  const renderSelected = () => {
    if (!selectedAddr) return null
    const label = lang === 'el' ? selectedAddr.labelEl : selectedAddr.labelEn
    const details = [
      selectedAddr.street,
      selectedAddr.zip ? `${selectedAddr.zip} ${selectedAddr.area}` : selectedAddr.area,
      selectedAddr.floor ? `${selectedAddr.floor}` : '',
      selectedAddr.doorbell || '',
    ].filter(Boolean).join(' · ')

    return (
      <div className="addr-picker">
        <div className="addr-card selected">
          <div className="addr-card-icon">{addrIcon(selectedAddr, lang)}</div>
          <div className="addr-card-content">
            <div className="addr-card-label">{label}</div>
            <div className="addr-card-details">{details}</div>
          </div>
          <div className="addr-card-actions">
            <button className="addr-action-link" onClick={handleEdit}>
              {lang === 'el' ? 'Επεξεργασία' : 'Edit'}
            </button>
            <button className="addr-action-link addr-action-secondary" onClick={handleChange}>
              {lang === 'el' ? 'Αλλαγή' : 'Change'}
            </button>
          </div>
        </div>

        {activeDayCount > 1 && (
          <div className="addr-copy-row">
            <button className="btn-copy-addr" onClick={handleCopyToAll}>
              ↻ {lang === 'el' ? 'Χρήση σε όλες τις ημέρες' : 'Use for all days'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── Edit mode: form pre-populated from selected address ─────────────────────

  const renderEdit = () => (
    <div className="addr-form">
      <div className="addr-form-back">
        <button className="addr-form-back-link" onClick={handleBackToSelected}>
          ← {lang === 'el' ? 'Πίσω' : 'Back'}
        </button>
      </div>

      {renderFormFields()}

      {editHasChanges && formComplete && (
        <button className="btn-save-changes" onClick={handleSaveEdit}>
          {lang === 'el' ? 'Αποθήκευση αλλαγών' : 'Save changes'}
        </button>
      )}
    </div>
  )

  // ─── Change mode: picker with NO preselection ───────────────────────────────

  const renderChange = () => (
    <div className="addr-picker">
      {savedAddresses.map((addr) => (
        <button
          key={addr.id}
          className="addr-card"
          onClick={() => handleSelectAddress(addr)}
        >
          <div className="addr-card-radio" />
          <div className="addr-card-icon">{addrIcon(addr, lang)}</div>
          <div className="addr-card-content">
            <div className="addr-card-label">
              {lang === 'el' ? addr.labelEl : addr.labelEn}
            </div>
            <div className="addr-card-details">
              {addr.street}, {addr.zip ? `${addr.zip} ` : ''}{addr.area}
            </div>
          </div>
        </button>
      ))}

      <button className="addr-card addr-card-new" onClick={handleNewAddress}>
        <span className="addr-new-label">
          + {lang === 'el' ? 'Νέα διεύθυνση' : 'New address'}
        </span>
      </button>
    </div>
  )

  // ─── Form mode (new address) ────────────────────────────────────────────────

  const renderNewForm = () => (
    <div className="addr-form">
      {savedAddresses.length > 0 && (
        <div className="addr-form-back">
          <button className="addr-form-back-link" onClick={handleBackFromForm}>
            ← {lang === 'el' ? 'Πίσω' : 'Back'}
          </button>
        </div>
      )}

      {renderFormFields()}

      {/* Save address to profile — only for logged-in users */}
      {user && formComplete && !savingName && (
        <button className="btn-save-addr-profile" onClick={() => setSavingName(true)}>
          {lang === 'el' ? '💾 Αποθήκευση στις διευθύνσεις μου' : '💾 Save to my addresses'}
        </button>
      )}

      {user && savingName && (
        <div className="addr-save-prompt">
          <label className="form-label">{lang === 'el' ? 'Ονομα διεύθυνσης' : 'Address name'}</label>
          <div className="addr-save-row">
            <input
              className="form-input"
              value={addrName}
              onChange={(e) => setAddrName(e.target.value)}
              placeholder={lang === 'el' ? 'π.χ. Σπίτι, Γραφείο' : 'e.g. Home, Office'}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSaveAddress()}
            />
            <button className="btn-save-addr" onClick={handleSaveAddress} disabled={!addrName.trim()}>
              {lang === 'el' ? 'Αποθήκευση' : 'Save'}
            </button>
            <button className="btn-cancel-save" onClick={() => { setSavingName(false); setAddrName('') }}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* "Use for all days" — when form is valid */}
      {formComplete && activeDayCount > 1 && (
        <div className="addr-copy-row">
          <button className="btn-copy-addr" onClick={handleCopyToAll}>
            ↻ {lang === 'el' ? 'Χρήση σε όλες τις ημέρες' : 'Use for all days'}
          </button>
        </div>
      )}
    </div>
  )

  // ─── Shared form fields (used in edit + new form modes) ──────────────────────

  const renderFormFields = () => (
    <>
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
          <label className="form-label">{t('zipCode')}</label>
          <input
            className={`form-input${zoneStatus === 'valid' ? ' zone-valid' : ''}${zoneStatus === 'invalid' ? ' zone-invalid' : ''}`}
            value={form.zip}
            onChange={(e) => handleZipChange(e.target.value)}
            placeholder="12345"
          />
          {zoneStatus && (
            <div className={`zone-feedback ${zoneStatus === 'valid' ? 'zone-ok' : 'zone-err'}`}>
              {zoneStatus === 'valid'
                ? lang === 'el' ? '✓ Διανομή διαθέσιμη στη ζώνη σου' : '✓ Delivery zone confirmed'
                : lang === 'el' ? '✗ Εκτός ζώνης παράδοσης για αυτό τον Τ.Κ.' : '✗ Outside delivery zone for this postcode'}
            </div>
          )}
        </div>
        <div>
          <label className="form-label">{t('area')}</label>
          <input
            className="form-input"
            value={form.area}
            onChange={(e) => handleAreaChange(e.target.value)}
            placeholder={lang === 'el' ? 'Περιοχή' : 'Area'}
          />
        </div>
      </div>

      <div className="form-row two-col">
        <div>
          <label className="form-label">{lang === 'el' ? 'ΟΡΟΦΟΣ' : 'FLOOR'}</label>
          <input
            className="form-input"
            value={form.floor}
            onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
            placeholder={lang === 'el' ? 'π.χ. 3ος' : 'e.g. 3rd'}
          />
        </div>
        <div>
          <label className="form-label">{lang === 'el' ? 'ΚΟΥΔΟΥΝΙ' : 'DOORBELL'}</label>
          <input
            className="form-input"
            value={form.doorbell}
            onChange={(e) => setForm((f) => ({ ...f, doorbell: e.target.value }))}
            placeholder={lang === 'el' ? 'π.χ. Σαρρής' : 'e.g. Sarris'}
          />
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">{lang === 'el' ? 'ΣΧΟΛΙΑ ΠΑΡΑΔΟΣΗΣ' : 'DELIVERY NOTES'}</label>
        <input
          className="form-input"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder={lang === 'el' ? 'π.χ. Κουδούνι αριστερά' : 'e.g. Ring left bell'}
        />
      </div>
    </>
  )

  return (
    <div className="addr-section">
      {mode === 'selected' && renderSelected()}
      {mode === 'edit' && renderEdit()}
      {mode === 'change' && renderChange()}
      {mode === 'form' && renderNewForm()}
    </div>
  )
}
