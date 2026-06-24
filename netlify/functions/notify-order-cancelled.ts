// Admin-only endpoint: fire the Klaviyo "Order Cancelled" transactional email
// for an order whose status has just transitioned to 'cancelled'.
//
// Why this exists as its own function:
//   Admin order cancellation today happens via direct Supabase update from the
//   admin client (`src/lib/api/adminOrders.ts → setOrderStatus`). The Klaviyo
//   trackAsync helper is server-only (API key never reaches the browser), so
//   we need a tiny server endpoint the admin client calls AFTER the status
//   update succeeds.
//
//   When admin actions migrate to Netlify Functions wholesale (WEC-121), this
//   logic can move inside the cancel function and this file deletes itself.
//
// Linear: WEC-289 (Order Cancelled email).

import { createClient } from '@supabase/supabase-js'
// 2026-06-24 incident fix: same Netlify-microtask issue as submit-order.
// Fast return path; trackAsync's fire-and-forget HTTP POST was racing
// against the function being killed. Use awaited track() instead.
import { track, EVT } from '../lib/klaviyo'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface RequestBody {
  orderId: string
  reason?: string
}

async function assertAdmin(token: string): Promise<{ userId: string } | { error: string; status: number }> {
  if (!token) return { error: 'Missing Authorization', status: 401 }
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userRes } = await supa.auth.getUser()
  if (!userRes?.user) return { error: 'Invalid session', status: 401 }
  const { data, error } = await supa.rpc('is_admin')
  if (error) return { error: `Admin check failed: ${error.message}`, status: 500 }
  if (!data) return { error: 'Forbidden — admin role required', status: 403 }
  return { userId: userRes.user.id }
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const who = await assertAdmin(token)
  if ('error' in who) {
    return Response.json({ error: who.error }, {
      status: who.status,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.orderId) {
    return Response.json({ error: 'orderId required' }, { status: 400 })
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: order } = await svc
    .from('orders')
    .select('id, order_number, total, payment_method, payment_status, customer_name, customer_email, user_id, status')
    .eq('id', body.orderId)
    .single()
  if (!order) {
    return Response.json({ error: 'Order not found' }, { status: 404 })
  }
  // Defensive: only fire if status is actually cancelled. setOrderStatus calls
  // this AFTER updating, so the DB should match — but never trust the caller.
  if ((order.status as string) !== 'cancelled') {
    return Response.json({
      error: `Order ${body.orderId} is not cancelled (status=${order.status})`,
    }, { status: 400 })
  }

  // Lang lookup — server-side, admin-initiated.
  let custLang: 'el' | 'en' = 'el'
  if (order.user_id) {
    const { data: pref } = await svc
      .from('user_prefs')
      .select('lang')
      .eq('user_id', order.user_id)
      .maybeSingle()
    const l = (pref as { lang?: string } | null)?.lang
    if (l === 'el' || l === 'en') custLang = l
  }

  const klaviyoRes = await track(EVT.OrderCancelled, {
    email: (order.customer_email as string) ?? '',
    firstName: ((order.customer_name as string) ?? '').split(' ')[0],
    externalId: (order.user_id as string | null) ?? undefined,
  }, {
    lang: custLang,
    orderNumber: order.order_number,
    total: (order.total as number) / 100,
    paymentMethod: order.payment_method,
    wasPaid: order.payment_status === 'paid',
    reason: body.reason ?? '',
  })
  if (!klaviyoRes.ok) {
    console.warn('[notify-order-cancelled] klaviyo:', klaviyoRes.error)
    // Still 200 — the cancel has already happened in the DB; we shouldn't
    // signal failure for an email side-effect.
  }

  return Response.json({ ok: true }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}
