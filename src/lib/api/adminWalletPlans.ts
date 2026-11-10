// Admin queries for wallet plan purchases.
// Read directly via Supabase + RLS (admin policies cover all wallet_plans).
// Refund call goes through /api/wallet-plan-refund Netlify Function.

import { supabase } from '../supabase'

import { workingDaysEnd } from '../planDates' // WEC-905

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
  /** WEC-811 lifecycle status: 'active' | 'cancelled'. */
  status: string
  vivaOrderCode: string | null
  vivaTransactionId: string | null
  createdAt: string
  confirmedAt: string | null
  // WEC-553: bodyFatMeasurement + its fee (cents) snapshot.
  services: { dieticianManaged?: boolean; bodyFatMeasurement?: boolean; bodyFatFeeCents?: number }
  dailyKcal: number | null
  // WEC-693: invoice request snapshot ('invoice' = τιμολόγιο, 'receipt' = απόδειξη).
  invoiceType: string | null
  invoiceName: string | null
  invoiceVat: string | null
  // WEC-794: the start date the customer picked (WEC-783) + derived active-until.
  startDate: string | null
  activeUntil: string | null
  planLengthWeeks: number | null
  // Contacted: admin-set yes/no flag — has the team reached out about this purchase.
  contacted: boolean
  /** WEC-903: true when a strictly-later PAID plan exists for the same wallet —
   *  i.e. the customer has already renewed/bought again. Computed per page. */
  renewed: boolean
  /** WEC-913: which package purchase this is for the customer — 1 = first,
   *  2 = second … Counts only PAID purchases created before it, so failed
   *  attempts / retries don't bump the number. Computed per page. */
  purchaseNumber: number
  /** WEC-799: when an admin last sent a Viva payment link (null = never). */
  linkSentAt: string | null
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
  // WEC-893 Leg 4: human voucher code (looked up from voucher_id) for the drawer.
  voucherCode: string | null
  // WEC-893 Leg 1: ops note moved into the plan drawer.
  adminNote: string | null
}

interface AdminWalletPlanFilters {
  status?: string             // 'pending' | 'paid' | 'failed' | 'refunded'
  planLength?: string         // '2w' | '1mo' | '3mo'
  goal?: string               // 'lose' | 'maintain' | 'gain'
  lifecycle?: string          // wallet_plans.status: 'active' | 'cancelled'
  fromDate?: string           // ISO date — created_at
  toDate?: string             // ISO date — created_at
  // WEC-903: start_date (Έναρξη) + active_until (Λήξη) ranges, από–έως.
  startFrom?: string          // start_date >=
  startTo?: string            // start_date <=
  endFrom?: string            // active_until >=
  endTo?: string              // active_until <=
  renewed?: boolean           // WEC-903: true = only renewed, false = only not-renewed
  purchase?: 'first' | 'repeat' // WEC-913: 1st package purchase vs 2nd+
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
    status: (row.status as string) ?? 'active',
    vivaOrderCode: row.viva_order_code as string | null,
    vivaTransactionId: row.viva_transaction_id as string | null,
    createdAt: row.created_at as string,
    confirmedAt: row.confirmed_at as string | null,
    services: (row.services as { dieticianManaged?: boolean; bodyFatMeasurement?: boolean; bodyFatFeeCents?: number }) ?? {},
    dailyKcal: row.daily_kcal as number | null,
    invoiceType: (row.invoice_type as string | null) ?? null,
    invoiceName: (row.invoice_name as string | null) ?? null,
    invoiceVat:  (row.invoice_vat  as string | null) ?? null,
    startDate:  (row.start_date  as string | null) ?? null,
    activeUntil:(row.active_until as string | null) ?? null,
    planLengthWeeks: (row.plan_length_weeks as number | null) ?? null,
    contacted: (row.contacted as boolean) ?? false,
    renewed: false, // filled in by fetchAdminWalletPlans (per-page computation)
    purchaseNumber: 1, // WEC-913: filled in by fetchAdminWalletPlans
    linkSentAt: (row.link_sent_at as string | null) ?? null,
  }
}

