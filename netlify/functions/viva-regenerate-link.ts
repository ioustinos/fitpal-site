// Admin-only endpoint: regenerate the Viva payment link for an existing
// pending order. Invalidates the old payment_links row and creates a new
// Viva orderCode with a 24h timeout.
//
// Called from the admin drawer's Payment Link block (WEC-176).
//
// WEC-176: part of the Viva Payments integration epic (WEC-125).

import { createClient } from '@supabase/supabase-js'
import { createVivaOrder } from '../lib/viva/createOrder'
// 2026-06-26: switched to awaited track() + subscribeProfileToMarketing
// (same fix as submit-order — fire-and-forget was being killed by Netlify).
import { track, subscribeProfileToMarketing, EVT } from '../lib/klaviyo'
import { corsHeaders } from '../lib/cors'

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
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: cors,
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
    .select('id, order_number, total, payment_status, customer_name, customer_email, payment_method, user_id')
    .eq('id', body.orderId)
    .single()
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 })

  // WEC-599: allow regenerating a link on an order that already had one sent
  // («pending_link_sent» is still unpaid). Only paid/failed/refunded is blocked.
  if (order.payment_status !== 'pending' && order.payment_status !== 'pending_link_sent') {
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

    // WEC-599: mark the order «pending_link_sent» on the FIRST send (guarded on
    // 'pending' so a regenerate of an already-sent order is a no-op, and paid/
    // failed can never be clobbered). This is the single server-side place the
    // new status is set — customer inline card checkout stays plain 'pending'.
    await service
      .from('orders')
      .update({ payment_status: 'pending_link_sent', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('payment_status', 'pending')

    // WEC-604: the timeline entry is written by the caller (sendPaymentLinkLogged,
    // WEC-598) with the admin's EMAIL and the correct «sent» vs «regenerated»
    // label. The old audit insert here duplicated that row AND wrote the admin's
    // raw uuid into the By column (which everywhere else holds an email) AND
    // always said «Regenerated» even on first generation. Removed — one row, one
    // source of truth.

    // Fire Klaviyo "Payment Link Sent" event. Fail-soft — never block admin
    // action on email delivery. Lang routes EL/EN template via Klaviyo flow's
    // conditional split on event.lang.
    try {
      let custLang: 'el' | 'en' = 'el'
      if (order.user_id) {
        const { data: pref } = await service
          .from('user_prefs')
          .select('lang')
          .eq('user_id', order.user_id)
          .maybeSingle()
        const l = (pref as { lang?: string } | null)?.lang
        if (l === 'el' || l === 'en') custLang = l
      }
      // 2026-06-26: template UTa3ND/RuKhzb uses snake_case
      // (event.order_number, event.payment_url). Emit BOTH.
      const linkFirstName = ((order.customer_name as string) ?? '').split(' ')[0]
      const linkEmail = (order.customer_email as string) ?? ''
      const linkProps = {
        lang: custLang,
        // snake_case (template-expected)
        first_name: linkFirstName,
        order_number: order.order_number,
        payment_url: result.paymentUrl,
        total: (order.total as number) / 100,
        // camelCase (legacy / downstream)
        orderNumber: order.order_number,
        paymentUrl: result.paymentUrl,
      }
      const linkFires = await Promise.all([
        subscribeProfileToMarketing(linkEmail, 'Fitpal payment link sent (auto-subscribe)'),
        track(EVT.PaymentLinkSent, {
          email: linkEmail,
          firstName: linkFirstName,
          externalId: (order.user_id as string | null) ?? undefined,
        }, linkProps),
      ])
      const linkFailed = linkFires.filter((r) => !r.ok)
      if (linkFailed.length > 0) {
        console.warn('[viva-regenerate-link] klaviyo: %d/%d failed: %s',
          linkFailed.length, linkFires.length,
          linkFailed.map((r) => r.error).join(' | '))
      }
    } catch (e) { console.warn('[viva-regenerate-link] klaviyo:', e) }

    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('viva-regenerate-link failed:', msg)
    return Response.json({ error: msg }, { status: 400 })
  }
}
