import { supabase } from '../supabase'

export interface DashboardStats {
  todayOrdersCount: number
  pendingOrdersCount: number
  activeMenuName: string | null
  activeMenuRange: { from: string; to: string } | null
  activeDishesCount: number
  nextPublishedMenuName: string | null
  nextPublishedMenuRange: { from: string; to: string } | null
}

/** WEC-174b — last run of the viva-reconcile scheduled function. */
export interface ReconcileSummary {
  runAt: string
  ageSeconds: number
  checked: number
  /** >0 = webhook missed something; treat as canary. */
  paidRescued: number
  failed: number
  stillPending: number
  cancelledTimeout: number
  errors: number
  durationMs: number | null
  notes: string | null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function fetchDashboardStats(): Promise<{ data: DashboardStats | null; error: string | null }> {
  const today = todayIso()

  const [todayCntRes, pendingCntRes, activeMenuRes, dishesCntRes, upcomingMenuRes] = await Promise.all([
    // child_orders where delivery_date = today
    supabase
      .from('child_orders')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_date', today),
    // orders where status = 'pending' OR payment_status = 'pending'
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .or('status.eq.pending,payment_status.eq.pending'),
    // Active weekly menu that covers today
    supabase
      .from('weekly_menus')
      .select('name, from_date, to_date')
      .eq('active', true)
      .lte('from_date', today)
      .gte('to_date', today)
      .limit(1)
      .maybeSingle(),
    // Active dishes count
    supabase
      .from('dishes')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    // Next published menu starting after today
    supabase
      .from('weekly_menus')
      .select('name, from_date, to_date')
      .eq('active', true)
      .gt('from_date', today)
      .order('from_date')
      .limit(1)
      .maybeSingle(),
  ])

  if (todayCntRes.error) return { data: null, error: todayCntRes.error.message }
  if (pendingCntRes.error) return { data: null, error: pendingCntRes.error.message }
  if (activeMenuRes.error) return { data: null, error: activeMenuRes.error.message }
  if (dishesCntRes.error) return { data: null, error: dishesCntRes.error.message }

  const activeMenu = activeMenuRes.data as { name: string | null; from_date: string; to_date: string } | null
  const upcoming = upcomingMenuRes.data as { name: string | null; from_date: string; to_date: string } | null

  return {
    data: {
      todayOrdersCount: todayCntRes.count ?? 0,
      pendingOrdersCount: pendingCntRes.count ?? 0,
      activeMenuName: activeMenu?.name ?? (activeMenu ? `${activeMenu.from_date} — ${activeMenu.to_date}` : null),
      activeMenuRange: activeMenu ? { from: activeMenu.from_date, to: activeMenu.to_date } : null,
      activeDishesCount: dishesCntRes.count ?? 0,
      nextPublishedMenuName: upcoming?.name ?? (upcoming ? `${upcoming.from_date} — ${upcoming.to_date}` : null),
      nextPublishedMenuRange: upcoming ? { from: upcoming.from_date, to: upcoming.to_date } : null,
    },
    error: null,
  }
}

/**
 * WEC-174b — fetch the most recent viva-reconcile run for the /admin dashboard
 * health card. Silently returns null if the table is empty or RLS denies.
 */
export async function fetchLatestReconcileRun(): Promise<{ data: ReconcileSummary | null; error: string | null }> {
  const { data, error } = await supabase
    .from('reconcile_runs')
    .select('run_at, checked, paid, failed, still_pending, cancelled_timeout, errors, duration_ms, notes')
    .eq('provider', 'viva')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: null }

  const row = data as {
    run_at: string
    checked: number
    paid: number
    failed: number
    still_pending: number
    cancelled_timeout: number
    errors: number
    duration_ms: number | null
    notes: string | null
  }

  return {
    data: {
      runAt: row.run_at,
      ageSeconds: Math.max(0, Math.floor((Date.now() - new Date(row.run_at).getTime()) / 1000)),
      checked: row.checked,
      paidRescued: row.paid,
      failed: row.failed,
      stillPending: row.still_pending,
      cancelledTimeout: row.cancelled_timeout,
      errors: row.errors,
      durationMs: row.duration_ms,
      notes: row.notes,
    },
    error: null,
  }
}
