// Verify a Viva transaction that belongs to a *wallet plan* purchase.
// Mirrors netlify/lib/viva/verify.ts but for wallet_plans. Called from the
// webhook (after merchantTrns prefix routing) and the reconcile cron.
//
// Security model is identical: re-fetch via Viva's Retrieve Transaction API,
// validate orderCode + merchantTrns + amount, then call the idempotent SQL
// function `wallet_plan_mark_paid`. Never trusts the webhook payload.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaAccessToken } from '../viva/auth'
import { getVivaCreds } from '../viva/env'
import { sendMetaCapiEvent, metaConfigured, hashLower, hashPhone } from '../metaCapi'
// 2026-06-26: switched to awaited track() + subscribeProfileToMarketing
// so the Klaviyo Subscription Purchased event isn't killed mid-flight
// after the wallet plan is verified. See submit-order.ts for the full
// backstory of why fire-and-forget was unreliable on Netlify.
import { track, subscribeProfileToMarketing, EVT } from '../klaviyo'
// WEC-529: populate account macro goals from the plan's diet profile on paid.
import { applyPlanGoalsToUser } from './applyPlanGoals'
// WEC-504: durable Viva audit logging.
import { logVivaEvent, type VivaEventLog } from '../viva/logEvent'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export type WalletVerifyOutcome =
  | { status: 'paid';     walletPlanId: string; amountCents: number; transactionId: string }
  | { status: 'failed';   walletPlanId: string; reason: string;     transactionId: string }
  | { status: 'pending';  walletPlanId: string | null; statusId: string; transactionId: string }
  | { status: 'unknown';  transactionId: string; message: string }
  | { status: 'mismatch'; walletPlanId: string; vivaCents: number; dbCents: number; transactionId: string }

interface VivaTransaction {
  orderCode: number | string
  statusId: string
  amount: number
  merchantTrns?: string
  transactionId?: string
  errorCode?: number | string
  errorText?: string
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Same defensive normalization as verify.ts */
function normalizeAmountCents(raw: number, dbCents: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (!Number.isInteger(raw)) return Math.round(raw * 100)
  if (raw === dbCents) return raw
  return raw * 100
}

export async function verifyWalletPlanTransaction(
  transactionId: string,
): Promise<WalletVerifyOutcome> {
  if (!transactionId) throw new Error('transactionId required')

  const token = await getVivaAccessToken()
  const creds = getVivaCreds()

  const res = await fetch(
    `https://${creds.apiHost}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Viva retrieve-transaction failed: ${res.status} ${body}`)
  }
  // WEC-430: read response as text + extract orderCode via regex on the raw
  // JSON, NOT via JSON.parse. See createOrder.ts for the precision-loss
  // explanation. wallet_plans.viva_order_code lookups go through the same
  // failure mode if we don't.
  const text = await res.text()
  const data = JSON.parse(text) as VivaTransaction
  const m = text.match(/"orderCode"\s*:\s*(\d+)/)
  const orderCode = m ? m[1] : String(data.orderCode)
  const statusId = String(data.statusId ?? '')
  const merchantTrns = String(data.merchantTrns ?? '')

  // Parse the wp: prefix to extract our wallet_plan_id
  if (!merchantTrns.startsWith('wp:')) {
    return {
      status: 'unknown',
      transactionId,
      message: `merchantTrns "${merchantTrns}" is not a wallet plan ref`,
    }
  }
  const walletPlanId = merchantTrns.slice(3)

  const supabase = serviceClient()
  // WEC-504: durable audit of every wallet-plan verify outcome (fail-soft).
  const log = (outcome: string, extra: Partial<VivaEventLog> = {}) =>
    logVivaEvent(supabase, { source: 'wallet_verify', kind: 'wallet', walletPlanId, orderCode, transactionId, statusId, outcome, payload: data, ...extra })

  const { data: plan } = await supabase
    .from('wallet_plans')
    .select('id, wallet_id, amount_to_pay_cents, bonus_credits_cents, wallet_credit_cents, plan_length, days_per_week, goal, daily_kcal, meal_breakfast, meal_lunch, meal_dinner, meal_snack, services, payment_status, viva_order_code')
    .eq('id', walletPlanId)
    .maybeSingle()

  if (!plan) {
    await log('unknown', { message: `wallet_plan ${walletPlanId} not found` })
    return { status: 'unknown', transactionId, message: `wallet_plan ${walletPlanId} not found` }
  }

  const dbCents = plan.amount_to_pay_cents as number
  const amountCents = normalizeAmountCents(Number(data.amount), dbCents)

