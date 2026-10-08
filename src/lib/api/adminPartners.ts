/**
 * WEC-840 / WEC-848 — admin access to dietitian partners. Direct Supabase
 * client + admin_all_* RLS (the project's admin pattern, see
 * feedback_admin_writes_rls). Money lines come from the admin_partner_* RPCs.
 */
import { supabase } from '../supabase'

export interface AdminPartner {
  id: string
  name: string
  legal_name: string | null
  vat_number: string | null
  tax_office: string | null
  address: string | null
  email: string | null
  phone: string | null
  iban: string | null
  default_commission_bps: number
  default_discount_bps: number
  is_internal: boolean
  active: boolean
  features: { progress_tracking?: boolean; referral?: boolean; notifications?: boolean }
  referral_code: string | null
  agreement_date: string | null
  notes: string | null
  created_at: string
}

export interface PartnerBalance {
  partnerId: string; commission: number; paidOut: number; outstanding: number; activeClients: number; pendingClients: number
}

export interface AdminPartnerUser { id: string; user_id: string; role: string; email: string | null; name: string | null }

export interface AdminPartnerClient {
  id: string
  client_user_id: string
  status: 'active' | 'pending' | 'inactive'
  discount_bps: number
  commission_bps: number
  created_via: string
  client_confirmed_at: string | null
  approved_at: string | null
  consent_at: string | null
  created_at: string
  name: string | null
  email: string | null
}

export interface AdminPayout { id: string; amount: number; paid_at: string; reference: string | null; note: string | null }

const m = (e: { message: string } | null) => (e ? e.message : null)

export async function fetchPartners() {
  const [{ data, error }, bal] = await Promise.all([
    supabase.from('partners').select('*').order('name'),
    supabase.rpc('admin_partner_balances'),
  ])
  return {
    data: (data ?? []) as AdminPartner[],
    balances: ((bal.data ?? []) as PartnerBalance[]),
    error: m(error) ?? m(bal.error),
  }
}

export async function savePartner(p: Partial<AdminPartner> & { id?: string }) {
  const { id, created_at: _c, ...rest } = p
  void _c
  if (rest.referral_code === '') rest.referral_code = null
  if (id) {
    const { data, error } = await supabase.from('partners').update(rest).eq('id', id).select('*').single()
    return { data: data as AdminPartner | null, error: m(error) }
  }
  const { data, error } = await supabase.from('partners').insert(rest).select('*').single()
  return { data: data as AdminPartner | null, error: m(error) }
}

/** profiles has the email; resolve the user's id by it. */
async function userIdByEmail(email: string): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
  if (error) return { id: null, error: error.message }
  return { id: (data as { id: string } | null)?.id ?? null, error: null }
}

export async function fetchPartnerUsers(partnerId: string) {
  const { data, error } = await supabase.from('partner_users').select('id, user_id, role').eq('partner_id', partnerId)
  const rows = (data ?? []) as Array<{ id: string; user_id: string; role: string }>
  // partner_users.user_id → auth.users (not profiles): resolve in a second query.
  const ids = rows.map((r) => r.user_id)
  const { data: profs } = ids.length
    ? await supabase.from('profiles').select('id, email, name').in('id', ids)
    : { data: [] as Array<{ id: string; email: string | null; name: string | null }> }
  const pm = new Map((profs ?? []).map((p) => [(p as { id: string }).id, p as { email: string | null; name: string | null }]))
  return { data: rows.map((r) => ({ ...r, email: pm.get(r.user_id)?.email ?? null, name: pm.get(r.user_id)?.name ?? null })) as AdminPartnerUser[], error: m(error) }
}

export async function addPartnerUser(partnerId: string, email: string) {
  const { id, error } = await userIdByEmail(email)
  if (error) return { error }
  if (!id) return { error: 'Δεν υπάρχει λογαριασμός με αυτό το email. Ο διαιτολόγος πρέπει πρώτα να συνδεθεί μία φορά στο site (ή δημιουργήστε τον από Users).' }
  const { error: e2 } = await supabase.from('partner_users').insert({ partner_id: partnerId, user_id: id, role: 'owner' })
  return { error: e2 ? (e2.code === '23505' ? 'Αυτός ο λογαριασμός ανήκει ήδη σε διαιτολόγο.' : e2.message) : null }
}

