// WEC-686 — one place that turns a plan's meal flags into a label.
//
// This existed as six hand-rolled copies across the codebase and three of
// them had never been updated after `meal_snack` was added to the model, so
// customers who paid for a snack didn't see it listed. Anything that renders
// "which meals are in this plan" goes through here.

export type Lang = 'el' | 'en'

export interface PlanMealFlags {
  meal_breakfast?: boolean | null
  meal_lunch?: boolean | null
  meal_dinner?: boolean | null
  meal_snack?: boolean | null
}

/** Fixed display order — the order people eat in, not the column order. */
export const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealKey = (typeof MEAL_KEYS)[number]

const LABELS: Record<MealKey, Record<Lang, string>> = {
  breakfast: { el: 'Πρωινό',      en: 'Breakfast' },
  lunch:     { el: 'Μεσημεριανό', en: 'Lunch' },
  dinner:    { el: 'Βραδινό',     en: 'Dinner' },
  snack:     { el: 'Σνακ',        en: 'Snack' },
}

export function mealLabel(key: MealKey, lang: Lang): string {
  return LABELS[key][lang]
}

/** The meals a plan includes, in display order. */
export function planMealKeys(plan: PlanMealFlags): MealKey[] {
  const on: MealKey[] = []
  if (plan.meal_breakfast) on.push('breakfast')
  if (plan.meal_lunch)     on.push('lunch')
  if (plan.meal_dinner)    on.push('dinner')
  if (plan.meal_snack)     on.push('snack')
  return on
}

/** "Πρωινό, Μεσημεριανό, Βραδινό, Σνακ" — empty string when none are set. */
export function planMealsLabel(plan: PlanMealFlags, lang: Lang): string {
  return planMealKeys(plan).map((k) => mealLabel(k, lang)).join(', ')
}
