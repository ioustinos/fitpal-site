// WEC-826: single source of truth for phone → E.164 normalization, shared by
// the order/subscription write paths and the Airtable customer match.
//
// International-aware (libphonenumber-js): a number carrying its own country
// code (+44…, +33…, +49…) normalizes to THAT country; a number with no country
// code falls back to `defaultCountry` (GR — effectively all our traffic). If the
// input can't be parsed to a valid number we return it trimmed rather than null,
// so a phone is never dropped. Empty/nullish → null.
//
// Why it matters: Airtable keys a customer by an EXACT phone string, so the same
// person arriving once as `+306912345678` and once as `6912345678` / `(691)…`
// was created as two customers. Normalizing to E.164 at every write + match
// collapses those to one.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

export function toE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = 'GR',
): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  try {
    const parsed = parsePhoneNumberFromString(s, defaultCountry)
    if (parsed && parsed.isValid()) return parsed.number
  } catch { /* unparseable — fall through */ }
  return s
}
