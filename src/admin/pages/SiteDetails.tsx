import {
  ContactInfoSection,
  PickupLocationsSection,
  AdminEmailRecipientsSection,
  parsePickupLocations,
  parseAdminEmails,
} from './Settings'
import type { ContactInfo } from '../../lib/api/settings'
import { useAdminSettings } from '../hooks/useAdminSettings'

/**
 * Site Details (WEC-276) — brand identity + how customers reach us.
 *
 * Sections:
 *   - Contact & social — supportEmail/Phone + Instagram/Facebook/TikTok/YouTube
 *   - Pickup locations — physical pickup points (name EL/EN, address, hours, days)
 *   - Order confirmation admin recipients (WEC-486) — BCC list of admin emails
 *     that get a copy of every customer order confirmation. WEC-486 shipped
 *     the component into the old monolithic Settings page, but Settings was
 *     subsequently broken into category sub-pages — the section ended up
 *     orphaned (in code, not rendered anywhere reachable from the new
 *     sidebar). 2026-06-24: re-wired here under Site Details since it's
 *     about how the team is contacted on each order, same family as the
 *     Contact section.
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
          <AdminEmailRecipientsSection
            value={parseAdminEmails(byKey.get('order_confirmation_admin_emails'))}
            onSave={(v) => save('order_confirmation_admin_emails', v)}
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
