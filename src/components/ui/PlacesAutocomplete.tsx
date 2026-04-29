import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps, parsePlace, type ParsedPlace } from '../../lib/googleMaps'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Fired when the user picks a result from the dropdown. */
  onSelect: (place: ParsedPlace) => void
  placeholder?: string
  className?: string
  /** ISO country code(s) to restrict results to. Default: 'gr'. */
  country?: string | string[]
  /** Disable autocomplete and degrade to a plain input. */
  disabled?: boolean
  /** WAI-ARIA invalid state. */
  ariaInvalid?: boolean
}

/**
 * Address-line input wired to Google Places Autocomplete.
 *
 * Behaviour:
 *   - Loads the Maps JS once via the singleton in `lib/googleMaps`.
 *   - Restricts results to Greece by default (the only delivery zone today).
 *   - On selection, parses the place and fires `onSelect` with structured
 *     fields the caller can spread into form state.
 *   - If `VITE_GOOGLE_MAPS_API_KEY` is unset (or load fails), silently
 *     degrades to a regular text input — onChange still fires, the user
 *     just types the address manually.
 *
 * The component intentionally only wires the STREET field. Locality + zip
 * are populated via `onSelect` so the rest of the form auto-fills.
 */
export function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  country = 'gr',
  disabled,
  ariaInvalid,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const autoRef = useRef<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (disabled) return
    loadGoogleMaps().then((ns) => {
      if (cancelled || !ns || !inputRef.current) return
      // Use the legacy Autocomplete (still supported through 2027). The new
      // PlaceAutocompleteElement is a custom element and clashes with React's
      // controlled-input pattern.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ac = new (ns as any).places.Autocomplete(inputRef.current, {
        fields: ['address_components', 'geometry', 'formatted_address'],
        types: ['address'],
        componentRestrictions: { country },
      })
      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        const parsed = parsePlace(place)
        // Reflect the formatted address back into the input — Google's
        // dropdown sets the input's text directly via the DOM, but we want
        // React state to track it too.
        if (parsed.street) onChange(parsed.street)
        onSelect(parsed)
      })
      autoRef.current = ac
      setReady(true)
    })
    return () => {
      cancelled = true
      // No clean teardown method on the legacy Autocomplete; it'll be
      // garbage-collected when the input unmounts.
      autoRef.current = null
    }
  }, [country, disabled, onChange, onSelect])

  return (
    <input
      ref={inputRef}
      className={className}
      type="text"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={ariaInvalid || undefined}
      data-gmaps-ready={ready || undefined}
    />
  )
}
