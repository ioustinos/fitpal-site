/**
 * WEC-841..851 — data access for the /partner portal. Every call is a
 * SECURITY DEFINER RPC that checks the caller is a partner and may see the
 * client (migration wec846_partner_rpcs.sql). Nothing here reads tables
 * directly, so a partner can never widen what they see by editing a query.
 */
import { supabase } from '../lib/supabase'

/**
 * Admins can open the portal AS any partner. The chosen partner id travels as
 * the `x-partner-view` request header; the DB (current_partner_id) honours it
 * ONLY when the caller is an admin, and ignores it for everyone else.
 */
const VIEW_KEY = 'fitpal_partner_view_as'
export function getViewAs(): string | null {
  try { return sessionStorage.getItem(VIEW_KEY) } catch { return null }
}
export function setViewAs(id: string | null) {
  try { if (id) sessionStorage.setItem(VIEW_KEY, id); else sessionStorage.removeItem(VIEW_KEY) } catch { /* ignore */ }
}
function rpc(fn: string, args?: Record<string, unknown>) {
  const q = supabase.rpc(fn, args)
  const v = getViewAs()
  return v ? q.setHeader('x-partner-view', v) : q
}

export async function fetchAllPartnersForAdmin() {
  const { data, error } = await supabase.from('partners').select('id, name, is_internal, active').order('name')
  return { data: (data ?? []) as Array<{ id: string; name: string; is_internal: boolean; active: boolean }>, error: error?.message ?? null }
}

export interface MyPartner {
  id: string
  name: string
  is_internal: boolean
  features: { progress_tracking?: boolean; referral?: boolean; notifications?: boolean }
  default_commission_bps: number
  default_discount_bps: number
  referral_code: string | null
}

export interface ClientRow {
  userId: string
  name: string
  email: string | null
  phone: string | null
  linkId: string | null
  status: 'active' | 'pending' | null
  discountBps: number | null
  commissionBps: number | null
  consent: boolean | null
  linkedAt: string | null
  needsClientConfirm: boolean | null
  needsFitpalApproval: boolean | null
  lastOrderAt: string | null
  walletBalance: number | null
  planActiveUntil: string | null
}

export interface Macro { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }
export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface ClientDetail {
  userId: string
  link: { id: string; status: string; discountBps: number; commissionBps: number | null; consentAt: string | null; ownLink: boolean } | null
  bodyVisible: boolean
  profile: {
    name: string | null; email: string | null; phone: string | null
    sex: string | null; birthYear: number | null; heightCm: number | null; weightKg: number | null
    activityLevel: string | null; goal: string | null; dietaryNotes: string | null
  } | null
  targets: (Macro & { meals: Partial<Record<MealKey, Partial<Macro>>>; updatedAt: string }) | null
  userGoals: Record<string, unknown> | null
  addresses: Array<{ label: string; street: string; area: string | null; zip: string | null; isDefault: boolean }>
  wallet: { balance: number; active: boolean } | null
  plan: {
    id: string; dailyKcal: number | null; macroSplit: Record<string, number> | null; planLength: string | null
    startDate: string | null; activeUntil: string | null; paymentStatus: string; status: string | null; amount: number | null
    meals: Record<MealKey, boolean>; daysPerWeek: number | null
  } | null
  progressEnabled: boolean
  measurements: Array<{ id: string; measuredOn: string; weightKg: number | null; bodyFatPct: number | null; waistCm: number | null; extra: Record<string, unknown>; notes: string | null }> | null
}

export interface OrderDay {
  date: string; cancelled: boolean; fulfillment: string | null; pickupLocationId: string | null
  area: string | null; zip: string | null; street: string | null; timeFrom: string | null; timeTo: string | null
  zoneName: string | null
  totals: { kcal: number; protein: number; carbs: number; fat: number }
  items: Array<{ name: string; variant: string | null; qty: number; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; comment: string | null }> | null
}
export interface PartnerOrder {
  id: string; orderNumber: string; userId: string; clientName: string; status: string
  paymentMethod: string; paymentStatus: string; subtotal: number; total: number; partnerDiscount: number
  placedBy: string | null; firstDate: string | null
  target: Macro | null
  days: OrderDay[] | null
}

export interface CommissionLine {
  source_type: 'order' | 'wallet_plan'; source_id: string; client_user_id: string; client_name: string | null
  ref: string | null; occurred_at: string; gross: number; base: number; rate_bps: number; commission: number
  paid_out: number; outstanding: number; payment_method: string | null; payment_status: string | null; order_status: string | null
}

function msg(e: { message: string } | null): string | null { return e ? e.message : null }

export async function fetchMyPartner() {
  const { data, error } = await rpc('my_partner')
  return { data: (data as MyPartner | null) ?? null, error: msg(error) }
}
export async function fetchClients(search?: string) {
  const { data, error } = await rpc('partner_list_clients', { p_search: search ?? null })
  return { data: (data as ClientRow[] | null) ?? [], error: msg(error) }
}
export async function fetchClientDetail(userId: string) {
  const { data, error } = await rpc('partner_client_detail', { p_client: userId })
  return { data: (data as ClientDetail | null) ?? null, error: msg(error) }
}
export async function saveClient(userId: string, patch: { profile?: Record<string, unknown>; targets?: Record<string, unknown> }) {
  const { error } = await rpc('partner_update_client', { p_client: userId, p: patch })
  return { error: msg(error) }
}
export async function addMeasurement(userId: string, m: Record<string, unknown>) {
  const { error } = await rpc('partner_add_measurement', { p_client: userId, p: m })
  return { error: msg(error) }
}
export async function fetchOrders(clientId: string | null, from?: string | null, to?: string | null) {
  const { data, error } = await rpc('partner_orders', { p_client: clientId, p_from: from ?? null, p_to: to ?? null })
  return { data: (data as PartnerOrder[] | null) ?? [], error: msg(error) }
}
export async function fetchFinance(from?: string | null, to?: string | null) {
  const { data, error } = await rpc('partner_finance', { p_from: from ?? null, p_to: to ?? null })
  return { data: (data as CommissionLine[] | null) ?? [], error: msg(error) }
}

export async function createClientAccount(input: {
  email: string; name: string; phone: string
  address?: { street?: string; area?: string; zip?: string; floor?: string; doorbell?: string }
}): Promise<{ userId?: string; status?: string; existing?: boolean; message?: string; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { error: 'Not signed in' }
  const res = await fetch('/.netlify/functions/partner-create-client', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(getViewAs() ? { 'x-partner-view': getViewAs()! } : {}),
    },
    body: JSON.stringify(input),
  })
  let json: Record<string, unknown> = {}
  try { json = await res.json() } catch { /* empty body */ }
  if (!res.ok) return { error: (json.error as string) ?? `HTTP ${res.status}` }
  return json as { userId: string; status: string; existing: boolean; message?: string }
}

export const eur = (cents: number | null | undefined) =>
  `${((cents ?? 0) / 100).toFixed(2).replace('.', ',')} €`
export const pct = (bps: number | null | undefined) => {
  const v = (bps ?? 0) / 100
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`
}
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const DOW = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ']
/** Weekday from the DATE itself — never from a day's position in a list. */
export const dayLabel = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return `${DOW[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
