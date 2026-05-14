// WEC-338 — Indicative-address gate for the subscription page.
//
// Compact inline form (Street / Area / ZIP). Street + Area are optional —
// useful for our records — but the ZIP is the hard gate. We use the
// same postcode-only resolution we use at checkout (`resolveZone`).
//
// If the ZIP doesn't match an active delivery zone we surface a clear
// message and the parent disables the "Continue to payment" CTA. The form
// is NOT persisted as an `addresses` row — it's "indicative" by design,
// because the real per-day delivery address is captured at checkout.
//
// State model: fully controlled by the parent. The parent decides what to
// do with the `inZone` boolean (typically: gate the CTA).

import { useEffect, useMemo } from 'react'
import { useMenuStore } from '../../store/useMenuStore'
import { resolveZone } from '../../lib/helpers'
import { PlacesAutocomplete } from '../ui/PlacesAutocomplete'
import { googleMapsAvailable, type ParsedPlace } from '../../lib/googleMaps'

export interface IndicativeAddress {
  street: string
  area: string
  zip: string
}

interface IndicativeAddressGateProps {
  lang: 'el' | 'en'
  value: IndicativeAddress
  onChange: (next: IndicativeAddress) => void
  /**
   * Lifted out so the parent can use the same boolean to gate the CTA.
   * Called whenever the validity changes.
   */
  onValidityChange: (inZone: boolean) => void
}

export function IndicativeAddressGate({
  lang,
  value,
  onChange,
  onValidityChange,
}: IndicativeAddressGateProps) {
  const isEl = lang === 'el'
  const zones = useMenuStore((s) => s.zones)

  const resolved = useMemo(
    () => (value.zip ? resolveZone(value.zip, zones) : undefined),
    [value.zip, zones],
  )
  const zipTouched = value.zip.trim().length > 0
  const inZone = !!resolved

  /* Notify the parent whenever validity flips. */
  useEffect(() => {
    onValidityChange(inZone)
  }, [inZone, onValidityChange])

  const set = (patch: Partial<IndicativeAddress>) => onChange({ ...value, ...patch })

  /** Place picked from the Google Places dropdown → spread the parsed fields
   *  into our state. Street already syncs via onChange; Area + ZIP are the
   *  bonus we get from the parser. We only overwrite local fields when the
   *  parsed value is non-empty so users typing manually don't get their
   *  partial input wiped. */
  function handlePlaceSelect(parsed: ParsedPlace) {
    onChange({
      street: parsed.street || value.street,
      area: parsed.area || value.area,
      zip: parsed.zip || value.zip,
    })
  }

  const gmaps = googleMapsAvailable()

  return (
    <div className="wpv2-addrgate">
      <div className="wpv2-addrgate-row">
        <label className="wpv2-addrgate-field grow">
          <span className="wpv2-addrgate-label">
            {isEl ? 'Διεύθυνση' : 'Street'}
            <small>{isEl ? ' (προαιρετικό)' : ' (optional)'}</small>
          </span>
          {gmaps ? (
            <PlacesAutocomplete
              className="wpv2-addrgate-input"
              value={value.street}
              onChange={(v) => set({ street: v })}
              onSelect={handlePlaceSelect}
              placeholder={isEl ? 'π.χ. Λεωφ. Συγγρού 100' : 'e.g. 100 Syngrou Ave'}
              country="gr"
            />
          ) : (
            <input
              type="text"
              className="wpv2-addrgate-input"
              value={value.street}
              onChange={(e) => set({ street: e.target.value })}
              placeholder={isEl ? 'π.χ. Λεωφ. Συγγρού 100' : 'e.g. 100 Syngrou Ave'}
              autoComplete="street-address"
            />
          )}
        </label>
      </div>
      <div className="wpv2-addrgate-row two">
        <label className="wpv2-addrgate-field">
          <span className="wpv2-addrgate-label">
            {isEl ? 'Περιοχή' : 'Area'}
            <small>{isEl ? ' (προαιρετικό)' : ' (optional)'}</small>
          </span>
          <input
            type="text"
            className="wpv2-addrgate-input"
            value={value.area}
            onChange={(e) => set({ area: e.target.value })}
            placeholder={isEl ? 'π.χ. Νέος Κόσμος' : 'e.g. Neos Kosmos'}
            autoComplete="address-level2"
          />
        </label>
        <label className="wpv2-addrgate-field">
          <span className="wpv2-addrgate-label">
            {isEl ? 'Τ.Κ.' : 'ZIP'}
            <small className="req">*</small>
          </span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            className={`wpv2-addrgate-input zip${
              zipTouched ? (inZone ? ' ok' : ' bad') : ''
            }`}
            value={value.zip}
            onChange={(e) => set({ zip: e.target.value.replace(/\D/g, '').slice(0, 6) })}
            placeholder="11744"
            autoComplete="postal-code"
            aria-invalid={zipTouched && !inZone}
          />
        </label>
      </div>

      {zipTouched && (
        <div className={`wpv2-addrgate-feedback ${inZone ? 'ok' : 'bad'}`}>
          {inZone ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {isEl
                ? `Παραδίδουμε στη ζώνη "${resolved!.nameEl}".`
                : `We deliver to the "${resolved!.nameEn}" zone.`}
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
              </svg>
              {isEl
                ? 'Δεν παραδίδουμε ακόμη στον Τ.Κ. σου — άσε μας email να σε ειδοποιήσουμε όταν επεκταθούμε.'
                : "We don't deliver to this postcode yet — leave us your email and we'll let you know when we expand."}
            </>
          )}
        </div>
      )}

      {!zipTouched && (
        <div className="wpv2-addrgate-hint">
          {isEl
            ? 'Συμπλήρωσε τον Τ.Κ. για να επιβεβαιώσουμε ότι παραδίδουμε στην περιοχή σου. Η ακριβής διεύθυνση παράδοσης ορίζεται ανά ημέρα στο checkout.'
            : 'Add your postcode so we can confirm delivery in your area. The exact per-day delivery address is set at checkout.'}
        </div>
      )}
    </div>
  )
}
