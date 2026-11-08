// WEC-799: ONE admin endpoint for sending a Viva payment link, for an order OR
// a subscription (wallet plan).
//
//   POST /api/viva-payment-link  { kind: 'order'|'plan', id, amountCents? }
//
// kind:'order' → delegated, unchanged, to viva-regenerate-link (the order path's
//   internals are NOT rewritten here — lowest-risk wiring; the orders drawer keeps
//   calling that function directly, so its behaviour is byte-identical).
// kind:'plan'  → createWalletPlanVivaOrder({mode:'link'}) (cuts an 18h link, writes
//   viva_order_code, flips payment_method → link), then stamps
//   payment_status='pending_link_sent' + link_sent_at (so reconcile measures the
//   link's own age, not the plan's), writes an admin_change_log row on the
//   subscription timeline, and fires the same «Payment Link Sent» Klaviyo event
//   the orders use. Email is fail-soft: never blocks the admin action.

import { createClient } from '@supabase/supabase-js'
import { createWalletPlanVivaOrder } from '../lib/wallet/createWalletPlanOrder'
import { track, subscribeProfileToMarketing, EVT } from '../lib/klaviyo'
import { corsHeaders } from '../lib/cors'
import regenerateOrderLink from './viva-regenerate-link'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

async function assertAdmin(token: string): Promise<{ userId: string; email: string } | { error: string; status: number }> {
  if (!token) return { error: 'Missing Authorization', status: 401 }
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userRes } = await supa.auth.getUser()
  if (!userRes?.user) return { error: 'Invalid session', status: 401 }
  const { data, error } = await supa.rpc('is_admin')
  if (error) return { error: `Admin check failed: ${error.message}`, status: 500 }
  if (!data) return { error: 'Forbidden — admin role required', status: 403 }
  return { userId: userRes.user.id, email: userRes.user.email ?? '(admin)' }
}