  // Sanity-check orderCode matches the one we recorded (defense in depth)
  if (plan.viva_order_code && plan.viva_order_code !== orderCode) {
    console.error(
      '[verifyWalletPlanTransaction] orderCode mismatch planId=%s db=%s viva=%s',
      walletPlanId, plan.viva_order_code, orderCode,
    )
    await log('unknown', { message: `orderCode mismatch (db=${plan.viva_order_code} viva=${orderCode})` })
    return { status: 'unknown', transactionId, message: 'orderCode mismatch' }
  }

  if (statusId === 'F') {
    if (amountCents !== dbCents) {
      console.error(
        '[verifyWalletPlanTransaction] AMOUNT MISMATCH planId=%s vivaCents=%d dbCents=%d',
        walletPlanId, amountCents, dbCents,
      )
      await log('mismatch', { amountCents, message: `viva=${amountCents} db=${dbCents}` })
      return { status: 'mismatch', walletPlanId, vivaCents: amountCents, dbCents, transactionId }
    }

    const { error } = await supabase.rpc('wallet_plan_mark_paid', {
      p_plan_id: walletPlanId,
      p_transaction_id: transactionId,
      p_amount_cents: amountCents,
    })
    if (error) {
      console.error('[verifyWalletPlanTransaction] wallet_plan_mark_paid failed:', error)
      throw error
    }
    // WEC-398: Subscribe conversion (Meta CAPI, server-side, separate from food
    // Purchase). Fire only when THIS verification is the pending→paid transition
    // (plan.payment_status was 'pending' when fetched above) so duplicate webhook
    // / reconcile re-verifies don't re-fire; also deduped at Meta by event_id.
    if (plan.payment_status === 'pending') {
      await fireSubscribeCapi(supabase, walletPlanId, amountCents)
      // Fire Klaviyo "Subscription Purchased" event (card/link paid path).
      // Mirror of the transfer-path fire in wallet-plan-purchase.ts. Fail-soft.
      await fireSubscriptionPurchasedKlaviyo(supabase, plan, amountCents)
      // WEC-529: set Account → Goals from the plan's diet profile. Fail-soft.
      await applyPlanGoalsToUser(supabase, walletPlanId)
    }
    await log('paid', { amountCents })
    return { status: 'paid', walletPlanId, amountCents, transactionId }
  }

  if (statusId === 'E' || statusId === 'X') {
    const reason = data.errorText ? `${statusId}: ${data.errorText}` : `statusId=${statusId}`
    await supabase
      .from('wallet_plans')
      .update({ payment_status: 'failed' })
      .eq('id', walletPlanId)
      .eq('payment_status', 'pending')
    await log('failed', { message: reason })
    return { status: 'failed', walletPlanId, reason, transactionId }
  }

  await log('pending', { walletPlanId })
  return { status: 'pending', walletPlanId, statusId, transactionId }
}

/**
 * WEC-398: fire a Meta CAPI `Subscribe` for a just-paid wallet plan. Server-side
 * because card/link redirect to Viva (no browser at confirm). Never throws.
 * Deduped at Meta by `event_id = subscribe:<walletPlanId>`.
 */
async function fireSubscribeCapi(
  supabase: SupabaseClient,
  walletPlanId: string,
  amountCents: number,
): Promise<void> {
  if (!metaConfigured()) return
  try {
    // Resolve the buyer (for hashed advanced matching) via wallet_plan → wallet.
    let userId: string | undefined
    let email: string | undefined
    let phone: string | undefined
    const { data: planRow } = await supabase
      .from('wallet_plans')
      .select('wallet_id')
      .eq('id', walletPlanId)
      .maybeSingle()
    const walletId = (planRow as { wallet_id?: string } | null)?.wallet_id
    if (walletId) {
      const { data: w } = await supabase
        .from('wallets')
        .select('user_id')
        .eq('id', walletId)
        .maybeSingle()
      userId = (w as { user_id?: string } | null)?.user_id ?? undefined
    }
    if (userId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', userId)
        .maybeSingle()
      phone = (prof as { phone?: string } | null)?.phone ?? undefined
      const { data: au } = await supabase.auth.admin.getUserById(userId)
      email = au?.user?.email ?? undefined
    }
    await sendMetaCapiEvent({
      eventName: 'Subscribe',
      eventId: `subscribe:${walletPlanId}`,
      userData: { em: hashLower(email), ph: hashPhone(phone), external_id: hashLower(userId) },
      customData: {
        currency: 'EUR',
        value: Math.round(amountCents) / 100,
        order_id: walletPlanId,
        content_type: 'subscription',
      },
    })
  } catch (e) {
    console.error('[verifyWalletPlanTransaction] subscribe CAPI failed (non-fatal) planId=%s:', walletPlanId, e)
  }
}

/**
 * Fire Klaviyo "Subscription Purchased" event for a just-paid wallet plan
 * (card / link path). Mirror of the transfer-path fire in
 * netlify/functions/wallet-plan-purchase.ts. Fail-soft.
 *
 * Lang resolution: user_prefs.lang for the wallet owner. Server-side context,
 * no client lang to pass through.
 */
