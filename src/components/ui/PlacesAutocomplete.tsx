import { useEffect, useRef } from 'react'
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
 * Uses the new `PlaceAutocompleteElement` (the legacy `places.Autocomplete`
 * was deprecated 2025-03-01 and is not available to new customers).
 *
 * `PlaceAutocompleteElement` is a custom HTML element that renders its own
 * input + suggestions list. We mount it into a wrapper div, listen for the
 * `gmp-select` event, and bridge that to `onSelect` / `onChange` for React
 * parity. We also relay typing via the inner input's `input` event so the
 * controlled `value` state outside still tracks what the user typed.
 *
 * If `VITE_GOOGLE_MAPS_API_KEY` is unset, the SDK fails to load, OR the
 * Places API (New) isn't enabled on the project — the component silently
 * degrades to a plain `<input>`. The fallback input is rendered always and
 * hidden only when the autocomplete element successfully mounts.
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
  const containerRef = useRef<HTMLDivElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elementRef = useRef<any>(null)
  // Latest callbacks via refs so the mount effect can stay value-independent.
  const onChangeRef = useRef(onChange)
  const onSelectRef = useRef(onSelect)
  const valueRef = useRef(value)
  onChangeRef.current = onChange
  onSelectRef.current = onSelect
  valueRef.current = value

  // Mount the PlaceAutocompleteElement once. Country can change but in
  // practice it's a constant per call site; mount-once is fine.
  useEffect(() => {
    if (disabled) return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let element: any = null

    loadGoogleMaps().then(async (ns) => {
      if (cancelled || !ns || !containerRef.current) return
      try {
        // The new API ships via importLibrary. This pulls in the Places
        // library on demand (lazy after the base SDK is loaded).
        const placesLib = await ns.importLibrary('places')

        const PlaceAutocompleteElement = placesLib.PlaceAutocompleteElement
        if (!PlaceAutocompleteElement) {
          // Library didn't expose the element — bail to fallback.
          // Most likely cause: Places API (New) not enabled on the project.
          console.warn('[PlacesAutocomplete] PlaceAutocompleteElement unavailable — falling back to plain input')
          return
        }

        element = new PlaceAutocompleteElement({
          // The new-API equivalent of legacy componentRestrictions.country.
          includedRegionCodes: Array.isArray(country) ? country : [country],
        })

        // Seed initial value from outside state.
        if (valueRef.current) element.value = valueRef.current

        // Place selection: the new API gives us a placePrediction; calling
        // .toPlace() returns a Place we can fetchFields on.
        element.addEventListener('gmp-select', async (ev: { placePrediction?: { toPlace?: () => unknown } }) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const prediction = ev?.placePrediction as any
            if (!prediction?.toPlace) return
            const place = prediction.toPlace()
            await place.fetchFields({
              fields: ['displayName', 'formattedAddress', 'addressComponents', 'location'],
            })
            const parsed = parsePlace(place)
            // Mirror the picked street back into outside state so downstream
            // form code (validation, auto-apply) sees it.
            if (parsed.street) onChangeRef.current(parsed.street)
            onSelectRef.current(parsed)
          } catch (err) {
            console.warn('[PlacesAutocomplete] fetchFields failed:', err)
          }
        })

        // Live typing — relay so external form state stays in sync.
        element.addEventListener('input', () => {
          onChangeRef.current(element.value ?? '')
        })

        containerRef.current.appendChild(element)
        elementRef.current = element

        // Hide the fallback once the real element is mounted.
        if (fallbackInputRef.current) {
          fallbackInputRef.current.style.display = 'none'
        }
      } catch (err) {
        console.warn('[PlacesAutocomplete] failed to mount:', err)
      }
    })

    return () => {
      cancelled = true
      if (element && containerRef.current?.contains(element)) {
        containerRef.current.removeChild(element)
      }
      elementRef.current = null
      if (fallbackInputRef.current) {
        fallbackInputRef.current.style.display = ''
      }
    }
  }, [country, disabled])

  // Sync external value changes into the element (kept separate from the
  // mount effect so re-mounting doesn't happen on every keystroke).
  useEffect(() => {
    const el = elementRef.current
    if (el && el.value !== value) {
      el.value = value ?? ''
    }
  }, [value])

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative' }}>
      {/* Fallback plain input — visible until the autocomplete element mounts
          successfully. Crucial for: (a) graceful degradation when the API
          key is unset, (b) when Places API (New) isn't enabled on the
          project, (c) when offline. */}
      <input
        ref={fallbackInputRef}
        className={className}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={ariaInvalid || undefined}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </div>
  )
}