/** Customer-facing plan reference — same derivation as src/lib/api/wallet.ts planReference. */
const planReference = (id: string) => `WP-${id.slice(0, 8).toUpperCase()}`

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  let body: { kind?: string; id?: string; amountCents?: number; allowOverAmount?: boolean; firstTime?: boolean }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.kind !== 'order' && body.kind !== 'plan') {
    return Response.json({ error: "kind must be 'order' or 'plan'" }, { status: 400 })
  }
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })

  // ── Orders: delegate untouched to the existing order path ──────────────
  if (body.kind === 'order') {
    return regenerateOrderLink(new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        orderId: body.id,
        ...(body.amountCents != null ? { amountCents: body.amountCents } : {}),
        ...(body.allowOverAmount ? { allowOverAmount: true } : {}),
      }),
    }))
  }

  // ── Plans ───────────────────────────────────────────────────────────────
  const who = await assertAdmin(token)
  if ('error' in who) return Response.json({ error: who.error }, { status: who.status })

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: plan } = await service
    .from('wallet_plans')
    .select('id, wallet_id, amount_to_pay_cents, payment_status, payment_method, viva_order_code, status, wallets!wallet_plans_wallet_id_fkey(user_id)')
    .eq('id', body.id)
    .maybeSingle()
  if (!plan) return Response.json({ error: 'Subscription not found' }, { status: 404 })
  if (plan.payment_status !== 'pending' && plan.payment_status !== 'pending_link_sent') {
    return Response.json({ error: `Subscription is not pending (payment_status=${plan.payment_status})` }, { status: 400 })
  }
  if (plan.status === 'cancelled') {
    return Response.json({ error: 'Subscription is cancelled' }, { status: 400 })
  }
  // A plan's charge is fixed — createWalletPlanVivaOrder refuses any other amount.
  const amountCents = plan.amount_to_pay_cents as number
  if (body.amountCents != null && body.amountCents !== amountCents) {
    return Response.json({ error: `A subscription link is always for the full amount (${(amountCents / 100).toFixed(2)} €)` }, { status: 400 })
  }

  // Customer identity (email + name) for Viva + the email.
  const userId = (plan.wallets as { user_id?: string } | null)?.user_id ?? null
  let email = ''
  let fullName = ''
  if (userId) {
    const { data: prof } = await service.from('profiles').select('name, email').eq('id', userId).maybeSingle()
    fullName = (prof as { name?: string } | null)?.name ?? ''
    email = (prof as { email?: string } | null)?.email ?? ''
    if (!email) {
      const { data: au } = await service.auth.admin.getUserById(userId)
      email = au?.user?.email ?? ''
    }
  }
  if (!email) return Response.json({ error: 'Customer email not found — cannot send a payment link' }, { status: 400 })

  const previousCode = (plan.viva_order_code as string | null) ?? null
  const wasSent = plan.payment_status === 'pending_link_sent' && plan.payment_method === 'link'
  const firstTime = body.firstTime ?? !wasSent

  let result: { orderCode: string; paymentUrl: string }
  try {
    result = await createWalletPlanVivaOrder({
      walletPlanId: plan.id as string,
      amountCents,
      customerEmail: email,
      customerFullName: fullName,
      mode: 'link',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[viva-payment-link] plan create failed:', msg)
    return Response.json({ error: msg }, { status: 400 })
  }

  // Mark link-sent + give the link its own clock. Guarded so a plan that got
  // paid in the meantime is never clobbered back to pending.
  const { error: stampErr } = await service
    .from('wallet_plans')
    .update({ payment_status: 'pending_link_sent', link_sent_at: new Date().toISOString() })
    .eq('id', plan.id)
    .in('payment_status', ['pending', 'pending_link_sent'])
  if (stampErr) console.error('[viva-payment-link] stamp failed plan=%s:', plan.id, stampErr)

  // Subscription timeline (WEC-895 history reads admin_change_log by wallet_plan_id).
  const { error: logErr } = await service.from('admin_change_log').insert({
    wallet_plan_id: plan.id,
    table_name: 'wallet_plans',
    field_name: 'payment_link',
    old_value: previousCode,
    new_value: result.orderCode,
    label: `${firstTime ? 'Payment link sent' : 'Payment link regenerated'} — ${(amountCents / 100).toFixed(2)} €`,
    admin_user: who.email,
  })
  if (logErr) console.error('[viva-payment-link] change_log failed plan=%s:', plan.id, logErr)

  // Same «Payment Link Sent» email as orders. Fail-soft.
  try {
    let custLang: 'el' | 'en' = 'el'
    if (userId) {
      const { data: pref } = await service.from('user_prefs').select('lang').eq('user_id', userId).maybeSingle()
      const l = (pref as { lang?: string } | null)?.lang
      if (l === 'el' || l === 'en') custLang = l
    }
    const ref = planReference(plan.id as string)
    const firstName = fullName.split(' ')[0] ?? ''
    const props = {
      lang: custLang,
      kind: 'subscription',
      // snake_case (template-expected) — order_number carries the plan reference.
      first_name: firstName,
      order_number: ref,
      payment_url: result.paymentUrl,
      total: amountCents / 100,
      // camelCase (legacy / downstream)
      orderNumber: ref,
      paymentUrl: result.paymentUrl,
      walletPlanId: plan.id,
    }
    const fires = await Promise.all([
      subscribeProfileToMarketing(email, 'Fitpal payment link sent (auto-subscribe)'),
      track(EVT.PaymentLinkSent, { email, firstName, externalId: userId ?? undefined }, props),
    ])
    const failed = fires.filter((r) => !r.ok)
    if (failed.length) console.warn('[viva-payment-link] klaviyo: %d/%d failed: %s', failed.length, fires.length, failed.map((r) => r.error).join(' | '))
  } catch (e) { console.warn('[viva-payment-link] klaviyo:', e) }

  return Response.json(result)
}
