import {
  ContactInfoSection,
  PickupLocationsSection,
  parsePickupLocations,
} from './Settings'
import type { ContactInfo } from '../../lib/api/settings'
import { useAdminSettings } from '../hooks/useAdminSettings'

/**
 * Site Details (WEC-276) — brand identity + how customers reach us.
 *
 * Sections:
 *   - Contact & social — supportEmail/Phone + Instagram/Facebook/TikTok/YouTube
 *   - Pickup locations — physical pickup points (name EL/EN, address, hours, days)
 */
export function SiteDetails() {
  const { byKey, loading, err, savingMsg, save } = useAdminSettings()

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Site Details</h1>
      <p className="admin-page-sub">
        Brand-facing info — contact channels, social links, and physical pickup locations.
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
          <PickupLocationsSection
            value={parsePickupLocations(byKey.get('pickup_locations'))}
            onSave={(v) => save('pickup_locations', v)}
          />
        </>
      )}
    </div>
  )
}
