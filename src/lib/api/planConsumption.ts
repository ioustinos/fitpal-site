// WEC-836 — how many delivery-days a subscription has actually consumed.
//
// A subscription credits the customer's wallet; the customer then places
// orders paid FROM the wallet. Each wallet-paid, non-cancelled delivery day
// (a `child_orders` row) inside the plan's active window is one day "used".
// This is the intuitive "days ordered on the subscription" — the same number
// a human would get counting the customer's wallet orders by eye — and it is
// what both the «X/Y ημέρες» display and the €/day budget on the staff strip
// divide by.
//
// Count model (see WEC-836):
//   totalDays = round(plan_length_weeks × days_per_week)
//     plan_length_weeks is stored in weeks, and a "1 month" plan is 4.33, so
//     monthly×5 → 22, monthly×7 → 30, a 2-week×5 plan → 10, 3-month×5 → 65.
//   usedDays  = non-cancelled child_orders of this user's payment_method='wallet'
//     orders whose delivery_date falls inside [windowStart, windowEnd].
//   daysLeft  = max(0, totalDays − usedDays)
//
// Pure PostgREST read (embedded !inner filter on orders) — no RPC, no
// migration. Runs under whatever session is active: the customer's own JWT
// during impersonation / on their account tab (their RLS), the admin's in the
// admin panel (admin policies). Same function either way.

import { supabase } from '../supabase'

export interface PlanWindowInput {
  planLengthWeeks: number | null
  daysPerWeek: number | null
  /** The date the customer picked (wallet_plans.start_date). */
  startDate: string | null
  /** wallet_plans.active_until — the plan's own end date, when set. */
  activeUntil: string | null
  /** wallet_plans.created_at — last-ditch window start when start_date is null. */
  createdAt: string
}

export interface PlanConsumption {
  usedDays: number
  /** null when plan_length_weeks or days_per_week is unknown. */
  totalDays: number | null
  /** max(0, totalDays − usedDays); null when totalDays is null. */
  daysLeft: number | null
  /** The window actually counted, for display/debugging. */
  startIso: string
  endIso: string | null
}

/** round(weeks × days/week); null when either input is missing, 0 → null. */
export function planTotalDays(planLengthWeeks: number | null, daysPerWeek: number | null): number | null {
  if (planLengthWeeks == null || daysPerWeek == null) return null
  const t = Math.round(planLengthWeeks * daysPerWeek)
  return t > 0 ? t : null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

/**
 * Resolve the window [start, end] a plan's days are counted in.
 * start: plan.start_date, else the created_at calendar date.
 * end:   plan.active_until, else start + ceil(weeks × 7) days (so a plan with
 *        no active_until — legacy rows — is still bounded, never open-ended).
 */
export function planWindow(p: PlanWindowInput): { startIso: string; endIso: string | null } {
  const startIso = p.startDate ?? isoDate(new Date(p.createdAt))
  let endIso: string | null = p.activeUntil ?? null
  if (!endIso && p.planLengthWeeks != null) {
    endIso = addDays(startIso, Math.ceil(p.planLengthWeeks * 7))
  }
  return { startIso, endIso }
}

export async function fetchPlanConsumption(
  userId: string,
  plan: PlanWindowInput,
): Promise<{ data: PlanConsumption | null; error: string | null }> {
  const totalDays = planTotalDays(plan.planLengthWeeks, plan.daysPerWeek)
  const { startIso, endIso } = planWindow(plan)
  try {
    let q = supabase
      .from('child_orders')
      // !inner so the payment_method / user_id filters on the parent order
      // actually restrict the child rows (a left join would keep all of them).
      .select('id, orders!inner(user_id, payment_method)', { count: 'exact', head: true })
      .eq('orders.user_id', userId)
      .eq('orders.payment_method', 'wallet')
      .is('cancelled_at', null)
      .gte('delivery_date', startIso)
    if (endIso) q = q.lte('delivery_date', endIso)
    const { count, error } = await q
    if (error) return { data: null, error: error.message }
    const usedDays = count ?? 0
    return {
      data: {
        usedDays,
        totalDays,
        daysLeft: totalDays == null ? null : Math.max(0, totalDays - usedDays),
        startIso,
        endIso,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'consumption lookup failed' }
  }
}
