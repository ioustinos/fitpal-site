// ──────────────────────────────────────────────────────────────────────────────
// Wallet plan calculator — default settings (R1 hardcoded; eventually in DB)
// ──────────────────────────────────────────────────────────────────────────────
// These values mirror the `settings` jsonb keys we'll create when we wire the
// backend (`wallet_pricing_matrix`, `wallet_meal_split`, etc.). Keeping them
// here for R1 lets the UI run end-to-end without DB plumbing.

import type { WalletSettings, PlanLength } from './types'

export const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  // ────────────────────────────────────────────────────────────
  // Pricing matrix — derived from existing dish data via regression
  // (Ioustinos's price-calc chat). Both forms stored; `active` decides.
  // ────────────────────────────────────────────────────────────
  pricingMatrix: {
    active: 'perKcal',
    perGram: {
      breakfast: { i: 3.2438, p: 0.059611, c: 0.000640, f: 0.033241 },
      lunch:     { i: 6.6102, p: 0.083625, c: -0.034411, f: 0.078906 },
      dinner:    { i: 6.3362, p: 0.072036, c: -0.005313, f: 0.012452 },
      snack:     { i: 2.4800, p: 0.027286, c: 0.006719, f: -0.013487 },
    },
    perKcal: {
      breakfast: { i: 3.2438, p: 0.014903, c: 0.000160, f: 0.003693 },
      lunch:     { i: 6.6102, p: 0.020906, c: -0.008603, f: 0.008767 },
      dinner:    { i: 6.3362, p: 0.018009, c: -0.001328, f: 0.001384 },
      snack:     { i: 2.4800, p: 0.006822, c: 0.001680, f: -0.001499 },
    },
  },

  // ────────────────────────────────────────────────────────────
  // Meal split — what % of daily kcal lives at each meal slot.
  // Skipping a meal does NOT redistribute — those kcal simply
  // aren't supplied (per Ioustinos's spec).
  // ────────────────────────────────────────────────────────────
  mealSplit: {
    breakfast: 25,
    lunch: 35,
    dinner: 30,
    snack: 10,
  },

  // ────────────────────────────────────────────────────────────
  // Macro split (P/C/F) by user goal. Same split applied to
  // every included meal in V1; per-meal overrides come later.
  // ────────────────────────────────────────────────────────────
  macroSplitByGoal: {
    lose:     { p: 35, c: 35, f: 30 },
    maintain: { p: 25, c: 50, f: 25 },
    gain:     { p: 30, c: 50, f: 20 },
  },

  // ────────────────────────────────────────────────────────────
  // Calorie formula — Mifflin-St Jeor BMR × activity × goal adj
  // ────────────────────────────────────────────────────────────
  calorieFormula: {
    formula: 'mifflin_st_jeor',
    activityMultipliers: {
      sedentary:   1.2,
      light:       1.375,
      moderate:    1.55,
      active:      1.725,
      very_active: 1.9,
    },
    goalAdjustments: {
      lose:     -500,
      maintain:  0,
      gain:      300,
    },
  },

  // ────────────────────────────────────────────────────────────
  // Discount matrix — single 2D table, plan length × days/week.
  // Values are fractions (0..1). Tune freely.
  // ────────────────────────────────────────────────────────────
  discountMatrix: {
    '2w':  { 5: 0.04, 6: 0.06, 7: 0.08 },
    '1mo': { 5: 0.10, 6: 0.12, 7: 0.15 },
    '3mo': { 5: 0.18, 6: 0.22, 7: 0.25 },
  },

  // ────────────────────────────────────────────────────────────
  // Plan length → weeks conversion
  // ────────────────────────────────────────────────────────────
  planLengthWeeks: {
    '2w':  2,
    '1mo': 4.33,   // 52/12
    '3mo': 13,
  },
}

// ────────────────────────────────────────────────────────────
// kcal per gram by macro (biology constants)
// ────────────────────────────────────────────────────────────
export const KCAL_PER_GRAM = {
  p: 4,
  c: 4,
  f: 9,
} as const

// ────────────────────────────────────────────────────────────
// Display labels (bilingual)
// ────────────────────────────────────────────────────────────
export const PLAN_LENGTH_LABELS: Record<PlanLength, { el: string; en: string; short: string }> = {
  '2w':  { el: '2 εβδομάδες', en: '2 weeks',  short: '2w'  },
  '1mo': { el: '1 μήνας',     en: '1 month',  short: '1mo' },
  '3mo': { el: '3 μήνες',     en: '3 months', short: '3mo' },
}

export const ACTIVITY_LABELS = {
  sedentary:   { el: 'Καθιστικός',     en: 'Sedentary',   sub: { el: 'γραφείο, λίγη κίνηση',       en: 'desk job, no exercise'      } },
  light:       { el: 'Ελαφρύς',        en: 'Light',       sub: { el: '1–3 προπονήσεις/εβδ.',       en: '1–3 workouts/wk'            } },
  moderate:    { el: 'Μέτριος',        en: 'Moderate',    sub: { el: '3–5 προπονήσεις/εβδ.',       en: '3–5 workouts/wk'            } },
  active:      { el: 'Ενεργός',        en: 'Active',      sub: { el: '6–7 προπονήσεις/εβδ.',       en: '6–7 workouts/wk'            } },
  very_active: { el: 'Πολύ ενεργός',   en: 'Very active', sub: { el: '2× ημερησίως ή φυσική εργασία', en: '2× daily or physical job' } },
} as const

export const GOAL_LABELS = {
  lose:     { el: 'Απώλεια',    en: 'Lose'     },
  maintain: { el: 'Διατήρηση', en: 'Maintain' },
  gain:     { el: 'Αύξηση',    en: 'Gain'     },
} as const

export const SEX_LABELS = {
  female: { el: 'Γυναίκα',  en: 'Female' },
  male:   { el: 'Άνδρας',   en: 'Male'   },
  other:  { el: 'Άλλο',     en: 'Other'  },
} as const

export const MEAL_LABELS: Record<'breakfast' | 'lunch' | 'dinner' | 'snack', { el: string; en: string; emoji: string }> = {
  breakfast: { el: 'Πρωινό',      en: 'Breakfast', emoji: '☀️' },
  lunch:     { el: 'Μεσημεριανό', en: 'Lunch',     emoji: '\u{1F31E}'    },
  dinner:    { el: 'Βραδινό',     en: 'Dinner',    emoji: '\u{1F319}'    },
  snack:     { el: 'Σνακ',        en: 'Snack',     emoji: '\u{1F95C}'    },
}
