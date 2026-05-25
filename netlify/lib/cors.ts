// Shared CORS helper — WEC-146.
//
// Replaces the previous hardcoded `Access-Control-Allow-Origin: '*'` across the
// Netlify functions with an origin allowlist. Note: the customer app is served
// same-origin from the same Netlify site, and browsers don't require CORS for
// same-origin requests — so tightening this does NOT affect the real app. It
// only stops arbitrary third-party sites from calling our endpoints from a
// victim's browser (the voucher-enumeration / order-spam vector in WEC-146).
//
// Usage in a function:
//   import { corsHeaders } from '../lib/cors'
//   if (request.method === 'OPTIONS')
//     return new Response(null, { status: 204, headers: corsHeaders(request) })
//   return Response.json(data, { status: 200, headers: corsHeaders(request) })

const ALLOWED_ORIGINS = new Set<string>([
  'http://localhost:8888',
  'http://localhost:5173',
  'https://dev--fitpal-order.netlify.app',
  'https://fitpal-order.netlify.app',
  'https://order.fitpal.gr', // future production domain (cutover: WEC-306)
])

// Default echoed when the caller's Origin isn't allow-listed (or absent, e.g.
// server-to-server). Production host is the safe default.
const DEFAULT_ORIGIN = 'https://fitpal-order.netlify.app'

// Netlify deploy-preview subdomains: deploy-preview-123--fitpal-order.netlify.app
const PREVIEW_RE = /^https:\/\/[a-z0-9-]+--fitpal-order\.netlify\.app$/

export function resolveOrigin(request: Request): string {
  const origin = request.headers.get('origin') ?? ''
  if (ALLOWED_ORIGINS.has(origin)) return origin
  if (PREVIEW_RE.test(origin)) return origin
  return DEFAULT_ORIGIN
}

export function corsHeaders(
  request: Request,
  methods = 'POST, OPTIONS',
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(request),
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
}
