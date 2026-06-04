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

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface QuoteLine {
  dish_id: string
  variant_id: string
  qty: number
}
interface QuoteBody {
  lines: QuoteLine[]
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
  const { data: variants, error } = await supabase
    .from('dish_variants')
    .select('id, price')
    .in('id', variantIds)
  if (error) {
    console.error('[menu-quote] variant fetch failed:', error)
    return Response.json({ error: 'Failed to load prices' }, { status: 500, headers: cors })
  }

  const priceByVariant = new Map<string, number>()
  for (const v of (variants ?? []) as Array<{ id: string; price: number }>) {
    priceByVariant.set(v.id, v.price)
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
