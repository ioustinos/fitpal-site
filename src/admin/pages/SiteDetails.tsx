import {
  ContactInfoSection,
} from './Settings'
import type { ContactInfo } from '../../lib/api/settings'
import { useAdminSettings } from '../hooks/useAdminSettings'

/**
 * Site Details (WEC-276) — brand identity + how customers reach us.
 *
 * Sections:
 *   - Contact & social (existing ContactInfoSection — supportEmail/Phone,
 *     instagramUrl, facebookUrl)
 *
 * Future sections (file a follow-up when needed):
 *   - Tiktok / YouTube social URLs (extend ContactInfo)
 *   - Pickup locations CRUD UI (currently `settings.pickup_locations` is
 *     SQL-only; see WEC-259)
 */
export function SiteDetails() {
  const { byKey, loading, err, savingMsg, save } = useAdminSettings()

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Site Details</h1>
      <p className="admin-page-sub">
        Brand-facing info — contact channels, social links, future pickup locations.
      </p>

      {err && <div className="admin-error-banner">{err}</div>}
      {savingMsg && <div className="admin-info-banner">{savingMsg}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <ContactInfoSection
            value={(byKey.get('contact') as ContactInfo) ?? {}}
            onSave={(v) => save('contact', v)}
          />
        </>
      )}
    </div>
  )
}
