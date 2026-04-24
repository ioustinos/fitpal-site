/**
 * Phone helpers — wrap `react-phone-number-input` / `libphonenumber-js`.
 *
 * Storage convention: we always persist phones in E.164 (e.g. `+306912345678`).
 * The `<PhoneInput>` component (used in `ContactSection`) emits E.164
 * directly, so no normalization is needed at write-time. These helpers
 * cover the remaining corners: validation, display-formatting, and
 * parsing of free-text inputs (e.g. admin backfills, legacy data).
 *
 * Default country: Greece (`GR`) — 99% of our traffic. Curated country
 * list below keeps the dropdown fast while still supporting expats.
 */

import {
  getCountries,
  isValidPhoneNumber as _isValid,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js'
import labelsEn from 'react-phone-number-input/locale/en.json'
import labelsEl from 'react-phone-number-input/locale/el.json'

/**
 * Ordered country list for the `<PhoneInput>` dropdown.
 *
 * Order (requested by Ioustinos, 2026-04-21):
 *   1. Priority — GR (default) + the top foreign-number sources for our expats.
 *   2. Other European — everything remaining in the EU/EEA/neighbourhood.
 *   3. Rest of world — alphabetical, populated from libphonenumber-js so no
 *      country is missing if someone ever needs it.
 *
 * The `<PhoneInput>` component renders countries in the order we pass them,
 * so the priority tier stays pinned at the top of the dropdown.
 */
const PRIORITY: CountryCode[] = ['GR', 'GB', 'FR', 'DE', 'IT', 'ES', 'US']

const OTHER_EUROPEAN: CountryCode[] = [
  'CY', 'IE', 'PT', 'NL', 'BE', 'LU', 'AT', 'CH',
  'SE', 'NO', 'DK', 'FI', 'IS',
  'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI',
  'EE', 'LV', 'LT', 'MT',
]

const TOP_TIERS: CountryCode[] = [...PRIORITY, ...OTHER_EUROPEAN]
const TOP_TIERS_SET = new Set<CountryCode>(TOP_TIERS)

// Everything else, alphabetical — sourced from libphonenumber-js so the list
// stays complete as the library updates.
const REST_OF_WORLD: CountryCode[] = (getCountries() as CountryCode[])
  .filter((c) => !TOP_TIERS_SET.has(c))
  .sort()

export const COUNTRIES: CountryCode[] = [...TOP_TIERS, ...REST_OF_WORLD]

export const DEFAULT_COUNTRY: CountryCode = 'GR'

/**
 * Turn a 2-letter ISO country code into its flag emoji via Regional Indicator
 * Symbols (0x1F1E6 + A–Z offset). e.g. `GR` → 🇬🇷.
 *
 * Flags in the native <select> dropdown are only possible via the `labels`
 * prop — there's no way to inject React elements into <option>. So we bake
 * the emoji directly into each country's label string. Modern macOS / iOS /
 * Android all render these as color flags; Windows falls back to a 2-letter
 * pair which still reads fine.
 */
function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return ''
  const A = 'A'.charCodeAt(0)
  const base = 0x1f1e6
  return (
    String.fromCodePoint(base + (code.charCodeAt(0) - A)) +
    String.fromCodePoint(base + (code.charCodeAt(1) - A))
  )
}

/**
 * Build a labels map with flag-prefixed country names from the library's
 * localised label files. Non-country keys (`ext`, `country`, `phone`, ZZ)
 * are preserved as-is.
 */
function withFlags(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, name] of Object.entries(labels)) {
    if (key.length === 2 && /^[A-Z]{2}$/.test(key)) {
      out[key] = `${flagEmoji(key)}  ${name}`
    } else {
      out[key] = name
    }
  }
  return out
}

export const PHONE_LABELS_EN = withFlags(labelsEn as Record<string, string>)
export const PHONE_LABELS_EL = withFlags(labelsEl as Record<string, string>)

/**
 * Return the flag-prefixed labels object for the active UI language.
 * Use this as the `labels` prop on `<PhoneInput>`.
 */
export function phoneLabels(lang: 'el' | 'en'): Record<string, string> {
  return lang === 'el' ? PHONE_LABELS_EL : PHONE_LABELS_EN
}

/**
 * Validate an E.164 phone string against libphonenumber-js's per-country
 * rules. Returns false for null/undefined/empty.
 */
export function isValidPhone(value: string | undefined | null): boolean {
  if (!value) return false
  try {
    return _isValid(value)
  } catch {
    return false
  }
}

/**
 * Format an E.164 phone for display, e.g. `+306912345678` → `+30 691 234 5678`.
 * Returns the input unchanged if parsing fails.
 */
export function formatPhoneDisplay(e164: string | undefined | null): string {
  if (!e164) return ''
  try {
    const parsed = parsePhoneNumberFromString(e164)
    return parsed?.formatInternational() ?? e164
  } catch {
    return e164
  }
}

/**
 * Parse a free-text phone input into E.164. Used for admin backfills and
 * any flow where a user might paste a number without the component's
 * structured input. Falls back to `defaultCountry` when the input has
 * no country code.
 *
 * Returns `null` if the input can't be parsed into a valid phone.
 */
export function parsePhone(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = parsePhoneNumberFromString(raw, defaultCountry)
    if (!parsed || !parsed.isValid()) return null
    return parsed.number
  } catch {
    return null
  }
}
