// POST /api/revert-order-to-draft  (WEC-681)
//
// When a customer cancels at Viva's hosted checkout and returns to
// /order/pending/failure, the order that submit-order promoted (draft → pending
// before the redirect, because Viva needs a merchantTrns) is left abandoned as
// `status='pending'`. The promote guard is `WHERE status='draft'`, so a retry
// can't reuse that row and submit-order creates a SECOND, duplicate order.
//
// This endpoint reverts that abandoned order BACK to `status='draft'` so the
// retry re-promotes the SAME row (one order, correct final method, order number
// reused) and voids its outstanding payment_links row so a stale link can't be
// paid later. Guarded: only an abandoned pending card/link order, owned by the
// caller (registered users), is ever touched — never a paid/confirmed order.

import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async (request: Request): Promise<Response> => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })

  let body: { orderId?: string }
  try { body = (await request.json()) as { orderId?: string } }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }
  const orderId = (body.orderId ?? '').trim()
  if (!orderId) return Response.json({ error: 'orderId required' }, { status: 400, headers: cors })

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: order } = await svc
    .from('orders')
    .select('id, user_id, status, payment_status, payment_method')
    .eq('id', orderId)
    .maybeSingle()
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404, headers: cors })

  // Only an abandoned card/link checkout qualifies. Never touch a paid,
  // confirmed, cancelled, or cash/transfer order.
  const qualifies =
    order.status === 'pending' &&
    order.payment_status === 'pending' &&
    (order.payment_method === 'card' || order.payment_method === 'link')
  if (!qualifies) {
    return Response.json({ reverted: false, reason: 'not an abandoned pending card/link order' }, { status: 200, headers: cors })
  }

  // Ownership: a registered user's order requires that user's token. Guest
  // orders (user_id null) are allowed — the caller held the orderId from their
  // own checkout session, and the worst case is a race reconcile would clean.
  if (order.user_id) {
    const authHeader = request.headers.get('authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return Response.json({ error: 'Auth required' }, { status: 401, headers: cors })
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: u } = await userClient.auth.getUser()
    if (!u?.user || u.user.id !== order.user_id) {
      return Response.json({ error: 'Not your order' }, { status: 403, headers: cors })
    }
  }

  // Revert to draft — race-guarded so a webhook/reconcile that just flipped it
  // can't be clobbered.
  const { data: upd, error: upErr } = await svc
    .from('orders')
    .update({ status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', 'pending')
    .eq('payment_status', 'pending')
    .select('id')
  if (upErr) return Response.json({ error: upErr.message }, { status: 500, headers: cors })
  const reverted = (upd?.length ?? 0) > 0

  if (reverted) {
    // Void the outstanding link + leave an audit trail. Best-effort — a failure
    // here must not undo the revert (the duplicate-prevention is the priority).
    try {
      await svc.from('payment_links').update({ status: 'failure' }).eq('order_id', orderId).eq('status', 'pending')
      await svc.from('admin_change_log').insert({
        order_id: orderId, table_name: 'orders', field_name: 'status',
        old_value: 'pending', new_value: 'draft',
        label: 'reverted abandoned checkout (WEC-681)', admin_user: 'system_revert',
      })
    } catch (e) {
      console.warn('[revert-order-to-draft] void/log best-effort failed:', e)
    }
  }
  return Response.json({ reverted }, { status: 200, headers: cors })
}
