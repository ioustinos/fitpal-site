/**
 * MealIcon — linear SVG icons for the four meal slots.
 *
 * Fitpal icon set: linear, monochrome (uses currentColor), no shading,
 * 24×24 viewBox. Picked by Ioustinos from the curated icon kit:
 *   - breakfast: coffee cup with steam
 *   - lunch:     place setting (plate flanked by fork + knife)
 *   - dinner:    covered cloche on a plate
 *   - snack:     wrapped energy bar
 *
 * Usage:
 *   <MealIcon meal="breakfast" size={28} />
 *   <span style={{ color: 'var(--fp-green-700)' }}>
 *     <MealIcon meal="lunch" />
 *   </span>
 *
 * The icon inherits its color from the surrounding text (`currentColor`),
 * so wrapping in a coloured element themes it.
 */

import type { MealKey } from '../../lib/wallet/types'

interface MealIconProps {
  meal: MealKey
  size?: number
  className?: string
  strokeWidth?: number
}

export function MealIcon({ meal, size = 24, className, strokeWidth = 1.6 }: MealIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }

  switch (meal) {
    case 'breakfast':
      // Coffee cup with rising steam — universal morning ritual.
      return (
        <svg {...common}>
          <path d="M9 3c.8 1 .8 2 0 3" />
          <path d="M12 2.5c.8 1 .8 2 0 3" />
          <path d="M15 3c.8 1 .8 2 0 3" />
          <path d="M5 10h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
          <path d="M16 12h1.5a2.5 2.5 0 0 1 0 5H16" />
          <path d="M3.5 21h14" />
        </svg>
      )

    case 'lunch':
      // Place setting — plate flanked by fork and knife. Reads as
      // "sit-down meal" without the crossed-utensils cliche.
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M3 3v4" />
          <path d="M5 3v4" />
          <path d="M7 3v4" />
          <path d="M3 7h4" />
          <path d="M5 7v14" />
          <path d="M19 3c1.8 0 2.4 1.5 2.4 3.5v3l-2.4 1.2V3z" />
          <path d="M19 10.7V21" />
        </svg>
      )

    case 'dinner':
      // Covered cloche on a plate — the sense of a meal "presented."
      // Premium, deliberate, evening.
      return (
        <svg {...common}>
          <circle cx="12" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
          <path d="M12 5.6v2.4" />
          <path d="M4 17.5c0-4.7 3.6-9 8-9s8 4.3 8 9z" />
          <path d="M2.5 19.5h19" />
        </svg>
      )

    case 'snack':
      // Wrapped bar — protein/energy bar with twist ends and a segment
      // line. Hand-held, packaged, between meals.
      return (
        <svg {...common}>
          <rect x="4" y="9" width="16" height="6" rx="1.5" />
          <path d="M4 10.5l-2.5-1" />
          <path d="M4 13.5l-2.5 1" />
          <path d="M20 10.5l2.5-1" />
          <path d="M20 13.5l2.5 1" />
          <path d="M9 9v6" />
          <path d="M15 9v6" />
        </svg>
      )
  }
}
