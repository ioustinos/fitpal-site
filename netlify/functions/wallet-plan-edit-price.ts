// WEC-894 — admin edits a subscription's FINAL PRICE (revenue) and/or discount.
//
// Decisions (Ioustinos, locked):
//  • The price is the revenue — it must reach the P&L. We persist amount_to_pay_cents
//    (+ discount_cents / discount_pct) and mark the plan airtable_dirty so the
//    Subscriptions mirror + reports pick it up.
//  • The wallet is NOT touched: wallets.balance, wallet_credit_cents and
//    bonus_credits_cents are left exactly as they are (admins manage those
//    separately, same as the voucher design — a voucher only cuts what the
//    customer pays, never the credits).
//  • Only price/discount here. Duration/days/meals/plan-type/body-fat stay read-only.
//
// Server-authoritative: the browser never writes the price. Bearer JWT →
// is_admin() RPC, then the mutation runs service-role. Pattern mirrors
// wallet-plan-mark-paid.ts / wallet-plan-refund.ts.
//
// Body: { walletPlanId, amountToPayCents, discountCents }
// Response: { ok: true, amountToPayCents, discountCents, discountPct }

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface AdminOk { userId: string; email: string }
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
  return { userId: userRes.user.id, email: userRes.user.email ?? userRes.user.id }
}

function serviceClient() {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const who = await assertAdmin(token)
  if ('error' in who) return Response.json({ error: who.error }, { status: who.status, headers: cors })

  let body: { walletPlanId?: string; amountToPayCents?: number; discountCents?: number }
  try { body = await request.json() as typeof body }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }

  const { walletPlanId, amountToPayCents, discountCents } = body
  if (!walletPlanId) return Response.json({ error: 'walletPlanId required' }, { status: 400, headers: cors })
  if (!isInt(amountToPayCents) || amountToPayCents < 0) return Response.json({ error: 'amountToPayCents must be a non-negative integer (cents)' }, { status: 400, headers: cors })
  if (!isInt(discountCents) || discountCents < 0) return Response.json({ error: 'discountCents must be a non-negative integer (cents)' }, { status: 400, headers: cors })

  try {
    const svc = serviceClient()
    const { data: plan, error: readErr } = await svc
      .from('wallet_plans')
      .select('id, subtotal_cents, discount_cents, discount_pct, amount_to_pay_cents')
      .eq('id', walletPlanId)
      .maybeSingle()
    if (readErr) return Response.json({ error: readErr.message }, { status: 500, headers: cors })
    if (!plan) return Response.json({ error: 'Wallet plan not found' }, { status: 404, headers: cors })

    const subtotal = (plan.subtotal_cents as number) ?? 0
    // Guard rails: neither figure may exceed the list price (subtotal). The
    // final price (revenue) can be anything from 0 up to subtotal.
    if (subtotal > 0 && amountToPayCents > subtotal) return Response.json({ error: `Final price cannot exceed the subtotal (${(subtotal / 100).toFixed(2)} €)` }, { status: 400, headers: cors })
    if (subtotal > 0 && discountCents > subtotal) return Response.json({ error: `Discount cannot exceed the subtotal (${(subtotal / 100).toFixed(2)} €)` }, { status: 400, headers: cors })

    // discount_pct is stored as a fraction (0..1); the UI shows round(pct*100).
    const discountPct = subtotal > 0 ? Math.round((discountCents / subtotal) * 10000) / 10000 : 0

    const prev = {
      amount: (plan.amount_to_pay_cents as number) ?? 0,
      discount: (plan.discount_cents as number) ?? 0,
    }

    const { error: upErr } = await svc.from('wallet_plans').update({
      amount_to_pay_cents: amountToPayCents,
      discount_cents: discountCents,
      discount_pct: discountPct,
      airtable_dirty: true,
    }).eq('id', walletPlanId)
    if (upErr) return Response.json({ error: upErr.message }, { status: 500, headers: cors })

    // Mandatory audit trail (WEC-895 linkage) — one row per changed figure, in
    // cents so the timeline can colour/format it.
    const rows: Record<string, unknown>[] = []
    if (prev.amount !== amountToPayCents) rows.push({
      wallet_plan_id: walletPlanId, table_name: 'wallet_plans', field_name: 'amount_to_pay_cents',
      old_value: String(prev.amount), new_value: String(amountToPayCents),
      label: 'WEC-894 τελική τιμή (έσοδο)', admin_user: who.email,
    })
    if (prev.discount !== discountCents) rows.push({
      wallet_plan_id: walletPlanId, table_name: 'wallet_plans', field_name: 'discount_cents',
      old_value: String(prev.discount), new_value: String(discountCents),
      label: 'WEC-894 έκπτωση', admin_user: who.email,
    })
    if (rows.length) {
      const { error: logErr } = await svc.from('admin_change_log').insert(rows)
      if (logErr) console.warn('[wallet-plan-edit-price] change log failed:', logErr.message)
    }

    return Response.json({ ok: true, amountToPayCents, discountCents, discountPct }, { headers: cors })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[wallet-plan-edit-price] failed:', msg)
    return Response.json({ error: msg }, { status: 400, headers: cors })
  }
}
