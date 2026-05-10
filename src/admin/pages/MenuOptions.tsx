import {
  MacrosDisplaySection,
  VariantPillThresholdSection,
} from './Settings'
import { useAdminSettings } from '../hooks/useAdminSettings'

/**
 * Menu Options (WEC-279) — customer-facing UX knobs for the menu surface.
 *
 * Sections (in order):
 *   1. Customer dish-card macros — settings.macros_display
 *      'numbers' (real values for the preselected variant) or
 *      'dots' (legacy 1–5 admin-set scale)
 *   2. Variant picker threshold — settings.variant_pill_threshold
 *      Dishes with MORE than N variants flip from pill rows to
 *      per-ingredient dropdown picker. Default 4 (range 2–20).
 *      Shipped in WEC-304.
 */
export function MenuOptions() {
  const { byKey, loading, err, savingMsg, save } = useAdminSettings()

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Menu Options</h1>
      <p className="admin-page-sub">
        Customer-facing UX knobs for how dishes appear on the menu and inside the dish modal.
      </p>

      {err && <div className="admin-error-banner">{err}</div>}
      {savingMsg && <div className="admin-info-banner">{savingMsg}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <MacrosDisplaySection
            value={(byKey.get('macros_display') === 'dots' ? 'dots' : 'numbers')}
            onSave={(v) => save('macros_display', v)}
          />
          <VariantPillThresholdSection
            value={Number(byKey.get('variant_pill_threshold') ?? 4)}
            onSave={(v) => save('variant_pill_threshold', v)}
          />
        </>
      )}
    </div>
  )
}
