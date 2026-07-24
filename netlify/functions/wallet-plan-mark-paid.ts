// Admin-only: mark a BANK-TRANSFER wallet plan as paid once funds land,
// crediting the customer's wallet. WEC-509.
//
// Mirrors wallet-plan-refund.ts: Bearer JWT → is_admin() RPC check, then the
// money mutation runs service-role via the idempotent wallet_plan_mark_paid
// RPC (credits base+bonus, flips status→paid, sets wallet active, logs
// wallet_transactions; no-ops if already paid).
//
// Restricted to payment_method='transfer' on purpose: card/link plans must be
// confirmed through Viva (verifyWalletPlanTransaction) — never manually marked,
// which would credit a wallet for money that never arrived.
//
// Body: { walletPlanId }
// Response: { ok: true, alreadyPaid?: boolean }

import { createClient } from '@supabase/supabase-js'
// WEC-529: populate account macro goals from the plan's diet profile on paid.
import { applyPlanGoalsToUser } from '../lib/wallet/applyPlanGoals'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface AdminOk { userId: string }
interface AdminErr { error: string; status: number }

async function assertAdmin(token: string): Promise<AdminOk | AdminErr> {
  if (!token) return { error: 'Missing Authorization header', status: 401 }
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userRes } = await supa.auth.getUser(token)
  if (!userRes?.user) return { error: 'Invalid session', status: 401 }
  const { data, error } = await supa.rpc('is_admin')
  if (error) return { error: `Admin check failed: ${error.message}`, status: 500 }
  if (!data) return { error: 'Forbidden — admin role required', status: 403 }
  return { userId: userRes.user.id }
}

function serviceClient() {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors})

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const who = await assertAdmin(token)
  if ('error' in who) return Response.json({ error: who.error }, { status: who.status, headers: cors})

  let body: { walletPlanId?: string }
  try { body = await request.json() as typeof body }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors}) }
  if (!body.walletPlanId) return Response.json({ error: 'walletPlanId required' }, { status: 400, headers: cors})

  try {
    const svc = serviceClient()
    const { data: plan, error: readErr } = await svc
      .from('wallet_plans')
      .select('id, payment_method, payment_status, amount_to_pay_cents')
      .eq('id', body.walletPlanId)
      .maybeSingle()
    if (readErr) return Response.json({ error: readErr.message }, { status: 500, headers: cors})
    if (!plan) return Response.json({ error: 'Wallet plan not found' }, { status: 404, headers: cors})

    if (plan.payment_status === 'paid') {
      return Response.json({ ok: true, alreadyPaid: true }, { headers: cors})
    }
    // WEC-554: cash (Αντικαταβολή) plans are also marked paid manually — the
    // courier collects on first delivery. Card/link still confirm via Viva.
    if (plan.payment_method !== 'transfer' && plan.payment_method !== 'cash') {
      return Response.json(
        { error: `Only bank-transfer or cash plans can be marked paid manually (this one is '${plan.payment_method}'). Card/link plans confirm via Viva.` },
        { status: 400, headers: cors},
      )
    }

    const { error: rpcErr } = await svc.rpc('wallet_plan_mark_paid', {
      p_plan_id: plan.id,
      p_transaction_id: `manual-${plan.payment_method}:${who.userId}`,
      p_amount_cents: plan.amount_to_pay_cents ?? 0,
    })
    if (rpcErr) return Response.json({ error: rpcErr.message }, { status: 500, headers: cors})

    // WEC-529: set Account → Goals from the plan's diet profile (fail-soft;
    // runs only on the pending→paid transition — alreadyPaid returned above).
    await applyPlanGoalsToUser(svc, plan.id)

    // Audit trail — who manually marked it paid (fail-soft).
    try {
      await svc.from('admin_change_log').insert({
        table_name: 'wallet_plans',
        field_name: 'payment_status',
        old_value: 'pending',
        new_value: 'paid',
        label: `${plan.payment_method === 'cash' ? 'Cash (Αντικαταβολή)' : 'Bank transfer'} marked paid (manual, admin)`,
        admin_user: who.userId,
      })
    } catch { /* non-fatal */ }

    return Response.json({ ok: true }, { headers: cors})
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[wallet-plan-mark-paid] failed:', msg)
    return Response.json({ error: msg }, { status: 400, headers: cors})
  }
}
