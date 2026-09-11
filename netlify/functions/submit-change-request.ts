// WEC-601: customer files an «Αίτημα Αλλαγής» → notify admins by email.
//
// Moves change-request creation SERVER-SIDE (was a direct browser insert in
// src/lib/api/orderChangeRequests.ts) so the notification can't be skipped:
// one place validates ownership, inserts (service role), and emails staff.
//
// Channel: Brevo SMTP — the SAME relay that carries Supabase Auth's OTP mail
// (same account / authenticated domain / verified sender noreply@fitpal.gr),
// just driven from our own code. Klaviyo is deliberately NOT used here (staff-
// only email; avoids a template + flow + transactional approval + the shared
// monthly quota). Volume ~5/day, so SMTP-from-Lambda has no pooling concern.
// If this ever turns flaky in the logs, switch to Brevo's REST API
// (POST https://api.brevo.com/v3/smtp/email, `api-key` header, same account,
// needs a v3 key) — that decision is already made, don't re-open it.
//
// The email is FAIL-SOFT: the customer's request must succeed even if Brevo is
// down (mirrors the order-events-background posture — never throw into the
// customer path, log loudly).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders } from '../lib/cors'
import { checkRateLimit, clientIp } from '../lib/rateLimit'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

const REASONS = ['cancel', 'address_or_time', 'dish', 'other'] as const
type Reason = (typeof REASONS)[number]
const REASON_LABEL: Record<Reason, string> = {
  cancel: 'Ακύρωση παραγγελίας',
  address_or_time: 'Αλλαγή διεύθυνσης/ώρας',
  dish: 'Αλλαγή πιάτων',
  other: 'Άλλο',
}
const MESSAGE_MAX = 2000

interface Body { orderId?: string; reason?: string; message?: string }

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** JWT subject (user id) or null. Never throws. */
async function getJwtUserId(request: Request): Promise<string | null> {
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : ''
  if (!token) return null
  try {
    const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await c.auth.getUser(token)
    return data.user?.id ?? null
  } catch {
    return null
  }
}

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Brevo REST API — NOT SMTP.
//
// This used to open an SMTP connection to smtp-relay.brevo.com:587 from the
// Lambda. Between 2026-08-25 and 2026-09-11 not one notification reached Brevo:
// four real change requests, zero rows in Brevo's transactional log, while
// other mail from the same sender (info@fitpal.gr) delivered fine the same day.
// So the message never left us — it was not a deliverability problem.
//
// Three things produce that identical signature (missing/rotated SMTP
// credentials, outbound port 587 blocked or timing out from the Lambda, or the
// function timing out mid-send) and we could not tell them apart from outside.
// The REST API removes the whole category: plain HTTPS, no port 587, no
// connection pooling, an explicit HTTP status and a response body we can store.
//
// This was pre-approved in this file's own header from day one: "If this ever
// turns flaky in the logs, switch to Brevo's REST API — that decision is
// already made, don't re-open it."
const BREVO_API_KEY = process.env.BREVO_API_KEY ?? ''
const SENDER = { name: 'Fitpal', email: 'info@fitpal.gr' }

