import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useImpersonationStore } from '../../store/useImpersonationStore'
import { supabase } from '../../lib/supabase'
import { fetchActivePlanDetails, type PlanDetails } from '../../lib/api/planDetails'
import { PlanDetailsPanel } from '../shared/PlanDetailsPanel'
import { planMealsLabel } from '../../lib/planMeals'

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
  baseEur: number
  bonusEur: number
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

const eur = (n: number) => `${n.toFixed(2)} €`

export function ImpersonationBanner() {
  const active = useImpersonationStore((s) => s.active)
  const target = useImpersonationStore((s) => s.target)
  const loading = useImpersonationStore((s) => s.loading)
  const stop = useImpersonationStore((s) => s.stop)
  const navigate = useNavigate()

  const [summary, setSummary] = useState<PlanSummary | null>(null)

  // WEC-688: full plan details behind a «Στόχοι / Πλάνο» button. Loaded
  // lazily on first open — the strip renders on every page and most of the
  // time nobody opens this, so there's no reason to pay for it up front.
  const [planOpen, setPlanOpen] = useState(false)
  const [plan, setPlan] = useState<PlanDetails | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planErr, setPlanErr] = useState<string | null>(null)

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
          .select('wallet_credit_cents, bonus_credits_cents, meal_breakfast, meal_lunch, meal_dinner, meal_snack, plan_length_weeks, created_at')
          .eq('id', w.active_plan_id)
          .maybeSingle()
        if (cancelled || !planRow) { setSummary(null); return }
        const plan = planRow as {
          wallet_credit_cents: number | null; bonus_credits_cents: number | null
          meal_breakfast: boolean | null; meal_lunch: boolean | null; meal_dinner: boolean | null
          meal_snack: boolean | null
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
        const bonus = (plan.bonus_credits_cents ?? 0) / 100
        // Base = credited total minus the bonus portion, so base + bonus always
        // equals the total the Left/Spent math below runs on (creditedTotal).
        const base = Math.max(0, creditedTotal - bonus)
        const remaining = (w.balance ?? 0) / 100
        const spent = Math.max(0, creditedTotal - remaining)

        const totalWD = countWeekdays(start, end)
        const elapsedWD = countWeekdays(start, clampedToday)
        const remainingWD = Math.max(0, totalWD - elapsedWD)

        const evenPace = totalWD > 0 ? creditedTotal / totalWD : 0
        const actualPace = elapsedWD > 0 ? spent / elapsedWD : 0
        const dailyLimit = remainingWD > 0 ? remaining / remainingWD : remaining
        const overPace = evenPace > 0 && actualPace > evenPace * 1.10

        // WEC-686: was a hand-rolled three-item list that predated
        // `meal_snack`, so a customer who paid for a snack never saw it here.
        const meals = planMealsLabel(plan, 'el')

        setSummary({
          baseEur: base,
          bonusEur: bonus,
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

  // Drop any loaded plan when the impersonation target changes, so the popup
  // can never show the previous customer's numbers.
  useEffect(() => {
    setPlan(null); setPlanErr(null); setPlanOpen(false)
  }, [targetUserId])

  // Esc closes the popup — it covers the page, so it needs a keyboard exit.
  useEffect(() => {
    if (!planOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlanOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [planOpen])

  if (!shouldShow || !target) return null

  async function openPlan() {
    setPlanOpen(true)
    if (plan || planLoading || !targetUserId) return
    setPlanLoading(true); setPlanErr(null)
    const { data, error } = await fetchActivePlanDetails(targetUserId)
    setPlanLoading(false)
    if (error) { setPlanErr(error); return }
    if (!data) { setPlanErr('Ο πελάτης δεν έχει ενεργό πλάνο.'); return }
    setPlan(data)
  }

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
          <span style={chip} title="Plan base credit + bonus credit">
            Plan {eur(summary.baseEur)}{summary.bonusEur > 0 ? ` + ${eur(summary.bonusEur)} bonus` : ''}
          </span>
          <span style={chip}>Left {eur(summary.remainingEur)} · Spent {eur(summary.spentEur)}</span>
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
          {summary.meals && <span style={chip}>{summary.meals}</span>}
        </span>
      )}

      {/* WEC-688: the numbers a dietitian builds meals against. Shown whenever
          the customer has an active plan — `summary` is only set in that case,
          so it doubles as the has-a-plan check and we never open an empty
          popup. */}
      {summary && (
        <button
          className="imp-plan-btn"
          onClick={openPlan}
          title="Στοιχεία πλάνου και ημερήσιοι στόχοι"
        >
          Στόχοι / Πλάνο
        </button>
      )}

      <button onClick={handleExit} disabled={loading}>
        {loading ? 'Exiting…' : 'Exit & sign back in'}
      </button>

      {planOpen && (
        <div className="imp-plan-overlay" onClick={() => setPlanOpen(false)}>
          <div
            className="imp-plan-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Στοιχεία πλάνου"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="imp-plan-head">
              <div>
                <h3>Στόχοι / Πλάνο</h3>
                <p>{target.name || target.email}</p>
              </div>
              <button className="imp-plan-close" onClick={() => setPlanOpen(false)} aria-label="Κλείσιμο">×</button>
            </header>
            <div className="imp-plan-body">
              {planLoading && <p className="imp-plan-msg">Φόρτωση…</p>}
              {planErr && <p className="imp-plan-msg imp-plan-msg-err">{planErr}</p>}
              {plan && <PlanDetailsPanel plan={plan} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
