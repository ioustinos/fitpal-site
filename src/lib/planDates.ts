// WEC-905: a subscription's end date is measured by the NUMBER of delivery days
// (plan_length_weeks × days_per_week), landing on working days (Mon–Fri) only —
// NOT by calendar duration. A 2-week / 5-day plan (10 days) starting Mon 09/11
// ends Fri 20/11, not 23/11. Pure (no imports) so both the client and Netlify
// functions can use it.
export function workingDaysEnd(startIso: string, totalDays: number): string {
  if (!startIso || !Number.isFinite(totalDays) || totalDays <= 0) return startIso
  const d = new Date(`${startIso}T00:00:00Z`)
  const isWork = (x: Date) => { const w = x.getUTCDay(); return w >= 1 && w <= 5 }
  let count = isWork(d) ? 1 : 0           // the start date counts as day 1 if it's a weekday
  while (count < totalDays) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isWork(d)) count++
  }
  return d.toISOString().slice(0, 10)
}
