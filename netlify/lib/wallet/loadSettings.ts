// Loads the 10 wallet settings keys from the `settings` jsonb table and
// assembles them into a `WalletSettings` object that `calculateWalletPlan`
// can consume directly. Cached in-memory for 60s to avoid hitting the DB on
// every quote request.
//
// Keys read:
//   wallet_pricing_matrix
//   wallet_meal_split
//   wallet_macro_split_by_goal
//   wallet_calorie_formula
//   wallet_discount_matrix
//   wallet_plan_lengths
//   wallet_payment_methods       (returned separately, not in WalletSettings)
//   wallet_voucher_enabled       (returned separately)
//   wallet_services_catalog      (returned separately)
//   wallet_min_amount_cents      (returned separately)

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { WalletSettings, PaymentMethod, MealKey, Macro } from '../../../src/lib/wallet/types'
import { DEFAULT_WALLET_SETTINGS, KCAL_PER_GRAM } from '../../../src/lib/wallet/constants'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const CACHE_TTL_MS = 60_000

interface ServiceCatalogItem {
  id: string
  nameEl: string
  nameEn: string
  priceCents: number
  defaultOn: boolean
}

export interface BankTransferInfo {
  iban: string
  beneficiary: string
  bankName?: string
}

export interface FullWalletConfig {
  /** The settings the calculator needs */
  settings: WalletSettings
  /** Allowed payment methods at wallet checkout */
  paymentMethods: PaymentMethod[]
  /** Whether voucher codes can be applied at wallet checkout */
  voucherEnabled: boolean
  /** Catalog of available service add-ons */
  servicesCatalog: ServiceCatalogItem[]
  /** Minimum total (cents) for a wallet purchase */
  minAmountCents: number
  /** Bank wire details shown on the transfer-payment success overlay */
  bankTransferInfo: BankTransferInfo
}

let cache: { value: FullWalletConfig; loadedAt: number } | null = null

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Load the wallet config (settings + checkout opts). Cached 60s in memory. */
export async function loadWalletConfig(opts: { force?: boolean } = {}): Promise<FullWalletConfig> {
  if (!opts.force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', [
      'wallet_pricing_matrix',
      'wallet_meal_split',
      'wallet_macro_split_by_goal',
      'wallet_calorie_formula',
      'wallet_discount_matrix',
      'wallet_meals_extra_discount',
      'wallet_plan_lengths',
      'wallet_payment_methods',
      'wallet_voucher_enabled',
      'wallet_services_catalog',
      'wallet_min_amount_cents',
      'bank_transfer_info',
    ])

  if (error) {
    console.error('[loadWalletConfig] settings fetch failed; falling back to defaults', error)
    return defaultConfig()
  }

  const map = new Map<string, unknown>()
  for (const row of data ?? []) map.set(row.key, row.value)

  const settings: WalletSettings = {
    pricingMatrix:    normalizePricingMatrix(map.get('wallet_pricing_matrix')),
    mealSplit:        (map.get('wallet_meal_split')          as WalletSettings['mealSplit'])        ?? DEFAULT_WALLET_SETTINGS.mealSplit,
    macroSplitByGoal: (map.get('wallet_macro_split_by_goal') as WalletSettings['macroSplitByGoal']) ?? DEFAULT_WALLET_SETTINGS.macroSplitByGoal,
    calorieFormula:   (map.get('wallet_calorie_formula')     as WalletSettings['calorieFormula'])   ?? DEFAULT_WALLET_SETTINGS.calorieFormula,
    discountMatrix:   (map.get('wallet_discount_matrix')     as WalletSettings['discountMatrix'])   ?? DEFAULT_WALLET_SETTINGS.discountMatrix,
    // WEC-552: extra-meals discount (0..1). Optional DB key; falls back to default.
    mealsExtraDiscount: (map.get('wallet_meals_extra_discount') as number) ?? DEFAULT_WALLET_SETTINGS.mealsExtraDiscount,
    planLengthWeeks:  (map.get('wallet_plan_lengths')        as WalletSettings['planLengthWeeks'])  ?? DEFAULT_WALLET_SETTINGS.planLengthWeeks,
  }

  const config: FullWalletConfig = {
    settings,
    // WEC-554: cash (Αντικαταβολή) added to the fallback allowlist. NOTE: if a
    // `wallet_payment_methods` row EXISTS in settings, it wins — so cash must
    // also be added there (via /admin/wallet-settings) for it to be offered.
    paymentMethods:   (map.get('wallet_payment_methods')   as PaymentMethod[])         ?? ['card', 'link', 'transfer', 'cash'],
    voucherEnabled:   (map.get('wallet_voucher_enabled')   as boolean)                 ?? true,
    servicesCatalog:  (map.get('wallet_services_catalog')  as ServiceCatalogItem[])    ?? [],
    minAmountCents:   (map.get('wallet_min_amount_cents')  as number)                  ?? 3000,
    // WEC-260: bank_transfer_info is now an array of up to 5 entries.
    // Wallet-plan-purchase only renders one IBAN on its success overlay,
    // so we always pick the first valid entry. Falls back to a placeholder
    // when the admin hasn't configured one — the customer-facing message
    // ("contact support") is rendered in wallet-plan-purchase.ts.
    bankTransferInfo: pickFirstBank(map.get('bank_transfer_info')),
  }

  cache = { value: config, loadedAt: Date.now() }
  return config
}

