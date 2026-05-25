import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { trackingConfig, trackingConfigured } from '../../lib/tracking/config'
import { currentConsent, hasChosenConsent, saveConsent } from '../../lib/tracking/consent'
import type { ConsentState } from '../../lib/tracking/types'

/**
 * First-party cookie-consent banner (WEC-375) — the free alternative to
 * Cookiebot. Granular opt-in (Analytics / Marketing), all OFF by default,
 * wired to Google Consent Mode v2 via src/lib/tracking/consent.ts.
 *
 * Renders ONLY when tracking is switched on (VITE_TRACKING_ENABLED) AND
 * configured — so it stays invisible until we're ready to go live. Re-open via
 * `openConsentSettings()` (e.g. a footer link).
 */
export function ConsentBanner() {
  const lang = useUIStore((s) => s.lang)
  const isEl = lang === 'el'

  const enabled = trackingConfig.trackingEnabled && trackingConfigured

  const [visible, setVisible] = useState(false)
  const [customize, setCustomize] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [ads, setAds] = useState(false)

  useEffect(() => {
    if (!enabled) return
    if (!hasChosenConsent()) {
      setVisible(true)
    } else {
      const c = currentConsent()
      setAnalytics(c.analytics)
      setAds(c.ads)
    }
    const reopen = () => {
      const c = currentConsent()
      setAnalytics(c.analytics)
      setAds(c.ads)
      setCustomize(true)
      setVisible(true)
    }
    window.addEventListener('fitpal-open-consent', reopen)
    return () => window.removeEventListener('fitpal-open-consent', reopen)
  }, [enabled])

  if (!enabled || !visible) return null

  function persist(c: ConsentState) {
    saveConsent(c)
    setVisible(false)
    setCustomize(false)
  }
  const acceptAll = () => persist({ analytics: true, ads: true, preferences: true })
  const rejectAll = () => persist({ analytics: false, ads: false, preferences: false })
  const saveChoice = () => persist({ analytics, ads, preferences: false })

  return (
    <div className="consent-banner" role="dialog" aria-live="polite" aria-label={isEl ? 'Συγκατάθεση cookies' : 'Cookie consent'}>
      <div className="consent-inner">
        <div className="consent-text">
          <strong>{isEl ? 'Σεβόμαστε το απόρρητό σου' : 'We respect your privacy'}</strong>
          <p>
            {isEl
              ? 'Χρησιμοποιούμε απαραίτητα cookies για τη λειτουργία του site. Με τη συγκατάθεσή σου, χρησιμοποιούμε επίσης cookies analytics και marketing. Δες την '
              : 'We use essential cookies to run the site. With your consent we also use analytics and marketing cookies. See our '}
            <a href="/privacy">{isEl ? 'Πολιτική Απορρήτου' : 'Privacy Policy'}</a>.
          </p>

          {customize && (
            <div className="consent-cats">
              <label className="consent-cat">
                <span><strong>{isEl ? 'Απαραίτητα' : 'Essential'}</strong><small>{isEl ? 'Πάντα ενεργά' : 'Always on'}</small></span>
                <input type="checkbox" checked disabled />
              </label>
              <label className="consent-cat">
                <span><strong>Analytics</strong><small>{isEl ? 'GA4 — στατιστικά χρήσης' : 'GA4 — usage statistics'}</small></span>
                <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
              </label>
              <label className="consent-cat">
                <span><strong>Marketing</strong><small>Meta · Google Ads · Klaviyo</small></span>
                <input type="checkbox" checked={ads} onChange={(e) => setAds(e.target.checked)} />
              </label>
            </div>
          )}
        </div>

        <div className="consent-actions">
          {!customize ? (
            <>
              <button className="consent-btn consent-ghost" onClick={() => setCustomize(true)}>{isEl ? 'Προσαρμογή' : 'Customize'}</button>
              <button className="consent-btn consent-ghost" onClick={rejectAll}>{isEl ? 'Απόρριψη' : 'Reject'}</button>
              <button className="consent-btn consent-primary" onClick={acceptAll}>{isEl ? 'Αποδοχή όλων' : 'Accept all'}</button>
            </>
          ) : (
            <>
              <button className="consent-btn consent-ghost" onClick={rejectAll}>{isEl ? 'Απόρριψη όλων' : 'Reject all'}</button>
              <button className="consent-btn consent-primary" onClick={saveChoice}>{isEl ? 'Αποθήκευση' : 'Save choices'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
