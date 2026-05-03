// Admin queries for wallet plan purchases.
// Read directly via Supabase + RLS (admin policies cover all wallet_plans).
// Refund call goes through /api/wallet-plan-refund Netlify Function.

import { supabase } from '../supabase'

export interface AdminWalletPlanRow {
  id: string
  walletId: string
  userId: string | null
  customerName: string | null
  customerEmail: string | null
  goal: string | null
  planLength: string | null
  daysPerWeek: number | null
  selectedMeals: string[]
  amountToPayCents: number
  walletCreditCents: number
  bonusCreditsCents: number
  refundAmountCents: number
  paymentMethod: string | null
  paymentStatus: string
  vivaOrderCode: string | null
  vivaTransactionId: string | null
  createdAt: string
  confirmedAt: string | null
  services: { dieticianManaged?: boolean }
  dailyKcal: number | null
}

export interface AdminWalletPlanDetail extends AdminWalletPlanRow {
  profileSnapshot: { sex?: string; birth_year?: number; height_cm?: number; weight_kg?: number; activity_level?: string; goal?: string }
  macroSplit: { p?: number; c?: number; f?: number }
  pricingBreakdown: Record<string, { kcal: number; price: number; grams: { p: number; c: number; f: number } }>
  pricingMatrixSnapshot: unknown
  discountMatrixSnapshot: unknown
  subtotalCents: number
  discountCents: number
  discountPct: number
  voucherId: string | null
  voucherAmountCents: number
}

interface AdminWalletPlanFilters {
  status?: string             // 'pending' | 'paid' | 'failed' | 'refunded'
  planLength?: string         // '2w' | '1mo' | '3mo'
  goal?: string               // 'lose' | 'maintain' | 'gain'
  fromDate?: string           // ISO date
  toDate?: string             // ISO date
  search?: string             // matches customer email or name (substring)
  limit?: number
}

function rowToBase(row: Record<string, unknown>): AdminWalletPlanRow {
  const meals: string[] = []
  if (row.meal_breakfast) meals.push('breakfast')
  if (row.meal_lunch)     meals.push('lunch')
  if (row.meal_dinner)    meals.push('dinner')
  if (row.meal_snack)     meals.push('snack')
  const wallet = row.wallets as { user_id?: string; profiles?: { name?: string; email?: string } } | null
  const profile = wallet?.profiles ?? null

  return {
    id: row.id as string,
    walletId: row.wallet_id as string,
    userId: wallet?.user_id ?? null,
    customerName:  profile?.name ?? null,
    customerEmail: profile?.email ?? null,
    goal: row.goal as string | null,
    planLength: row.plan_length as string | null,
    daysPerWeek: row.days_per_week as number | null,
    selectedMeals: meals,
    amountToPayCents: (row.amount_to_pay_cents as number) ?? 0,
    walletCreditCents: (row.wallet_credit_cents as number) ?? 0,
    bonusCreditsCents: (row.bonus_credits_cents as number) ?? 0,
    refundAmountCents: (row.refund_amount_cents as number) ?? 0,
    paymentMethod: row.payment_method as string | null,
    paymentStatus: (row.payment_status as string) ?? 'pending',
    vivaOrderCode: row.viva_order_code as string | null,
    vivaTransactionId: row.viva_transaction_id as string | null,
    createdAt: row.created_at as string,
    confirmedAt: row.confirmed_at as string | null,
    services: (row.services as { dieticianManaged?: boolean }) ?? {},
    dailyKcal: row.daily_kcal as number | null,
  }
}

export async function fetchAdminWalletPlans(
  filters: AdminWalletPlanFilters = {},
): Promise<{ data: AdminWalletPlanRow[] | null; error: string | null }> {
  let q = supabase
    .from('wallet_plans')
    .select('*, wallets!inner(user_id, profiles:user_id(name, email))')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.status)     q = q.eq('payment_status', filters.status)
  if (filters.planLength) q = q.eq('plan_length',    filters.planLength)
  if (filters.goal)       q = q.eq('goal',           filters.goal)
  if (filters.fromDate)   q = q.gte('created_at', filters.fromDate)
  if (filters.toDate)     q = q.lte('created_at', filters.toDate)

  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map((r) => rowToBase(r as Record<string, unknown>)), error: null }
}

