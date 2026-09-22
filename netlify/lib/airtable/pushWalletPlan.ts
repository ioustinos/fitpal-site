// WEC-810: mirror a subscription (wallet_plans row) into Airtable.
//
// Mirrors the shape of pushOrder.ts deliberately — same client, same upsert,
// same fail-loud contract — so there is one pattern to learn, not two.
//
// ⚠️ The Airtable client runs with `typecast: false`. A single-select value
// that is not already an option, or a field name that does not exist, returns
// 422 and throws, and the plan stays dirty. Every literal written below was
// read off Ioustinos's field screenshots on 21/09. If you add a value here,
// add the option in Airtable FIRST.

import type { SupabaseClient } from '@supabase/supabase-js'
import { TABLES } from './env'
import { upsertRecords, findRecordId, createRecord } from './client'
import { toEuros, esc } from './maps'

/**
 * Airtable dateTime fields reject Postgres's 6-digit microsecond timestamps
 * under typecast:false — normalise to millisecond ISO so they actually land.
 * (Same helper pushOrder.ts defines inline; NOT athensIso, which takes a
 * separate date + time and exists for delivery windows.)
 */
const isoMs = (v?: string | null): string | undefined =>
  v ? new Date(v).toISOString() : undefined

export interface PlanPushResult {
  ok: boolean
  planId: string
  skipped?: 'not_found' | 'not_eligible'
}

/** Airtable «Plan Length» options. */
const PLAN_LENGTH: Record<string, string> = {
  '2w': '2 εβδομάδες',
  '1mo': '1 μήνας',
  '3mo': '3 μήνες',
}

/** Airtable «Goal» options. Identical strings to the Klaviyo subscription
 *  email (wallet-plan-purchase.ts) so ops never sees two spellings. */
const GOAL: Record<string, string> = {
  lose: 'Απώλεια βάρους',
  maintain: 'Διατήρηση',
  gain: 'Αύξηση μυϊκής μάζας',
}

/** Airtable «Payment Method» options. */
const PAYMENT_METHOD: Record<string, string> = {
  cash: 'CASH',
  transfer: 'BANK_TRANSFER',
  card: 'CARD',
  link: 'Payment Link',
}

/** Airtable «Payment Status» options — note the Subscriptions table uses
 *  `Pending`, NOT the Orders table's `NO_PAYMENT`. Different table, different
 *  vocabulary; do not unify them without changing Airtable. */
const PAYMENT_STATUS: Record<string, string> = {
  paid: 'PAID',
  refunded: 'REFUNDED',
  failed: 'FAILED',
  pending: 'Pending',
  pending_link_sent: 'Pending',
}

/** WEC-811 Airtable «Status» single-select: subscription lifecycle. */
const PLAN_STATUS: Record<string, string> = {
  active: 'Active',
  cancelled: 'Cancelled',
}

/** Airtable «Invoice Type» options. */
const INVOICE_TYPE: Record<string, string> = {
  invoice: 'Τιμολόγιο',
  receipt: 'Απόδειξη',
}

/**
 * A plan is mirrored unless the purchase never happened.
 *
 * Ioustinos, 21/09: "όλα εκτός από failed". Deliberately INCLUDES pending —
 * cash and bank-transfer plans activate and start feeding the customer while
 * payment is still outstanding (WEC-758), so hiding them would hide exactly
 * the subscriptions ops needs to chase. Refunded rows stay too, carrying the
 * refunded amount, so a refund is visible rather than making the row vanish.
 */
export function isPlanMirrorEligible(p: { payment_status: string }): boolean {
  return p.payment_status !== 'failed'
}

async function findOrCreateCustomer(
  phone: string | null,
  name: string | null,
  email: string | null,
): Promise<string | null> {
  if (!phone) return null
  const existing = await findRecordId(TABLES.customers, `{Phone Number}='${esc(phone)}'`)
  if (existing) return existing
  return createRecord(TABLES.customers, {
    Name: name ?? '',
    'Phone Number': phone,
    Email: email ?? '',
    Source: 'Other',
  })
}

