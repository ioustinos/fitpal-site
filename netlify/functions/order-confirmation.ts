/**
 * WEC-740: confirmation-screen order lookup for the Viva return page.
 *
 * ⚠️ WHY THIS EXISTS — the bug it fixes
 *
 * `fetchOrderForConfirmation` read `orders` / `child_orders` / `order_items`
 * straight from the browser. For a LOGGED-IN customer that works: the
 * "Users read own orders" RLS policy matches on `auth.uid() = user_id`.
 *
 * For a GUEST it can never work. The guest has no `auth.uid()`, and the order
 * has no `user_id`, so the policy evaluates `null = null` → NULL → **no rows,
 * and no error**. The page therefore sat on «Φόρτωση λεπτομερειών παραγγελίας…»
 * forever, with nothing in the console to explain it.
 *
 * That path only shows up for card / link payments, because those are the only
 * ones that leave the site and come back — a cash order renders its
 * confirmation from the cart still in memory. Guest + card is also exactly the
 * combination the E2E suite cannot drive end to end (Viva's 3DS iframe is
 * cross-origin), so it had never actually been walked. Found by Ioustinos on
 * the first real B2B card order, 2026-09-07.
 *
 * ⚠️ ACCESS MODEL — read carefully before changing
 *
 * Keyed on the order's **uuid**, never its order number. `FP-260907-00005` is
 * trivially enumerable; a uuid is not, and the Viva return URL already carries
 * it as `merchantTrns`. This is the same "a guessed ID leads nowhere" model
 * `viva-verify` uses. Drafts are refused outright, and the response carries
 * only what the confirmation screen renders — no `user_id`, no admin notes, no
 * internal ids.
 *
 * ⚠️ WEC-742 — `&minimal=1`
 *
 * The return page has a second read of the same order: when Viva's verify says
 * "still pending", it polls every 1.5s for up to 10s hoping the webhook lands.
 * That poll was ALSO a direct browser query, so it hit the identical guest
 * null-match and the page fell through to a "payment pending" screen with no
 * order number on it. `minimal=1` serves that poll — order row only, no
 * children, no items — so a 7-iteration poll doesn't do 21 queries to answer
 * one question.
 */

import type { Handler } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const

export const handler: Handler = async (event) => {
  const orderId = (event.queryStringParameters?.orderId ?? '').trim()
  // WEC-742: the payment poll only needs the order row.
  const minimal = (event.queryStringParameters?.minimal ?? '') === '1'

  if (!UUID_RE.test(orderId)) {
    return { statusCode: 400, headers: NO_STORE, body: JSON.stringify({ error: 'invalid_order_id' }) }
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers: NO_STORE, body: JSON.stringify({ error: 'server_not_configured' }) }
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .select('id, order_number, total, notes, payment_method, payment_status, invoice_type, invoice_name, invoice_vat, status')
      .eq('id', orderId)
      .maybeSingle()

    if (oErr) throw new Error(oErr.message)
    if (!order) {
      return { statusCode: 404, headers: NO_STORE, body: JSON.stringify({ error: 'order_not_found' }) }
    }
    // A draft is not an order yet — nothing to confirm, and it should not be
    // readable by anyone holding a stale id.
    if ((order as { status?: string }).status === 'draft') {
      return { statusCode: 404, headers: NO_STORE, body: JSON.stringify({ error: 'order_not_found' }) }
    }

    // WEC-742: the poll asks one question — "is it paid yet?" — and pays for
    // one query to answer it.
    if (minimal) {
      return {
        statusCode: 200,
        headers: NO_STORE,
        body: JSON.stringify({ order, children: [], items: [] }),
      }
    }

    const { data: children, error: cErr } = await supabase
      .from('child_orders')
      .select('id, delivery_date, time_from, time_to, address_street, address_area, address_zip, company_benefit_amount')
      .eq('order_id', orderId)
      .is('cancelled_at', null)   // hide soft-cancelled days from the customer
      .order('delivery_date', { ascending: true })
    if (cErr) throw new Error(cErr.message)

    const childIds = (children ?? []).map((c) => (c as { id: string }).id)
    let items: unknown[] = []
    if (childIds.length > 0) {
      const { data: itemRows, error: iErr } = await supabase
        .from('order_items')
        .select('child_order_id, quantity, name_el, name_en, variant_label_el, variant_label_en, total_price, comment')
        .in('child_order_id', childIds)
      if (iErr) throw new Error(iErr.message)
      items = itemRows ?? []
    }

    return {
      statusCode: 200,
      headers: NO_STORE,
      body: JSON.stringify({ order, children: children ?? [], items }),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return {
      statusCode: 503,
      headers: NO_STORE,
      body: JSON.stringify({ error: `order-confirmation failed: ${message}` }),
    }
  }
}
