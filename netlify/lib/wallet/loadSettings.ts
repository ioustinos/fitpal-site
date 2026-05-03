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
import type { WalletSettings, PaymentMethod } from '../../../src/lib/wallet/types'
import { DEFAULT_WALLET_SETTINGS } from '../../../src/lib/wallet/constants'

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
      'wallet_plan_lengths',
      'wallet_payment_methods',
      'wallet_voucher_enabled',
      'wallet_services_catalog',
      'wallet_min_amount_cents',
    ])

  if (error) {
    console.error('[loadWalletConfig] settings fetch failed; falling back to defaults', error)
    return defaultConfig()
  }

  const map = new Map<string, unknown>()
  for (const row of data ?? []) map.set(row.key, row.value)

  const settings: WalletSettings = {
    pricingMatrix:    (map.get('wallet_pricing_matrix')      as WalletSettings['pricingMatrix'])    ?? DEFAULT_WALLET_SETTINGS.pricingMatrix,
    mealSplit:        (map.get('wallet_meal_split')          as WalletSettings['mealSplit'])        ?? DEFAULT_WALLET_SETTINGS.mealSplit,
    macroSplitByGoal: (map.get('wallet_macro_split_by_goal') as WalletSettings['macroSplitByGoal']) ?? DEFAULT_WALLET_SETTINGS.macroSplitByGoal,
    calorieFormula:   (map.get('wallet_calorie_formula')     as WalletSettings['calorieFormula'])   ?? DEFAULT_WALLET_SETTINGS.calorieFormula,
    discountMatrix:   (map.get('wallet_discount_matrix')     as WalletSettings['discountMatrix'])   ?? DEFAULT_WALLET_SETTINGS.discountMatrix,
    planLengthWeeks:  (map.get('wallet_plan_lengths')        as WalletSettings['planLengthWeeks'])  ?? DEFAULT_WALLET_SETTINGS.planLengthWeeks,
  }

  const config: FullWalletConfig = {
    settings,
    paymentMethods:  (map.get('wallet_payment_methods')   as PaymentMethod[])         ?? ['card', 'link', 'transfer'],
    voucherEnabled:  (map.get('wallet_voucher_enabled')   as boolean)                 ?? true,
    servicesCatalog: (map.get('wallet_services_catalog')  as ServiceCatalogItem[])    ?? [],
    minAmountCents:  (map.get('wallet_min_amount_cents')  as number)                  ?? 3000,
  }

  cache = { value: config, loadedAt: Date.now() }
  return config
}

/** Bypass the cache — useful when admin just edited the settings UI. */
export function invalidateWalletConfigCache(): void {
  cache = null
}

function defaultConfig(): FullWalletConfig {
  return {
    settings: DEFAULT_WALLET_SETTINGS,
    paymentMethods: ['card', 'link', 'transfer'],
    voucherEnabled: true,
    servicesCatalog: [],
    minAmountCents: 3000,
  }
}
