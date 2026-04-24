/**
 * Weekday-label helper (WEC-137) — single source of truth for "what day is
 * this date" across the customer site.
 *
 * Always computes from the real weekday of the ISO date, never from the
 * date's position inside an array. Prevents the class of bugs where a
 * week's shape changes (Sunday delivery sneaks in, ad-hoc weeks) and
 * labels drift by one position. WEC-122 root cause.
 *
 * Use ISO weekday internally (1=Mon..7=Sun) so Sunday orders are
 * representable; JS's `Date#getDay()` returns 0=Sun which we convert.
 */

export type Lang = 'el' | 'en'
export type WeekdayVariant = 'short' | 'long' | 'upper'

// Indexed by ISO weekday 1-7. Index 0 is a padding slot so we can index with
// the numeric weekday directly.
const LABELS_LONG_EL = ['', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή']
const LABELS_LONG_EN = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const LABELS_SHORT_EL = ['', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ']
const LABELS_SHORT_EN = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Convert `Date#getDay()` (0=Sun..6=Sat) to ISO weekday (1=Mon..7=Sun). */
export function isoDow(jsDow: number): number {
  return jsDow === 0 ? 7 : jsDow
}

/** Get the ISO weekday (1–7) of an ISO date string (`YYYY-MM-DD`). */
export function isoDowOf(isoDate: string): number {
  // Anchor at noon to dodge DST edge cases / timezone midnight roll-back.
  const d = new Date(isoDate + 'T12:00:00')
  return isoDow(d.getDay())
}

/**
 * Return the localised weekday label for a given ISO date (`YYYY-MM-DD`).
 *
 * @param isoDate `YYYY-MM-DD`
 * @param lang    `'el'` | `'en'`
 * @param variant `'short'` (Δευ / Mon) | `'long'` (Δευτέρα / Monday) | `'upper'` (ΔΕΥΤΕΡΑ / MONDAY)
 */
export function dayLabel(
  isoDate: string,
  lang: Lang,
  variant: WeekdayVariant = 'short',
): string {
  if (!isoDate) return ''
  const dow = isoDowOf(isoDate)
  if (variant === 'short') {
    return (lang === 'el' ? LABELS_SHORT_EL : LABELS_SHORT_EN)[dow]
  }
  const long = (lang === 'el' ? LABELS_LONG_EL : LABELS_LONG_EN)[dow]
  return variant === 'upper' ? long.toUpperCase() : long
}

/**
 * Variant that takes a raw JS weekday number (0=Sun..6=Sat) instead of a date
 * string. Occasionally needed when we only have a `Date` in hand (e.g.
 * cutoff timestamps don't round-trip cleanly through an ISO string).
 */
export function dayLabelFromJsDow(
  jsDow: number,
  lang: Lang,
  variant: WeekdayVariant = 'short',
): string {
  const dow = isoDow(jsDow)
  if (variant === 'short') {
    return (lang === 'el' ? LABELS_SHORT_EL : LABELS_SHORT_EN)[dow]
  }
  const long = (lang === 'el' ? LABELS_LONG_EL : LABELS_LONG_EN)[dow]
  return variant === 'upper' ? long.toUpperCase() : long
}
