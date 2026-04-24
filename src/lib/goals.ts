import type { FitpalUser, UserGoals } from '../store/useAuthStore'

/**
 * WEC-163 — single source of truth for goal-tracking logic.
 *
 * Gating: the macro *numbers* (kcal, P/C/F grams) are always shown when
 * there's food to sum; what these helpers gate is the *comparison to a
 * target*: bars, %, coloured status treatment, etc.
 *
 * Goals count as "on" only when both the user's preference toggle is on
 * (`user.prefs.goalTracking`) AND there's an active goals record
 * (`user.goals.enabled`). Either being false (incl. guests) = numbers only.
 *
 * Used by: DayMacrosBlock (WEC-164/165), DayIntakePanel (WEC-166), Account
 * order detail (WEC-167).
 */
export function showGoalProgress(user: FitpalUser | null): boolean {
  if (!user) return false
  if (user.prefs?.goalTracking !== true) return false
  if (user.goals?.enabled !== true) return false
  return true
}

export type MacroKey = 'cal' | 'protein' | 'carbs' | 'fat'
export type MacroStatus = 'ok' | 'below' | 'above' | 'none'

/** Maps the MacroKey used in the UI to the field name used on `UserGoals`. */
const GOAL_FIELD: Record<MacroKey, keyof UserGoals> = {
  cal: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fat: 'fat',
}

/**
 * Classify an intake value against the user's goal range:
 *   'below' — under the configured min
 *   'above' — over the configured max
 *   'ok'    — within range (or only one of min/max set and not violated)
 *   'none'  — no goal configured, or goals disabled
 */
export function goalStatus(
  key: MacroKey,
  value: number,
  goals: UserGoals | undefined | null,
): MacroStatus {
  if (!goals?.enabled) return 'none'
  const g = goals[GOAL_FIELD[key]]
  if (!g || typeof g !== 'object') return 'none'
  const range = g as { min?: number; max?: number }
  if (range.min && value < range.min) return 'below'
  if (range.max && value > range.max) return 'above'
  if (range.min || range.max) return 'ok'
  return 'none'
}

/**
 * Percent progress toward the user's goal (anchored to max, falling back to
 * min). Capped at 120% so an over-target bar doesn't overflow its track.
 * Returns 0 when goals are disabled / unconfigured.
 */
export function goalPct(
  key: MacroKey,
  value: number,
  goals: UserGoals | undefined | null,
): number {
  if (!goals?.enabled) return 0
  const g = goals[GOAL_FIELD[key]]
  if (!g || typeof g !== 'object') return 0
  const range = g as { min?: number; max?: number }
  const anchor = range.max ?? range.min
  if (!anchor) return 0
  return Math.min(120, Math.round((value / anchor) * 100))
}