async function fireSubscriptionPurchasedKlaviyo(
  supabase: SupabaseClient,
  plan: {
    id: string
    wallet_id?: string | null
    bonus_credits_cents?: number | null
    wallet_credit_cents?: number | null
    plan_length?: string | null
    days_per_week?: number | null
    goal?: string | null
    daily_kcal?: number | null
    meal_breakfast?: boolean | null
    meal_lunch?: boolean | null
    meal_dinner?: boolean | null
    meal_snack?: boolean | null
    services?: { dieticianManaged?: boolean } | null
  },
  amountCents: number,
): Promise<void> {
  try {
    const walletId = plan.wallet_id
    if (!walletId) return
    const { data: w } = await supabase
      .from('wallets')
      .select('user_id, balance')
      .eq('id', walletId)
      .maybeSingle()
    const userId = (w as { user_id?: string } | null)?.user_id
    const newBalanceCents = (w as { balance?: number } | null)?.balance ?? null
    if (!userId) return

    const { data: au } = await supabase.auth.admin.getUserById(userId)
    const email = au?.user?.email ?? ''
    const userMeta = (au?.user?.user_metadata ?? {}) as { name?: string }
    const firstName = (userMeta.name ?? '').split(' ')[0]
    if (!email) return

    let custLang: 'el' | 'en' = 'el'
    const { data: pref } = await supabase
      .from('user_prefs')
      .select('lang')
      .eq('user_id', userId)
      .maybeSingle()
    const l = (pref as { lang?: string } | null)?.lang
    if (l === 'el' || l === 'en') custLang = l

    // Localized labels for the email (templates XxNNci/XbgLEd are chosen by
    // lang, so a single custLang-localized string works for each).
    const isEl = custLang === 'el'
    const mealsLabel = [
      plan.meal_breakfast && (isEl ? 'Πρωινό' : 'Breakfast'),
      plan.meal_lunch && (isEl ? 'Μεσημεριανό' : 'Lunch'),
      plan.meal_dinner && (isEl ? 'Βραδινό' : 'Dinner'),
      plan.meal_snack && (isEl ? 'Σνακ' : 'Snack'),
    ].filter(Boolean).join(', ') || null
    const goalMap: Record<string, string> = isEl
      ? { lose: 'Απώλεια βάρους', maintain: 'Διατήρηση', gain: 'Αύξηση μυϊκής μάζας' }
      : { lose: 'Weight loss', maintain: 'Maintain', gain: 'Muscle gain' }
    const goalLabel = plan.goal ? (goalMap[plan.goal] ?? plan.goal) : null
    const dieticianManaged = !!plan.services?.dieticianManaged

    // 2026-06-26: templates XxNNci (EL) / XbgLEd (EN) use snake_case
    // (event.first_name, event.plan_length_label, event.meals_per_week,
    // event.amount_paid, event.bonus_credits, event.new_balance,
    // event.goal_label, event.meals_label, event.daily_kcal,
    // event.dietician_managed). Emit BOTH cases.
    const subProps = {
      lang: custLang,
      // snake_case (template-expected)
      first_name: firstName,
      plan_length_label: plan.plan_length ?? null,
      meals_per_week: plan.days_per_week ?? null,
      goal_label: goalLabel,
      meals_label: mealsLabel,
      daily_kcal: plan.daily_kcal ?? null,
      dietician_managed: dieticianManaged,
      amount_paid: amountCents / 100,
      bonus_credits: (plan.bonus_credits_cents ?? 0) / 100,
      new_balance: newBalanceCents != null ? newBalanceCents / 100 : null,
      payment_status: 'paid',
      // camelCase (legacy / downstream)
      walletPlanId: plan.id,
      planLengthLabel: plan.plan_length ?? null,
      mealsPerWeek: plan.days_per_week ?? null,
      amountPaid: amountCents / 100,
      bonusCredits: (plan.bonus_credits_cents ?? 0) / 100,
      newBalance: newBalanceCents != null ? newBalanceCents / 100 : null,
      paymentStatus: 'paid',
    }
    const subFires = await Promise.all([
      subscribeProfileToMarketing(email, 'Fitpal subscription purchased (auto-subscribe)'),
      track(EVT.SubscriptionPurchased, {
        email,
        firstName,
        externalId: userId,
      }, subProps),
    ])
    const subFailed = subFires.filter((r) => !r.ok)
    if (subFailed.length > 0) {
      console.warn('[verifyWalletPlanTransaction] Subscription Purchased klaviyo: %d/%d failed: %s',
        subFailed.length, subFires.length,
        subFailed.map((r) => r.error).join(' | '))
    }
  } catch (e) {
    console.warn('[verifyWalletPlanTransaction] Subscription Purchased Klaviyo failed (non-fatal):', e)
  }
}
