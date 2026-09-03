// WEC-688 — the customer's active diet plan, normalised for display.
//
// The dietitian needs the numbers BEHIND the goal bars while building a
// customer's meals: body metrics, goal, daily kcal, macro split, and the
// per-meal kcal/macro targets. None of that is on any customer-facing
// surface by design — it lives frozen on `wallet_plans`.
//
// Runs under whatever session is active. During impersonation that is the
// CUSTOMER's JWT, so these reads pass their own RLS; from the admin panel
// the admin policies cover the same rows. Same function either way.

import { supabase } from '../supabase'
import type { PlanMealFlags, MealKey } from '../planMeals'
import { planMealKeys } from '../planMeals'

export interface PlanMealTarget {
  key: MealKey
  kcal: number
  protein: number
  carbs: number
  fat: number
  priceEur: number | null
}

export interface PlanGoalBand { min: number | null; max: number | null }

export interface PlanDetails {
  planId: string
  /** lose | maintain | gain */
  goal: string | null
  planLength: string | null          // '2w' | '1mo' | '3mo'
  planLengthWeeks: number | null
  daysPerWeek: number | null
  meals: MealKey[]
  startDate: string | null           // ISO date
  createdAt: string

  // Body metrics, frozen at purchase.
  sex: string | null
  age: number | null
  heightCm: number | null
  weightKg: number | null
  activityLevel: string | null

  // Targets.
  dailyKcal: number | null
  macroPct: { p: number | null; c: number | null; f: number | null }
  macroGrams: { p: number | null; c: number | null; f: number | null }
  perMeal: PlanMealTarget[]

  // Services bought alongside the plan.
  dieticianManaged: boolean
  bodyFatMeasurement: boolean

  /** Account → Στόχοι bands. Auto-written at ±5% by applyPlanGoals (WEC-529). */
  goalBands: {
    enabled: boolean
    cal: PlanGoalBand
    protein: PlanGoalBand
    carbs: PlanGoalBand
    fat: PlanGoalBand
  } | null
}

/** kcal per gram — mirrors calculator.ts and applyPlanGoals.ts. */
const KCAL_PER_GRAM = { p: 4, c: 4, f: 9 } as const

function grams(dailyKcal: number | null, pct: number | null, macro: 'p' | 'c' | 'f'): number | null {
  if (dailyKcal == null || pct == null) return null
  return Math.round((dailyKcal * pct) / 100 / KCAL_PER_GRAM[macro])
}

/**
 * The user's ACTIVE plan, or null when they have none (never subscribed, or
 * the plan lapsed). Callers hide the entry point rather than showing an
 * empty panel.
 */
export async function fetchActivePlanDetails(
  userId: string,
): Promise<{ data: PlanDetails | null; error: string | null }> {
  try {
    const { data: walletRow, error: wErr } = await supabase
      .from('wallets')
      .select('active_plan_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (wErr) return { data: null, error: wErr.message }

    const activePlanId = (walletRow as { active_plan_id: string | null } | null)?.active_plan_id
    if (!activePlanId) return { data: null, error: null }

    const { data: planRow, error: pErr } = await supabase
      .from('wallet_plans')
      .select(
        'id, goal, plan_length, plan_length_weeks, days_per_week, daily_kcal, macro_split, ' +
        'profile_snapshot, pricing_breakdown, services, created_at, ' +
        'meal_breakfast, meal_lunch, meal_dinner, meal_snack',
      )
      .eq('id', activePlanId)
      .maybeSingle()
    if (pErr) return { data: null, error: pErr.message }
    if (!planRow) return { data: null, error: null }

    const row = planRow as unknown as Record<string, unknown>
    const snap = (row.profile_snapshot ?? {}) as {
      sex?: string; birth_year?: number; height_cm?: number
      weight_kg?: number; activity_level?: string
    }
    const split = (row.macro_split ?? {}) as { p?: number; c?: number; f?: number }
    const breakdown = (row.pricing_breakdown ?? {}) as Record<
      string,
      { kcal?: number; price?: number; included?: boolean; grams?: { p?: number; c?: number; f?: number } }
    >
    const services = (row.services ?? {}) as {
      dieticianManaged?: boolean; bodyFatMeasurement?: boolean
    }

    const dailyKcal = (row.daily_kcal as number | null) ?? null
    const pct = { p: split.p ?? null, c: split.c ?? null, f: split.f ?? null }

    // Start date: prefer the active meal_services row, fall back to purchase
    // date. Mirrors the banner's existing budget logic so the two agree.
    let startDate: string | null = null
    const { data: svcRow } = await supabase
      .from('meal_services')
      .select('start_date')
      .eq('user_id', userId)
      .eq('active', true)
      .order('start_date', { ascending: false })
      .maybeSingle()
    startDate = (svcRow as { start_date: string | null } | null)?.start_date ?? null

    const mealKeys = planMealKeys(row as PlanMealFlags)
    const perMeal: PlanMealTarget[] = mealKeys.map((key) => {
      const m = breakdown[key] ?? {}
      return {
        key,
        kcal: Math.round(m.kcal ?? 0),
        protein: Math.round(m.grams?.p ?? 0),
        carbs: Math.round(m.grams?.c ?? 0),
        fat: Math.round(m.grams?.f ?? 0),
        priceEur: typeof m.price === 'number' ? m.price : null,
      }
    })

    // Goal bands are best-effort: the panel is still useful without them.
    let goalBands: PlanDetails['goalBands'] = null
    const { data: goalsRow } = await supabase
      .from('user_goals')
      .select('enabled, cal_min, cal_max, protein_min, protein_max, carbs_min, carbs_max, fat_min, fat_max')
      .eq('user_id', userId)
      .maybeSingle()
    if (goalsRow) {
      const g = goalsRow as Record<string, number | boolean | null>
      goalBands = {
        enabled: !!g.enabled,
        cal:     { min: (g.cal_min as number) ?? null,     max: (g.cal_max as number) ?? null },
        protein: { min: (g.protein_min as number) ?? null, max: (g.protein_max as number) ?? null },
        carbs:   { min: (g.carbs_min as number) ?? null,   max: (g.carbs_max as number) ?? null },
        fat:     { min: (g.fat_min as number) ?? null,     max: (g.fat_max as number) ?? null },
      }
    }

    const birthYear = snap.birth_year ?? null
    const age = birthYear ? new Date().getFullYear() - birthYear : null

    return {
      data: {
        planId: row.id as string,
        goal: (row.goal as string | null) ?? null,
        planLength: (row.plan_length as string | null) ?? null,
        planLengthWeeks: row.plan_length_weeks != null ? Number(row.plan_length_weeks) : null,
        daysPerWeek: (row.days_per_week as number | null) ?? null,
        meals: mealKeys,
        startDate,
        createdAt: row.created_at as string,
        sex: snap.sex ?? null,
        age,
        heightCm: snap.height_cm ?? null,
        weightKg: snap.weight_kg ?? null,
        activityLevel: snap.activity_level ?? null,
        dailyKcal,
        macroPct: pct,
        macroGrams: {
          p: grams(dailyKcal, pct.p, 'p'),
          c: grams(dailyKcal, pct.c, 'c'),
          f: grams(dailyKcal, pct.f, 'f'),
        },
        perMeal,
        dieticianManaged: !!services.dieticianManaged,
        bodyFatMeasurement: !!services.bodyFatMeasurement,
        goalBands,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Plan lookup failed' }
  }
}
