// WEC-546: shared identity normalizers for per-user voucher matching.
//
// These MUST stay in sync with the SQL used by the backfill + the
// redeem_voucher_for_order RPC (migrations wec546_*):
//   email  → lower(trim(...)), null if empty
//   phone  → digits only; GR E.164 (starts with '30', 12 digits) → last 10
//            digits (the national number); anything else → full digits.
//
// The phone rule collapses all GR representations (+30…, bare national) to the
// same 10-digit key while leaving foreign numbers as their full digit string
// so two different foreign numbers can't false-collide. Email is the primary
// matcher; phone is the backstop. Plus-aliases (x+1@gmail.com) count as a
// different email by design — not stripped.

export function normVoucherEmail(email?: string | null): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return e || null
}

export function normVoucherPhone(phone?: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (!d) return null
  return d.length === 12 && d.startsWith('30') ? d.slice(-10) : d
}
