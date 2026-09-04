// WEC-688 — read-only view of a customer's diet plan.
//
// The dietitian builds a customer's meals against these numbers. Goal bars
// tell you "62% of protein"; this tells you WHY — 164cm / 55kg / female /
// light activity, goal lose, 1291 kcal, P25/C45/F30, and the per-meal split
// each dish has to land inside.
//
// Presentational only. Mounted from the impersonation strip and the admin
// customer profile (staff, Greek), and — WEC-702 — from the customer's own
// Συνδρομές tab, which is bilingual, so labels take a `lang` (default 'el' so
// the staff mounts are unchanged). No pricing is shown on any surface.

import type { PlanDetails } from '../../lib/api/planDetails'
import { mealLabel } from '../../lib/planMeals'

type Lang = 'el' | 'en'

const GOAL_LABEL: Record<Lang, Record<string, string>> = {
  el: { lose: 'Απώλεια βάρους', maintain: 'Διατήρηση', gain: 'Αύξηση μυϊκής μάζας' },
  en: { lose: 'Weight loss', maintain: 'Maintain', gain: 'Muscle gain' },
}
const ACTIVITY_LABEL: Record<Lang, Record<string, string>> = {
  el: { sedentary: 'Καθιστική', light: 'Ελαφριά', moderate: 'Μέτρια', active: 'Έντονη', very_active: 'Πολύ έντονη' },
  en: { sedentary: 'Sedentary', light: 'Light', moderate: 'Moderate', active: 'Active', very_active: 'Very active' },
}
const SEX_LABEL: Record<Lang, Record<string, string>> = {
  el: { male: 'Άνδρας', female: 'Γυναίκα' },
  en: { male: 'Male', female: 'Female' },
}
const LENGTH_LABEL: Record<Lang, Record<string, string>> = {
  el: { '2w': '2 εβδομάδες', '1mo': '1 μήνας', '3mo': '3 μήνες' },
  en: { '2w': '2 weeks', '1mo': '1 month', '3mo': '3 months' },
}

