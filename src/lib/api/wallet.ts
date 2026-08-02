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
  let meals: { breakfast: boolean; lunch: boolean; dinner: boolean } | undefined

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
      }
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