export async function pushWalletPlanToAirtable(
  supabase: SupabaseClient,
  planId: string,
): Promise<PlanPushResult> {
  // 1. Load the plan, the wallet it belongs to, and the owning profile.
  const { data: planRow, error: pErr } = await supabase
    .from('wallet_plans')
    .select(
      'id, wallet_id, created_at, confirmed_at, activated_at, plan_length, days_per_week, ' +
      'meal_breakfast, meal_lunch, meal_dinner, meal_snack, daily_kcal, goal, ' +
      'subtotal_cents, discount_cents, discount_pct, amount_to_pay_cents, ' +
      'wallet_credit_cents, bonus_pct, bonus_credits_cents, services, ' +
      'payment_method, payment_status, viva_order_code, viva_transaction_id, ' +
      'invoice_type, invoice_name, invoice_vat, refund_amount_cents, ' +
      'voucher_id, voucher_amount_cents, start_date, active_until, admin_note, status',
    )
    .eq('id', planId)
    .maybeSingle()
  if (pErr) throw new Error(`wallet_plans read failed: ${pErr.message}`)
  if (!planRow) return { ok: false, planId, skipped: 'not_found' }

  const plan = planRow as Record<string, any>
  if (!isPlanMirrorEligible({ payment_status: String(plan.payment_status) })) {
    return { ok: true, planId, skipped: 'not_eligible' }
  }

  // 2. Resolve the customer. wallet → user → profile. A plan always has a
  //    wallet, but be defensive: a missing profile must not sink the push.
  let custName: string | null = null
  let custEmail: string | null = null
  let custPhone: string | null = null
  if (plan.wallet_id) {
    const { data: w } = await supabase
      .from('wallets').select('user_id').eq('id', plan.wallet_id).maybeSingle()
    const userId = (w as { user_id?: string } | null)?.user_id
    if (userId) {
      const { data: prof } = await supabase
        .from('profiles').select('name, phone').eq('id', userId).maybeSingle()
      const p = prof as { name?: string; phone?: string } | null
      custName = p?.name ?? null
      custPhone = p?.phone ?? null
      // auth.users isn't reachable through PostgREST; the admin API is the
      // supported route and this runs service-role.
      try {
        const { data: u } = await supabase.auth.admin.getUserById(userId)
        custEmail = u?.user?.email ?? null
      } catch {
        /* email is nice-to-have, never worth failing the mirror for */
      }
    }
  }
  const custRecId = await findOrCreateCustomer(custPhone, custName, custEmail)

  // 3. Build the record. Field names are EXACT — see the warning at the top.
  const services = (plan.services ?? {}) as {
    dieticianManaged?: boolean; bodyFatMeasurement?: boolean; bodyFatFeeCents?: number
  }
  // «Meals» is a MULTIPLE SELECT, so it takes an array of option names — not a
  // comma-joined string. The first run sent a string and every one of the 49
  // plans came back 422 «Cannot parse value for field Meals», which blocked the
  // whole record: with typecast:false one bad field fails all 31.
  const meals = [
    plan.meal_breakfast && 'Πρωινό',
    plan.meal_lunch && 'Μεσημεριανό',
    plan.meal_dinner && 'Βραδινό',
    plan.meal_snack && 'Σνακ',
  ].filter(Boolean) as string[]

  const fields: Record<string, unknown> = {
    'Plan Id': plan.id,
    // Purchase moment: when the money was confirmed, else when the plan was
    // created. Same rule the customer's «Ημερομηνία αγοράς» uses.
    'Purchased At': isoMs(plan.confirmed_at ?? plan.created_at),
    'Customer Email': custEmail ?? '',
    'Customer Phone': custPhone ?? '',
    'Days / Week': plan.days_per_week ?? null,
    'Daily kcal': plan.daily_kcal ?? null,
    Subtotal: toEuros(plan.subtotal_cents),
    'Discount %': plan.discount_pct != null ? Number(plan.discount_pct) : null,
    Discount: toEuros(plan.discount_cents),
    'Amount Paid': toEuros(plan.amount_to_pay_cents),
    'Wallet Credit': toEuros(plan.wallet_credit_cents),
    'Bonus %': plan.bonus_pct ?? null,
    'Bonus Credit': toEuros(plan.bonus_credits_cents),
    'Dietician Managed': !!services.dieticianManaged,
    'Body Fat Measurement': !!services.bodyFatMeasurement,
    'Body Fat Fee': toEuros(services.bodyFatFeeCents ?? 0),
    'Activated At': isoMs(plan.activated_at),
    // WEC-783 ops fields. `start_date` / `active_until` are Postgres `date`
    // columns, so they arrive as plain YYYY-MM-DD and Airtable date fields
    // take them as-is — no timezone conversion, which is the point: these are
    // calendar days the customer picked, not instants.
    'Start Date': plan.start_date ?? null,
    'Valid Until': plan.active_until ?? null,
    'Admin Note': plan.admin_note ?? '',
    'Viva Order Code': plan.viva_order_code ?? '',
    'Viva Transaction Id': plan.viva_transaction_id ?? '',
    Επωνυμία: plan.invoice_name ?? '',
    ΑΦΜ: plan.invoice_vat ?? '',
    Refunded: toEuros(plan.refund_amount_cents ?? 0),
    'Voucher Amount': toEuros(plan.voucher_amount_cents ?? 0),
  }

  // Single-selects: only send a value we know is an option. An unmapped enum
  // would 422 the whole record, so silence beats guessing.
  const len = PLAN_LENGTH[String(plan.plan_length)]
  if (len) fields['Plan Length'] = len
  const goal = GOAL[String(plan.goal)]
  if (goal) fields.Goal = goal
  const pm = PAYMENT_METHOD[String(plan.payment_method)]
  if (pm) fields['Payment Method'] = pm
  const ps = PAYMENT_STATUS[String(plan.payment_status)]
  if (ps) fields['Payment Status'] = ps
  const st = PLAN_STATUS[String(plan.status ?? 'active')]
  if (st) fields['Status'] = st
  const inv = INVOICE_TYPE[String(plan.invoice_type)]
  if (inv) fields['Invoice Type'] = inv

  // Only send the multi-select when there is something to send: an empty array
  // is a legitimate value, but omitting it leaves any manual edit untouched.
  if (meals.length > 0) fields.Meals = meals

  if (custRecId) fields.Customer = [custRecId]

  // Voucher code, if one was redeemed. Separate read — cheap and optional.
  if (plan.voucher_id) {
    const { data: v } = await supabase
      .from('vouchers').select('code').eq('id', plan.voucher_id).maybeSingle()
    const code = (v as { code?: string } | null)?.code
    if (code) fields.Voucher = code
  }

  // 4. Upsert on Plan Id, then stamp the sync.
  await upsertRecords(TABLES.subscriptions, ['Plan Id'], [{ fields }])

  await supabase
    .from('wallet_plans')
    .update({ airtable_dirty: false, airtable_synced_at: new Date().toISOString() })
    .eq('id', planId)

  return { ok: true, planId }
}