/** Bypass the cache — useful when admin just edited the settings UI. */
export function invalidateWalletConfigCache(): void {
  cache = null
}

/**
 * Normalise the legacy single-object and the new array shape of
 * `settings.bank_transfer_info` (WEC-260) down to one IBAN entry —
 * what the wallet-plan UI expects.
 */
function pickFirstBank(raw: unknown): BankTransferInfo {
  const fallback: BankTransferInfo = { iban: '', beneficiary: '' }
  if (!raw) return fallback
  const list = Array.isArray(raw) ? raw : [raw]
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const iban = typeof o.iban === 'string' ? o.iban.trim() : ''
    if (!iban) continue
    return {
      iban,
      beneficiary: typeof o.beneficiary === 'string' ? o.beneficiary : '',
      bankName: typeof o.bankName === 'string' ? o.bankName : undefined,
    }
  }
  return fallback
}

/**
 * Accepts either:
 *  - the new shape: { active, perGram: {p:{b,l,d,s},c:{...},f:{...}}, perKcal:{...}, intercepts:{b,l,d,s}, kcalPerGram:{p,c,f} }
 *  - the legacy shape: { active, perGram: {breakfast:{i,p,c,f}, lunch:{...}, ...}, perKcal:{...} }
 *
 * In both cases returns the new shape. Used at load time so the calculator
 * never has to know about the legacy nesting. The migration in
 * supabase/migrations/wec_wallet_pricing_matrix_reshape.sql writes the new
 * shape back into the DB once; until that runs, this normalizer covers it.
 */
function normalizePricingMatrix(raw: unknown): WalletSettings['pricingMatrix'] {
  const fallback = DEFAULT_WALLET_SETTINGS.pricingMatrix
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as Record<string, unknown>

  // New shape: perGram.p / perGram.c / perGram.f are keyed by macro and
  // contain {breakfast,lunch,dinner,snack} objects.
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

  // Legacy shape: perGram.breakfast = { i, p, c, f } etc. Transpose.
  const transpose = (form: 'perGram' | 'perKcal') => {
    const raw = obj[form] as Record<MealKey, { i: number; p: number; c: number; f: number }> | undefined
    if (!raw) return fallback[form]
    const out: WalletSettings['pricingMatrix']['perGram'] = {
      p: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
      c: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
      f: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
    }
    const meals: MealKey[] = ['breakfast', 'lunch', 'dinner', 'snack']
    const macros: Macro[] = ['p', 'c', 'f']
    for (const m of meals) {
      const cell = raw[m] ?? { i: 0, p: 0, c: 0, f: 0 }
      for (const k of macros) out[k][m] = Number(cell[k]) || 0
    }
    return out
  }

  const intercepts: WalletSettings['pricingMatrix']['intercepts'] = {
    breakfast: 0, lunch: 0, dinner: 0, snack: 0,
  }
  const legacyPerGram = obj.perGram as Record<MealKey, { i: number }> | undefined
  if (legacyPerGram) {
    for (const m of ['breakfast', 'lunch', 'dinner', 'snack'] as MealKey[]) {
      intercepts[m] = Number(legacyPerGram[m]?.i) || 0
    }
  }

  return {
    active: (obj.active as 'perGram' | 'perKcal') ?? fallback.active,
    perGram: transpose('perGram'),
    perKcal: transpose('perKcal'),
    intercepts,
    kcalPerGram: KCAL_PER_GRAM,
  }
}

function defaultConfig(): FullWalletConfig {
  return {
    settings: DEFAULT_WALLET_SETTINGS,
    paymentMethods: ['card', 'link', 'transfer', 'cash'], // WEC-554
    voucherEnabled: true,
    servicesCatalog: [],
    minAmountCents: 3000,
    bankTransferInfo: { iban: '', beneficiary: '' },
  }
}
