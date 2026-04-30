import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// ─── Types ──────────────────────────────────────────────────────────────────

interface ValidateRequest {
  code: string
  cartTotal: number    // euros
  userId?: string
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

    // Fetch voucher
    const { data: voucher, error: vErr } = await supabase
      .from('vouchers')
      .select('*')
      .eq('code', code)
      .single()

    if (vErr || !voucher) {
      return Response.json({
        valid: false,
        code,
        error: 'Invalid voucher code',
      })
    }

    // Check active
    if (!voucher.active) {
      return Response.json({ valid: false, code, error: 'This voucher is no longer active' })
    }

    // Check expiry
    if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
      return Response.json({ valid: false, code, error: 'This voucher has expired' })
    }

    // Check global usage limit
    if (voucher.max_uses != null && voucher.uses_count >= voucher.max_uses) {
      return Response.json({ valid: false, code, error: 'This voucher has reached its usage limit' })
    }

    // Check per-user limit
    if (userId && voucher.per_user_limit != null) {
      const { count } = await supabase
        .from('voucher_uses')
        .select('id', { count: 'exact', head: true })
        .eq('voucher_id', voucher.id)
        .eq('user_id', userId)

      if ((count ?? 0) >= voucher.per_user_limit) {
        return Response.json({ valid: false, code, error: 'You have already used this voucher' })
      }
    }

    // Check if voucher is user-specific and doesn't match
    if (voucher.user_id && userId && voucher.user_id !== userId) {
      return Response.json({ valid: false, code, error: 'This voucher is not available for your account' })
    }

    // Check minimum order
    const cartTotalCents = Math.round((body.cartTotal ?? 0) * 100)
    if (voucher.min_order != null && cartTotalCents < voucher.min_order) {
      const minEuros = (voucher.min_order / 100).toFixed(2)
      return Response.json({
        valid: false,
        code,
        error: `Minimum order €${minEuros} required for this voucher`,
      })
    }

    // Check credit voucher remaining balance
    if (voucher.type === 'credit' && (voucher.remaining ?? 0) <= 0) {
      return Response.json({ valid: false, code, error: 'This credit voucher has been fully used' })
    }

    // Calculate discount
    let discount = 0
    const type = voucher.type as 'pct' | 'fixed' | 'credit'
    const value = voucher.value // stored as number (percentage or cents)

    if (type === 'pct') {
      discount = Math.round(cartTotalCents * value / 100) / 100 // result in euros
    } else if (type === 'fixed') {
      discount = Math.min(value / 100, body.cartTotal) // value is in cents, cap at cart total
    } else if (type === 'credit') {
      const remaining = (voucher.remaining ?? 0) / 100 // cents to euros
      discount = Math.min(remaining, body.cartTotal)
    }

    return Response.json({
      valid: true,
      code,
      type: type === 'credit' ? 'fixed' : type, // frontend treats credit as fixed
      value: type === 'pct' ? value : value / 100, // return euros for fixed/credit, pct as-is
      discount: +discount.toFixed(2),
      minOrder: voucher.min_order != null ? voucher.min_order / 100 : null, // euros, or null
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
