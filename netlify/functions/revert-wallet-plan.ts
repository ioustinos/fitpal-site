// POST /api/revert-wallet-plan  (WEC-682)
//
// The subscription-purchase twin of revert-order-to-draft (WEC-681). When a
// customer backs out of Viva's hosted checkout during a PLAN purchase and
// returns to /order/pending/failure, the wallet_plans snapshot that
// wallet-plan-purchase inserted (payment_status='pending', before the redirect,
// because Viva needs merchantTrns 'wp:<id>') is left abandoned. Retrying inserts
// a SECOND snapshot, so admin shows the same package twice, both «Pending».
//
// Unlike orders, wallet_plans is a purchase-HISTORY table (one row per package
// bought), so a discarded attempt should read as `failed`, not be reused. This
// endpoint marks that abandoned plan `failed` (guarded on ownership +
// payment_status='pending' + card/link) so it stops presenting as a live
// purchase. Credits are only ever granted by wallet_plan_mark_paid, which
// returns early once `paid` — so this can never double-credit.

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async (request: Request): Promise<Response> => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })

  let body: { walletPlanId?: string }
  try { body = (await request.json()) as { walletPlanId?: string } }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }
  const planId = (body.walletPlanId ?? '').trim()
  if (!planId) return Response.json({ error: 'walletPlanId required' }, { status: 400, headers: cors })

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve the plan + its owning user (via the wallet).
  const { data: plan } = await svc
    .from('wallet_plans')
    .select('id, wallet_id, payment_status, payment_method, viva_transaction_id, wallets!wallet_plans_wallet_id_fkey(user_id)')
    .eq('id', planId)
    .maybeSingle()
  if (!plan) return Response.json({ error: 'Plan not found' }, { status: 404, headers: cors })

  // Only an abandoned card/link attempt that never got a transaction qualifies.
  // Never touch a paid, failed, refunded, or transfer/cash plan.
  const qualifies =
    plan.payment_status === 'pending' &&
    (plan.payment_method === 'card' || plan.payment_method === 'link') &&
    !plan.viva_transaction_id
  if (!qualifies) {
    return Response.json({ failed: false, reason: 'not an abandoned pending card/link plan' }, { status: 200, headers: cors })
  }

  // Ownership: the owning user's token is required (plan purchases are always by
  // a registered user — there is no guest subscription flow).
  const ownerId = (plan.wallets as { user_id?: string } | null)?.user_id ?? null
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return Response.json({ error: 'Auth required' }, { status: 401, headers: cors })
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u?.user || (ownerId && u.user.id !== ownerId)) {
    return Response.json({ error: 'Not your plan' }, { status: 403, headers: cors })
  }

  // Mark failed — race-guarded so a webhook/reconcile that just paid it can't be
  // clobbered (WHERE still pending + still no transaction).
  const { data: upd, error: upErr } = await svc
    .from('wallet_plans')
    .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('payment_status', 'pending')
    .is('viva_transaction_id', null)
    .select('id')
  if (upErr) return Response.json({ error: upErr.message }, { status: 500, headers: cors })
  const failed = (upd?.length ?? 0) > 0

  // WEC-703: the voucher (if any) was redeemed at plan-creation, BEFORE the Viva
  // redirect — so an abandoned card/link attempt would leak the redemption
  // (uses_count stuck up, a per-user-limit code un-retryable, credit not
  // restored). Release it now that the plan is `failed`. No-op when there was no
  // voucher. Fail-soft — the revert itself already succeeded.
  if (failed) {
    const { error: unredeemErr } = await svc.rpc('unredeem_voucher_for_plan', { p_wallet_plan_id: planId })
    if (unredeemErr) console.warn('[revert-wallet-plan] voucher un-redeem failed planId=%s:', planId, unredeemErr)
  }

  return Response.json({ failed }, { status: 200, headers: cors })
}
