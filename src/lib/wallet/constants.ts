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
  // Shape: macro × meal grid (3×4 = 12 values per form) + 4 intercepts
  // + kcalPerGram biology constants. Mirrors the admin grid editor.
  // ────────────────────────────────────────────────────────────
  pricingMatrix: {
    active: 'perKcal',
    // Calibrated vs Maria's 10 manual plans (WEC-533, 2026-07-14).
    // Source of truth is settings.wallet_pricing_matrix in the DB —
    // these values are the fallback mirror only.
    // € per gram of <macro> at <meal>
    perGram: {
      p: { breakfast: 0.0544, lunch: 0.0696, dinner: 0.0744, snack: 0.0768 },
      c: { breakfast: 0.0160, lunch: 0.0160, dinner: 0.0160, snack: 0.0160 },
      f: { breakfast: 0.0810, lunch: 0.0288, dinner: 0.0630, snack: 0.0450 },
    },
    // € per kcal of <macro> at <meal> (= perGram ÷ kcalPerGram)
    perKcal: {
      p: { breakfast: 0.0136, lunch: 0.0174, dinner: 0.0186, snack: 0.0192 },
      c: { breakfast: 0.0040, lunch: 0.0040, dinner: 0.0040, snack: 0.0040 },
      f: { breakfast: 0.0090, lunch: 0.0032, dinner: 0.0070, snack: 0.0050 },
    },
    // Per-meal fixed floor cost (€)
    intercepts: {
      breakfast: 2.71,
      lunch:     6.60,
      dinner:    6.00,
      snack:     1.96,
    },
    // Biology: kcal yielded by 1g of each macro. Configurable but
    // realistically never changes from 4/4/9.
    kcalPerGram: { p: 4, c: 4, f: 9 },
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
  // Source: head dietitian Νένα (2026-05-08 spec).
  // ────────────────────────────────────────────────────────────
  macroSplitByGoal: {
    lose:     { p: 25, c: 45, f: 30 },  // -500 kcal/day
    maintain: { p: 20, c: 50, f: 30 },
    gain:     { p: 30, c: 50, f: 20 },  // +300 kcal/day
  },

  // ────────────────────────────────────────────────────────────
  // Calorie formula — Mifflin-St Jeor BMR × PAL × goal adj
  // PAL values from head dietitian Νένα. 5th tier (very_active)
  // kept in the type/calculator but not surfaced in the UI per
  // WEC-360 — dietitian's table only covers 4 levels.
  // ────────────────────────────────────────────────────────────
  calorieFormula: {
    formula: 'mifflin_st_jeor',
    activityMultipliers: {
      sedentary:   1.2,    // Καθιστική
      light:       1.4,    // Ελαφριά
      moderate:    1.5,    // Μέτρια
      active:      1.7,    // Πολύ δραστήριος
      very_active: 1.9,    // (UI-hidden; legacy)
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
  // WEC-552: owner discount matrix = duration + days-per-week components folded
  // into one table. Duration: 2w 3% / 1mo 6% / 3mo 10%. Days/week: 4d +0 / 5d
  // +2 / 6d +4 / 7d +6. (Meals-count discount is separate — see mealsExtraDiscount
  // + calculator.) Admin-managed via settings.wallet_discount_matrix.
  discountMatrix: {
    '2w':  { 4: 0.03, 5: 0.05, 6: 0.07, 7: 0.09 },
    '1mo': { 4: 0.06, 5: 0.08, 6: 0.10, 7: 0.12 },
    '3mo': { 4: 0.10, 5: 0.12, 6: 0.14, 7: 0.16 },
  },

  // WEC-552: additional discount per meal-type selected BEYOND the 2-meal
  // minimum. +1 extra meal = 2%, +2 = 4%. Stacks additively on the matrix above.
  mealsExtraDiscount: 0.02,

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
// kcal per gram by macro (biology constants — fallback only)
// The canonical source is now `settings.pricingMatrix.kcalPerGram`;
// this constant is kept so legacy callers without a settings object
// still work, and so the calculator can fall back if the field is
// missing from a stale settings row.
// ────────────────────────────────────────────────────────────
export const KCAL_PER_GRAM = {
  p: 4,
  c: 4,
  f: 9,
} as const

// WEC-553: λιπομέτρηση (body-fat measurement) add-on fee in cents, by plan
// length. €29 for the 2-week & 1-month plans, €87 for the 3-month package.
// Charged ON TOP of the plan (not wallet credit). Priced server-side; this
// shared constant lets the wizard preview the same number.
export const LIPOMETRISI_FEE_CENTS: Record<PlanLength, number> = {
  '2w': 2900,
  '1mo': 2900,
  '3mo': 8700,
}

/** WEC-553: fee in cents for the λιπομέτρηση add-on, or 0 when not selected. */
export function lipometrisiFeeCents(planLength: PlanLength, enabled: boolean | undefined): number {
  return enabled ? (LIPOMETRISI_FEE_CENTS[planLength] ?? 0) : 0
}

// ────────────────────────────────────────────────────────────
// Display labels (bilingual)
// ────────────────────────────────────────────────────────────
export const PLAN_LENGTH_LABELS: Record<PlanLength, { el: string; en: string; short: string }> = {
  '2w':  { el: '2 εβδομάδες', en: '2 weeks',  short: '2w'  },
  '1mo': { el: '1 μήνας',     en: '1 month',  short: '1mo' },
  '3mo': { el: '3 μήνες',     en: '3 months', short: '3mo' },
}

// WEC-360: renamed per dietitian feedback. The top "very active / 2× daily"
// tier was dropped from the UI (see the activity button list in WalletPage).
// `very_active` is kept in the map so the type/calculator stay intact — it's
// simply never offered as a selectable option.
export const ACTIVITY_LABELS = {
  sedentary:   { el: 'Καθιστική Ζωή',       en: 'Sedentary',          sub: { el: 'γραφείο, λίγη κίνηση',                  en: 'desk job, little movement'  } },
  light:       { el: 'Ελαφρώς Δραστήριος',  en: 'Lightly active',     sub: { el: '1–3 προπονήσεις/εβδ.',                 en: '1–3 workouts/wk'            } },
  moderate:    { el: 'Μέτρια Δραστήριος',   en: 'Moderately active',  sub: { el: '3–5 προπονήσεις/εβδ.',                 en: '3–5 workouts/wk'            } },
  active:      { el: 'Πολύ Δραστήριος',     en: 'Very active',        sub: { el: '6–7 προπονήσεις ή βαριά σωματική εργασία', en: '6–7 workouts or hard labour' } },
  very_active: { el: 'Πολύ ενεργός',        en: 'Extremely active',   sub: { el: '2× ημερησίως ή φυσική εργασία',        en: '2× daily or physical job'   } },
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
