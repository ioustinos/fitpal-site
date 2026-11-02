// WEC-899 — welcome email for a client a dietitian just added.
//
// Replaces the generic login-code email (Supabase «Magic Link» template, OTP
// inside, link back to /partner → 403). 🟢 Ioustinos 02/11: own text, no OTP,
// one-click link valid 7 days, lands on the ordering site.
//
// The link is NOT a Supabase magic link (those expire in about an hour). It
// points at /api/partner-welcome with a signed, 7-day token; that function
// mints a fresh magic link at click time and redirects into it. So the
// customer gets one click, and the credential in the inbox lives 7 days.
//
// Sent through Brevo REST (same account/sender as submit-change-request),
// not Klaviyo: no flow, no transactional review, no shared monthly quota.

import { createHmac, timingSafeEqual } from 'node:crypto'

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BREVO_API_KEY = process.env.BREVO_API_KEY ?? ''
const SENDER = { name: 'Fitpal Meals', email: 'info@fitpal.gr' }

export const WELCOME_TTL_DAYS = 7

/** The ordering site for this deploy (same rule as subscriptionRenewalInvites). */
export function siteBase(): string {
  const isProd = process.env.CONTEXT === 'production' || process.env.VIVA_ENV === 'prod'
  return isProd ? 'https://orders.fitpal.gr' : 'https://dev--fitpal-order.netlify.app'
}

// Key derived from the service-role key: server-only, already per-environment,
// and rotating it invalidates outstanding links (which is what you'd want).
function sign(userId: string, exp: number): string {
  return createHmac('sha256', `${SUPABASE_SERVICE_KEY}:wec899-partner-welcome`)
    .update(`${userId}.${exp}`)
    .digest('base64url')
}

export function welcomeUrl(userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + WELCOME_TTL_DAYS * 86400
  const q = new URLSearchParams({ u: userId, e: String(exp), s: sign(userId, exp) })
  return `${siteBase()}/api/partner-welcome?${q.toString()}`
}

/** Returns the user id when the token is valid and unexpired, else null. */
export function verifyWelcome(u: string | null, e: string | null, s: string | null): string | null {
  if (!u || !e || !s || !SUPABASE_SERVICE_KEY) return null
  const exp = Number(e)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null
  const want = Buffer.from(sign(u, exp))
  const got = Buffer.from(s)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return u
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function html(url: string): string {
  const u = esc(url)
  const logo = 'https://rhwetztxwjxfstffalwl.supabase.co/storage/v1/object/public/email-assets/logo-on-cream.png'
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Καλώς ήρθες στα Fitpal Meals!</title></head>
<body style="margin:0;padding:0;background:#f9f2e1;font-family:Arial,Helvetica,sans-serif;color:#1c2b1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f2e1"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px">
<tr><td align="center" style="padding:32px 32px 8px"><img src="${logo}" width="160" alt="Fitpal Meals" style="display:block;border:0;height:auto"></td></tr>
<tr><td style="padding:16px 32px 0;font-size:26px;line-height:1.25;font-weight:bold;color:#004739">Καλώς ήρθες στα Fitpal Meals!</td></tr>
<tr><td style="padding:16px 32px 0;font-size:16px;line-height:1.55">Η σύνδεσή σου με τον/τη διατροφολόγο σου ολοκληρώθηκε.</td></tr>
<tr><td style="padding:24px 32px 0">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#006647">
    <a href="${u}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">Πάτα εδώ</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:12px 32px 0;font-size:16px;line-height:1.55">για να μπεις στο προφίλ σου και να ξεκινήσεις τις παραγγελίες σου.</td></tr>
<tr><td style="padding:28px 32px 32px;font-size:12px;line-height:1.5;color:#6b7280">Ο σύνδεσμος ισχύει ${WELCOME_TTL_DAYS} ημέρες. Αν δεν δουλεύει, άνοιξε το <a href="${esc(siteBase())}" style="color:#006647">${esc(siteBase().replace('https://', ''))}</a> και συνδέσου με το email σου.</td></tr>
</table>
</td></tr></table></body></html>`
}

/** Send the welcome email. Returns null on success, or the failure reason. */
export async function sendPartnerWelcome(to: { email: string; name?: string }, userId: string): Promise<string | null> {
  if (!BREVO_API_KEY) return 'BREVO_API_KEY is not set'
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: SENDER,
        to: [{ email: to.email, ...(to.name ? { name: to.name } : {}) }],
        subject: 'Καλώς ήρθες στα Fitpal Meals!',
        htmlContent: html(welcomeUrl(userId)),
        tags: ['partner-welcome'],
      }),
    })
    if (!res.ok) return `Brevo ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`
    return null
  } catch (e) {
    return `fetch failed: ${e instanceof Error ? e.message : String(e)}`
  }
}
