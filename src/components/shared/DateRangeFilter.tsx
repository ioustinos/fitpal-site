import { useUIStore } from '../../store/useUIStore'
import type { RangePreset } from '../../lib/dateRange'

/**
 * Date-range pill bar (WEC-168 / WEC-169).
 *
 * Presets: This week, Last week, This month, Last month, Custom. When
 * "Custom" is active, two `<input type="date">` fields appear for from/to
 * (both optional — omitted end = open-ended on that side).
 *
 * This is a controlled component: the parent owns `preset`, `from`, `to`
 * and passes setters. All filtering logic lives in `src/lib/dateRange.ts`
 * so the orders list and goals history stay in sync.
 */
export interface DateRangeFilterProps {
  preset: RangePreset
  from: string
  to: string
  onPresetChange: (p: RangePreset) => void
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  /** Optional small helper text rendered after the pills (e.g. "12 orders"). */
  summary?: string
}

const PRESETS: Array<{ id: RangePreset; el: string; en: string }> = [
  { id: 'this_week',  el: 'Αυτή η εβδομάδα',    en: 'This week' },
  { id: 'last_week',  el: 'Περασμένη εβδομάδα', en: 'Last week' },
  { id: 'this_month', el: 'Αυτός ο μήνας',      en: 'This month' },
  { id: 'last_month', el: 'Περασμένος μήνας',   en: 'Last month' },
  { id: 'custom',     el: 'Προσαρμογή',         en: 'Custom' },
]

export function DateRangeFilter({
  preset, from, to, onPresetChange, onFromChange, onToChange, summary,
}: DateRangeFilterProps) {
  const lang = useUIStore((s) => s.lang)

  return (
    <div className="date-range-filter">
      <div className="drf-pills" role="tablist" aria-label={lang === 'el' ? 'Φίλτρο ημερομηνιών' : 'Date filter'}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={preset === p.id}
            className={`drf-pill${preset === p.id ? ' active' : ''}`}
            onClick={() => onPresetChange(p.id)}
          >
            {lang === 'el' ? p.el : p.en}
          </button>
        ))}
        {summary && <span className="drf-summary">{summary}</span>}
      </div>

      {preset === 'custom' && (
        <div className="drf-custom">
          <label className="drf-field">
            <span>{lang === 'el' ? 'Από' : 'From'}</span>
            <input
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              max={to || undefined}
            />
          </label>
          <label className="drf-field">
            <span>{lang === 'el' ? 'Έως' : 'To'}</span>
            <input
              type="date"
              value={to}
              onChange={(e) => onToChange(e.target.value)}
              min={from || undefined}
            />
          </label>
        </div>
      )}
    </div>
  )
}
