/**
 * siteUrls — WEC-756. ONE source of truth for the Fitpal landing origin.
 *
 * Before this file the landing host was hardcoded in three places, three
 * different ways, and one of them was wrong in production:
 *
 *   · App.tsx          — flat constant pinned to DEV. Fed <SiteFooter>, so
 *                        every footer marketing link on orders.fitpal.gr sent
 *                        customers to dev--fitpal-landing.netlify.app.
 *   · SubscriptionSuccess.tsx — its own runtime host sniff. Correct, but a
 *                        second copy of the same logic.
 *   · StoreProvider.tsx — link text said «fitpal.gr», href said "/".
 *
 * If you need the landing origin anywhere, import LANDING_URL. Do not write
 * another literal, and do not add another host sniff.
 *
 * ── Resolution order ───────────────────────────────────────────────────────
 *  1. VITE_LANDING_URL, when set at build time.
 *  2. Otherwise a host-based default.
 *
 * The env var WINS but is deliberately NOT REQUIRED. Nothing in Netlify sets
 * it today, and shipping code that depends on an unset var would take the
 * footer down the moment it deployed. Setting VITE_LANDING_URL later needs no
 * further code change.
 *
 * ⚠️ Vite inlines import.meta.env at BUILD time, so changing the var in
 * Netlify requires a redeploy — it is not read at runtime.
 */

const DEV_LANDING = 'https://dev--fitpal-landing.netlify.app'
const PROD_LANDING = 'https://fitpal.gr'

/**
 * True for the dev branch deploy, Netlify deploy previews, and local dev.
 *
 * Note the `--` test: it matches `dev--fitpal-order.netlify.app` and
 * `deploy-preview-123--fitpal-order.netlify.app` but NOT the bare
 * `fitpal-order.netlify.app`, which is production (`main`) alongside
 * orders.fitpal.gr. Getting that wrong would point prod at the dev landing —
 * which is the bug this file exists to fix.
 */
function isNonProdHost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    host.includes('--')
  )
}

/** Origin of the marketing site. No trailing slash — callers append paths. */
export const LANDING_URL: string =
  (import.meta.env.VITE_LANDING_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  (isNonProdHost() ? DEV_LANDING : PROD_LANDING)
