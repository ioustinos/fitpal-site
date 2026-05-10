import { RawJsonSection } from './Settings'
import { useAdminSettings } from '../hooks/useAdminSettings'

/**
 * Advanced (WEC-281) — escape hatch for editing raw settings rows + anything
 * that doesn't belong on the typed pages yet.
 *
 * Sections:
 *   1. Raw JSON editor — every settings row, edit value directly.
 *
 * If a setting needs a typed UI, that's a typed-page ticket — don't grow this
 * page beyond raw JSON, otherwise we lose the typed-vs-raw clarity that
 * justifies the page split in the first place.
 */
export function Advanced() {
  const { all, loading, err, savingMsg, refresh } = useAdminSettings()

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Advanced</h1>
      <p className="admin-page-sub">
        Raw JSON editor over the settings table. Prefer the typed pages above —
        use this only for incident response or schema evolution work where the
        typed editor doesn't cover what you need yet.
      </p>

      {err && <div className="admin-error-banner">{err}</div>}
      {savingMsg && <div className="admin-info-banner">{savingMsg}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && <RawJsonSection rows={all} onSaved={refresh} />}
    </div>
  )
}
