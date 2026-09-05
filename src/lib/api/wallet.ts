import { supabase } from '../supabase'
import type { UserWallet, WalletTransaction } from '../../store/useAuthStore'

// ─── DB row shapes ───────────────────────────────────────────────────────────

interface DbWallet {
  id: string
  user_id: string
  active_plan_id: string | null
  balance: number            // cents
  base_balance: number       // cents
  bonus_balance: number      // cents
  auto_renew: boolean
  next_renewal: string | null
  active: boolean
  admin_managed: boolean      // when true, only admins can spend via impersonation
}

interface DbWalletPlan {
  id: string
  wallet_id: string
  consumer_type: string
  meal_breakfast: boolean
  meal_lunch: boolean
  meal_dinner: boolean
  meal_snack: boolean          // WEC-686
  people: number
  days_per_week: number
  frequency: string
  cost: number               // cents
  credits: number            // cents
  bonus_pct: number
  bonus_amount: number       // cents
  bonus_expires_at: string | null
  created_at: string
}

interface DbWalletTransaction {
  id: string
  wallet_id: string
  type: string               // topup | bonus | debit | refund | bonus_expired | adjustment
  amount: number             // cents (positive or negative)
  description_el: string | null
  description_en: string | null
  order_id: string | null
  created_at: string
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

const centsToEuros = (cents: number): number => +(cents / 100).toFixed(2)

const toTransaction = (row: DbWalletTransaction): WalletTransaction => ({
  type: row.type === 'debit' ? 'debit' : 'credit',
  descEl: row.description_el ?? '',
  descEn: row.description_en ?? '',
  date: row.created_at.split('T')[0],
  amount: centsToEuros(row.amount),
})

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch the user's wallet state + active plan details + recent transactions.
 */
export async function fetchWallet(userId: string): Promise<{
  data: UserWallet | null
  error: string | null
}> {
  // 1. Wallet row — .maybeSingle() so "no wallet yet" isn't a 406 in the console
  const { data: walletRow, error: wErr } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (wErr) {
    return { data: null, error: wErr.message }
  }

  if (!walletRow) {
    // No wallet exists yet — return inactive wallet
    return {
      data: {
        active: false,
        balance: 0,
        baseBalance: 0,
        bonusBalance: 0,
      },
      error: null,
    }
  }

  const w = walletRow as DbWallet

  // 2. Active plan (if any)
  let planEl: string | undefined
  let planEn: string | undefined
  let bonusPct: number | undefined
  let monthlyAmount: number | undefined
  let creditAmount: number | undefined
  // WEC-565: initial-purchase breakdown for the Συνδρομή tab.
  let purchaseAmount: number | undefined   // amount_to_pay_cents (paid)
  let purchaseBonus: number | undefined    // bonus_credits_cents
  let purchaseCredit: number | undefined   // wallet_credit_cents (paid + bonus)
  // WEC-349: plan composition + dates for the "My Subscription" tab.
  let startDate: string | undefined
  let bonusExpiresAt: string | undefined
  let frequency: string | undefined
  let people: number | undefined
  let daysPerWeek: number | undefined
  let meals: { breakfast: boolean; lunch: boolean; dinner: boolean; snack: boolean } | undefined
  // WEC-663: fields the Συνδρομές tab needs but weren't exposed before.
  let goal: string | undefined
  let bodyFatMeasurement: boolean | undefined
  let purchaseDate: string | undefined

  if (w.active_plan_id) {
    const { data: planRow } = await supabase
      .from('wallet_plans')
      .select('*')
      .eq('id', w.active_plan_id)
      .single()

    if (planRow) {
      const plan = planRow as DbWalletPlan
      // Use consumer_type as the plan display name
      const typeLabels: Record<string, { el: string; en: string }> = {
        light:    { el: 'Light', en: 'Light' },
        medium:   { el: 'Medium', en: 'Medium' },
        regular:  { el: 'Regular', en: 'Regular' },
        large:    { el: 'Large', en: 'Large' },
        athletic: { el: 'Athletic', en: 'Athletic' },
      }
      const label = typeLabels[plan.consumer_type] ?? { el: plan.consumer_type, en: plan.consumer_type }
      planEl = label.el
      planEn = label.en
      bonusPct = plan.bonus_pct
      monthlyAmount = centsToEuros(plan.cost)
      creditAmount = centsToEuros(plan.credits + plan.bonus_amount)
      // WEC-565: explicit v2 initial-purchase columns (fall back to legacy
      // mirrors when a very old plan row lacks them).
      {
        const pv = planRow as Record<string, number | null>
        purchaseAmount = centsToEuros((pv.amount_to_pay_cents ?? plan.cost) ?? 0)
        purchaseBonus  = centsToEuros((pv.bonus_credits_cents ?? plan.bonus_amount) ?? 0)
        purchaseCredit = centsToEuros((pv.wallet_credit_cents ?? plan.credits) ?? 0)
      }
      // created_at is a timestamptz; keep the date part for display parity
      // with the other ISO date fields the tab formats.
      startDate = plan.created_at ? plan.created_at.split('T')[0] : undefined
      bonusExpiresAt = plan.bonus_expires_at
        ? plan.bonus_expires_at.split('T')[0]
        : undefined
      frequency = plan.frequency
      people = plan.people
      daysPerWeek = plan.days_per_week
      meals = {
        breakfast: !!plan.meal_breakfast,
        lunch: !!plan.meal_lunch,
        dinner: !!plan.meal_dinner,
        snack: !!plan.meal_snack, // WEC-686: snack was missing → customer didn't see it
      }
      // WEC-663: plan type (goal), λιπομέτρηση, and purchase date (confirmed_at,
      // falling back to created_at) for the slimmed Συνδρομές tab.
      const pr = planRow as Record<string, unknown>
      goal = (pr.goal as string | null) ?? undefined
      const svc = (pr.services as { bodyFatMeasurement?: boolean } | null) ?? {}
      bodyFatMeasurement = !!svc?.bodyFatMeasurement
      const confirmedAt = pr.confirmed_at as string | null
      purchaseDate = confirmedAt ? confirmedAt.split('T')[0] : startDate
    }
  }

  // 3. Transactions (most recent 20)
  const { data: txRows } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', w.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const transactions = (txRows ?? []).map((t) => toTransaction(t as DbWalletTransaction))

  return {
    data: {
      active: w.active,
      planId: w.active_plan_id ?? undefined,
      planEl,
      planEn,
      balance: centsToEuros(w.balance),
      baseBalance: centsToEuros(w.base_balance),
      bonusBalance: centsToEuros(w.bonus_balance),
      bonusPct,
      autoRenew: w.auto_renew,
      nextRenewal: w.next_renewal ?? undefined,
      monthlyAmount,
      creditAmount,
      purchaseAmount,
      purchaseBonus,
      purchaseCredit,
      startDate,
      bonusExpiresAt,
      frequency,
      people,
      daysPerWeek,
      meals,
      goal,
      bodyFatMeasurement,
      purchaseDate,
      transactions,
      adminManaged: w.admin_managed ?? false,
    },
    error: null,
  }
}

// WEC-589: past (non-active) plans for the merged Subscription & Wallet page.
export interface PastWalletPlan {
  id: string
  labelEl: string
  labelEn: string
  createdAt: string | null   // YYYY-MM-DD (date part)
  amountPaid: number         // € paid
  credits: number            // € credited (paid + bonus)
  paymentStatus: string
}

const CONSUMER_LABELS: Record<string, { el: string; en: string }> = {
  light: { el: 'Light', en: 'Light' },
  medium: { el: 'Medium', en: 'Medium' },
  regular: { el: 'Regular', en: 'Regular' },
  large: { el: 'Large', en: 'Large' },
  athletic: { el: 'Athletic', en: 'Athletic' },
}

/**
 * WEC-589 (absorbs WEC-349 gap): the customer's PAST wallet plans — every
 * `wallet_plans` row for their wallet except the currently-active one, newest
 * first. Lazy-loaded when the "past plans" section is expanded. Reads via the
 * same customer RLS `fetchWallet` already uses for the active plan.
 */
export async function fetchPastWalletPlans(
  userId: string,
  excludePlanId?: string,
): Promise<{ data: PastWalletPlan[] | null; error: string | null }> {
  const { data: walletRow, error: wErr } = await supabase
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (wErr) return { data: null, error: wErr.message }
  if (!walletRow) return { data: [], error: null }

  let q = supabase
    .from('wallet_plans')
    .select('id, consumer_type, created_at, amount_to_pay_cents, wallet_credit_cents, cost, credits, payment_status')
    .eq('wallet_id', (walletRow as { id: string }).id)
    .order('created_at', { ascending: false })
  if (excludePlanId) q = q.neq('id', excludePlanId)

  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  const rows = (data ?? []) as Record<string, string | number | null>[]
  return {
    data: rows.map((p) => {
      const ct = String(p.consumer_type ?? '')
      const lbl = CONSUMER_LABELS[ct] ?? { el: ct || '—', en: ct || '—' }
      return {
        id: String(p.id),
        labelEl: lbl.el,
        labelEn: lbl.en,
        createdAt: p.created_at ? String(p.created_at).split('T')[0] : null,
        amountPaid: centsToEuros(Number(p.amount_to_pay_cents ?? p.cost ?? 0)),
        credits: centsToEuros(Number(p.wallet_credit_cents ?? p.credits ?? 0)),
        paymentStatus: String(p.payment_status ?? 'paid'),
      }
    }),
    error: null,
  }
}

// ─── WEC-701 §A: subscription success page (revisitable, survives refresh) ────

export interface SubscriptionBankInfo {
  iban: string
  beneficiary: string
  bankName: string | null
}

export interface SubscriptionDetails {
  /** WP-<first8 of plan uuid, uppercased> — the human reference shown to the customer. */
  reference: string
  planId: string
  paymentMethod: string          // cash | card | link | transfer | wallet
  paymentStatus: string          // pending | paid | failed | refunded
  amountPaid: number             // € the customer pays
  walletCredit: number           // € credited to wallet (paid + bonus)
  bonusCredits: number           // € bonus
  goal: string | null
  planLength: string | null
  planLengthWeeks: number | null
  daysPerWeek: number | null
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean; snack: boolean }
  dailyKcal: number | null
  invoiceType: string | null     // 'invoice' | 'receipt' | null
  invoiceName: string | null
  invoiceVat: string | null
  purchaseDate: string | null    // YYYY-MM-DD (confirmed_at, falls back to created_at)
  /** Only populated for a transfer purchase — the accounts to pay into. */
  bankInfos: SubscriptionBankInfo[]
  /** WEC-703: voucher applied at purchase — code + € off the amount paid.
   *  null / 0 when no voucher was used. */
  voucherCode: string | null
  voucherDiscount: number
}

