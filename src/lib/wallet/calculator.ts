// ──────────────────────────────────────────────────────────────────────────────
// Wallet plan calculator — pure function, no React, no Supabase.
// ──────────────────────────────────────────────────────────────────────────────
// Reusable client-side (live preview in WalletPage) and server-side (Netlify
// Function for purchase verification). Same function, same numbers — the
// server is the source of truth at checkout time to prevent client tampering.

import type {
  WalletCalcInput,
  WalletCalcResult,
  WalletSettings,
  MealKey,
  MealBreakdown,
  PerMealCoeff,
} from './types'
import { DEFAULT_WALLET_SETTINGS, KCAL_PER_GRAM } from './constants'

const ALL_MEALS: MealKey[] = ['breakfast', 'lunch', 'dinner', 'snack']

// ──────────────────────────────────────────────────────────────────────────────
// BMR — Mifflin-St Jeor
//   men:   10w + 6.25h − 5a + 5
//   women: 10w + 6.25h − 5a − 161
//   "other" treated as average of male/female
// ──────────────────────────────────────────────────────────────────────────────
function mifflinStJeor(sex: WalletCalcInput['sex'], weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  if (sex === 'male') return base + 5
  if (sex === 'female') return base - 161
  return base - 78  // average of +5 and -161
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-meal price = intercept + Σ(macro_quantity × coefficient)
// `quantity` is grams (perGram table) or kcal (perKcal table)
// ──────────────────────────────────────────────────────────────────────────────
function priceMeal(coeff: PerMealCoeff, quantity: { p: number; c: number; f: number }): number {
  return coeff.i + coeff.p * quantity.p + coeff.c * quantity.c + coeff.f * quantity.f
}

export function calculateWalletPlan(
  input: WalletCalcInput,
  settings: WalletSettings = DEFAULT_WALLET_SETTINGS,
): WalletCalcResult {
  // ── 1. Daily caloric need ──────────────────────────────────
  const bmr = mifflinStJeor(input.sex, input.weightKg, input.heightCm, input.age)
  const activityMultiplier = settings.calorieFormula.activityMultipliers[input.activity]
  const goalAdjustment = settings.calorieFormula.goalAdjustments[input.goal]
  const dailyKcal = Math.max(0, Math.round(bmr * activityMultiplier + goalAdjustment))

  // ── 2. Macro split (P/C/F) by goal — applied per-meal ──────
  const macroSplitPct = settings.macroSplitByGoal[input.goal]

  // Daily macro grams (informational — also surfaced in "your numbers" pill)
  const macroGramsPerDay = {
    p: Math.round((dailyKcal * macroSplitPct.p) / 100 / KCAL_PER_GRAM.p),
    c: Math.round((dailyKcal * macroSplitPct.c) / 100 / KCAL_PER_GRAM.c),
    f: Math.round((dailyKcal * macroSplitPct.f) / 100 / KCAL_PER_GRAM.f),
  }

  // ── 3. Per-meal breakdown — the 4×3 matrix ─────────────────
  const matrix = settings.pricingMatrix
  const useTable = matrix.active // 'perKcal' | 'perGram'

  const perMeal = {} as Record<MealKey, MealBreakdown>
  let dailyPrice = 0

  for (const meal of ALL_MEALS) {
    const included = input.meals[meal]
    const mealPctOfDay = settings.mealSplit[meal]
    const mealKcal = (dailyKcal * mealPctOfDay) / 100

    // kcal of each macro at this meal
    const kcalP = (mealKcal * macroSplitPct.p) / 100
    const kcalC = (mealKcal * macroSplitPct.c) / 100
    const kcalF = (mealKcal * macroSplitPct.f) / 100

    // grams of each macro at this meal
    const gP = kcalP / KCAL_PER_GRAM.p
    const gC = kcalC / KCAL_PER_GRAM.c
    const gF = kcalF / KCAL_PER_GRAM.f

    // price using whichever table is active
    const coeff = matrix[useTable][meal]
    const quantity =
      useTable === 'perKcal'
        ? { p: kcalP, c: kcalC, f: kcalF }
        : { p: gP, c: gC, f: gF }
    const rawPrice = priceMeal(coeff, quantity)
    const price = Math.max(0, rawPrice) // floor at 0 for safety

    perMeal[meal] = {
      included,
      kcal: Math.round(mealKcal),
      grams: { p: Math.round(gP), c: Math.round(gC), f: Math.round(gF) },
      kcalPerMacro: { p: Math.round(kcalP), c: Math.round(kcalC), f: Math.round(kcalF) },
      price: round2(price),
    }

    if (included) dailyPrice += price
  }

  // ── 4. Period pricing ──────────────────────────────────────
  const planLengthWeeks = settings.planLengthWeeks[input.planLength]
  const daysCovered = planLengthWeeks * input.daysPerWeek
  const periodPriceBeforeDiscount = dailyPrice * daysCovered

  // ── 5. Discount lookup ─────────────────────────────────────
  const discountPct = settings.discountMatrix[input.planLength][input.daysPerWeek] ?? 0
  const amountToPay = periodPriceBeforeDiscount * (1 - discountPct)
  const bonusCredits = periodPriceBeforeDiscount - amountToPay
  const walletCredit = periodPriceBeforeDiscount

  // ── 6. Result ──────────────────────────────────────────────
  const selectedMealCount = ALL_MEALS.filter((m) => input.meals[m]).length

  return {
    dailyKcal,
    macroSplitPct,
    macroGramsPerDay,
    perMeal,
    dailyPrice: round2(dailyPrice),
    daysCovered: round2(daysCovered),
    periodPriceBeforeDiscount: round2(periodPriceBeforeDiscount),
    discountPct,
    amountToPay: round2(amountToPay),
    bonusCredits: round2(bonusCredits),
    walletCredit: round2(walletCredit),
    planLength: input.planLength,
    planLengthWeeks,
    daysPerWeek: input.daysPerWeek,
    selectedMealCount,
    matrixSnapshot: {
      formula: settings.calorieFormula.formula,
      activityMultiplier,
      goalAdjustment,
      bmr: Math.round(bmr),
      mealSplitPctUsed: settings.mealSplit,
      pricingTable: useTable,
    },
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
