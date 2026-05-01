// Admin-only Viva refund endpoint.
//
// Auth: Supabase JWT in Authorization: Bearer <token>, verified against
// public.is_admin() RPC (set up in the admin_rls_policies migration).
// Non-admin → 403. Missing token → 401.
//
// WEC-175: part of the Viva Payments integration epic (WEC-125).

import { createClient } from '@supabase/supabase-js'
import { refundVivaTransaction } from '../lib/viva/refund'
import { trackAsync } from '../lib/klaviyo'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

interface AdminOk { userId: string }
interface AdminErr { error: string; status: number }

async function assertAdmin(token: string): Promise<AdminOk | AdminErr> {
  if (!token) return { error: 'Missing Authorization header', status: 401 }
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
  if ('error' in who) return Response.json({ error: who.error }, { status: who.status })

  let body: { orderId?: string; amountCents?: number; reason?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.orderId) return Response.json({ error: 'orderId required' }, { status: 400 })
  if (!body.reason?.trim()) return Response.json({ error: 'reason required' }, { status: 400 })

  try {
    const result = await refundVivaTransaction({
      orderId: body.orderId,
      amountCents: body.amountCents,
      reason: body.reason,
      adminUserId: who.userId,
    })

    // Fire Klaviyo "Order Refunded" event so the customer-facing refund
    // email flow can pick up. Best-effort; never blocks the refund response.
    // We re-fetch order details for the email payload.
    try {
      const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      const { data: order } = await supa
        .from('orders')
        .select('order_number, customer_name, customer_email, customer_phone, total, refund_amount, user_id, payment_status')
        .eq('id', body.orderId)
        .maybeSingle()
      if (order && (order as { customer_email?: string }).customer_email) {
        const o = order as {
          order_number: string; customer_name: string; customer_email: string;
          customer_phone: string | null; total: number; refund_amount: number;
          user_id: string | null; payment_status: string;
        }
        trackAsync('Order Refunded', {
          email: o.customer_email,
          firstName: o.customer_name?.split(' ')[0],
          lastName: o.customer_name?.split(' ').slice(1).join(' '),
          phone: o.customer_phone ?? undefined,
          externalId: o.user_id ?? undefined,
        }, {
          orderId: body.orderId,
          orderNumber: o.order_number,
          refundAmountCents: body.amountCents ?? o.total,
          refundAmount: ((body.amountCents ?? o.total) / 100),
          orderTotal: o.total / 100,
          cumulativeRefundAmount: o.refund_amount / 100,
          isFullRefund: o.payment_status === 'refunded',
          reason: body.reason,
        })
      }
    } catch (klaviyoErr) {
      console.warn('[viva-refund] klaviyo dispatch failed (non-fatal):', klaviyoErr)
    }

    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('viva-refund failed:', msg)
    return Response.json({ error: msg }, { status: 400 })
  }
}
