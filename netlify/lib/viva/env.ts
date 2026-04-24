// Viva Payments environment resolver.
//
// Picks dev sandbox or prod based on VIVA_ENV (explicit override) or the
// Netlify CONTEXT variable. Resolves all four per-env secrets and returns
// the right Viva hostnames.
//
// Server-side only — must never be imported from the browser bundle.
//
// WEC-171: part of the Viva Payments integration epic (WEC-125).

export type VivaEnv = 'dev' | 'prod'

export interface VivaCredentials {
  env: VivaEnv
  /** OAuth2 token endpoint host. */
  accountsHost: string
  /** REST API host (create order, retrieve transaction). */
  apiHost: string
  /** Hosted checkout host — customer redirect + /api/messages/config/token. */
  checkoutHost: string
  sourceCode: string
  clientId: string
  clientSecret: string
  /** Legacy Basic-auth creds. Required for refunds and for fetching the
   *  webhook verification key (neither endpoint accepts OAuth). */
  merchantId: string
  apiKey: string
}

function resolveEnv(): VivaEnv {
  const explicit = (process.env.VIVA_ENV ?? '').toLowerCase()
  if (explicit === 'prod' || explicit === 'dev') return explicit
  // Netlify production context → prod; branch / deploy-preview / local → dev.
  if (process.env.CONTEXT === 'production') return 'prod'
  return 'dev'
}

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

export function getVivaCreds(): VivaCredentials {
  const env = resolveEnv()
  const suffix = env === 'prod' ? 'PROD' : 'DEV'
  return {
    env,
    accountsHost: env === 'prod' ? 'accounts.vivapayments.com' : 'accounts.demo.vivapayments.com',
    apiHost:      env === 'prod' ? 'api.vivapayments.com'      : 'demo-api.vivapayments.com',
    checkoutHost: env === 'prod' ? 'www.vivapayments.com'      : 'demo.vivapayments.com',
    sourceCode:   req(`VIVA_SOURCE_CODE_${suffix}`),
    clientId:     req(`VIVA_CLIENT_ID_${suffix}`),
    clientSecret: req(`VIVA_CLIENT_SECRET_${suffix}`),
    merchantId:   req(`VIVA_MERCHANT_ID_${suffix}`),
    apiKey:       req(`VIVA_API_KEY_${suffix}`),
  }
}

/** Customer-facing hosted checkout URL for a given Viva orderCode. */
export function checkoutUrl(orderCode: string): string {
  const { checkoutHost } = getVivaCreds()
  return `https://${checkoutHost}/web/checkout?ref=${orderCode}`
}
