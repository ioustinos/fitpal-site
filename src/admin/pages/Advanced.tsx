import { Link } from 'react-router-dom'
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

      {/* Tools & reference — non-settings utilities live here too */}
      <section className="admin-setting-card" style={{ marginBottom: 20 }}>
        <div className="admin-setting-head">
          <h3>Tools & reference</h3>
          <p>Internal documentation and shared reference surfaces.</p>
        </div>
        <div className="admin-setting-body">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <Link to="/admin/design-system" className="admin-inline-link">Design System</Link> —
              live reference for tokens, typography, components, icons, and usage rules.
              Share with designers, contractors, or anyone touching the UI.
            </li>
          </ul>
        </div>
      </section>

      {!loading && <RawJsonSection rows={all} onSaved={refresh} />}
    </div>
  )
}