/** Derive the WP- reference for a plan uuid. Keep in sync with
 *  `wallet-plan-purchase.ts` (`WP-${id.slice(0,8).toUpperCase()}`). */
export function planReference(planId: string): string {
  return `WP-${planId.slice(0, 8).toUpperCase()}`
}

/**
 * WEC-701 §A: resolve a subscription by its WP- reference for the signed-in
 * customer, so `/subscription/success/:reference` can rebuild the page from the
 * durable plan record on every visit / refresh (never from React state).
 *
 * Reference = `WP-` + the first 8 hex chars of the plan uuid. We match on the
 * user's own `wallet_plans` (RLS-scoped) rather than a global lookup, so one
 * customer can never resolve another's plan. Bank accounts come from the public
 * `settings.bank_transfer_info` — the same source the order + email flows use.
 */
export async function fetchSubscriptionByReference(
  userId: string,
  reference: string,
): Promise<{ data: SubscriptionDetails | null; error: string | null }> {
  const prefix = reference.replace(/^WP-/i, '').toLowerCase()
  if (!/^[0-9a-f]{8}$/.test(prefix)) {
    return { data: null, error: 'invalid reference' }
  }

  const { data: walletRow, error: wErr } = await supabase
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (wErr) return { data: null, error: wErr.message }
  if (!walletRow) return { data: null, error: 'not found' }

  const { data: planRows, error: pErr } = await supabase
    .from('wallet_plans')
    .select('id, payment_method, payment_status, goal, plan_length, plan_length_weeks, days_per_week, meal_breakfast, meal_lunch, meal_dinner, meal_snack, amount_to_pay_cents, wallet_credit_cents, bonus_credits_cents, daily_kcal, invoice_type, invoice_name, invoice_vat, voucher_id, voucher_amount_cents, confirmed_at, created_at')
    .eq('wallet_id', (walletRow as { id: string }).id)
    .order('created_at', { ascending: false })
  if (pErr) return { data: null, error: pErr.message }

  const row = (planRows ?? []).find(
    (p) => String((p as { id: string }).id).slice(0, 8).toLowerCase() === prefix,
  ) as Record<string, unknown> | undefined
  if (!row) return { data: null, error: 'not found' }

  // Bank accounts (transfer only) — public settings, array of {iban,beneficiary,bankName}.
  let bankInfos: SubscriptionBankInfo[] = []
  if (row.payment_method === 'transfer') {
    const { data: bankRow } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'bank_transfer_info')
      .maybeSingle()
    const raw = (bankRow as { value?: unknown } | null)?.value
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
    bankInfos = (list as Record<string, unknown>[])
      .filter((e) => e && typeof e === 'object')
      .map((o) => ({
        iban: typeof o.iban === 'string' ? o.iban : '',
        beneficiary: typeof o.beneficiary === 'string' ? o.beneficiary : '',
        bankName: typeof o.bankName === 'string' ? o.bankName : null,
      }))
      .filter((e) => e.iban.length > 0)
  }

  // WEC-703: resolve the voucher code (if any) for display on the success page.
  let voucherCode: string | null = null
  const voucherDiscount = centsToEuros(Number(row.voucher_amount_cents ?? 0))
  if (row.voucher_id) {
    const { data: vRow } = await supabase
      .from('vouchers')
      .select('code')
      .eq('id', String(row.voucher_id))
      .maybeSingle()
    voucherCode = (vRow as { code?: string } | null)?.code ?? null
  }

  const confirmedAt = row.confirmed_at as string | null
  const createdAt = row.created_at as string | null
  return {
    data: {
      reference: planReference(String(row.id)),
      planId: String(row.id),
      paymentMethod: String(row.payment_method ?? ''),
      paymentStatus: String(row.payment_status ?? 'pending'),
      amountPaid: centsToEuros(Number(row.amount_to_pay_cents ?? 0)),
      walletCredit: centsToEuros(Number(row.wallet_credit_cents ?? 0)),
      bonusCredits: centsToEuros(Number(row.bonus_credits_cents ?? 0)),
      goal: (row.goal as string | null) ?? null,
      planLength: (row.plan_length as string | null) ?? null,
      planLengthWeeks: row.plan_length_weeks != null ? Number(row.plan_length_weeks) : null,
      daysPerWeek: row.days_per_week != null ? Number(row.days_per_week) : null,
      meals: {
        breakfast: !!row.meal_breakfast,
        lunch: !!row.meal_lunch,
        dinner: !!row.meal_dinner,
        snack: !!row.meal_snack,
      },
      dailyKcal: row.daily_kcal != null ? Number(row.daily_kcal) : null,
      invoiceType: (row.invoice_type as string | null) ?? null,
      invoiceName: (row.invoice_name as string | null) ?? null,
      invoiceVat: (row.invoice_vat as string | null) ?? null,
      purchaseDate: confirmedAt ? confirmedAt.split('T')[0] : createdAt ? createdAt.split('T')[0] : null,
      bankInfos,
      voucherCode,
      voucherDiscount,
    },
    error: null,
  }
}

/**
 * Fetch just the wallet transactions (paginated).
 */
export async function fetchTransactions(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{
  data: WalletTransaction[] | null
  error: string | null
}> {
  // First get the wallet ID
  const { data: walletRow, error: wErr } = await supabase
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (wErr) return { data: null, error: wErr.message }

  const { data: txRows, error: tErr } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', (walletRow as { id: string }).id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (tErr) return { data: null, error: tErr.message }

  return {
    data: (txRows ?? []).map((t) => toTransaction(t as DbWalletTransaction)),
    error: null,
  }
}
