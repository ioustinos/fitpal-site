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

  const { data: plan } = await supabase
    .from('wallet_plans')
    .select('id, wallet_id, amount_to_pay_cents, bonus_credits_cents, wallet_credit_cents, plan_length, days_per_week, payment_status, viva_order_code')
    .eq('id', walletPlanId)
    .maybeSingle()

  if (!plan) {
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
    return { status: 'unknown', transactionId, message: 'orderCode mismatch' }
  }

  if (statusId === 'F') {
    if (amountCents !== dbCents) {
      console.error(
        '[verifyWalletPlanTransaction] AMOUNT MISMATCH planId=%s vivaCents=%d dbCents=%d',
        walletPlanId, amountCents, dbCents,
      )
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
    }
    return { status: 'paid', walletPlanId, amountCents, transactionId }
  }

  if (statusId === 'E' || statusId === 'X') {
    const reason = data.errorText ? `${statusId}: ${data.errorText}` : `statusId=${statusId}`
    await supabase
      .from('wallet_plans')
      .update({ payment_status: 'failed' })
      .eq('id', walletPlanId)
      .eq('payment_status', 'pending')
    return { status: 'failed', walletPlanId, reason, transactionId }
  }

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

    // 2026-06-26: template W3v8Bf/TgGF2L uses snake_case
    // (event.first_name, event.plan_length_label, event.meals_per_week,
    // event.amount_paid, event.bonus_credits, event.new_balance). Emit BOTH.
    const subProps = {
      lang: custLang,
      // snake_case (template-expected)
      first_name: firstName,
      plan_length_label: plan.plan_length ?? null,
      meals_per_week: plan.days_per_week ?? null,
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
