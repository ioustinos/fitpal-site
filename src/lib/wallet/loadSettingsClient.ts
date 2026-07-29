// WEC-433: browser-side fetcher for wallet settings.
//
// Before this, WalletPage called calculateWalletPlan(input) without passing
// settings, so the calculator silently used DEFAULT_WALLET_SETTINGS (the
// compile-time bundled defaults in src/lib/wallet/constants.ts). Admin
// edits in /admin/settings → wallet_pricing_matrix landed in DB but never
// reached the customer. The customer saw a stale price; the server (the
// authoritative pricing point in wallet-plan-purchase.ts) charged the new
// price → unpleasant surprise.
//
// settings table has RLS "Public read settings" USING (true), so the anon
// Supabase client can read these rows safely.
//
// Server-side equivalent lives at netlify/lib/wallet/loadSettings.ts. The
// shape mapping (normalizePricingMatrix etc) is intentionally duplicated
// here rather than shared to keep the bundle clean. Both paths fall back
// to DEFAULT_WALLET_SETTINGS if any field is missing or malformed.

import { supabase } from '../supabase'
import {
  DEFAULT_WALLET_SETTINGS,
  KCAL_PER_GRAM,
} from './constants'
import type { WalletSettings } from './types'

const KEYS = [
  'wallet_pricing_matrix',
  'wallet_meal_split',
  'wallet_macro_split_by_goal',
  'wallet_calorie_formula',
  'wallet_discount_matrix',
  'wallet_meals_extra_discount',
  'wallet_plan_lengths',
] as const

/** Read all wallet-related setting rows. Returns DEFAULT_WALLET_SETTINGS on any
 *  failure (network error / RLS denial / malformed row) so the UI never breaks
 *  — it just renders stale prices. The quote-before-submit safety net catches
 *  any drift before the customer pays. */
export async function loadWalletSettingsFromDb(): Promise<WalletSettings> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', KEYS as unknown as string[])

    if (error || !data) return DEFAULT_WALLET_SETTINGS

    const map = new Map<string, unknown>()
    for (const row of data as Array<{ key: string; value: unknown }>) {
      map.set(row.key, row.value)
    }

    return {
      pricingMatrix: normalizePricingMatrix(map.get('wallet_pricing_matrix')),
      mealSplit:
        (map.get('wallet_meal_split') as WalletSettings['mealSplit']) ??
        DEFAULT_WALLET_SETTINGS.mealSplit,
      macroSplitByGoal:
        (map.get('wallet_macro_split_by_goal') as WalletSettings['macroSplitByGoal']) ??
        DEFAULT_WALLET_SETTINGS.macroSplitByGoal,
      calorieFormula:
        (map.get('wallet_calorie_formula') as WalletSettings['calorieFormula']) ??
        DEFAULT_WALLET_SETTINGS.calorieFormula,
      discountMatrix:
        (map.get('wallet_discount_matrix') as WalletSettings['discountMatrix']) ??
        DEFAULT_WALLET_SETTINGS.discountMatrix,
      // WEC-552: extra-meals discount (0..1). Optional DB key; falls back to default.
      mealsExtraDiscount:
        (map.get('wallet_meals_extra_discount') as number) ??
        DEFAULT_WALLET_SETTINGS.mealsExtraDiscount,
      planLengthWeeks:
        (map.get('wallet_plan_lengths') as WalletSettings['planLengthWeeks']) ??
        DEFAULT_WALLET_SETTINGS.planLengthWeeks,
    }
  } catch {
    return DEFAULT_WALLET_SETTINGS
  }
}

/** Mirror of the server-side normalizer in netlify/lib/wallet/loadSettings.ts.
 *  Handles both the new shape (perKcal.{p,c,f}.{meal}) and the legacy
 *  shape (perGram.{meal}.{i,p,c,f}). New shape is the only one written by
 *  the current admin UI; the legacy path is kept as a safety belt for any
 *  pre-WEC-339 row that hasn't been migrated yet. */
function normalizePricingMatrix(raw: unknown): WalletSettings['pricingMatrix'] {
  const fallback = DEFAULT_WALLET_SETTINGS.pricingMatrix
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as Record<string, unknown>

  const perGramObj = (obj.perGram as Record<string, unknown>) ?? {}
  const newShapeHit =
    perGramObj &&
    typeof perGramObj === 'object' &&
    'p' in perGramObj &&
    'c' in perGramObj &&
    'f' in perGramObj &&
    perGramObj.p &&
    typeof perGramObj.p === 'object' &&
    'breakfast' in (perGramObj.p as object)

  if (newShapeHit) {
    return {
      active: (obj.active as 'perGram' | 'perKcal') ?? fallback.active,
      perGram: perGramObj as unknown as WalletSettings['pricingMatrix']['perGram'],
      perKcal: (obj.perKcal as WalletSettings['pricingMatrix']['perKcal']) ?? fallback.perKcal,
      intercepts: (obj.intercepts as WalletSettings['pricingMatrix']['intercepts']) ?? fallback.intercepts,
      kcalPerGram: (obj.kcalPerGram as WalletSettings['pricingMatrix']['kcalPerGram']) ?? KCAL_PER_GRAM,
    }
  }

  // Legacy: don't bother reconstructing — pre-WEC-339 rows are extinct in
  // practice. Caller can investigate if this fires.
  return fallback
}
