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
  // 1. Wallet row
  const { data: walletRow, error: wErr } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (wErr) {
    // No wallet exists yet — return inactive wallet
    if (wErr.code === 'PGRST116') {
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
    return { data: null, error: wErr.message }
  }

  const w = walletRow as DbWallet

  // 2. Active plan (if any)
  let planEl: string | undefined
  let planEn: string | undefined
  let bonusPct: number | undefined
  let monthlyAmount: number | undefined
  let creditAmount: number | undefined

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
      transactions,
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