export async function fetchAdminWalletPlans(
  filters: AdminWalletPlanFilters = {},
): Promise<{ data: AdminWalletPlanRow[] | null; error: string | null }> {
  let q = supabase
    .from('wallet_plans')
    .select('*, wallets!wallet_plans_wallet_id_fkey(user_id, profiles:user_id(name, email))')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.status)     q = q.eq('payment_status', filters.status)
  if (filters.planLength) q = q.eq('plan_length',    filters.planLength)
  if (filters.goal)       q = q.eq('goal',           filters.goal)
  if (filters.lifecycle)  q = q.eq('status',         filters.lifecycle)
  if (filters.fromDate)   q = q.gte('created_at', filters.fromDate)
  if (filters.toDate)     q = q.lte('created_at', filters.toDate)
  // WEC-903: Έναρξη / Λήξη date ranges (από–έως), server-side.
  if (filters.startFrom)  q = q.gte('start_date',  filters.startFrom)
  if (filters.startTo)    q = q.lte('start_date',  filters.startTo)
  if (filters.endFrom)    q = q.gte('active_until', filters.endFrom)
  if (filters.endTo)      q = q.lte('active_until', filters.endTo)

  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  const rows = (data ?? []).map((r) => rowToBase(r as Record<string, unknown>))

  // WEC-903: mark «renewed» — a strictly-later PAID plan exists for the same
  // wallet. One extra query over the page's wallets; the lookup is NOT subject to
  // the date filters above (a plan filtered to this week may be renewed next month).
  const walletIds = [...new Set(rows.map((r) => r.walletId).filter(Boolean))]
  if (walletIds.length) {
    const { data: paid } = await supabase
      .from('wallet_plans')
      .select('wallet_id, created_at')
      .in('wallet_id', walletIds)
      .eq('payment_status', 'paid')
    const byWallet = new Map<string, string[]>()
    for (const p of (paid ?? []) as Array<{ wallet_id: string; created_at: string }>) {
      const arr = byWallet.get(p.wallet_id) ?? []
      arr.push(p.created_at)
      byWallet.set(p.wallet_id, arr)
    }
    for (const r of rows) {
      const others = byWallet.get(r.walletId) ?? []
      r.renewed = others.some((ts) => ts > r.createdAt)
      // WEC-913: 1 + paid purchases strictly before this one.
      r.purchaseNumber = 1 + others.filter((ts) => ts < r.createdAt).length
    }
  }

  let filtered = filters.renewed === undefined ? rows : rows.filter((r) => r.renewed === filters.renewed)
  if (filters.purchase === 'first') filtered = filtered.filter((r) => r.purchaseNumber === 1)
  else if (filters.purchase === 'repeat') filtered = filtered.filter((r) => r.purchaseNumber > 1)
  return { data: filtered, error: null }
}

export async function fetchAdminWalletPlanDetail(
  planId: string,
): Promise<{ data: AdminWalletPlanDetail | null; error: string | null }> {
  const { data, error } = await supabase
    .from('wallet_plans')
    .select('*, wallets!wallet_plans_wallet_id_fkey(user_id, profiles:user_id(name, email))')
    .eq('id', planId)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'Not found' }
  const row = data as Record<string, unknown>
  // WEC-893 Leg 4: resolve the human voucher code from voucher_id (the Airtable
  // push does the same lookup — pushWalletPlan.ts).
  let voucherCode: string | null = null
  const vId = row.voucher_id as string | null
  if (vId) {
    const { data: vRow } = await supabase.from('vouchers').select('code').eq('id', vId).maybeSingle()
    voucherCode = (vRow as { code?: string } | null)?.code ?? null
  }
  // WEC-913: which package purchase this is (1 + paid purchases before it).
  const { count: earlierPaid } = await supabase.from('wallet_plans')
    .select('id', { count: 'exact', head: true })
    .eq('wallet_id', row.wallet_id as string).eq('payment_status', 'paid')
    .lt('created_at', row.created_at as string)
  return {
    data: {
      ...rowToBase(row),
      purchaseNumber: 1 + (earlierPaid ?? 0),
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
      voucherCode,
      adminNote: (row.admin_note as string | null) ?? null,
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

/**
 * WEC-509: mark a bank-transfer wallet plan as paid (admin, funds received).
 * Credits the customer's wallet via the Netlify function (transfer-only there).
 */
export async function markAdminWalletPlanPaid(
  walletPlanId: string,
): Promise<{ error: string | null; data?: { ok: boolean; alreadyPaid?: boolean } }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) return { error: 'Not authenticated' }

  const res = await fetch('/api/wallet-plan-mark-paid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ walletPlanId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    return { error: err.error ?? `HTTP ${res.status}` }
  }
  return { data: await res.json(), error: null }
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

// WEC-894: admin edits the subscription's final price (revenue) + discount.
// Server-authoritative — the browser only POSTs; is_admin() is checked there.
export async function editWalletPlanPrice(
  walletPlanId: string, amountToPayCents: number, discountCents: number,
): Promise<{ error: string | null }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) return { error: 'Not authenticated' }
  const res = await fetch('/api/wallet-plan-edit-price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ walletPlanId, amountToPayCents, discountCents }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    return { error: err.error ?? `HTTP ${res.status}` }
  }
  return { error: null }
}

