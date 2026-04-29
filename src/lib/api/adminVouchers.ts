import { supabase } from '../supabase'

export type VoucherType = 'pct' | 'fixed' | 'credit'

export const VOUCHER_TYPES: { id: VoucherType; label: string; help: string }[] = [
  { id: 'pct',    label: 'Percentage', help: 'Discount % off order total. Value = 1–100.' },
  { id: 'fixed',  label: 'Fixed amount', help: 'Flat € off order total. Value = euros (we store cents).' },
  { id: 'credit', label: 'Credit',  help: 'Pre-loaded credit that depletes per use. Remaining tracked in cents.' },
]

export interface AdminVoucher {
  id: string
  code: string
  userId: string | null
  type: VoucherType
  value: number              // pct: 1-100. fixed: cents. credit: starting cents.
  remaining: number | null   // credit only — remaining cents.
  minOrder: number           // cents
  maxUses: number | null     // null = unlimited
  usesCount: number
  perUserLimit: number | null
  expiresAt: string | null
  active: boolean
  createdAt: string
}

export interface AdminVoucherUseRow {
  id: string
  voucherId: string
  userId: string | null
  userEmail: string | null
  orderId: string | null
  orderNumber: string | null
  amount: number             // cents
  usedAt: string
}

function rowToVoucher(r: Record<string, unknown>): AdminVoucher {
  return {
    id: r.id as string,
    code: r.code as string,
    userId: (r.user_id as string | null) ?? null,
    type: r.type as VoucherType,
    value: (r.value as number) ?? 0,
    remaining: (r.remaining as number | null) ?? null,
    minOrder: (r.min_order as number) ?? 0,
    maxUses: (r.max_uses as number | null) ?? null,
    usesCount: (r.uses_count as number) ?? 0,
    perUserLimit: (r.per_user_limit as number | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    active: (r.active as boolean) ?? true,
    createdAt: (r.created_at as string) ?? '',
  }
}

export async function fetchAdminVouchers(): Promise<{ data: AdminVoucher[]; error: string | null }> {
  const { data, error } = await supabase
    .from('vouchers')
    .select('id, code, user_id, type, value, remaining, min_order, max_uses, uses_count, per_user_limit, expires_at, active, created_at')
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []).map((r) => rowToVoucher(r as Record<string, unknown>)), error: null }
}

export interface VoucherDraft {
  code: string
  userId?: string | null
  type: VoucherType
  value: number
  remaining?: number | null
  minOrder?: number
  maxUses?: number | null
  perUserLimit?: number | null
  expiresAt?: string | null
  active?: boolean
}

export async function createVoucher(d: VoucherDraft): Promise<{ data: AdminVoucher | null; error: string | null }> {
  const code = d.code.trim().toUpperCase()
  if (!code) return { data: null, error: 'Code is required' }

  const payload: Record<string, unknown> = {
    code,
    user_id: d.userId ?? null,
    type: d.type,
    value: d.value,
    // For credit vouchers, remaining starts equal to value if not specified.
    remaining: d.type === 'credit' ? (d.remaining ?? d.value) : null,
    min_order: d.minOrder ?? 0,
    max_uses: d.maxUses ?? null,
    per_user_limit: d.perUserLimit ?? null,
    expires_at: d.expiresAt ?? null,
    active: d.active ?? true,
  }

  const { data, error } = await supabase
    .from('vouchers')
    .insert(payload)
    .select('id, code, user_id, type, value, remaining, min_order, max_uses, uses_count, per_user_limit, expires_at, active, created_at')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: rowToVoucher(data as Record<string, unknown>), error: null }
}

export async function saveVoucher(id: string, patch: Partial<VoucherDraft>): Promise<{ error: string | null }> {
  const payload: Record<string, unknown> = {}
  if (patch.code !== undefined) payload.code = patch.code.trim().toUpperCase()
  if (patch.userId !== undefined) payload.user_id = patch.userId
  if (patch.type !== undefined) payload.type = patch.type
  if (patch.value !== undefined) payload.value = patch.value
  if (patch.remaining !== undefined) payload.remaining = patch.remaining
  if (patch.minOrder !== undefined) payload.min_order = patch.minOrder
  if (patch.maxUses !== undefined) payload.max_uses = patch.maxUses
  if (patch.perUserLimit !== undefined) payload.per_user_limit = patch.perUserLimit
  if (patch.expiresAt !== undefined) payload.expires_at = patch.expiresAt
  if (patch.active !== undefined) payload.active = patch.active

  const { error } = await supabase.from('vouchers').update(payload).eq('id', id)
  return { error: error?.message ?? null }
}

/** Soft delete: flip active=false. Real DELETE would orphan voucher_uses rows. */
export async function deactivateVoucher(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('vouchers').update({ active: false }).eq('id', id)
  return { error: error?.message ?? null }
}

export async function fetchVoucherUses(voucherId: string): Promise<{ data: AdminVoucherUseRow[]; error: string | null }> {
  // Pull the uses + the linked order (for order number) + linked user (for email)
  // in three queries so we can show a useful detail panel without exposing
  // the full RLS-protected user table client-side.
  const { data, error } = await supabase
    .from('voucher_uses')
    .select('id, voucher_id, user_id, order_id, amount, used_at')
    .eq('voucher_id', voucherId)
    .order('used_at', { ascending: false })

  if (error) return { data: [], error: error.message }

  const rows = (data ?? []) as Array<{
    id: string; voucher_id: string; user_id: string | null;
    order_id: string | null; amount: number; used_at: string;
  }>

  // Resolve order numbers in one query.
  const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter((x): x is string => !!x)))
  const orderNumbers = new Map<string, string>()
  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number')
      .in('id', orderIds)
    for (const o of orders ?? []) orderNumbers.set((o as { id: string }).id, (o as { order_number: string }).order_number)
  }

  // Resolve emails (best-effort; admin RLS allows reading profiles).
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x)))
  const emails = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', userIds)
    for (const p of profiles ?? []) emails.set((p as { id: string }).id, (p as { email: string | null }).email ?? '')
  }

  return {
    data: rows.map((r) => ({
      id: r.id,
      voucherId: r.voucher_id,
      userId: r.user_id,
      userEmail: r.user_id ? (emails.get(r.user_id) ?? null) : null,
      orderId: r.order_id,
      orderNumber: r.order_id ? (orderNumbers.get(r.order_id) ?? null) : null,
      amount: r.amount,
      usedAt: r.used_at,
    })),
    error: null,
  }
}
