import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// ─── Types ──────────────────────────────────────────────────────────────────

interface ValidateRequest {
  code: string
  cartTotal: number    // euros — full subtotal, used for min_order check
  userId?: string
  /**
   * WEC-262: optional cart items so the server can compute the
   * eligible-only subtotal when the voucher is category-scoped. Each
   * entry is `{ dishId, lineTotal }` (lineTotal = unit_price × qty in euros).
   * Older clients that don't pass this still get a result — but if the
   * voucher is scoped AND no items are passed, the server treats every
   * item as eligible (back-compat — the authoritative scoped calc still
   * runs at submit-order). When items ARE passed and none qualify, the
   * voucher is rejected as "not applicable".
   */
  items?: Array<{ dishId: string; lineTotal: number }>
}

interface VoucherResult {
  valid: boolean
  code: string
  type: 'pct' | 'fixed' | 'credit'
  value: number        // percentage, fixed €, or credit €
  discount: number     // calculated discount in euros
  /** Minimum order amount in EUROS — null if no minimum. The client stores
   *  this so it can re-validate locally when the cart shrinks (the server
   *  also re-validates on submit). */
  minOrder: number | null
  /**
   * WEC-262: category ids this voucher applies to. Empty array = applies
   * to all categories. The client uses this list to (a) compute eligible
   * subtotal when the cart changes (no extra server round-trip) and (b)
   * render per-item "discount applies here" badges in the cart.
   */
  applicableCategoryIds: string[]
  error?: string
}

// ─── Handler ────────────────────────────────────────────────────────────────

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

  try {
    const body: ValidateRequest = await request.json()
    const code = (body.code ?? '').trim().toUpperCase()

    if (!code) {
      return Response.json({ valid: false, error: 'No voucher code provided' }, { status: 400 })
    }

    // Create Supabase client — use service key for voucher lookups (no RLS needed)
    const supabase = SUPABASE_SERVICE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      : createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    // Resolve userId from JWT if present
    let userId = body.userId ?? null
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (token && !userId) {
      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: { user } } = await authClient.auth.getUser()
      userId = user?.id ?? null
    }

    // ── Voucher lookup + reject path ────────────────────────────────────
    //
    // WEC-148: don't leak which specific reason a voucher is unavailable.
    // The previous behaviour exposed distinct strings for "doesn't exist",
    // "expired", "max uses reached", "already used by this user", "not
    // your voucher" — letting an attacker enumerate valid codes by error
    // diff. Now every "invalid for this caller" reason returns the same
    // generic message + the same shape, modulo the `min_order` case which
    // is the one bit of information the legit user genuinely needs to act
    // on (it's not a yes/no — it's "you'd be eligible if your cart hits
    // the threshold"; same logic as a "free shipping above €X" badge).
    //
    // Exception: the min-order case is allowed because:
    //   (a) it doesn't confirm voucher existence beyond what cart total
    //       reveals (an attacker could still try `cartTotal: 9999` to
    //       bypass), and
    //   (b) ux value to legit users is high.
    //
    // Server-side logging keeps the actual reason for ops debugging.
    const REJECT_GENERIC = 'This voucher is invalid or unavailable.'

    function reject(reason: string) {
      // eslint-disable-next-line no-console
      console.log(`[validate-voucher] rejected ${code} for user=${userId ?? 'guest'}: ${reason}`)
      return Response.json({ valid: false, code, error: REJECT_GENERIC })
    }

    // Fetch voucher
    const { data: voucher, error: vErr } = await supabase
      .from('vouchers')
      .select('*')
      .eq('code', code)
      .single()

    if (vErr || !voucher) return reject('not found')
    if (!voucher.active) return reject('inactive')
    if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) return reject('expired')
    if (voucher.max_uses != null && voucher.uses_count >= voucher.max_uses) return reject('max_uses reached')

    // Per-user limit
    if (userId && voucher.per_user_limit != null) {
      const { count } = await supabase
        .from('voucher_uses')
        .select('id', { count: 'exact', head: true })
        .eq('voucher_id', voucher.id)
        .eq('user_id', userId)
      if ((count ?? 0) >= voucher.per_user_limit) return reject('per-user limit reached')
    }

    // User-specific voucher with no match (or guest trying to use one)
    if (voucher.user_id && voucher.user_id !== userId) return reject('user mismatch')

    // Check minimum order — the ONE case where we DO leak the reason,
    // because it's actionable for the customer ("add €X more").
    const cartTotalCents = Math.round((body.cartTotal ?? 0) * 100)
    if (voucher.min_order != null && cartTotalCents < voucher.min_order) {
      const minEuros = (voucher.min_order / 100).toFixed(2)
      return Response.json({
        valid: false,
        code,
        error: `Minimum order €${minEuros} required for this voucher`,
      })
    }

    // Credit voucher with zero remaining → generic.
    if (voucher.type === 'credit' && (voucher.remaining ?? 0) <= 0) return reject('credit exhausted')

    // WEC-262: scoped vouchers — compute the eligible subtotal from the
    // cart items the client passed. Without an items array we can't filter,
    // so we fall through to the legacy "discount on full cart" behaviour
    // (submit-order will tighten this for the actual order); but if items
    // are provided AND none qualify, this voucher is rejected outright.
    const scopedCats = Array.isArray(voucher.applicable_category_ids) ? (voucher.applicable_category_ids as string[]) : []
    let eligibleCents = cartTotalCents
    if (scopedCats.length > 0 && Array.isArray(body.items) && body.items.length > 0) {
      const dishIds = Array.from(new Set(body.items.map((i) => i.dishId)))
      const { data: dishRows } = await supabase
        .from('dishes')
        .select('id, category_id')
        .in('id', dishIds)
      const catByDish = new Map<string, string>()
      for (const r of (dishRows ?? []) as Array<{ id: string; category_id: string }>) {
        catByDish.set(r.id, r.category_id)
      }
      const eligibleEuros = body.items
        .filter((i) => {
          const cat = catByDish.get(i.dishId)
          return typeof cat === 'string' && scopedCats.includes(cat)
        })
        .reduce((s, i) => s + i.lineTotal, 0)
      eligibleCents = Math.round(eligibleEuros * 100)
      if (eligibleCents <= 0) return reject('no eligible items in cart')
    }

    // Calculate discount on the eligible total (full cart for unscoped
    // vouchers, eligible-only for scoped ones).
    let discount = 0
    const type = voucher.type as 'pct' | 'fixed' | 'credit'
    const value = voucher.value // stored as number (percentage or cents)

    if (type === 'pct') {
      discount = Math.round(eligibleCents * value / 100) / 100 // result in euros
    } else if (type === 'fixed') {
      discount = Math.min(value / 100, eligibleCents / 100) // value is in cents, cap at eligible
    } else if (type === 'credit') {
      const remaining = (voucher.remaining ?? 0) / 100 // cents to euros
      discount = Math.min(remaining, eligibleCents / 100)
    }

    return Response.json({
      valid: true,
      code,
      type: type === 'credit' ? 'fixed' : type, // frontend treats credit as fixed
      value: type === 'pct' ? value : value / 100, // return euros for fixed/credit, pct as-is
      discount: +discount.toFixed(2),
      minOrder: voucher.min_order != null ? voucher.min_order / 100 : null, // euros, or null
      applicableCategoryIds: scopedCats,
      voucherId: voucher.id, // needed for submit-order to record usage
    } satisfies VoucherResult & { voucherId: string })
  } catch (err) {
    console.error('Voucher validation error:', err)
    return Response.json(
      { valid: false, error: 'Server error validating voucher' },
      { status: 500 }
    )
  }
}
