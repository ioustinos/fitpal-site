import {
  CutoffHourSection,
  WeekdayOverridesSection,
  DateOverridesSection,
  TimeSlotsSection,
} from './Settings'
import { useAdminSettings } from '../hooks/useAdminSettings'

// Local types — duplicated from Settings.tsx since they're not exported there
type WeekdayOverrides = Record<string, { dow: number; hour: number }>
type DateOverrides = Record<string, { cutoffDate: string; hour: number }>

/**
 * Cutoff Times & Schedules (WEC-277) — when ordering closes + delivery windows.
 *
 * Sections (in order):
 *   1. Default cutoff hour                — settings.cutoff_hour
 *   2. Per-weekday overrides              — settings.cutoff_weekday_overrides
 *   3. Per-date overrides (holidays etc)  — settings.cutoff_date_overrides
 *   4. Delivery time slots                — settings.time_slots
 */
export function CutoffSchedules() {
  const { byKey, loading, err, savingMsg, save } = useAdminSettings()

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Cutoff Times & Schedules</h1>
      <p className="admin-page-sub">
        When ordering closes per delivery day, and which delivery windows are offered.
      </p>

      {err && <div className="admin-error-banner">{err}</div>}
      {savingMsg && <div className="admin-info-banner">{savingMsg}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <CutoffHourSection
            value={Number(byKey.get('cutoff_hour') ?? 18)}
            onSave={(v) => save('cutoff_hour', v)}
          />
          <WeekdayOverridesSection
            value={(byKey.get('cutoff_weekday_overrides') as WeekdayOverrides) ?? {}}
            onSave={(v) => save('cutoff_weekday_overrides', v)}
          />
          <DateOverridesSection
            value={(byKey.get('cutoff_date_overrides') as DateOverrides) ?? {}}
            onSave={(v) => save('cutoff_date_overrides', v)}
          />
          <TimeSlotsSection
            value={(byKey.get('time_slots') as string[]) ?? []}
            onSave={(v) => save('time_slots', v)}
          />
        </>
      )}
    </div>
  )
}
