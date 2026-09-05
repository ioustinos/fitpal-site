import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'
import { checkRateLimit, clientIp } from '../lib/rateLimit'
import { normVoucherEmail, normVoucherPhone } from '../../src/lib/voucherIdentity'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// ─── Types ──────────────────────────────────────────────────────────────────

interface ValidateRequest {
  code: string
  cartTotal: number    // euros — full subtotal (order) or plan cost (subscription)
  userId?: string
  /**
   * WEC-703: which product this validation is for. Default 'orders' (à-la-carte
   * checkout). The subscription wizard passes 'subscriptions'. A voucher whose
   * `applies_to` doesn't match is rejected — an orders voucher can't be used on
   * a package and vice versa (never both). For subscriptions the category
   * scoping is skipped (a plan has no dish categories) and cartTotal = plan cost.
   */
  scope?: 'orders' | 'subscriptions'
  /** WEC-546: best-effort contact for per-user matching before submit. The
   *  cart-apply may run before contact is typed, so these can be absent — the
   *  redeem RPC at submit is the authoritative check. */
  email?: string
  phone?: string
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
  // WEC-146: origin allowlist via shared helper
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, 'POST, OPTIONS') })
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // WEC-147 + WEC-455: rate limit (fail-open) — 20 voucher checks / minute / IP.
  // Per WEC-455 / `feedback_error_messaging` this IS the abuse mitigation
  // against code enumeration. Specific error messages are intentional now.
  if (!(await checkRateLimit(`validate-voucher:${clientIp(request)}`, 20, 60))) {
    return Response.json(
      {
        valid: false,
        errorCode: 'rate_limit',
        error: 'Too many attempts — please try again shortly',
      },
      { status: 429, headers: corsHeaders(request, 'POST, OPTIONS') },
    )
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
    // WEC-455 / feedback_error_messaging: explicitly OVERRULES WEC-148's
    // collapse-to-generic strategy. The product decision is to surface
    // specific, actionable error reasons to the customer so they understand
    // why a code didn't apply (typo? already used? minimum not met?).
    // Abuse mitigation against code enumeration is the rate limit above
    // (20 attempts / min / IP) — not error-message obfuscation. See
    // memory `feedback_error_messaging`.
    //
    // Response shape on rejection:
    //   {
    //     valid: false,
    //     code: '<the submitted code, uppercased>',
    //     errorCode: '<machine-readable code>',  // e.g. 'per_user_limit'
    //     error: '<English fallback message>',    // for clients without i18n
    //     ...optional structured fields (min order, etc.)
    //   }
    //
    // The client maps errorCode → localized bilingual message.
    const REJECT_MESSAGES: Record<string, string> = {
      not_found:         "This voucher code doesn't exist",
      inactive:          "This voucher is currently disabled",
      expired:           "This voucher has expired",
      max_uses_reached:  "This voucher has reached its maximum uses",
      per_user_limit:    "This code has already been used",
      registered_only:   "Log in to use this code",
      user_mismatch:     "This voucher is not available for your account",
      credit_exhausted:  "This voucher's credit balance is depleted",
      no_eligible_items: "No items in your cart qualify for this voucher",
      min_order_not_met: "Minimum order amount not met for this voucher",
      // WEC-703: right code, wrong product.
      wrong_scope_orders:        "This code can only be used on food orders",
      wrong_scope_subscriptions: "This code can only be used on subscriptions",
    }

    function reject(errorCode: keyof typeof REJECT_MESSAGES, extra: Record<string, unknown> = {}) {
      // Server-side logging stays — useful for ops debugging.
      // eslint-disable-next-line no-console
      console.log(`[validate-voucher] rejected ${code} for user=${userId ?? 'guest'}: ${errorCode}`)
      return Response.json({
        valid: false,
        code,
        errorCode,
        error: REJECT_MESSAGES[errorCode],
        ...extra,
      })
    }

    // Fetch voucher
    const { data: voucher, error: vErr } = await supabase
      .from('vouchers')
      .select('*')
      .eq('code', code)
      .single()

    if (vErr || !voucher) return reject('not_found')
    if (!voucher.active) return reject('inactive')

    // WEC-703: scope gate — an orders voucher can't apply to a subscription and
    // vice versa. `applies_to` defaults to 'orders' for every pre-WEC-703 code.
    const requestedScope: 'orders' | 'subscriptions' = body.scope === 'subscriptions' ? 'subscriptions' : 'orders'
    const voucherScope = (voucher.applies_to as string | null) ?? 'orders'
    if (voucherScope !== requestedScope) {
      return reject(voucherScope === 'orders' ? 'wrong_scope_orders' : 'wrong_scope_subscriptions')
    }
    if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
      return reject('expired', { expiresAt: voucher.expires_at })
    }
    if (voucher.max_uses != null && voucher.uses_count >= voucher.max_uses) {
      return reject('max_uses_reached', { maxUses: voucher.max_uses, usesCount: voucher.uses_count })
    }

    // WEC-546: registered-only vouchers require an authenticated user.
    if (voucher.registered_only && !userId) {
      return reject('registered_only')
    }

    // WEC-546: per-user limit matched by user_id OR email OR phone so guests
    // are bounded too. Contact is best-effort here (cart-apply may precede
    // typing it); the redeem RPC at submit is authoritative.
    if (voucher.per_user_limit != null) {
      const nEmail = normVoucherEmail(body.email)
      const nPhone = normVoucherPhone(body.phone)
      const ors: string[] = []
      if (userId) ors.push(`user_id.eq.${userId}`)
      if (nEmail) ors.push(`email.eq.${nEmail}`)
      if (nPhone) ors.push(`phone.eq.${nPhone}`)
      if (ors.length > 0) {
        const { count } = await supabase
          .from('voucher_uses')
          .select('id', { count: 'exact', head: true })
          .eq('voucher_id', voucher.id)
          .or(ors.join(','))
        if ((count ?? 0) >= voucher.per_user_limit) {
          return reject('per_user_limit', { perUserLimit: voucher.per_user_limit, used: count ?? 0 })
        }
      }
    }

    // User-specific voucher with no match (or guest trying to use one)
    if (voucher.user_id && voucher.user_id !== userId) return reject('user_mismatch')

    // Check minimum order — structured payload includes cents so the
    // client can format a localized "add €X more" hint.
    const cartTotalCents = Math.round((body.cartTotal ?? 0) * 100)
    if (voucher.min_order != null && cartTotalCents < voucher.min_order) {
      return reject('min_order_not_met', { minOrderCents: voucher.min_order, cartTotalCents })
    }

    // Credit voucher with zero remaining
    if (voucher.type === 'credit' && (voucher.remaining ?? 0) <= 0) return reject('credit_exhausted')

    // WEC-262: scoped vouchers — compute the eligible subtotal from the
    // cart items the client passed. Without an items array we can't filter,
    // so we fall through to the legacy "discount on full cart" behaviour
    // (submit-order will tighten this for the actual order); but if items
    // are provided AND none qualify, this voucher is rejected outright.
    // WEC-703: category scoping is meaningless for subscriptions (a plan has no
    // dish categories) — force the eligible total to the whole plan cost.
    const scopedCats = requestedScope === 'subscriptions'
      ? []
      : (Array.isArray(voucher.applicable_category_ids) ? (voucher.applicable_category_ids as string[]) : [])
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
      if (eligibleCents <= 0) {
        return reject('no_eligible_items', { applicableCategoryIds: scopedCats })
      }
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
