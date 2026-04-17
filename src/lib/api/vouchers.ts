import { supabase } from '../supabase'

// ─── DB row shape ────────────────────────────────────────────────────────────

interface DbVoucher {
  id: string
  code: string
  user_id: string | null
  type: 'pct' | 'fixed' | 'credit'
  value: number              // pct: percentage, fixed/credit: cents
  remaining: number | null   // for credit vouchers
  min_order: number | null   // cents
  max_uses: number | null
  uses_count: number
  per_user_limit: number | null
  expires_at: string | null
  active: boolean
}

// ─── Response types ──────────────────────────────────────────────────────────

export interface VoucherResult {
  valid: boolean
  code: string
  type: 'pct' | 'fixed' | 'credit'
  value: number              // percentage or euros
  discountAmount: number     // computed discount in euros for the given cart total
  error?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const centsToEuros = (cents: number): number => +(cents / 100).toFixed(2)

// ─── Client-side validation (temporary — will move to Netlify function in WEC-91) ─

/**
 * Validate a voucher code against the database.
 *
 * NOTE: This runs client-side for now (Phase 1). In WEC-91 this will be
 * replaced by a call to `/api/validate-voucher` for proper server-side
 * validation with usage tracking.
 */
export async function validateVoucher(
  code: string,
  cartTotalEuros: number,
  userId?: string,
): Promise<{ data: VoucherResult | null; error: string | null }> {
  const upperCode = code.toUpperCase().trim()

  if (!upperCode) {
    return { data: null, error: 'Voucher code is required' }
  }

  // Look up the voucher
  const { data: row, error: dbErr } = await supabase
    .from('vouchers')
    .select('*')
    .eq('code', upperCode)
    .eq('active', true)
    .single()

  if (dbErr || !row) {
    return {
      data: { valid: false, code: upperCode, type: 'pct', value: 0, discountAmount: 0, error: 'Invalid voucher code' },
      error: null,
    }
  }

  const v = row as DbVoucher

  // Check expiry
  if (v.expires_at && new Date(v.expires_at) < new Date()) {
    return {
      data: { valid: false, code: upperCode, type: v.type, value: 0, discountAmount: 0, error: 'Voucher has expired' },
      error: null,
    }
  }

  // Check max uses
  if (v.max_uses != null && v.uses_count >= v.max_uses) {
    return {
      data: { valid: false, code: upperCode, type: v.type, value: 0, discountAmount: 0, error: 'Voucher usage limit reached' },
      error: null,
    }
  }

  // Check per-user limit (if user is logged in)
  if (userId && v.per_user_limit != null) {
    const { count } = await supabase
      .from('voucher_uses')
      .select('*', { count: 'exact', head: true })
      .eq('voucher_id', v.id)
      .eq('user_id', userId)

    if (count != null && count >= v.per_user_limit) {
      return {
        data: { valid: false, code: upperCode, type: v.type, value: 0, discountAmount: 0, error: 'You have already used this voucher' },
        error: null,
      }
    }
  }

  // Check user-specific voucher
  if (v.user_id && userId && v.user_id !== userId) {
    return {
      data: { valid: false, code: upperCode, type: v.type, value: 0, discountAmount: 0, error: 'Invalid voucher code' },
      error: null,
    }
  }

  // Check minimum order
  const cartTotalCents = Math.round(cartTotalEuros * 100)
  if (v.min_order != null && cartTotalCents < v.min_order) {
    return {
      data: {
        valid: false,
        code: upperCode,
        type: v.type,
        value: 0,
        discountAmount: 0,
        error: `Minimum order of €${centsToEuros(v.min_order)} required`,
      },
      error: null,
    }
  }

  // Calculate discount
  let discountEuros: number
  let displayValue: number

  if (v.type === 'pct') {
    displayValue = v.value // already a percentage
    discountEuros = +(cartTotalEuros * v.value / 100).toFixed(2)
  } else if (v.type === 'fixed') {
    displayValue = centsToEuros(v.value)
    discountEuros = Math.min(displayValue, cartTotalEuros)
  } else {
    // credit voucher — discount is min(remaining, cart total)
    const remainingEuros = centsToEuros(v.remaining ?? v.value)
    displayValue = remainingEuros
    discountEuros = Math.min(remainingEuros, cartTotalEuros)
  }

  return {
    data: {
      valid: true,
      code: upperCode,
      type: v.type === 'credit' ? 'fixed' : v.type, // credit acts like fixed for the cart
      value: displayValue,
      discountAmount: discountEuros,
    },
    error: null,
  }
}
