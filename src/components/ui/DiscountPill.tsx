/**
 * DiscountPill — WEC-755.
 *
 * The ONE way to render a discount percentage anywhere in the app.
 *
 * Before this existed, the plan wizard rendered the same idea three different
 * ways on a single page: a `+2%` pill on the meals row, a `+6%` pill on the
 * frequency row, and a plain «−6% έκπτωση» line on the plan-length cards. Two
 * of them carried a PLUS sign on what is a price reduction, which reads to the
 * customer as "more expensive".
 *
 * Rules (Ioustinos, 2026-09-08) — do not reintroduce any of these:
 *   1. one visual, everywhere — this component, never an ad-hoc span
 *   2. always a minus sign, never a plus
 *   3. never the word «έκπτωση» / "discount" / "off" beside the number
 *
 * `pct` is a WHOLE number, already rounded by the caller: 6 → «−6%».
 *
 * Zero (or negative) renders an invisible pill of the same size so siblings in
 * a grid keep their vertical rhythm — the 3-up plan-length cards depend on
 * this. Pass `hideWhenZero` to drop it out of the flow entirely instead.
 *
 * Positioning belongs to the caller: pass the layout class through
 * `className` (e.g. `margin-left: auto` to push it to the end of a flex row).
 * This component owns appearance only.
 */
export function DiscountPill({
  pct,
  size = 'md',
  hideWhenZero = false,
  className = '',
}: {
  /** Whole-number percentage, already rounded. 6 → «−6%». */
  pct: number
  /** `sm` for tight rows (the meals list); `md` everywhere else. */
  size?: 'sm' | 'md'
  /** Drop out of the flow at 0 instead of holding the space. */
  hideWhenZero?: boolean
  /** Layout-only classes from the caller (margins, align-self). */
  className?: string
}) {
  const base = `fp-disc-pill${size === 'sm' ? ' fp-disc-pill--sm' : ''}`

  if (!Number.isFinite(pct) || pct <= 0) {
    if (hideWhenZero) return null
    // Same box, no ink — keeps grid siblings aligned without inventing copy.
    return (
      <span className={`${base} fp-disc-pill--ghost ${className}`.trim()} aria-hidden="true">
        −0%
      </span>
    )
  }

  return <span className={`${base} ${className}`.trim()}>−{Math.round(pct)}%</span>
}
