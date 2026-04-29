/**
 * Google Maps JS API loader — singleton, lazy.
 *
 * The script is only injected the first time someone calls `loadGoogleMaps()`,
 * and subsequent calls return the same promise. Without this, mounting the
 * autocomplete component on multiple inputs (checkout + account) double-loads
 * the SDK and the second `<script>` throws "google.maps already loaded".
 *
 * API key comes from `VITE_GOOGLE_MAPS_API_KEY`. If unset the loader resolves
 * with `null` so callers can degrade to a plain text input — better than
 * crashing the page on a missing key.
 *
 * Uses `importLibrary` under the hood (the pattern Google now recommends —
 * the legacy `places.Autocomplete` has been unavailable to new customers
 * since 2025-03-01, replaced by `places.PlaceAutocompleteElement`).
 */

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleMapsNs = any

let promise: Promise<GoogleMapsNs | null> | null = null

export function googleMapsAvailable(): boolean {
  return !!KEY
}

export function loadGoogleMaps(): Promise<GoogleMapsNs | null> {
  if (promise) return promise

  if (!KEY) {
    // No key configured — resolve with null. Components fall back to plain inputs.
    promise = Promise.resolve(null)
    return promise
  }

  // Already loaded by something else? Reuse it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (window as any).google?.maps
  if (existing) {
    promise = Promise.resolve(existing as GoogleMapsNs)
    return promise
  }

  promise = new Promise<GoogleMapsNs | null>((resolve, reject) => {
    const cbName = `__gmaps_cb_${Date.now()}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any)[cbName] = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ns = (window as any).google?.maps as GoogleMapsNs | undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any)[cbName]
      if (ns) resolve(ns)
      else reject(new Error('Google Maps loaded but window.google.maps missing'))
    }

    const s = document.createElement('script')
    // `loading=async` is required for the new `importLibrary` API used by
    // PlaceAutocompleteElement. We don't list `places` in the libraries
    // param — modern usage prefers per-feature `importLibrary('places')`.
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      KEY,
    )}&v=weekly&loading=async&callback=${cbName}`
    s.async = true
    s.defer = true
    s.onerror = () => reject(new Error('Failed to load Google Maps script'))
    document.head.appendChild(s)
  }).catch((err) => {
    // Reset so a future call can retry. Otherwise a transient network blip
    // permanently breaks autocomplete for the session.
    promise = null
    console.warn('[googleMaps]', err)
    return null
  })

  return promise
}

/**
 * Parsed result we hand back to the caller. Mirrors the columns we store
 * locally on `addresses` so callers can spread it into form state directly.
 */
export interface ParsedPlace {
  street: string      // street name + number, "{route} {street_number}"
  area: string        // locality / sublocality (city/neighbourhood)
  zip: string         // postal_code
  lat: number | null
  lng: number | null
  formatted: string   // full formatted address from Google
}

/**
 * Convert a `google.maps.places.Place` (new API) into our local shape.
 * Handles both the new `addressComponents` shape (array of `AddressComponent`
 * objects with `longText`/`shortText`/`types`) and the legacy
 * `address_components` shape (`long_name`/`short_name`/`types`) — useful if
 * we end up running both side-by-side during the migration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePlace(place: any): ParsedPlace {
  // New API: place.addressComponents is an array of { longText, shortText, types }
  // Old API: place.address_components is an array of { long_name, short_name, types }
  const components: Array<{
    longText?: string; shortText?: string;
    long_name?: string; short_name?: string;
    types: string[]
  }> = place?.addressComponents ?? place?.address_components ?? []

  const get = (type: string): string => {
    const c = components.find((x) => x.types.includes(type))
    return c?.longText ?? c?.long_name ?? ''
  }

  const route = get('route')
  const streetNumber = get('street_number')
  // Greek conventions usually put the number AFTER the street name.
  const street = [route, streetNumber].filter(Boolean).join(' ').trim()

  // Try locality first, then sublocality variants, then admin level 3.
  const area =
    get('locality') ||
    get('sublocality_level_1') ||
    get('sublocality') ||
    get('administrative_area_level_3') ||
    ''

  // Lat/lng — new API exposes `place.location` with .lat() / .lng() methods,
  // old API used `place.geometry.location`.
  const loc = place?.location ?? place?.geometry?.location ?? null
  const lat = typeof loc?.lat === 'function' ? loc.lat() : (typeof loc?.lat === 'number' ? loc.lat : null)
  const lng = typeof loc?.lng === 'function' ? loc.lng() : (typeof loc?.lng === 'number' ? loc.lng : null)

  return {
    street,
    area,
    zip: get('postal_code'),
    lat: lat ?? null,
    lng: lng ?? null,
    formatted: place?.formattedAddress ?? place?.formatted_address ?? '',
  }
}
