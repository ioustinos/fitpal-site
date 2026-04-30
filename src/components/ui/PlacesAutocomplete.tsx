import { useEffect, useRef, useState, useCallback } from 'react'
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
 * Address-line input with Google Places autocomplete — programmatic version.
 *
 * Why not the widget (`PlaceAutocompleteElement`)? Google's Web Component
 * ships with a fixed Material 3 visual treatment in shadow DOM. CSS only
 * reaches what Google exposes via `::part()` and a handful of CSS custom
 * properties. The outer container's border, the inner input's chrome, and
 * the dropdown's spacing can't all be overridden — so it always looks "off"
 * inside a custom-designed form.
 *
 * Instead this component drives the autocomplete itself:
 *
 *   - Renders a plain `<input className={className}>` so it inherits the
 *     surrounding `.form-input` styling 1:1.
 *   - Calls `AutocompleteSuggestion.fetchAutocompleteSuggestions` (the new
 *     non-deprecated programmatic API) as the user types, debounced.
 *   - Renders our own `<ul>` dropdown styled to match the rest of the app.
 *   - On click / Enter, calls `Place.fetchFields()` on the chosen prediction
 *     and parses it into our `ParsedPlace` shape.
 *
 * Falls back gracefully to a plain input when:
 *   - `VITE_GOOGLE_MAPS_API_KEY` is unset
 *   - The SDK fails to load
 *   - The new Places API isn't enabled on the project
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Suggestion = { placePrediction: any; key: string; mainText: string; secondaryText: string }

const DEBOUNCE_MS = 180

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
  const wrapperRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placesLibRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionTokenRef = useRef<any>(null)
  const debounceRef = useRef<number | null>(null)
  // We track the latest fetch so a slower in-flight request can't overwrite
  // the dropdown after the user has already typed something newer.
  const fetchSeqRef = useRef(0)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [ready, setReady] = useState(false)

  // ── Lazy-load the Places library once ────────────────────────────────────
  useEffect(() => {
    if (disabled) return
    let cancelled = false
    loadGoogleMaps().then(async (ns) => {
      if (cancelled || !ns) return
      try {
        const lib = await ns.importLibrary('places')
        if (!lib?.AutocompleteSuggestion) {
          console.warn('[PlacesAutocomplete] AutocompleteSuggestion missing — Places API (New) likely not enabled')
          return
        }
        placesLibRef.current = lib
        // A session token bundles the autocomplete typing + the eventual
        // place details fetch into one billable session (cheaper than
        // billing per-keystroke).
        sessionTokenRef.current = new lib.AutocompleteSessionToken()
        setReady(true)
      } catch (err) {
        console.warn('[PlacesAutocomplete] importLibrary failed:', err)
      }
    })
    return () => { cancelled = true }
  }, [disabled])

  // ── Click-outside closes the dropdown ────────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // ── Fetch suggestions for the current input ──────────────────────────────
  const fetchSuggestions = useCallback(async (input: string) => {
    const lib = placesLibRef.current
    if (!lib || !input.trim() || input.trim().length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const seq = ++fetchSeqRef.current
    try {
      const { suggestions: rawSuggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: input.trim(),
        sessionToken: sessionTokenRef.current,
        includedRegionCodes: Array.isArray(country) ? country : [country],
      })
      // If a newer fetch has started, ignore this stale response.
      if (seq !== fetchSeqRef.current) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: Suggestion[] = (rawSuggestions ?? []).map((s: any, i: number) => {
        const p = s.placePrediction
        const main = p?.structuredFormat?.mainText?.text ?? p?.text?.text ?? ''
        const secondary = p?.structuredFormat?.secondaryText?.text ?? ''
        return {
          placePrediction: p,
          key: p?.placeId ?? `${i}-${main}`,
          mainText: main,
          secondaryText: secondary,
        }
      }).filter((s: Suggestion) => s.placePrediction)
      setSuggestions(mapped)
      setOpen(mapped.length > 0)
      setActiveIdx(-1)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[PlacesAutocomplete] fetchAutocompleteSuggestions failed:', err)
    }
  }, [country])

  // ── Input change → debounce → fetch ──────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    onChange(v)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    if (!ready) return
    debounceRef.current = window.setTimeout(() => fetchSuggestions(v), DEBOUNCE_MS)
  }

  // ── Pick a suggestion → resolve full Place → fire onSelect ───────────────
  const pickSuggestion = useCallback(async (s: Suggestion) => {
    setOpen(false)
    setSuggestions([])
    if (s.mainText) onChange(s.mainText)
    try {
      const place = s.placePrediction.toPlace()
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'addressComponents', 'location'],
      })
      const parsed = parsePlace(place)
      // Mirror the parsed street back so any zone-validation effects fire.
      if (parsed.street) onChange(parsed.street)
      onSelect(parsed)
      // Rotate the session token after a place pick — that's what bundles
      // the typing + fetchFields into a single billable session.
      const lib = placesLibRef.current
      if (lib?.AutocompleteSessionToken) {
        sessionTokenRef.current = new lib.AutocompleteSessionToken()
      }
    } catch (err) {
      console.warn('[PlacesAutocomplete] fetchFields failed:', err)
    }
  }, [onChange, onSelect])

  // ── Keyboard nav inside the dropdown ─────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pickSuggestion(suggestions[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapperRef} className="places-ac-wrap">
      <input
        ref={inputRef}
        className={className}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={ariaInvalid || undefined}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="places-ac-listbox"
        role="combobox"
      />
      {open && suggestions.length > 0 && (
        <ul id="places-ac-listbox" role="listbox" className="places-ac-list">
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              role="option"
              aria-selected={i === activeIdx}
              className={`places-ac-item${i === activeIdx ? ' active' : ''}`}
              // Use mousedown not click — the input's blur fires before click,
              // and that would close the dropdown before the click registers.
              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s) }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span className="places-ac-pin" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </span>
              <span className="places-ac-text">
                <span className="places-ac-main">{s.mainText}</span>
                {s.secondaryText && (
                  <span className="places-ac-secondary">{s.secondaryText}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
