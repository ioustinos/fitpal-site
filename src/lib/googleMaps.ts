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
 */

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

type GoogleMapsNs = typeof window extends { google: { maps: infer M } } ? M : never

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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      KEY,
    )}&libraries=places&loading=async&callback=${cbName}`
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
  formatted: string   // full formatted_address from Google
}

/**
 * Convert a `google.maps.places.PlaceResult` into our local shape.
 * Tolerates missing components (e.g. unaddressed POIs) — fields default to ''.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePlace(place: any): ParsedPlace {
  const components: Array<{ long_name: string; short_name: string; types: string[] }> =
    place?.address_components ?? []

  const get = (type: string): string => {
    const c = components.find((x) => x.types.includes(type))
    return c?.long_name ?? ''
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

  return {
    street,
    area,
    zip: get('postal_code'),
    lat: place?.geometry?.location?.lat?.() ?? null,
    lng: place?.geometry?.location?.lng?.() ?? null,
    formatted: place?.formatted_address ?? '',
  }
}
