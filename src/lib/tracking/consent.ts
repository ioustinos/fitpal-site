// Consent manager (WEC-375). First-party, free alternative to Cookiebot —
// granular opt-in (analytics / ads), all denied by default, wired to Google
// Consent Mode v2. Persists the choice in localStorage. The tracking loaders
// (to be built) gate on currentConsent(); nothing fires until the user opts in.

import { DENIED_CONSENT, type ConsentState } from './types'

const STORAGE_KEY = 'fitpal_consent_v1'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

function pushGtag(...args: unknown[]): void {
  if (typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
  // Mirrors gtag()'s "push the arguments object" contract so a later-loaded
  // gtag.js picks these up.
  window.dataLayer.push(args)
}

/** Map our categories → Consent Mode v2 signals. */
function consentModePayload(c: ConsentState): Record<string, 'granted' | 'denied'> {
  return {
    analytics_storage: c.analytics ? 'granted' : 'denied',
    ad_storage: c.ads ? 'granted' : 'denied',
    ad_user_data: c.ads ? 'granted' : 'denied',
    ad_personalization: c.ads ? 'granted' : 'denied',
  }
}

/** Set Consent Mode defaults to DENIED — call as early as possible, before any
 *  gtag/Pixel script loads. `wait_for_update` gives the user a moment to choose
 *  before tags decide to fall back to modeled/cookieless mode. */
export function initConsentDefaults(): void {
  pushGtag('consent', 'default', { ...consentModePayload(DENIED_CONSENT), wait_for_update: 500 })
}

export function getStoredConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ConsentState) : null
  } catch {
    return null
  }
}

export function hasChosenConsent(): boolean {
  return getStoredConsent() !== null
}

/** Effective consent right now (stored choice, else all denied). */
export function currentConsent(): ConsentState {
  return getStoredConsent() ?? { ...DENIED_CONSENT }
}

/** Persist a choice, update Consent Mode, and notify the app. */
export function saveConsent(c: ConsentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    /* localStorage unavailable — choice holds for the session only */
  }
  pushGtag('consent', 'update', consentModePayload(c))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('fitpal-consent-change', { detail: c }))
  }
}

/** Re-open the banner (e.g. from a footer "Cookie settings" link). */
export function openConsentSettings(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fitpal-open-consent'))
}
