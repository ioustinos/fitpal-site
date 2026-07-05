import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useImpersonationStore } from '../../store/useImpersonationStore'
import { supabase } from '../../lib/supabase'

/**
 * Persistent banner shown at the top of every page while an admin is
 * impersonating a customer. Click "Exit" to restore the admin's session
 * and return to /admin/users.
 *
 * The banner pushes the page content down by 36px via the body class
 * `is-impersonating` (set in this component, removed on unmount/exit).
 *
 * WEC-507: when the impersonated customer has an active wallet plan, show a
 * budget summary so staff can order within the plan. Data is fetched directly
 * for the customer (NOT from useAuthStore.user, which stays the ADMIN during
 * impersonation — see WEC-495). The active session's JWT is the customer's, so
 * these `wallets` / `wallet_plans` / `meal_services` reads run under the
 * customer's own RLS.
 */

interface PlanSummary {
  costEur: number
  endStr: string
  workingDaysLeft: number
  dailyLimitEur: number
  spentEur: number
  remainingEur: number
  overPace: boolean
  meals: string
}

/** Count Mon–Fri days in [from, to] inclusive (the delivery-days model). */
function countWeekdays(from: Date, to: Date): number {
  const d = new Date(from); d.setHours(0, 0, 0, 0)
  const end = new Date(to); end.setHours(0, 0, 0, 0)
  if (end < d) return 0
  let n = 0
  while (d <= end) {
    const wd = d.getDay()
    if (wd >= 1 && wd <= 5) n++
    d.setDate(d.getDate() + 1)
  }
  return n
}

function fmtDayMonth(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

const eur = (n: number) => `€${n.toFixed(2)}`

export function ImpersonationBanner() {
  const active = useImpersonationStore((s) => s.active)
  const target = useImpersonationStore((s) => s.target)
  const loading = useImpersonationStore((s) => s.loading)
  const stop = useImpersonationStore((s) => s.stop)
  const navigate = useNavigate()

  const [summary, setSummary] = useState<PlanSummary | null>(null)

  // Only flip the body class when we'd actually render the banner. Without
  // the `target` guard we can end up with the page padded down 36px while
  // the banner is invisible — the symptom of stale persisted state.
  const shouldShow = active && !!target
  const targetUserId = target?.userId

  useEffect(() => {
    if (shouldShow) {
      document.body.classList.add('is-impersonating')
    } else {
      document.body.classList.remove('is-impersonating')
    }
    return () => { document.body.classList.remove('is-impersonating') }
  }, [shouldShow])

  // WEC-507: fetch the impersonated customer's active-plan budget summary.
  useEffect(() => {
    if (!shouldShow || !targetUserId) { setSummary(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance, active_plan_id')
          .eq('user_id', targetUserId)
          .maybeSingle()
        if (cancelled) return
        const w = wallet as { balance: number | null; active_plan_id: string | null } | null
        if (!w?.active_plan_id) { setSummary(null); return }

        const { data: planRow } = await supabase
          .from('wallet_plans')
          .select('amount_to_pay_cents, wallet_credit_cents, meal_breakfast, meal_lunch, meal_dinner, plan_length_weeks, created_at')
          .eq('id', w.active_plan_id)
          .maybeSingle()
        if (cancelled || !planRow) { setSummary(null); return }
        const plan = planRow as {
          amount_to_pay_cents: number | null; wallet_credit_cents: number | null
          meal_breakfast: boolean | null; meal_lunch: boolean | null; meal_dinner: boolean | null
          plan_length_weeks: number | null; created_at: string
        }

        // Prefer meal_services dates for the period; fall back to plan
        // created_at + plan_length_weeks when no service row is readable.
        const { data: svcRow } = await supabase
          .from('meal_services')
          .select('start_date, end_date')
          .eq('user_id', targetUserId)
          .eq('active', true)
          .order('start_date', { ascending: false })
          .maybeSingle()
        if (cancelled) return
        const svc = svcRow as { start_date: string | null; end_date: string | null } | null

        const start = svc?.start_date ? new Date(svc.start_date + 'T00:00:00') : new Date(plan.created_at)
        const weeks = plan.plan_length_weeks ?? 4
        const end = svc?.end_date
          ? new Date(svc.end_date + 'T00:00:00')
          : new Date(start.getTime() + weeks * 7 * 86_400_000)
        const today = new Date()
        const clampedToday = today < end ? today : end

        const creditedTotal = (plan.wallet_credit_cents ?? 0) / 100
        const remaining = (w.balance ?? 0) / 100
        const spent = Math.max(0, creditedTotal - remaining)

        const totalWD = countWeekdays(start, end)
        const elapsedWD = countWeekdays(start, clampedToday)
        const remainingWD = Math.max(0, totalWD - elapsedWD)

        const evenPace = totalWD > 0 ? creditedTotal / totalWD : 0
        const actualPace = elapsedWD > 0 ? spent / elapsedWD : 0
        const dailyLimit = remainingWD > 0 ? remaining / remainingWD : remaining
        const overPace = evenPace > 0 && actualPace > evenPace * 1.10

        const meals = [
          plan.meal_breakfast && 'Breakfast',
          plan.meal_lunch && 'Lunch',
          plan.meal_dinner && 'Dinner',
        ].filter(Boolean).join(', ')

        setSummary({
          costEur: (plan.amount_to_pay_cents ?? 0) / 100,
          endStr: fmtDayMonth(end),
          workingDaysLeft: remainingWD,
          dailyLimitEur: dailyLimit,
          spentEur: spent,
          remainingEur: remaining,
          overPace,
          meals,
        })
      } catch {
        if (!cancelled) setSummary(null)
      }
    })()
    return () => { cancelled = true }
  }, [shouldShow, targetUserId])

  if (!shouldShow || !target) return null

  async function handleExit() {
    // stop() signs the customer out via supabase.auth.signOut(). The admin
    // lands on the customer site as a guest, then navigates to /admin to
    // sign back in. This is the deliberate convention — no session
    // restoration, no stale-token edge cases.
    await stop()
    navigate('/admin')
  }

  const chip: React.CSSProperties = {
    background: 'rgba(255,255,255,0.18)', borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap',
  }

  return (
    <div className="impersonation-banner" role="status" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1" />
      </svg>
      <span>
        Impersonating <strong>{target.name || target.email}</strong>
      </span>

      {/* WEC-507: plan budget summary (only when the customer has an active plan) */}
      {summary && (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 600 }}>
          <span style={chip}>Plan {eur(summary.costEur)}</span>
          <span style={chip}>Ends {summary.endStr} · {summary.workingDaysLeft}d left</span>
          <span
            style={{
              ...chip,
              background: summary.overPace ? '#dc2626' : 'rgba(255,255,255,0.18)',
              color: '#fff',
            }}
            title={summary.overPace ? 'Spending above the even Mon–Fri pace (>10% over)' : 'Average allowed spend per remaining working day'}
          >
            {eur(summary.dailyLimitEur)}/day{summary.overPace ? ' ⚠' : ''}
          </span>
          <span style={chip}>Left {eur(summary.remainingEur)} · Spent {eur(summary.spentEur)}</span>
          {summary.meals && <span style={chip}>{summary.meals}</span>}
        </span>
      )}

      <button onClick={handleExit} disabled={loading}>
        {loading ? 'Exiting…' : 'Exit & sign back in'}
      </button>
    </div>
  )
}