/** Returns null on success, or the reason it failed (stored on the row). */
async function sendMail(
  to: { email: string; name?: string }[],
  subject: string,
  html: string,
): Promise<string | null> {
  if (!BREVO_API_KEY) return 'BREVO_API_KEY is not set'
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ sender: SENDER, to, subject, htmlContent: html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return `Brevo ${res.status}: ${body.slice(0, 300)}`
    }
    return null
  } catch (e) {
    return `fetch failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  if (!(await checkRateLimit(`change-request:${clientIp(request)}`, 20, 60))) {
    return Response.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: cors })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors })
  }

  const orderId = (body.orderId ?? '').trim()
  const reason = (body.reason ?? '') as Reason
  const message = (body.message ?? '').trim().slice(0, MESSAGE_MAX)
  if (!orderId) return Response.json({ error: 'orderId required' }, { status: 400, headers: cors })
  if (!REASONS.includes(reason)) return Response.json({ error: 'invalid reason' }, { status: 400, headers: cors })

  const jwtUserId = await getJwtUserId(request)
  if (!jwtUserId) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors })

  const supabase = serviceClient()

  // Load the order + its delivery days; validate the caller OWNS it.
  const { data: order, error: ordErr } = await supabase
    .from('orders')
    .select('id, order_number, user_id, customer_name, customer_email, customer_phone')
    .eq('id', orderId)
    .maybeSingle()
  if (ordErr) return Response.json({ error: ordErr.message }, { status: 500, headers: cors })
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404, headers: cors })
  if ((order.user_id as string | null) !== jwtUserId) {
    return Response.json({ error: 'This order does not belong to you' }, { status: 403, headers: cors })
  }

  const { data: children } = await supabase
    .from('child_orders')
    .select('delivery_date')
    .eq('order_id', orderId)
    .is('cancelled_at', null)
  const deliveryDates = (children ?? [])
    .map((c) => (c as { delivery_date: string }).delivery_date)
    .filter(Boolean)
    .sort()

  // Insert the request (service role — RLS-exempt, and this IS the server path).
  // WEC-601: keep the new row's id — the notification outcome is written back
  // onto it below, so a failure is visible in the database instead of only in a
  // Netlify console line.
  const { data: insRow, error: insErr } = await supabase
    .from('order_change_requests')
    .insert({
      order_id: orderId,
      user_id: jwtUserId,
      reason,
      message: message || null,
    })
    .select('id')
    .single()
  if (insErr) return Response.json({ error: insErr.message }, { status: 500, headers: cors })
  const requestId = (insRow as { id: string } | null)?.id ?? null

  // Customer's language, for the acknowledgement email. Same source and same
  // default-to-Greek posture as notify-order-cancelled.ts.
  let custLang = 'el'
  {
    const { data: pref } = await supabase
      .from('user_prefs')
      .select('lang')
      .eq('user_id', jwtUserId)
      .maybeSingle()
    const l = (pref as { lang?: string } | null)?.lang
    if (l === 'en' || l === 'el') custLang = l
  }

  // ── Notify admins + acknowledge to the customer ─────────────────────────────
  // FAIL-SOFT: the request already succeeded above and must stay succeeded.
  let adminNotifiedAt: string | null = null
  let customerNotifiedAt: string | null = null
  let notifyError: string | null = null
  try {
    const { data: setting } = await supabase
      .from('settings').select('value').eq('key', 'order_confirmation_admin_emails').maybeSingle()
    const rawAdmins = (setting as { value: unknown } | null)?.value
    // Same read + validation shape as notify-order-updated.ts.
    const adminEmails = Array.isArray(rawAdmins)
      ? (rawAdmins as unknown[])
          .filter((v): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
          .map((v) => v.trim())
      : []

    if (adminEmails.length > 0) {
      // Escalation: a cancel on an order delivering within ~24h is where silence
      // costs money — flag the subject.
      const soon = Date.now() + 24 * 3600 * 1000
      const dueSoon = reason === 'cancel' && deliveryDates.some((d) => {
        const t = new Date(`${d}T00:00:00`).getTime()
        return t <= soon && t >= Date.now() - 24 * 3600 * 1000
      })

      const label = REASON_LABEL[reason]
      const subject = `${dueSoon ? '⚠️ ΕΠΕΙΓΟΝ — ' : ''}[Fitpal] Αίτημα αλλαγής — ${order.order_number} (${label})`
      const origin = new URL(request.url).origin
      const adminUrl = `${origin}/admin/orders?order=${encodeURIComponent(orderId)}`
      const submittedAt = new Date().toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' })
      const datesStr = deliveryDates.length
        ? deliveryDates.map((d) => new Date(`${d}T12:00:00`).toLocaleDateString('el-GR', { weekday: 'short', day: '2-digit', month: '2-digit' })).join(' · ')
        : '—'
      const messageHtml = message
        ? esc(message)
        : '(χωρίς μήνυμα)'

      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.55">
  <h2 style="margin:0 0 4px;font-size:18px">Αίτημα αλλαγής</h2>
  <p style="margin:0 0 16px;color:#666">${esc(order.order_number as string)} · υποβλήθηκε ${esc(submittedAt)}</p>
  <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:16px">
    <tr><td style="color:#666">Λόγος</td><td><b>${esc(label)}</b></td></tr>
    <tr><td style="color:#666">Πελάτης</td><td>${esc(order.customer_name as string)}</td></tr>
    <tr><td style="color:#666">Email</td><td>${esc(order.customer_email as string)}</td></tr>
    <tr><td style="color:#666">Τηλέφωνο</td><td>${esc(order.customer_phone as string)}</td></tr>
    <tr><td style="color:#666">Ημέρες παράδοσης</td><td>${esc(datesStr)}</td></tr>
  </table>
  <p style="margin:0 0 6px;color:#666">Μήνυμα πελάτη</p>
  <blockquote style="margin:0 0 20px;padding:10px 14px;background:#f6f6f6;border-left:3px solid #00b96b;white-space:pre-wrap">${messageHtml}</blockquote>
  <a href="${esc(adminUrl)}" style="display:inline-block;background:#004739;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Άνοιγμα στο admin</a>
</div>`

      const err = await sendMail(adminEmails.map((email) => ({ email })), subject, html)
      if (err) {
        console.error('[change-request] admin email NOT delivered for order %s: %s', order.order_number, err)
        notifyError = err
      } else {
        adminNotifiedAt = new Date().toISOString()
      }
    } else {
      const warn = 'no valid admin recipients in order_confirmation_admin_emails'
      console.warn('[change-request] %s', warn)
      notifyError = warn
    }

    // ── Acknowledge to the CUSTOMER (WEC-601, added 2026-09-11) ─────────────
    // Until now the customer got a toast and nothing else: close the tab and
    // there was no evidence the request had ever been filed. The wording is
    // deliberately the SAME sentence as the on-screen toast (WEC-664), so we
    // are not inventing a second promise with different words.
    const custEmail = (order.customer_email as string | null)?.trim()
    if (custEmail) {
      const el = custLang !== 'en'
      const ackSubject = el
        ? `Λάβαμε το αίτημά σου — ${order.order_number}`
        : `We received your request — ${order.order_number}`
      const ackBody = el
        ? 'Η ομάδα μας επεξεργάζεται το αίτημα σου. Θα σε ενημερώσουμε για την εξέλιξή του.'
        : 'Our team is reviewing your request. We will let you know how it goes.'
      const ackHtml = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6">
  <p style="margin:0 0 14px">${el ? 'Γεια σου' : 'Hi'} ${esc((order.customer_name as string | null)?.split(' ')[0] ?? '')},</p>
  <p style="margin:0 0 14px">${esc(ackBody)}</p>
  <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px">
    <tr><td style="color:#666">${el ? 'Παραγγελία' : 'Order'}</td><td><b>${esc(order.order_number as string)}</b></td></tr>
    <tr><td style="color:#666">${el ? 'Λόγος' : 'Reason'}</td><td>${esc(REASON_LABEL[reason])}</td></tr>
  </table>
  ${message ? `<p style="margin:0 0 6px;color:#666">${el ? 'Το μήνυμά σου' : 'Your message'}</p>
  <blockquote style="margin:0 0 16px;padding:10px 14px;background:#f6f6f6;border-left:3px solid #00b96b;white-space:pre-wrap">${esc(message)}</blockquote>` : ''}
  <p style="margin:0;color:#666;font-size:13px">${el ? 'Ομάδα Fitpal' : 'The Fitpal team'} · support@fitpal.gr</p>
</div>`
      const custErr = await sendMail(
        [{ email: custEmail, name: (order.customer_name as string | null) ?? undefined }],
        ackSubject,
        ackHtml,
      )
      if (custErr) {
        console.error('[change-request] customer ack NOT delivered for %s: %s', order.order_number, custErr)
        notifyError = notifyError ? `${notifyError} | customer: ${custErr}` : `customer: ${custErr}`
      } else {
        customerNotifiedAt = new Date().toISOString()
      }
    }
  } catch (e) {
    // Never fail the customer's request on a notification error.
    console.error('[change-request] notification block failed (non-fatal):', e)
    notifyError = e instanceof Error ? e.message : String(e)
  }

  // Persist the outcome so "did the admins get an email?" is a SQL query rather
  // than half an hour in the Brevo UI. This is the whole reason the failure went
  // unnoticed for two and a half weeks.
  if (requestId) {
    await supabase
      .from('order_change_requests')
      .update({
        admin_notified_at: adminNotifiedAt,
        customer_notified_at: customerNotifiedAt,
        notify_error: notifyError,
      })
      .eq('id', requestId)
  }

  return Response.json({ ok: true }, { status: 200, headers: cors })
}
