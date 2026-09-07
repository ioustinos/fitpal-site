// WEC-433: server-side authoritative quote for a meal-order cart.
//
// CheckoutPage hits this once just before calling submit-order. If the
// client's locally-computed total (from useMenuStore-cached variant prices)
// differs from what the server sees in dish_variants right now, the
// CheckoutPage shows a "Price updated to €X — Confirm?" modal so the
// customer never gets a surprise charge if an admin edited a price during
// their session.
//
// Read-only. No DB writes. Public — no auth, no rate-limit needed beyond
// the global CORS allowlist. Resolved prices come straight from the
// dish_variants table (the same table submit-order resolves against).
//
// ⚠️ WEC-748 — this endpoint must price the way the STORE prices
//
// It used to read `dish_variants.price` and nothing else: no store, no
// wholesale price, no discounts. On a reseller storefront that meant the quote
// came back at RETAIL while the cart was at wholesale, so every single order
// tripped the "Η τιμή ενημερώθηκε" modal — quoting the customer a total HIGHER
// than the one on screen, moments before charging them the correct lower one.
// Found on the first real reseller checkout, 2026-09-07.
//
// The same hole applied to category discounts (WEC-717) on ANY store, retail
// included: the first category discount set in admin would have produced a
// false "price changed" scare on every affected cart.
//
// The rule this endpoint has to obey: it is the mirror held up to the cart, so
// it must resolve price through exactly the steps `submit-order` does —
// channel first (wholesale on a reseller store), then discounts. If those two
// ever diverge again, the symptom is a price-change modal on a cart nobody
// changed.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'
import { loadCategoryDiscounts, effectiveDiscountPct, applyDiscountCents } from '../lib/stores/categoryDiscounts'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface QuoteLine {
  dish_id: string
  variant_id: string
  qty: number
}
interface QuoteBody {
  lines: QuoteLine[]
  /** WEC-748: which storefront the cart belongs to. Absent = retail. */
  storeSlug?: string | null
}
interface QuoteOutLine {
  dish_id: string
  variant_id: string
  qty: number
  unit_cents: number
  total_cents: number
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  let body: QuoteBody
  try {
    body = await request.json() as QuoteBody
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }
  const lines = Array.isArray(body.lines) ? body.lines.filter((l) =>
    typeof l?.dish_id === 'string' &&
    typeof l?.variant_id === 'string' &&
    Number.isInteger(l?.qty) && l.qty > 0,
  ) : []

  if (lines.length === 0) {
    return Response.json({ lines: [], totalCents: 0 }, { status: 200, headers: cors })
  }
  if (lines.length > 200) {
    return Response.json({ error: 'Too many lines' }, { status: 400, headers: cors })
  }

  const variantIds = Array.from(new Set(lines.map((l) => l.variant_id)))
  const supabase = serviceClient()

  // WEC-748: resolve the storefront first — it decides which price column
  // counts and which discounts apply.
  const slug = (body.storeSlug ?? '').trim().toLowerCase()
  let storeId: string | null = null
  let isReseller = false
  let isMainStore = true
  if (slug && slug !== 'main') {
    const { data: store } = await supabase
      .from('stores')
      .select('id, type, is_default')
      .eq('slug', slug)
      .maybeSingle()
    const s = store as { id: string; type: string; is_default: boolean } | null
    if (s) {
      storeId = s.id
      isMainStore = s.is_default === true || s.type === 'main'
      isReseller = s.type === 'reseller'
    }
    // An unknown slug falls through as retail. This endpoint only ever shows a
    // confirmation modal, so guessing retail is the conservative failure: worst
    // case the customer is asked to confirm a number, never charged one.
  }

  const { data: variants, error } = await supabase
    .from('dish_variants')
    .select('id, dish_id, price, reseller_price, reseller_available')
    .in('id', variantIds)
  if (error) {
    console.error('[menu-quote] variant fetch failed:', error)
    return Response.json({ error: 'Failed to load prices' }, { status: 500, headers: cors })
  }

  // Discounts need the dish's category, and dish-level discount_pct.
  const dishIds = Array.from(new Set(
    ((variants ?? []) as Array<{ dish_id: string }>).map((v) => v.dish_id).filter(Boolean),
  ))
  const { data: dishRows } = dishIds.length > 0
    ? await supabase.from('dishes').select('id, category_id, discount_pct').in('id', dishIds)
    : { data: [] as unknown[] }
  const dishById = new Map(
    ((dishRows ?? []) as Array<{ id: string; category_id: string | null; discount_pct: number | null }>)
      .map((d) => [d.id, d]),
  )
  const categoryDiscounts = await loadCategoryDiscounts(supabase, storeId, isMainStore)

  const priceByVariant = new Map<string, number>()
  for (const v of (variants ?? []) as Array<{
    id: string; dish_id: string; price: number
    reseller_price: number | null; reseller_available: boolean | null
  }>) {
    // Step 1 — channel. Same rule as submit-order: on a reseller store the
    // wholesale price is authoritative and there is NO fallback to retail, so a
    // variant that isn't sold wholesale is left out of the map entirely and
    // reported as missing, exactly as submit-order would reject it.
    let unit: number | null = v.price
    if (isReseller) {
      unit = (v.reseller_available === true && typeof v.reseller_price === 'number')
        ? v.reseller_price
        : null
    }
    if (unit === null) continue

    // Step 2 — discounts, dish-level winning over category-level, no stacking.
    const dish = dishById.get(v.dish_id)
    const pct = effectiveDiscountPct(dish?.discount_pct, dish?.category_id, categoryDiscounts)
    priceByVariant.set(v.id, pct > 0 ? applyDiscountCents(unit, pct) : unit)
  }

  let totalCents = 0
  const outLines: QuoteOutLine[] = []
  const missing: string[] = []
  for (const l of lines) {
    const unit = priceByVariant.get(l.variant_id)
    if (typeof unit !== 'number') {
      // Variant disappeared (admin deleted/disabled it mid-session). Surface
      // so CheckoutPage can warn the user — submit-order would also fail
      // on this row, so flagging here is more user-friendly.
      missing.push(l.variant_id)
      continue
    }
    const lineCents = unit * l.qty
    totalCents += lineCents
    outLines.push({
      dish_id: l.dish_id,
      variant_id: l.variant_id,
      qty: l.qty,
      unit_cents: unit,
      total_cents: lineCents,
    })
  }

  return Response.json(
    { lines: outLines, totalCents, missingVariantIds: missing },
    { status: 200, headers: cors },
  )
}