const T: Record<Lang, Record<string, string>> = {
  el: {
    plan: 'Πλάνο', goal: 'Στόχος', duration: 'Διάρκεια', daysPerWeek: 'Ημέρες / εβδομάδα',
    meals: 'Γεύματα', start: 'Έναρξη', services: 'Υπηρεσίες',
    dietician: 'Διαχείριση από διατροφολόγο', bodyFat: 'Λιπομέτρηση',
    characteristics: 'Χαρακτηριστικά', charNote: 'Όπως καταχωρήθηκαν κατά την αγορά του πλάνου.',
    sex: 'Φύλο', age: 'Ηλικία', height: 'Ύψος', weight: 'Βάρος', activity: 'Δραστηριότητα',
    dailyGoals: 'Ημερήσιοι στόχοι', calories: 'Θερμίδες', protein: 'Πρωτεΐνη', carbs: 'Υδατάνθρακας', fat: 'Λιπαρά',
    bandsNote: 'Εύρος στόχων στον λογαριασμό — υπολογίστηκε αυτόματα από το πλάνο (±5%).',
    bandsDisabled: ' Η παρακολούθηση στόχων είναι απενεργοποιημένη.',
    perMeal: 'Στόχοι ανά γεύμα', meal: 'Γεύμα',
    yrs: ' ετών',
  },
  en: {
    plan: 'Plan', goal: 'Goal', duration: 'Duration', daysPerWeek: 'Days / week',
    meals: 'Meals', start: 'Start', services: 'Services',
    dietician: 'Dietitian management', bodyFat: 'Body-fat measurement',
    characteristics: 'Characteristics', charNote: 'As entered when the plan was purchased.',
    sex: 'Sex', age: 'Age', height: 'Height', weight: 'Weight', activity: 'Activity',
    dailyGoals: 'Daily targets', calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat',
    bandsNote: 'Target ranges on your account — computed automatically from the plan (±5%).',
    bandsDisabled: ' Goal tracking is turned off.',
    perMeal: 'Per-meal targets', meal: 'Meal',
    yrs: ' yrs',
  },
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

export function PlanDetailsPanel({ plan, lang = 'el' }: { plan: PlanDetails; lang?: Lang }) {
  const { macroPct: pct, macroGrams: g, goalBands: gb } = plan
  const t = T[lang]
  const locale = lang === 'el' ? 'el-GR' : 'en-GB'

  const macroStr = (key: 'p' | 'c' | 'f') =>
    pct[key] == null ? '—' : `${pct[key]}%${g[key] != null ? ` · ${g[key]} g` : ''}`

  return (
    <div className="pdp">
      {/* ── Plan ────────────────────────────────────────────────── */}
      <section className="pdp-sec">
        <h4 className="pdp-h">{t.plan}</h4>
        <Row label={t.goal} value={dash(plan.goal ? GOAL_LABEL[lang][plan.goal] ?? plan.goal : null)} />
        <Row
          label={t.duration}
          value={dash(plan.planLength ? LENGTH_LABEL[lang][plan.planLength] ?? plan.planLength : null)}
        />
        <Row label={t.daysPerWeek} value={dash(plan.daysPerWeek)} />
        <Row
          label={t.meals}
          value={plan.meals.length ? plan.meals.map((m) => mealLabel(m, lang)).join(', ') : '—'}
        />
        <Row
          label={t.start}
          value={dash(
            plan.startDate
              ? new Date(plan.startDate + 'T00:00:00').toLocaleDateString(locale)
              : new Date(plan.createdAt).toLocaleDateString(locale),
          )}
        />
        {(plan.dieticianManaged || plan.bodyFatMeasurement) && (
          <Row
            label={t.services}
            value={[
              plan.dieticianManaged && t.dietician,
              plan.bodyFatMeasurement && t.bodyFat,
            ].filter(Boolean).join(' · ')}
          />
        )}
      </section>

      {/* ── Characteristics ─────────────────────────────────────── */}
      <section className="pdp-sec">
        <h4 className="pdp-h">{t.characteristics}</h4>
        <p className="pdp-note">{t.charNote}</p>
        <Row label={t.sex} value={dash(plan.sex ? SEX_LABEL[lang][plan.sex] ?? plan.sex : null)} />
        <Row label={t.age} value={dash(plan.age, t.yrs)} />
        <Row label={t.height} value={dash(plan.heightCm, ' cm')} />
        <Row label={t.weight} value={dash(plan.weightKg, ' kg')} />
        <Row
          label={t.activity}
          value={dash(plan.activityLevel ? ACTIVITY_LABEL[lang][plan.activityLevel] ?? plan.activityLevel : null)}
        />
      </section>

      {/* ── Daily targets ───────────────────────────────────────── */}
      <section className="pdp-sec">
        <h4 className="pdp-h">{t.dailyGoals}</h4>
        <Row label={t.calories} value={<strong>{dash(plan.dailyKcal, ' kcal')}</strong>} />
        <Row label={t.protein} value={macroStr('p')} />
        <Row label={t.carbs} value={macroStr('c')} />
        <Row label={t.fat} value={macroStr('f')} />

        {gb && (
          <>
            <p className="pdp-note pdp-note-top">
              {t.bandsNote}
              {!gb.enabled && t.bandsDisabled}
            </p>
            <Row label={t.calories} value={`${dash(gb.cal.min)} – ${dash(gb.cal.max)} kcal`} />
            <Row label={t.protein} value={`${dash(gb.protein.min)} – ${dash(gb.protein.max)} g`} />
            <Row label={t.carbs} value={`${dash(gb.carbs.min)} – ${dash(gb.carbs.max)} g`} />
            <Row label={t.fat} value={`${dash(gb.fat.min)} – ${dash(gb.fat.max)} g`} />
          </>
        )}
      </section>

      {/* ── Per meal ────────────────────────────────────────────── */}
      {plan.perMeal.length > 0 && (
        <section className="pdp-sec pdp-sec-wide">
          <h4 className="pdp-h">{t.perMeal}</h4>
          <table className="pdp-table">
            <thead>
              <tr>
                <th>{t.meal}</th>
                <th>kcal</th>
                <th>{lang === 'el' ? 'Πρωτ.' : 'Prot.'}</th>
                <th>{lang === 'el' ? 'Υδατ.' : 'Carbs'}</th>
                <th>{lang === 'el' ? 'Λιπ.' : 'Fat'}</th>
              </tr>
            </thead>
            <tbody>
              {plan.perMeal.map((m) => (
                <tr key={m.key}>
                  <td>{mealLabel(m.key, lang)}</td>
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
