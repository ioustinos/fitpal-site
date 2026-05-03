// ──────────────────────────────────────────────────────────────────────────────
// Wallet plan calculator — types
// ──────────────────────────────────────────────────────────────────────────────
// All money fields are EUROS (numbers). When we persist to the database we
// convert to cents at the boundary (everything in DB is `int` cents). Inside
// the UI / calculator we stay in euros so the math is human-readable.

export type Sex = 'female' | 'male' | 'other'
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
export type Goal = 'lose' | 'maintain' | 'gain'
export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type Macro = 'p' | 'c' | 'f'
export type PlanLength = '2w' | '1mo' | '3mo'
export type DaysPerWeek = 5 | 6 | 7
export type PaymentMethod = 'cash' | 'card' | 'link' | 'transfer' | 'wallet'

export interface MealsSelection {
  breakfast: boolean
  lunch: boolean
  dinner: boolean
  snack: boolean
}

export interface WalletCalcInput {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  activity: ActivityLevel
  goal: Goal
  meals: MealsSelection
  planLength: PlanLength
  daysPerWeek: DaysPerWeek
  services: { dieticianManaged: boolean }
}

export interface MealBreakdown {
  included: boolean
  kcal: number
  grams: { p: number; c: number; f: number }
  kcalPerMacro: { p: number; c: number; f: number }
  price: number
}

export interface WalletCalcResult {
  // Daily nutrition
  dailyKcal: number
  macroSplitPct: { p: number; c: number; f: number }
  macroGramsPerDay: { p: number; c: number; f: number }

  // Per-meal breakdown (the 4×3 matrix populated for this user)
  perMeal: Record<MealKey, MealBreakdown>

  // Daily / period pricing
  dailyPrice: number
  daysCovered: number              // weeks × daysPerWeek
  periodPriceBeforeDiscount: number
  discountPct: number              // 0..1
  amountToPay: number              // periodPriceBeforeDiscount × (1 − discount)
  bonusCredits: number             // periodPriceBeforeDiscount − amountToPay
  walletCredit: number             // = periodPriceBeforeDiscount

  // Plan summary
  planLength: PlanLength
  planLengthWeeks: number
  daysPerWeek: DaysPerWeek
  selectedMealCount: number

  // Audit / explainability snapshot
  matrixSnapshot: {
    formula: string
    activityMultiplier: number
    goalAdjustment: number
    bmr: number
    mealSplitPctUsed: Record<MealKey, number>
    pricingTable: 'perKcal' | 'perGram'
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Settings shape — these eventually live in `settings` jsonb on the DB.
// For now we keep them as constants (see ./constants.ts) and the calculator
// accepts a settings object so it's easy to swap later.
// ──────────────────────────────────────────────────────────────────────────────

export interface PerMealCoeff {
  /** Intercept (€) — fixed cost per meal regardless of macros */
  i: number
  /** € per gram (or per kcal) of protein */
  p: number
  /** € per gram (or per kcal) of carbs */
  c: number
  /** € per gram (or per kcal) of fat */
  f: number
}

export interface PricingMatrix {
  perGram: Record<MealKey, PerMealCoeff>
  perKcal: Record<MealKey, PerMealCoeff>
  active: 'perGram' | 'perKcal'
}

export interface CalorieFormulaSettings {
  formula: 'mifflin_st_jeor'
  activityMultipliers: Record<ActivityLevel, number>
  goalAdjustments: Record<Goal, number>
}

export interface WalletSettings {
  pricingMatrix: PricingMatrix
  mealSplit: Record<MealKey, number>             // percentages, sum = 100
  macroSplitByGoal: Record<Goal, { p: number; c: number; f: number }>  // sum = 100 each
  calorieFormula: CalorieFormulaSettings
  discountMatrix: Record<PlanLength, Record<DaysPerWeek, number>>      // 0..1
  planLengthWeeks: Record<PlanLength, number>
}
