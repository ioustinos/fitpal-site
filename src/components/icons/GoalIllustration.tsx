/**
 * GoalIllustration — duo-chrome SVG illustrations for the three goals.
 *
 * Fitpal goal-card art, picked by Ioustinos from the curated icon kit:
 *   - lose      → a leaf carried on a wind line (calorie deficit reframed as
 *                 lightness and release, not loss)
 *   - maintain  → a balance scale with both pans level (equilibrium as goal,
 *                 not way-station)
 *   - gain      → a stacked-stone cairn (strength built deliberately, stone
 *                 by stone — grounded, calm, far from gym-bro tropes)
 *
 * 200×200 viewBox, duo-chrome with explicit hex baked in. Pair with the
 * suggested background tint via `GOAL_BG` if you want the intended card
 * look. The existing `.goal-card-art-{goal}` CSS gradients live on the
 * `GoalCardArt` wrapper so the consumer doesn't have to wire colors.
 *
 *   <GoalIllustration goal="lose" size={240} />
 *   <GoalCardArt goal="maintain" />   // gradient bg + SVG together
 *
 * Note: the project's domain type uses `gain`; the original uploaded set
 * called the same illustration `build`. We map at the boundary so the rest
 * of the app keeps speaking `gain`.
 */

import type { Goal } from '../../lib/wallet/types'

interface GoalIllustrationProps {
  goal: Goal
  className?: string
  size?: number
}

/** Suggested background tint per goal — matches the Fitpal goal cards. */
export const GOAL_BG: Record<Goal, string> = {
  lose: '#f5efe4',
  maintain: '#e3f3ea',
  gain: '#faf6ed',
}

export function GoalIllustration({ goal, className, size = 200 }: GoalIllustrationProps) {
  const common = {
    viewBox: '0 0 200 200',
    width: size,
    height: size,
    fill: 'none' as const,
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    'aria-hidden': true,
  }

  switch (goal) {
    case 'lose':
      // Leaf on a wind line — calorie deficit reframed as lightness.
      // primary #1e6b4a · accent #f08a3e · suggested bg #f5efe4
      return (
        <svg {...common}>
          <path d="M22 145 C 60 110, 130 130, 185 110" stroke="#f08a3e" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M40 168 C 70 158, 100 162, 130 158" stroke="#f08a3e" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 8" />
          <circle cx="178" cy="78" r="3" fill="#f08a3e" />
          <circle cx="28" cy="98" r="2.5" fill="#f08a3e" />
          <circle cx="155" cy="155" r="2" fill="#f08a3e" />
          <g transform="translate(100 92) rotate(-22)">
            <path d="M0 -40 C 22 -32, 22 32, 0 40 C -22 32, -22 -32, 0 -40 Z" fill="#f08a3e" stroke="#1e6b4a" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M0 -34 V34" stroke="#1e6b4a" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M0 -16 L13 -22" stroke="#1e6b4a" strokeWidth="2" strokeLinecap="round" />
            <path d="M0 -16 L-13 -22" stroke="#1e6b4a" strokeWidth="2" strokeLinecap="round" />
            <path d="M0 4 L15 -2" stroke="#1e6b4a" strokeWidth="2" strokeLinecap="round" />
            <path d="M0 4 L-15 -2" stroke="#1e6b4a" strokeWidth="2" strokeLinecap="round" />
            <path d="M0 22 L11 18" stroke="#1e6b4a" strokeWidth="2" strokeLinecap="round" />
            <path d="M0 22 L-11 18" stroke="#1e6b4a" strokeWidth="2" strokeLinecap="round" />
          </g>
        </svg>
      )

    case 'maintain':
      // Balance scale, both pans level — equilibrium as the goal itself.
      // primary #1e6b4a · accent #a8dcbf · suggested bg #e3f3ea
      return (
        <svg {...common}>
          <circle cx="100" cy="100" r="78" fill="#a8dcbf" />
          <path d="M72 178 H128" stroke="#1e6b4a" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M100 178 V156" stroke="#1e6b4a" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M88 156 H112 L108 148 H92 Z" fill="#1e6b4a" />
          <path d="M100 148 V58" stroke="#1e6b4a" strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="100" cy="58" r="5.5" fill="#1e6b4a" />
          <path d="M38 58 H162" stroke="#1e6b4a" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M38 58 V90" stroke="#1e6b4a" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M162 58 V90" stroke="#1e6b4a" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M18 90 H58 C58 113 47 122 38 122 C29 122 18 113 18 90 Z" fill="#a8dcbf" stroke="#1e6b4a" strokeWidth="4" strokeLinejoin="round" />
          <path d="M142 90 H182 C182 113 171 122 162 122 C153 122 142 113 142 90 Z" fill="#a8dcbf" stroke="#1e6b4a" strokeWidth="4" strokeLinejoin="round" />
          <path d="M30 96 L46 96" stroke="#1e6b4a" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M154 96 L170 96" stroke="#1e6b4a" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )

    case 'gain':
      // Stacked-stone cairn — strength built deliberately, stone by stone.
      // primary #0f3d2e · accent #a8dcbf · suggested bg #faf6ed
      return (
        <svg {...common}>
          <circle cx="148" cy="64" r="34" fill="#a8dcbf" />
          <path d="M28 180 H172" stroke="#0f3d2e" strokeWidth="4.5" strokeLinecap="round" />
          <ellipse cx="100" cy="156" rx="56" ry="22" fill="#a8dcbf" stroke="#0f3d2e" strokeWidth="4.5" />
          <g transform="rotate(-4 100 118)">
            <ellipse cx="100" cy="118" rx="42" ry="18" fill="none" stroke="#0f3d2e" strokeWidth="4.5" />
          </g>
          <g transform="rotate(6 100 86)">
            <ellipse cx="100" cy="86" rx="30" ry="14" fill="#a8dcbf" stroke="#0f3d2e" strokeWidth="4.5" />
          </g>
          <g transform="rotate(-5 100 58)">
            <ellipse cx="100" cy="58" rx="17" ry="10" fill="none" stroke="#0f3d2e" strokeWidth="4.5" />
          </g>
        </svg>
      )
  }
}

/**
 * Goal card art — illustration on a soft cream background, used as the
 * visual block on each goal card in the wallet page (where Unsplash food
 * photos used to be). The `.goal-card-art-{goal}` class on the wrapper
 * carries the gradient background; the SVG itself is duo-chrome.
 */
export function GoalCardArt({ goal, className }: GoalIllustrationProps) {
  return (
    <div className={`goal-card-art goal-card-art-${goal}${className ? ' ' + className : ''}`}>
      <GoalIllustration goal={goal} />
    </div>
  )
}
