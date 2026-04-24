/**
 * Date-range helpers for account filters (WEC-168 / WEC-169).
 *
 * Weeks are Monday-anchored to match the menu's week model. Months follow
 * the user's local calendar. Custom ranges are inclusive on both ends and
 * clipped to whole days so the `from` and `to` picker never excludes
 * anything the user visibly picked.
 *
 * Operates on local time; inputs/outputs are ISO strings for UI state.
 */

export type RangePreset =
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom'

/** Zero out the time portion in-place — returns the same Date for chaining. */
function startOfDay(d: Date): Date {
  d.setHours(0, 0, 0, 0)
  return d
}

/** End-of-day sentinel used as the inclusive right edge of a range. */
function endOfDay(d: Date): Date {
  d.setHours(23, 59, 59, 999)
  return d
}

/** Monday of the week containing `d` (local time). */
function mondayOf(d: Date): Date {
  const out = new Date(d)
  const jsDow = out.getDay() // 0=Sun..6=Sat
  const daysSinceMon = jsDow === 0 ? 6 : jsDow - 1
  out.setDate(out.getDate() - daysSinceMon)
  return startOfDay(out)
}

/** Sunday (end) of the week containing `d` (local time). */
function sundayOf(d: Date): Date {
  const mon = mondayOf(d)
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  return endOfDay(sun)
}

/** Resolve a preset to an explicit [from, to] pair (both inclusive). */
export function rangeFromPreset(preset: RangePreset, now: Date = new Date()): { from: Date; to: Date } | null {
  switch (preset) {
    case 'this_week':
      return { from: mondayOf(now), to: sundayOf(now) }
    case 'last_week': {
      const lastMon = new Date(mondayOf(now))
      lastMon.setDate(lastMon.getDate() - 7)
      const lastSun = new Date(lastMon)
      lastSun.setDate(lastSun.getDate() + 6)
      return { from: startOfDay(lastMon), to: endOfDay(lastSun) }
    }
    case 'this_month': {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
      const to = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))
      return { from, to }
    }
    case 'last_month': {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))
      const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))
      return { from, to }
    }
    case 'custom':
      return null
  }
}

/**
 * Check whether an ISO timestamp falls inside a preset's or explicit
 * custom range. For `custom`, pass `customFrom`/`customTo` as `YYYY-MM-DD`
 * strings; either can be omitted and the range becomes open-ended.
 */
export function matchesRange(
  iso: string | Date | null | undefined,
  preset: RangePreset,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): boolean {
  if (!iso) return false
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return false

  if (preset === 'custom') {
    if (customFrom) {
      const from = startOfDay(new Date(customFrom + 'T00:00:00'))
      if (d < from) return false
    }
    if (customTo) {
      const to = endOfDay(new Date(customTo + 'T00:00:00'))
      if (d > to) return false
    }
    return true
  }

  const range = rangeFromPreset(preset, now)
  if (!range) return true
  return d >= range.from && d <= range.to
}

/** ISO `YYYY-MM-DD` in local time — handy for <input type="date"> binding. */
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
