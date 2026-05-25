// Client tracking config (WEC-373). Every value comes from env and defaults to
// empty — so loaders/dispatch no-op while unset and the layer stays INERT until
// Marketing supplies IDs. Only public IDs live here (VITE_ prefix ships to the
// browser); secrets stay server-side in Netlify Functions.

const env = import.meta.env as unknown as Record<string, string | undefined>

export const trackingConfig = {
  env: (env.VITE_FITPAL_ENV ?? 'dev') as 'dev' | 'prod',
  /** Master switch (WEC-373). Until 'true', no consent banner shows and no
   *  tags load — so the whole layer ships dark until we're ready to go live. */
  trackingEnabled: (env.VITE_TRACKING_ENABLED ?? 'false') === 'true',
  metaPixelId: env.VITE_META_PIXEL_ID ?? '',
  ga4MeasurementId: env.VITE_GA4_MEASUREMENT_ID ?? '',
  googleAdsId: env.VITE_GOOGLE_ADS_ID ?? '',
  klaviyoPublicKey: env.VITE_KLAVIYO_PUBLIC_KEY ?? '',
  cookiebotId: env.VITE_COOKIEBOT_ID ?? '',
  metaTestEventCode: env.VITE_META_TEST_EVENT_CODE ?? '',
} as const

export const isDev = trackingConfig.env !== 'prod'

/** True once at least one client SDK is configured. Guards loaders so the app
 *  behaves identically (no tracking) until IDs are added. */
export const trackingConfigured = Boolean(
  trackingConfig.metaPixelId || trackingConfig.ga4MeasurementId || trackingConfig.klaviyoPublicKey,
)