// ─── WEC-799: payment method + Viva payment link (same as orders) ─────────

/** Viva hosted-checkout URL for an order code (client side). Dev deploys talk to
 *  the Viva demo merchant; production to the live one — mirrors netlify/lib/viva/env. */
export function vivaCheckoutUrl(orderCode: string): string {
  const isDev = import.meta.env.VITE_FITPAL_ENV === 'dev'
    || (typeof window !== 'undefined' && (window.location.hostname.startsWith('dev--') || window.location.hostname === 'localhost'))
  return `https://${isDev ? 'demo.vivapayments.com' : 'www.vivapayments.com'}/web/checkout?ref=${orderCode}`
}

/** WEC-799: change a plan's payment method — a plain field write + audit row,
 *  exactly like updateOrderPaymentMethod (no switch-away guard, by decision).
 *  'wallet' is refused: a plan CREDITS the wallet, it can't be paid from it. */
export async function updateWalletPlanPaymentMethod(
  id: string, current: string | null, next: string, adminUser: string,
): Promise<{ error: string | null }> {
  if (next === 'wallet') return { error: 'A subscription cannot be paid from the wallet.' }
  const { error } = await supabase.from('wallet_plans').update({ payment_method: next }).eq('id', id)
  if (error) return { error: error.message }
  const { error: logErr } = await supabase.from('admin_change_log').insert({
    wallet_plan_id: id, table_name: 'wallet_plans', field_name: 'payment_method',
    old_value: current ?? '', new_value: next, label: `payment method: ${current ?? '—'} → ${next}`,
    admin_user: adminUser,
  })
  if (logErr) console.error('[updateWalletPlanPaymentMethod] change_log failed:', logErr)
  return { error: null }
}

/** WEC-799: send / regenerate the Viva payment link for a plan (shared endpoint).
 *  Server cuts an 18h link, flips method → link, sets pending_link_sent +
 *  link_sent_at, logs the timeline and fires the «Payment Link Sent» email. */
export async function sendWalletPlanPaymentLink(
  id: string, firstTime: boolean,
): Promise<{ data: { orderCode: string; paymentUrl: string } | null; error: string | null }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) return { data: null, error: 'Not authenticated' }
  const res = await fetch('/api/viva-payment-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind: 'plan', id, firstTime }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { data: null, error: (json as { error?: string }).error ?? `Payment link failed (${res.status})` }
  return { data: json as { orderCode: string; paymentUrl: string }, error: null }
}

