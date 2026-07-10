// WEC-529: when a wallet plan becomes PAID, populate the customer's account
// macro goals (public.user_goals) from the plan's frozen diet profile so
// goal tracking works out of the box — previously the wizard computed
// kcal + macros, stored them on wallet_plans, and the customer had to
// re-enter the same numbers by hand in Account → Goals.
//
// Mapping: the plan gives POINT targets (daily_kcal + macro_split pct);
// user_goals stores RANGES (min/max). We write a ±GOAL_BAND_PCT band around
// each target. Grams derive from kcal exactly like calculator.ts:
//   grams(macro) = dailyKcal × pct/100 ÷ kcalPerGram   (p:4, c:4, f:9)
//
// Policy (defaults confirmed in WEC-529):
//   - OVERWRITE any existing goals — the fresh subscription profile is the
//     newer source of truth.
//   - Set user_goals.enabled = true AND user_prefs.goal_tracking = true so
//     the customer actually sees goal bars after purchase (WEC-163 gate).
//
// Idempotent (same plan → same values) and FAIL-SOFT: a goals hiccup must
// never break payment confirmation. Callers fire-and-await, errors are logged.
//
// Callers (every pending→paid transition):
//   - netlify/lib/wallet/verifyWalletPlanTransaction.ts  (card / link via Viva)
//   - netlify/functions/wallet-plan-mark-paid.ts         (bank transfer, admin)

import type { SupabaseClient } from '@supabase/supabase-js'

/** ± band applied around each point target to form the min/max range.
 *  10 → 5 per Ioustinos 2026-07-10. */
const GOAL_BAND_PCT = 5

/** Biology constants — kcal per gram of macro. Mirrors calculator kcalPerGram. */
const KCAL_PER_GRAM = { p: 4, c: 4, f: 9 } as const

interface MacroSplitPct { p: number; c: number; f: number }

function band(target: number): { min: number; max: number } {
  return {
    min: Math.round(target * (1 - GOAL_BAND_PCT / 100)),
    max: Math.round(target * (1 + GOAL_BAND_PCT / 100)),
  }
}

export async function applyPlanGoalsToUser(
  supabase: SupabaseClient,
  walletPlanId: string,
): Promise<void> {
  try {
    const { data: plan } = await supabase
      .from('wallet_plans')
      .select('id, wallet_id, daily_kcal, macro_split')
      .eq('id', walletPlanId)
      .maybeSingle()
    if (!plan) {
      console.warn('[applyPlanGoals] plan %s not found — skipping', walletPlanId)
      return
    }

    const dailyKcal = (plan.daily_kcal as number | null) ?? 0
    const split = (plan.macro_split as MacroSplitPct | null) ?? null
    if (!dailyKcal || !split || split.p == null || split.c == null || split.f == null) {
      // Legacy v1 plans (pre-calculator) have no diet profile — nothing to apply.
      console.warn('[applyPlanGoals] plan %s has no diet profile (kcal=%s) — skipping', walletPlanId, dailyKcal)
      return
    }

    // Resolve the owning user via the wallet.
    const { data: wallet } = await supabase
      .from('wallets')
      .select('user_id')
      .eq('id', plan.wallet_id as string)
      .maybeSingle()
    const userId = (wallet as { user_id?: string } | null)?.user_id
    if (!userId) {
      console.warn('[applyPlanGoals] wallet %s has no user — skipping', plan.wallet_id)
      return
    }

    // Daily grams per macro, identical formula to calculator.ts dailyGrams.
    const proteinG = Math.round((dailyKcal * split.p) / 100 / KCAL_PER_GRAM.p)
    const carbsG   = Math.round((dailyKcal * split.c) / 100 / KCAL_PER_GRAM.c)
    const fatG     = Math.round((dailyKcal * split.f) / 100 / KCAL_PER_GRAM.f)

    const cal = band(dailyKcal)
    const pro = band(proteinG)
    const carb = band(carbsG)
    const fat = band(fatG)

    // user_goals PK = user_id (row normally exists via the signup trigger,
    // upsert covers pre-trigger accounts too).
    const { error: goalsErr } = await supabase
      .from('user_goals')
      .upsert({
        user_id: userId,
        enabled: true,
        cal_min: cal.min, cal_max: cal.max,
        protein_min: pro.min, protein_max: pro.max,
        carbs_min: carb.min, carbs_max: carb.max,
        fat_min: fat.min, fat_max: fat.max,
      }, { onConflict: 'user_id' })
    if (goalsErr) {
      console.error('[applyPlanGoals] user_goals upsert failed plan=%s user=%s: %s', walletPlanId, userId, goalsErr.message)
      return
    }

    // Flip the visibility gate so the bars actually render (WEC-163:
    // goals shown when prefs.goal_tracking && goals.enabled).
    const { error: prefErr } = await supabase
      .from('user_prefs')
      .update({ goal_tracking: true })
      .eq('user_id', userId)
    if (prefErr) {
      console.error('[applyPlanGoals] user_prefs.goal_tracking update failed user=%s: %s', userId, prefErr.message)
    }

    console.log('[applyPlanGoals] goals set from plan %s for user %s: kcal %d±%d%%, P %dg, C %dg, F %dg',
      walletPlanId, userId, dailyKcal, GOAL_BAND_PCT, proteinG, carbsG, fatG)
  } catch (e) {
    // Fail-soft by design — never let goals block a payment confirmation.
    console.error('[applyPlanGoals] failed (non-fatal) plan=%s:', walletPlanId, e)
  }
}
