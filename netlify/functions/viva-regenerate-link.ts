// Admin-only endpoint: regenerate the Viva payment link for an existing
// pending order. Invalidates the old payment_links row and creates a new
// Viva orderCode with a 24h timeout.
//
// Called from the admin drawer's Payment Link block (WEC-176).
//
// WEC-176: part of the Viva Payments integration epic (WEC-125).

import { createClient } from '@supabase/supabase-js'
import { createVivaOrder } from '../lib/viva/createOrder'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

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
  if ('error' in who) return Response.json({ error: who.error }, { status: who.status })

  let body: { orderId?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.orderId) return Response.json({ error: 'orderId required' }, { status: 400 })

  // Pull order data needed by createVivaOrder — name/email are on orders row.
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: order } = await service
    .from('orders')
    .select('id, total, payment_status, customer_name, customer_email, payment_method')
    .eq('id', body.orderId)
    .single()
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 })

  if (order.payment_status !== 'pending') {
    return Response.json({ error: `Order is not pending (payment_status=${order.payment_status})` }, { status: 400 })
  }

  const mode = order.payment_method === 'link' ? 'link' : 'card'

  try {
    const result = await createVivaOrder({
      orderId: order.id as string,
      amountCents: order.total as number,
      customerEmail: (order.customer_email as string) ?? '',
      customerFullName: (order.customer_name as string) ?? '',
      mode,
      regenerate: true,
    })

    // Audit log for admin visibility.
    await service.from('admin_change_log').insert({
      order_id: order.id,
      table_name: 'payment_links',
      field_name: 'viva_order_code',
      old_value: null,
      new_value: result.orderCode,
      label: 'Regenerated Viva payment link',
      admin_user: who.userId,
    })

    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('viva-regenerate-link failed:', msg)
    return Response.json({ error: msg }, { status: 400 })
  }
}
