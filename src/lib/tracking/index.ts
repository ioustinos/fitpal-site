// Tracking entry point (WEC-397). Call initTracking() once on app start.
// Everything stays INERT until VITE_TRACKING_ENABLED=true AND an SDK id is set.

import { trackingConfig, trackingConfigured } from './config'
import { initConsentDefaults, currentConsent } from './consent'
import { loadMetaPixel, loadKlaviyo } from './loaders'
import { captureUtm } from './utm'
import { track } from './track'

export { track } from './track'
export type { TrackUser } from './track'
export { openConsentSettings, currentConsent, hasChosenConsent, saveConsent } from './consent'
export { captureUtm, getStoredUtm } from './utm'
export type { StandardEvent, EventPayload, EcommerceItem, ConsentState } from './types'

let initialized = false

export function initTracking(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  // First-touch UTM capture is functional attribution (not a tracker) — safe to
  // run pre-consent and even while the tracking layer is dark.
  captureUtm()

  if (!trackingConfig.trackingEnabled || !trackingConfigured) return

  // Consent Mode v2 defaults (denied) BEFORE any SDK loads.
  initConsentDefaults()
  applyConsent()
  window.addEventListener('fitpal-consent-change', applyConsent)
}

/** Load whichever SDKs the current consent state permits, then fire a PageView. */
function applyConsent(): void {
  const c = currentConsent()
  if (c.ads) loadMetaPixel()
  if (c.analytics) loadKlaviyo()
  if (c.ads || c.analytics) track('page_view')
}