export async function fetchPartnerClients(partnerId: string) {
  const { data, error } = await supabase
    .from('partner_clients')
    .select('id, client_user_id, status, discount_bps, commission_bps, created_via, client_confirmed_at, approved_at, consent_at, created_at')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
  const rows = (data ?? []) as Omit<AdminPartnerClient, 'name' | 'email'>[]
  const ids = rows.map((r) => r.client_user_id)
  const { data: profs } = ids.length
    ? await supabase.from('profiles').select('id, email, name').in('id', ids)
    : { data: [] as Array<{ id: string; email: string | null; name: string | null }> }
  const pm = new Map((profs ?? []).map((p) => [(p as { id: string }).id, p as { email: string | null; name: string | null }]))
  return {
    data: rows.map((r) => ({ ...r, name: pm.get(r.client_user_id)?.name ?? null, email: pm.get(r.client_user_id)?.email ?? null })) as AdminPartnerClient[],
    error: m(error),
  }
}

/** 🟢 Only Fitpal edits the split. History is kept by a DB trigger. */
export async function updateClientTerms(linkId: string, patch: { discount_bps?: number; commission_bps?: number; status?: string }) {
  const { error } = await supabase.from('partner_clients').update(patch).eq('id', linkId)
  return { error: m(error) }
}

export async function approveLink(linkId: string) {
  const { data, error } = await supabase.rpc('admin_approve_partner_link', { p_link: linkId })
  return { status: data as string | null, error: m(error) }
}

/** Admin links an existing customer directly (active, Fitpal-approved). */
export async function adminLinkClient(partner: AdminPartner, email: string) {
  const { id, error } = await userIdByEmail(email)
  if (error) return { error }
  if (!id) return { error: 'Δεν υπάρχει πελάτης με αυτό το email.' }
  const now = new Date().toISOString()
  const { error: e2 } = await supabase.from('partner_clients').insert({
    partner_id: partner.id, client_user_id: id, status: 'active', created_via: 'admin',
    discount_bps: partner.default_discount_bps, commission_bps: partner.is_internal ? 0 : partner.default_commission_bps,
    client_confirmed_at: now, approved_at: now,
  })
  return { error: e2 ? (e2.code === '23505' ? 'Ο πελάτης είναι ήδη συνδεδεμένος με διαιτολόγο.' : e2.message) : null }
}

export interface AdminCommissionLine {
  source_type: 'order' | 'wallet_plan'; source_id: string; client_user_id: string; client_name: string | null; ref: string | null
  occurred_at: string; gross: number; base: number; rate_bps: number; commission: number; paid_out: number; outstanding: number
  payment_method: string | null; payment_status: string | null; order_status: string | null
}

export async function fetchPartnerLines(partnerId: string, from?: string | null, to?: string | null) {
  const { data, error } = await supabase.rpc('admin_partner_finance', { p_partner: partnerId, p_from: from ?? null, p_to: to ?? null })
  return { data: (data ?? []) as AdminCommissionLine[], error: m(error) }
}

export async function markPaid(partnerId: string, lines: Array<{ source_type: string; source_id: string }>, reference: string, note: string) {
  const { data, error } = await supabase.rpc('admin_partner_mark_paid', {
    p_partner: partnerId, p_lines: lines, p_reference: reference || null, p_note: note || null,
  })
  return { payoutId: data as string | null, error: m(error) }
}

export async function fetchPayouts(partnerId: string) {
  const { data, error } = await supabase.from('partner_payouts').select('id, amount, paid_at, reference, note')
    .eq('partner_id', partnerId).order('paid_at', { ascending: false })
  return { data: (data ?? []) as AdminPayout[], error: m(error) }
}