// WEC-798(c): admin edits a plan's start date; «Ενεργή έως» (active_until)
// recalculates from start_date + plan_length_weeks — the same formula
// wallet-plan-purchase uses to prefill it. Informational, no gate (WEC-783).
export async function updateWalletPlanStartDate(
  id: string,
  startDateIso: string,
  planLengthWeeks: number | null,
  daysPerWeek: number | null,
  adminEmail?: string,
): Promise<{ activeUntil: string | null; error: string | null }> {
  // WEC-905: end = Nth working day (weeks × days/week delivery days), not weeks×7.
  const totalDeliveryDays = Math.round((planLengthWeeks ?? 0) * (daysPerWeek ?? 0))
  const activeUntil = totalDeliveryDays > 0 ? workingDaysEnd(startDateIso, totalDeliveryDays) : startDateIso
  // WEC-895: record the change so «who moved the start date» is answerable.
  const { data: beforeRow } = await supabase
    .from('wallet_plans').select('start_date').eq('id', id).maybeSingle()
  const { error } = await supabase
    .from('wallet_plans')
    .update({ start_date: startDateIso, active_until: activeUntil })
    .eq('id', id)
  if (!error) {
    await supabase.from('admin_change_log').insert({
      wallet_plan_id: id, table_name: 'wallet_plans', field_name: 'start_date',
      old_value: String((beforeRow as { start_date?: string | null } | null)?.start_date ?? ''),
      new_value: startDateIso, label: `WEC-798 start date · plan ${id}`,
      admin_user: adminEmail ?? '(admin)',
    })
  }
  return { activeUntil, error: error ? error.message : null }
}

/**
 * Toggle the admin "Contacted" flag on a wallet purchase. Persists the boolean,
 * writes an admin_change_log entry (who/when), and flags the plan airtable_dirty
 * so the reconcile mirrors the value into the Airtable Subscriptions table.
 */
export async function setWalletPlanContacted(
  id: string,
  contacted: boolean,
  adminUser: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('wallet_plans')
    .update({ contacted, airtable_dirty: true })
    .eq('id', id)
  if (error) return { error: error.message }
  await supabase.from('admin_change_log').insert({
    order_id: null,
    wallet_plan_id: id,
    table_name: 'wallet_plans',
    field_name: 'contacted',
    old_value: String(!contacted),
    new_value: String(contacted),
    label: contacted ? 'Marked contacted' : 'Unmarked contacted',
    admin_user: adminUser,
  })
  return { error: null }
}

// ── WEC-895: subscription comments + change-log (admin) ──────────────────────
export interface WalletPlanComment { id: number; body: string; visibleToCustomer: boolean; author: string | null; createdAt: string }
export interface WalletPlanChangeEntry { id: number; field: string; oldValue: string | null; newValue: string | null; label: string | null; adminUser: string | null; createdAt: string }

export async function fetchWalletPlanComments(planId: string): Promise<{ data: WalletPlanComment[]; error: string | null }> {
  const { data, error } = await supabase
    .from('wallet_plan_comments')
    .select('id, body, visible_to_customer, author, created_at')
    .eq('wallet_plan_id', planId)
    .order('created_at', { ascending: false })
  if (error) return { data: [], error: error.message }
  return {
    data: (data ?? []).map((r) => {
      const row = r as Record<string, unknown>
      return {
        id: row.id as number, body: row.body as string,
        visibleToCustomer: !!row.visible_to_customer,
        author: (row.author as string | null) ?? null,
        createdAt: row.created_at as string,
      }
    }),
    error: null,
  }
}

export async function addWalletPlanComment(
  planId: string, body: string, visibleToCustomer: boolean, author: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('wallet_plan_comments').insert({
    wallet_plan_id: planId, body, visible_to_customer: visibleToCustomer, author,
  })
  return { error: error ? error.message : null }
}

export async function deleteWalletPlanComment(id: number): Promise<{ error: string | null }> {
  const { error } = await supabase.from('wallet_plan_comments').delete().eq('id', id)
  return { error: error ? error.message : null }
}

export async function fetchWalletPlanChangeLog(planId: string): Promise<{ data: WalletPlanChangeEntry[]; error: string | null }> {
  const { data, error } = await supabase
    .from('admin_change_log')
    .select('id, field_name, old_value, new_value, label, admin_user, created_at')
    .eq('wallet_plan_id', planId)
    .order('created_at', { ascending: false })
  if (error) return { data: [], error: error.message }
  return {
    data: (data ?? []).map((r) => {
      const row = r as Record<string, unknown>
      return {
        id: row.id as number, field: row.field_name as string,
        oldValue: (row.old_value as string | null) ?? null,
        newValue: (row.new_value as string | null) ?? null,
        label: (row.label as string | null) ?? null,
        adminUser: (row.admin_user as string | null) ?? null,
        createdAt: row.created_at as string,
      }
    }),
    error: null,
  }
}