export async function fetchAdminWalletPlanDetail(
  planId: string,
): Promise<{ data: AdminWalletPlanDetail | null; error: string | null }> {
  const { data, error } = await supabase
    .from('wallet_plans')
    .select('*, wallets!inner(user_id, profiles:user_id(name, email))')
    .eq('id', planId)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'Not found' }
  const row = data as Record<string, unknown>
  return {
    data: {
      ...rowToBase(row),
      profileSnapshot: (row.profile_snapshot as AdminWalletPlanDetail['profileSnapshot']) ?? {},
      macroSplit: (row.macro_split as AdminWalletPlanDetail['macroSplit']) ?? {},
      pricingBreakdown: (row.pricing_breakdown as AdminWalletPlanDetail['pricingBreakdown']) ?? {},
      pricingMatrixSnapshot: row.pricing_matrix_snapshot,
      discountMatrixSnapshot: row.discount_matrix_snapshot,
      subtotalCents: (row.subtotal_cents as number) ?? 0,
      discountCents: (row.discount_cents as number) ?? 0,
      discountPct: (row.discount_pct as number) ?? 0,
      voucherId: row.voucher_id as string | null,
      voucherAmountCents: (row.voucher_amount_cents as number) ?? 0,
    },
    error: null,
  }
}

/** Stats for the dashboard widget — wallet purchase aggregates. */
export interface WalletPlanStats {
  paidToday: number
  paidWeek: number
  paidMonth: number
  revenueWeekCents: number
  revenueMonthCents: number
  pendingCount: number
  stuckPendingCount: number       // pending > 3 minutes
}

export async function fetchAdminWalletStats(): Promise<{ data: WalletPlanStats | null; error: string | null }> {
  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const stuckCutoff = new Date(Date.now() - 3 * 60 * 1000)

  const [today, week, month, pending, stuck] = await Promise.all([
    supabase.from('wallet_plans').select('amount_to_pay_cents', { count: 'exact' }).eq('payment_status', 'paid').gte('confirmed_at', startOfDay.toISOString()),
    supabase.from('wallet_plans').select('amount_to_pay_cents', { count: 'exact' }).eq('payment_status', 'paid').gte('confirmed_at', weekAgo.toISOString()),
    supabase.from('wallet_plans').select('amount_to_pay_cents', { count: 'exact' }).eq('payment_status', 'paid').gte('confirmed_at', monthAgo.toISOString()),
    supabase.from('wallet_plans').select('id', { count: 'exact', head: true }).eq('payment_status', 'pending'),
    supabase.from('wallet_plans').select('id', { count: 'exact', head: true }).eq('payment_status', 'pending').lt('created_at', stuckCutoff.toISOString()).in('payment_method', ['card', 'link']),
  ])

  const sum = (rows: { amount_to_pay_cents: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + (r.amount_to_pay_cents ?? 0), 0)

  return {
    data: {
      paidToday: today.count ?? 0,
      paidWeek:  week.count ?? 0,
      paidMonth: month.count ?? 0,
      revenueWeekCents:  sum(week.data as { amount_to_pay_cents: number }[]),
      revenueMonthCents: sum(month.data as { amount_to_pay_cents: number }[]),
      pendingCount: pending.count ?? 0,
      stuckPendingCount: stuck.count ?? 0,
    },
    error: null,
  }
}

/** Refund a wallet plan via the Netlify function (admin-only there too). */
export async function refundAdminWalletPlan(
  walletPlanId: string,
  amountCents: number | undefined,
  reason: string,
): Promise<{ error: string | null; data?: { refundedCents: number; newRefundTotal: number; planFullyRefunded: boolean } }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) return { error: 'Not authenticated' }

  const res = await fetch('/api/wallet-plan-refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ walletPlanId, amountCents, reason }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    return { error: err.error ?? `HTTP ${res.status}` }
  }
  return { data: await res.json(), error: null }
}
