// ─────────────────────────────────────────────────────────────────────────────
//  WEC-762 · Error monitoring
//
//  Before this, a crash on the customer site produced NOTHING. No alert, no log
//  anyone reads, no way to answer "is it broken for everyone or just her?".
//  The change-request email failed silently for two and a half weeks for exactly
//  that reason.
//
//  ⚠️ INERT WITHOUT A DSN. No VITE_SENTRY_DSN → initSentry() returns immediately,
//  nothing is loaded, nothing is sent, and the app behaves exactly as it did
//  before this file existed. Same posture as the tracking layer.
//
//  ⚠️ NO SESSION REPLAY, deliberately. Replay records the customer's screen —
//  that is personal data, it needs a consent gate, and it is a different
//  conversation. Errors are defensible under legitimate interest. Do not add
//  `replayIntegration` here without that conversation.
// ─────────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/react'

const env = import.meta.env as unknown as Record<string, string | undefined>

const DSN = env.VITE_SENTRY_DSN ?? ''
const ENVIRONMENT = env.VITE_FITPAL_ENV === 'prod' ? 'production' : 'development'
/** Netlify's build-time commit SHA, injected by vite.config.ts. Makes
 *  "which deploy broke this" a single click in Sentry. */
const RELEASE = env.VITE_COMMIT_REF ?? 'dev-local'

let started = false

// ── PII scrubbing ───────────────────────────────────────────────────────────
// This is a food-delivery app. Error strings and URLs routinely carry names,
// emails, phone numbers and HOME ADDRESSES. Sentry must never be a second copy
// of the customer database.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// Greek mobiles (69…) and landlines (2…), 10 digits, with or without a +30
// prefix and with separators ANYWHERE — real data is written «6937 109396»,
// «694-412-3456», «+30 210 4253929» and the fixed-position version of this
// regex missed all of them.
//
// ⚠️ The lookbehind/lookahead are not decoration. Without them this eats order
// numbers: FP-260913-00001 contains «26» followed by eight digits, so it would
// be redacted to FP-[phone] and destroy the one identifier that makes an error
// traceable — while containing no personal data at all.
const PHONE_RE = /(?<![\w-])(?:\+?30[\s-]?)?(?:2\d|69)(?:[\s-]?\d){8}(?![\w-])/g

export function scrubPii(input: string): string {
  return input.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]')
}

function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return value
  if (typeof value === 'string') return scrubPii(value)
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubDeep(v, depth + 1)
    }
    return out
  }
  return value
}

// ── Noise ───────────────────────────────────────────────────────────────────
// A monitoring tool that screams on day one is a tool nobody opens on day two.
// Everything here is known, understood, and not actionable.
const IGNORE_MESSAGES = [
  // WEC-238 — Google Places autocomplete CORS on dev, ~7 per checkout load.
  'Google Maps JavaScript API',
  'places.googleapis.com',
  // Benign: fires when a layout settles, no user impact, extremely chatty.
  'ResizeObserver loop',
  // The user navigated away mid-request. Not a fault.
  'AbortError',
  'The operation was aborted',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource',
  'Load failed',
]

function isExtensionFrame(filename?: string): boolean {
  if (!filename) return false
  return (
    filename.startsWith('chrome-extension://') ||
    filename.startsWith('moz-extension://') ||
    filename.startsWith('safari-extension://') ||
    filename.includes('extensions/')
  )
}

export function initSentry(): void {
  if (started || typeof window === 'undefined') return
  if (!DSN) return // ← inert. No DSN, no Sentry, no behaviour change.
  started = true

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,

    // Never let Sentry attach IPs, cookies or request bodies by itself.
    sendDefaultPii: false,

    // Errors: everything. Performance traces: off — they are the expensive part
    // of the quota and we have no performance question right now.
    sampleRate: 1.0,
    tracesSampleRate: 0,

    ignoreErrors: IGNORE_MESSAGES,
    denyUrls: [/chrome-extension:\/\//, /moz-extension:\/\//, /safari-extension:\/\//],

    beforeBreadcrumb(crumb) {
      // Breadcrumbs record every fetch URL and console line — a rich source of
      // leaked emails (e.g. /api/...?email=...). Scrub, don't trust.
      if (crumb.message) crumb.message = scrubPii(crumb.message)
      if (crumb.data) crumb.data = scrubDeep(crumb.data) as Record<string, unknown>
      return crumb
    },

    beforeSend(event) {
      // Drop anything whose stack is entirely a browser extension — those are
      // somebody's ad blocker breaking, not our bug.
      const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? []
      if (frames.length > 0 && frames.every((f) => isExtensionFrame(f.filename))) return null

      // Identity: the Supabase user id ONLY. Never email, never name.
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined
      }

      if (event.request?.url) event.request.url = scrubPii(event.request.url)
      if (event.message) event.message = scrubPii(event.message)
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubPii(ex.value)
      }
      if (event.extra) event.extra = scrubDeep(event.extra) as Record<string, unknown>

      return event
    },
  })

  Sentry.setTag('app', 'order-site')
}

/** Attach the signed-in user by ID only. Call after auth resolves. */
export function setSentryUser(userId: string | null): void {
  if (!started) return
  Sentry.setUser(userId ? { id: userId } : null)
}

/** Report something we caught ourselves and handled — the silent-failure class.
 *  `where` becomes a searchable tag, so "show me every Brevo failure" works. */
export function reportHandled(where: string, err: unknown, extra?: Record<string, unknown>): void {
  if (!started) {
    // Still visible locally and in Netlify logs when Sentry is off.
    console.error(`[${where}]`, err, extra ?? '')
    return
  }
  Sentry.withScope((scope) => {
    scope.setTag('where', where)
    if (extra) scope.setExtras(scrubDeep(extra) as Record<string, unknown>)
    scope.setLevel('error')
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
  })
}

export { Sentry }
