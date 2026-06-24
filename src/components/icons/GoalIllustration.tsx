/**
 * GoalIllustration — branded raster illustrations for the three plan goals.
 *
 * Replaced the original duo-chrome SVG illustrations with Ioustinos's
 * commissioned set of three branded PNGs (2026-06-24). Files live at
 * /public/goals/ so they're served as static assets straight from the CDN.
 *
 *   - lose      → bathroom-scale icon on cream + dark-green circle BG
 *   - maintain  → balance-scale icon on cream + bright-green circle BG
 *   - gain      → bicep-flex icon on cream + dark-green circle BG
 *
 * Each PNG is 800×600 (4:3) which matches the .goal-card-art container's
 * `aspect-ratio: 4 / 3`. The image carries its own cream background so the
 * old per-goal gradient bg on the wrapper has been left in place as a soft
 * frame (visible only as the rounded-corner crop edge).
 *
 *   <GoalIllustration goal="lose" />              // raw image
 *   <GoalCardArt goal="maintain" />               // wrapper + image
 *
 * The duo-chrome SVGs that lived here before (leaf / scales / cairn) are
 * in the git history if anyone wants the calm, illustrated version back.
 */

import type { Goal } from '../../lib/wallet/types'

interface GoalIllustrationProps {
  goal: Goal
  className?: string
  /** Optional max-width hint in px. Defaults to 100% of the container. */
  size?: number
}

/** Suggested background tint per goal — kept for any consumer reading it. */
export const GOAL_BG: Record<Goal, string> = {
  lose: '#f5efe4',
  maintain: '#e3f3ea',
  gain: '#faf6ed',
}

/** Source paths for the branded illustration set (2026-06-24). */
const GOAL_IMG: Record<Goal, string> = {
  lose:     '/goals/lose.png',
  maintain: '/goals/maintain.png',
  gain:     '/goals/gain.png',
}

/** Alt text per goal — bilingual not needed here, screen readers read the
 *  card label which is already localized. Image alt stays English-neutral. */
const GOAL_ALT: Record<Goal, string> = {
  lose:     'Weight loss',
  maintain: 'Weight maintenance',
  gain:     'Muscle gain',
}

export function GoalIllustration({ goal, className, size }: GoalIllustrationProps) {
  return (
    <img
      src={GOAL_IMG[goal]}
      alt={GOAL_ALT[goal]}
      className={className}
      style={size ? { maxWidth: size, maxHeight: size } : undefined}
      loading="eager"
      decoding="async"
    />
  )
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
