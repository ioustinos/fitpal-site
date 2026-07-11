// WEC-416: save-draft — persist an in-progress checkout as an `orders` row
// with status='draft', plus child_orders + order_items mirroring the cart shape.
//
// Triggers (called from CheckoutPage per WEC-417):
//   A. on mount → seed/save initial draft (cart + known customer info)
//   B. debounced 2s on section commits (address, slot, payment, etc.)
//   C. synchronously before submit-order (final-state snapshot — safety net)
//
// Side effects we DO NOT do here (deferred until promote in submit-order):
//   - assign order_number
//   - insert voucher_uses
//   - create payment_links
//   - fire Klaviyo / emails
//   - Viva create-order
//
// Pricing: drafts intentionally store unit_price=0 / total_price=0. The promote
// path in submit-order re-resolves real prices from dish_variants at the
// authoritative moment, so draft prices never leak into a real charge.
//
// Auth: optional. Logged-in callers pass their JWT; guest drafts are allowed
// (user_id NULL). If `user_id` is in the body it must match the JWT subject.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { corsHeaders } from '../lib/cors'
import { checkRateLimit, clientIp } from '../lib/rateLimit'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

interface ItemIn { dish_id: string; variant_id?: string | null; quantity: number; comment?: string }
interface DayCartIn { delivery_date: string; items: ItemIn[] }
interface DayAddrIn {
  delivery_date: string
  street?: string; area?: string; zip?: string; floor?: string
  fulfillment_type?: 'delivery' | 'pickup'
  pickup_location_id?: string | null
}
interface DaySlotIn { delivery_date: string; from?: string; to?: string }
interface SaveDraftBody {
  draft_id?: string
  user_id?: string | null
  customer?: { name?: string; email?: string; phone?: string }
  cart_by_day?: DayCartIn[]
  addresses_by_day?: DayAddrIn[]
  time_slots_by_day?: DaySlotIn[]
  payment_method?: 'cash' | 'card' | 'link' | 'transfer' | 'wallet'
  voucher_code?: string | null // accepted but not persisted in V1 — re-applied at promote
  cutlery?: boolean
  invoice?: { type?: 'invoice' | 'receipt' | 'none'; name?: string; vat?: string }
  notes?: string
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Returns the JWT subject (user id) or null. Never throws. */
async function getJwtUserId(request: Request): Promise<string | null> {
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : ''
  if (!token) return null
  try {
    const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    // WEC-511: pass the token explicitly — no-arg getUser() can return null on a
    // sessionless per-request client even with a valid Authorization header,
    // which produced the false "user_id present but no bearer token provided"
    // 403 for logged-in customers (and silently broke draft persistence).
    const { data } = await c.auth.getUser(token)
    return data.user?.id ?? null
  } catch {
    return null
  }
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  // Rate limit per IP — generous, drafts fire on debounce; we just want to stop
  // a runaway loop from any single client.
  if (!(await checkRateLimit(`save-draft:${clientIp(request)}`, 60, 60))) {
    return Response.json({ error: 'Too many draft saves — slow down.' }, { status: 429, headers: cors })
  }

  let body: SaveDraftBody
  try {
    body = (await request.json()) as SaveDraftBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors })
  }

  // Auth consistency — if body.user_id is set, JWT subject must match.
  const jwtUserId = await getJwtUserId(request)
  const bodyUserId = body.user_id ?? null
  if (bodyUserId && jwtUserId && bodyUserId !== jwtUserId) {
    return Response.json({ error: 'user_id does not match the bearer token' }, { status: 403, headers: cors })
  }
  if (bodyUserId && !jwtUserId) {
    return Response.json({ error: 'user_id present but no bearer token provided' }, { status: 403, headers: cors })
  }
  // Final user_id used on the draft row — prefer JWT (authoritative) over body.
  const effectiveUserId = jwtUserId ?? bodyUserId

  const supabase = serviceClient()

  // ── Resolve / create the draft orders row ────────────────────────────────
  let draftId = (body.draft_id ?? '').trim() || null
  // WEC-536: skip the child-tree delete+reinsert when the cart/address/slot
  // tree is unchanged since the last save (most debounced saves only touch the
  // order row — payment, notes, customer, cutlery, invoice).
  let draftExisted = false
  let storedHash: string | null = null
  const orderPatch: Record<string, unknown> = {
    user_id: effectiveUserId,
    customer_name: body.customer?.name ?? null,
    customer_email: body.customer?.email ?? null,
    customer_phone: body.customer?.phone ?? null,
    payment_method: body.payment_method ?? null,
    cutlery: body.cutlery ?? false,
    invoice_type: body.invoice?.type ?? 'none',
    invoice_name: body.invoice?.name ?? null,
    invoice_vat: body.invoice?.vat ?? null,
    notes: body.notes ?? null,
    updated_at: new Date().toISOString(),
  }

  if (draftId) {
    // Update existing — only if it's still a draft (guard against promoting it
    // while we were mid-flight, which would otherwise mutate a real order).
    const { data: existing, error: selErr } = await supabase
      .from('orders')
      .select('id, status, user_id, draft_cart_hash')
      .eq('id', draftId)
      .maybeSingle()
    if (selErr) return Response.json({ error: selErr.message }, { status: 500, headers: cors })
    if (!existing) {
      // Caller's draft_id is stale (cleared server-side?) — create a new one.
      draftId = null
    } else {
      if ((existing as { status: string }).status !== 'draft') {
        return Response.json({ error: 'draft already promoted' }, { status: 409, headers: cors })
      }
      // Ownership: if the existing draft has a user_id, it must match the caller.
      const existingUser = (existing as { user_id: string | null }).user_id
      if (existingUser && existingUser !== effectiveUserId) {
        return Response.json({ error: 'not the owner of this draft' }, { status: 403, headers: cors })
      }
      const { error: upErr } = await supabase.from('orders').update(orderPatch).eq('id', draftId)
      if (upErr) return Response.json({ error: upErr.message }, { status: 500, headers: cors })
      // WEC-536: remember we had a live draft + its last saved tree hash.
      draftExisted = true
      storedHash = (existing as { draft_cart_hash: string | null }).draft_cart_hash ?? null
    }
  }

  if (!draftId) {
    const { data: ins, error: insErr } = await supabase
      .from('orders')
      .insert({
        ...orderPatch,
        status: 'draft',           // critical — WEC-415 enum value
        payment_status: 'pending',
        subtotal: 0,
        total: 0,
        discount_amount: 0,
        // order_number stays NULL until promote.
      })
      .select('id')
      .single()
    if (insErr) return Response.json({ error: insErr.message }, { status: 500, headers: cors })
    draftId = (ins as { id: string }).id
  }

  // ── Replace child_orders + order_items (delete + re-insert) ──────────────
  // WEC-536: only when the cart/address/slot tree actually changed. Hash the
  // tree inputs; a matching hash means child_orders/order_items already reflect
  // this cart, so we skip the whole delete+reinsert (the p95 cost per WEC-535).
  // A partial rebuild leaves the hash unstamped, so the next save self-heals.
  const newCartHash = createHash('sha1')
    .update(JSON.stringify({
      c: body.cart_by_day ?? [],
      a: body.addresses_by_day ?? [],
      s: body.time_slots_by_day ?? [],
    }))
    .digest('hex')
  const needsTreeRebuild = !draftExisted || storedHash !== newCartHash

  if (needsTreeRebuild) {
  // Drafts are write-heavy on the same row; a clean replace per save is simpler
  // and avoids per-row diffing. CASCADE on the FK takes order_items with it.
  const { error: delErr } = await supabase.from('child_orders').delete().eq('order_id', draftId)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500, headers: cors })

  const cartByDay = body.cart_by_day ?? []
  if (cartByDay.length > 0) {
    // Snapshot dish names so the admin Drafts view can render without joins.
    const dishIds = Array.from(new Set(cartByDay.flatMap((d) => d.items.map((i) => i.dish_id))))
    const { data: dishRows } = await supabase
      .from('dishes')
      .select('id, name_el, name_en')
      .in('id', dishIds)
    const dishMap = new Map<string, { name_el: string; name_en: string }>()
    for (const r of (dishRows ?? []) as Array<{ id: string; name_el: string; name_en: string | null }>) {
      dishMap.set(r.id, { name_el: r.name_el, name_en: r.name_en ?? r.name_el })
    }

    const addrByDate = new Map<string, DayAddrIn>()
    for (const a of body.addresses_by_day ?? []) addrByDate.set(a.delivery_date, a)
    const slotByDate = new Map<string, DaySlotIn>()
    for (const s of body.time_slots_by_day ?? []) slotByDate.set(s.delivery_date, s)

    for (const day of cartByDay) {
      if (!day.delivery_date || !Array.isArray(day.items) || day.items.length === 0) continue
      const a = addrByDate.get(day.delivery_date)
      const s = slotByDate.get(day.delivery_date)
      const isPickup = a?.fulfillment_type === 'pickup'
      const { data: childIns, error: chErr } = await supabase
        .from('child_orders')
        .insert({
          order_id: draftId,
          delivery_date: day.delivery_date,
          time_from: s?.from ?? null,
          time_to: s?.to ?? null,
          address_street: isPickup ? null : (a?.street ?? null),
          address_area: isPickup ? null : (a?.area ?? null),
          address_zip: isPickup ? null : (a?.zip ?? null),
          address_floor: isPickup ? null : (a?.floor ?? null),
          fulfillment_type: a?.fulfillment_type ?? 'delivery',
          pickup_location_id: isPickup ? (a?.pickup_location_id ?? null) : null,
        })
        .select('id')
        .single()
      if (chErr) return Response.json({ error: chErr.message }, { status: 500, headers: cors })
      const childOrderId = (childIns as { id: string }).id

      const itemsPayload = day.items
        .filter((i) => i.dish_id && i.quantity > 0)
        .map((i) => {
          const d = dishMap.get(i.dish_id)
          return {
            child_order_id: childOrderId,
            dish_id: i.dish_id,
            variant_id: i.variant_id ?? null,
            // name_el is NOT NULL; fall back to the dish id slug so the row
            // still inserts even if the dish lookup didn't match.
            name_el: d?.name_el ?? i.dish_id,
            name_en: d?.name_en ?? null,
            quantity: i.quantity,
            // WEC-416: drafts carry zero prices/macros. Promote in submit-order
            // re-resolves real prices from dish_variants — the authoritative
            // moment is the final charge, not the in-progress draft.
            unit_price: 0,
            total_price: 0,
            comment: i.comment ?? null,
          }
        })
      if (itemsPayload.length > 0) {
        const { error: itErr } = await supabase.from('order_items').insert(itemsPayload)
        if (itErr) return Response.json({ error: itErr.message }, { status: 500, headers: cors })
      }
    }
  }

  // WEC-536: stamp the new tree hash AFTER a successful rebuild so the next
  // identical save can skip. (If a rebuild step above errored we returned
  // early and never reach here — the hash stays stale → next save rebuilds.)
  await supabase.from('orders').update({ draft_cart_hash: newCartHash }).eq('id', draftId)
  } // end if (needsTreeRebuild)

  return Response.json(
    { draft_id: draftId, updated_at: new Date().toISOString() },
    { status: 200, headers: cors },
  )
}
