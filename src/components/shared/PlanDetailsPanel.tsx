// WEC-688 — read-only view of a customer's diet plan, for staff.
//
// The dietitian builds a customer's meals against these numbers. Goal bars
// tell you "62% of protein"; this tells you WHY — 164cm / 55kg / female /
// light activity, goal lose, 1291 kcal, P25/C45/F30, and the per-meal split
// each dish has to land inside.
//
// Presentational only. Mounted from the impersonation strip today; the same
// component is the intended renderer for the admin customer profile
// (WEC-684) so the two can never drift.

import type { PlanDetails } from '../../lib/api/planDetails'
import { mealLabel } from '../../lib/planMeals'

const GOAL_LABEL: Record<string, string> = {
  lose: 'Απώλεια βάρους',
  maintain: 'Διατήρηση',
  gain: 'Αύξηση μυϊκής μάζας',
}

const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: 'Καθιστική',
  light: 'Ελαφριά',
  moderate: 'Μέτρια',
  active: 'Έντονη',
  very_active: 'Πολύ έντονη',
}

const SEX_LABEL: Record<string, string> = {
  male: 'Άνδρας',
  female: 'Γυναίκα',
}

const LENGTH_LABEL: Record<string, string> = {
  '2w': '2 εβδομάδες',
  '1mo': '1 μήνας',
  '3mo': '3 μήνες',
}

function dash(v: string | number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined || v === '') return '—'
  return `${v}${suffix}`
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="pdp-row">
      <span className="pdp-row-k">{label}</span>
      <span className="pdp-row-v">{value}</span>
    </div>
  )
}

export function PlanDetailsPanel({ plan }: { plan: PlanDetails }) {
  const { macroPct: pct, macroGrams: g, goalBands: gb } = plan

  const macroStr = (key: 'p' | 'c' | 'f') =>
    pct[key] == null ? '—' : `${pct[key]}%${g[key] != null ? ` · ${g[key]} g` : ''}`

  return (
    <div className="pdp">
      {/* ── Πλάνο ───────────────────────────────────────────────── */}
      <section className="pdp-sec">
        <h4 className="pdp-h">Πλάνο</h4>
        <Row label="Στόχος" value={dash(plan.goal ? GOAL_LABEL[plan.goal] ?? plan.goal : null)} />
        <Row
          label="Διάρκεια"
          value={dash(plan.planLength ? LENGTH_LABEL[plan.planLength] ?? plan.planLength : null)}
        />
        <Row label="Ημέρες / εβδομάδα" value={dash(plan.daysPerWeek)} />
        <Row
          label="Γεύματα"
          value={
            plan.meals.length
              ? plan.meals.map((m) => mealLabel(m, 'el')).join(', ')
              : '—'
          }
        />
        <Row
          label="Έναρξη"
          value={dash(
            plan.startDate
              ? new Date(plan.startDate + 'T00:00:00').toLocaleDateString('el-GR')
              : new Date(plan.createdAt).toLocaleDateString('el-GR'),
          )}
        />
        {(plan.dieticianManaged || plan.bodyFatMeasurement) && (
          <Row
            label="Υπηρεσίες"
            value={[
              plan.dieticianManaged && 'Διαχείριση από διατροφολόγο',
              plan.bodyFatMeasurement && 'Λιπομέτρηση',
            ].filter(Boolean).join(' · ')}
          />
        )}
      </section>

      {/* ── Χαρακτηριστικά ──────────────────────────────────────── */}
      <section className="pdp-sec">
        <h4 className="pdp-h">Χαρακτηριστικά</h4>
        <p className="pdp-note">Όπως καταχωρήθηκαν κατά την αγορά του πλάνου.</p>
        <Row label="Φύλο" value={dash(plan.sex ? SEX_LABEL[plan.sex] ?? plan.sex : null)} />
        <Row label="Ηλικία" value={dash(plan.age, ' ετών')} />
        <Row label="Ύψος" value={dash(plan.heightCm, ' cm')} />
        <Row label="Βάρος" value={dash(plan.weightKg, ' kg')} />
        <Row
          label="Δραστηριότητα"
          value={dash(plan.activityLevel ? ACTIVITY_LABEL[plan.activityLevel] ?? plan.activityLevel : null)}
        />
      </section>

      {/* ── Στόχοι ──────────────────────────────────────────────── */}
      <section className="pdp-sec">
        <h4 className="pdp-h">Ημερήσιοι στόχοι</h4>
        <Row label="Θερμίδες" value={<strong>{dash(plan.dailyKcal, ' kcal')}</strong>} />
        <Row label="Πρωτεΐνη" value={macroStr('p')} />
        <Row label="Υδατάνθρακας" value={macroStr('c')} />
        <Row label="Λιπαρά" value={macroStr('f')} />

        {gb && (
          <>
            <p className="pdp-note pdp-note-top">
              Εύρος στόχων στον λογαριασμό — υπολογίστηκε αυτόματα από το πλάνο (±5%).
              {!gb.enabled && ' Η παρακολούθηση στόχων είναι απενεργοποιημένη.'}
            </p>
            <Row label="Θερμίδες" value={`${dash(gb.cal.min)} – ${dash(gb.cal.max)} kcal`} />
            <Row label="Πρωτεΐνη" value={`${dash(gb.protein.min)} – ${dash(gb.protein.max)} g`} />
            <Row label="Υδατάνθρακας" value={`${dash(gb.carbs.min)} – ${dash(gb.carbs.max)} g`} />
            <Row label="Λιπαρά" value={`${dash(gb.fat.min)} – ${dash(gb.fat.max)} g`} />
          </>
        )}
      </section>

      {/* ── Ανά γεύμα ───────────────────────────────────────────── */}
      {plan.perMeal.length > 0 && (
        <section className="pdp-sec pdp-sec-wide">
          <h4 className="pdp-h">Στόχοι ανά γεύμα</h4>
          <table className="pdp-table">
            <thead>
              <tr>
                <th>Γεύμα</th>
                <th>kcal</th>
                <th>Πρωτ.</th>
                <th>Υδατ.</th>
                <th>Λιπ.</th>
              </tr>
            </thead>
            <tbody>
              {plan.perMeal.map((m) => (
                <tr key={m.key}>
                  <td>{mealLabel(m.key, 'el')}</td>
                  <td><strong>{m.kcal}</strong></td>
                  <td>{m.protein} g</td>
                  <td>{m.carbs} g</td>
                  <td>{m.fat} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
