import { createClient } from '@supabase/supabase-js'
import { createVivaOrder } from '../lib/viva/createOrder'
// 2026-06-24 incident fix: was `trackAsync` (fire-and-forget Promise.resolve
// + microtask). Even though there's awaited work after the call (DB update,
// airtable fetch), the microtask doesn't always get a chance to complete its
// HTTP POST to Klaviyo before Netlify ends the function. Result: order
// confirmation emails not arriving despite the function returning 200 and
// the order being persisted. Switching to awaited track() — slightly slower
// per response (~150ms extra) but events actually land.
import { track, subscribeProfileToMarketing } from '../lib/klaviyo'
import { corsHeaders } from '../lib/cors'
import { checkRateLimit, clientIp } from '../lib/rateLimit'
import { isMirrorEligible } from '../lib/airtable/pushOrder'
// WEC-490: shared per-day validator. Same rules + codes as the client uses
// in CheckoutPage's validationIssues + deliveryOk. Drift here was the root
// cause of WEC-489 (pickup days silently disabling submit) — that bug is
// structurally impossible while both sides go through this one helper.
import {
  validateDay,
  type DaySnapshot,
  type DayIssue,
} from '../../src/lib/dayValidation'
// WEC-204: shared silent grace period for cutoffs (5 min). Must stay in
// sync with the client — single constant imported on both sides.
import { CUTOFF_GRACE_MS } from '../../src/lib/helpers'

// ─── Greek ΑΦΜ checksum (WEC-354) ──────────────────────────────────────────
// Duplicated from src/lib/vat.ts — cross-folder src/ ⇄ netlify/ imports
// aren't set up in this project, so we keep two copies. They must stay in
// sync. See the original for algorithm comments + rationale.
function isValidGreekVatServer(input: string): boolean {
  const digits = String(input ?? '').replace(/\D/g, '')
  if (digits.length !== 9) return false
  if (/^0+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i], 10) * Math.pow(2, 8 - i)
  }
  let check = sum % 11
  if (check === 10) check = 0
  return check === parseInt(digits[8], 10)
}

// ─── Env ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderPayload {
  userId?: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  paymentMethod: 'cash' | 'card' | 'link' | 'transfer' | 'wallet'
  cutlery: boolean
  invoiceType?: string
  invoiceName?: string
  invoiceVat?: string
  notes?: string
  voucherCode?: string
  /** WEC-emails: customer's preferred language. Routes EL vs EN Klaviyo template. */
  lang?: 'el' | 'en'
  days: DayPayload[]
  // WEC-418: if set, submit-order promotes the draft (UPDATE … WHERE status='draft')
  // instead of inserting a fresh row. Side effects (voucher_uses, payment_links,
  // Viva, Klaviyo) run on the promote path, NOT on draft creation.
  draftId?: string
}

interface DayPayload {
  deliveryDate: string
  timeFrom: string
  timeTo: string
  addressStreet: string
  addressArea: string
  addressZip?: string
  addressFloor?: string
  addressDoorbell?: string
  addressNotes?: string
  /** WEC-259: 'delivery' (default) or 'pickup'. */
  fulfillmentType?: 'delivery' | 'pickup'
  /** WEC-259: pickup-only — references settings.pickup_locations[i].id. */
  pickupLocationId?: string | null
  items: ItemPayload[]
}

interface ItemPayload {
  dishId: string
  variantId: string
  quantity: number
  comment?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Errors = Record<string, string[]>

function addError(errors: Errors, key: string, msg: string) {
  errors[key] = [...(errors[key] ?? []), msg]
}

/**
 * WEC-490: localize a shared DayIssue to the server's English-only error
 * stream. Client side has its own bilingual localizer; the wire returns
 * either flow with the same structured code so the UI can surface the
 * right message either way.
 */
function formatDayIssueForServer(issue: DayIssue): string {
  switch (issue.code) {
    case 'no_address':                    return 'Address is required (street + area)'
    case 'no_postcode':                   return 'Postcode is required'
    case 'postcode_out_of_zone':          return `Postcode ${issue.params?.zip ?? ''} is not in any active delivery zone`
    case 'no_pickup_location':            return 'Pickup location is required'
    case 'no_pickup_locations_available': return 'No pickup locations configured'
    case 'no_time_slot':                  return 'Delivery time window is required'
    case 'below_min_order':               return `Below minimum order`
  }
}

// ─── Cutoff helpers ─────────────────────────────────────────────────────────
// All cutoff hours are interpreted in Europe/Athens — the operational tz.
//
// WEC-205: the previous version used JS Date local-time methods
// (`new Date('YYYY-MM-DDT00:00:00')`, `setHours`, `getDay`). On Netlify
// Functions the server tz is UTC, so a 6pm-Athens cutoff was being computed
// as 6pm UTC = 9pm Athens — giving every customer 3 hours of grace past the
// actual cutoff (2h in winter / EET). testBot caught it: order placed at
// Sat 18:34 Athens (= 15:34 UTC) passed because 15:34 UTC < 18:00 UTC.
//
// Fix: keep all date math as YYYY-MM-DD strings + hour-of-day, and convert
// to absolute UTC ms only at the final step via an Intl.DateTimeFormat
// round-trip in Europe/Athens. DST is handled by Intl automatically.

interface WeekdayCutoff { dow: number; hour: number }
interface DateCutoff    { cutoffDate: string; hour: number }

interface CutoffSettings {
  cutoffHour: number
  weekdayOverrides: Record<number, WeekdayCutoff>
  dateOverrides: Record<string, DateCutoff>
  /** cents — admin-configurable minimum per child order */
  minOrderCents: number
}

const ATHENS_TZ = 'Europe/Athens'

/** ISO weekday (1=Mon..7=Sun) for a YYYY-MM-DD calendar date. */
function isoWeekday(isoDate: string): number {
  // Calendar weekday is timezone-agnostic; using noon UTC avoids edge cases.
  const d = new Date(isoDate + 'T12:00:00Z')
  return ((d.getUTCDay() + 6) % 7) + 1
}

/** Subtract n calendar days from a YYYY-MM-DD string. */
function isoSubDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - n))
  return dt.toISOString().slice(0, 10)
}

/**
 * Returns the absolute UTC ms at which the Europe/Athens wall-clock equals
 * `isoDate hour:00`. Handles DST automatically.
 *
 * Algorithm: pretend the target wall-clock is in UTC ("guess"); ask Intl
 * what that absolute moment IS in Athens; the difference between the two
 * is the offset we need to subtract.
 */
function athensWallClockMs(isoDate: string, hour: number): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const guessUtcMs = Date.UTC(y, m - 1, d, hour, 0, 0, 0)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATHENS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(guessUtcMs))
  const g = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10)
  const athensAsUtcMs = Date.UTC(
    g('year'), g('month') - 1, g('day'),
    g('hour') === 24 ? 0 : g('hour'), g('minute'), g('second'), 0,
  )
  return guessUtcMs - (athensAsUtcMs - guessUtcMs)
}

/** Returns the absolute UTC ms at which ordering for a delivery date closes. */
function getCutoffMs(isoDate: string, cfg: CutoffSettings): number {
  // 1. Per-date override (holidays, long weekends)
  const dateOv = cfg.dateOverrides[isoDate]
  if (dateOv) return athensWallClockMs(dateOv.cutoffDate, dateOv.hour)

  // 2. Weekday override (e.g. Monday delivery → Saturday 18:00)
  const dow = isoWeekday(isoDate)
  const wdOv = cfg.weekdayOverrides[dow]
  if (wdOv) {
    let diff = dow - wdOv.dow
    if (diff <= 0) diff += 7
    return athensWallClockMs(isoSubDays(isoDate, diff), wdOv.hour)
  }

  // 3. Default: previous calendar day at cfg.cutoffHour Athens.
  return athensWallClockMs(isoSubDays(isoDate, 1), cfg.cutoffHour)
}

const DEFAULT_CUTOFF: CutoffSettings = {
  cutoffHour: 18,
  weekdayOverrides: {},
  dateOverrides: {},
  minOrderCents: 1500,
}

/** Parse DB settings rows into a CutoffSettings config. */
function parseCutoffSettings(rows: { key: string; value: unknown }[] | null): CutoffSettings {
  const cfg: CutoffSettings = { ...DEFAULT_CUTOFF }
  for (const row of rows ?? []) {
    if (row.key === 'cutoff_hour' && typeof row.value === 'number') {
      cfg.cutoffHour = row.value
    } else if (row.key === 'min_order' && typeof row.value === 'number') {
      cfg.minOrderCents = row.value
    } else if (row.key === 'cutoff_weekday_overrides' && row.value && typeof row.value === 'object') {
      const wd: Record<number, WeekdayCutoff> = {}
      for (const [k, v] of Object.entries(row.value as Record<string, WeekdayCutoff>)) {
        const dow = Number(k)
        if (Number.isInteger(dow) && dow >= 1 && dow <= 7 && v && typeof v.dow === 'number' && typeof v.hour === 'number') {
          wd[dow] = { dow: v.dow, hour: v.hour }
        }
      }
      cfg.weekdayOverrides = wd
    } else if (row.key === 'cutoff_date_overrides' && row.value && typeof row.value === 'object') {
      const dt: Record<string, DateCutoff> = {}
      for (const [k, v] of Object.entries(row.value as Record<string, DateCutoff>)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v.cutoffDate === 'string' && typeof v.hour === 'number') {
          dt[k] = { cutoffDate: v.cutoffDate, hour: v.hour }
        }
      }
      cfg.dateOverrides = dt
    }
  }
  return cfg
}

/**
 * Today's calendar date in Europe/Athens, YYYY-MM-DD.
 *
 * Was previously server-local (= UTC on Netlify); used for the
 * `delivery_date < today` past-date guard. UTC vs Athens diverge for ~3
 * hours every night around midnight Athens, so a customer ordering for
 * "today" at 00:30 Athens (= 21:30 UTC the previous day) would have the
 * server think today is yesterday. Mostly harmless — the cutoff guard
 * catches it — but worth fixing for correctness alongside WEC-205.
 */
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ATHENS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// ─── Basic payload validation ───────────────────────────────────────────────

const VALID_METHODS = ['cash', 'card', 'link', 'transfer', 'wallet']

// WEC-220 / WEC-237: server-side mirror of client validation. Frontend laxness
// compounded with missing server-side checks would let garbage payloads through
// (single-char names, "foo" emails, invoice toggle on with empty fields). We
// reject here too so a bypassed/malicious client can't get an order through.
// WEC-408: tighter email validation — mirror of src/lib/email.ts (kept as a
// server-side duplicate so curl/script submissions can't bypass the client
// regex). Rejects HTML-shaped local parts (`<img>@…`), > 254 chars, etc.
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/
function isValidEmailServer(input: string): boolean {
  const s = input.trim()
  if (!s || s.length > 254) return false
  if (s.includes('<') || s.includes('>')) return false
  return EMAIL_RE.test(s)
}
// WEC-407: order-notes cap. Mirrors the client maxLength={500} on the
// checkout textarea — protects the DB / admin view against megabyte payloads.
const NOTES_MAX_LEN = 500

function validatePayload(body: OrderPayload): Errors {
  const errors: Errors = {}

  // Contact (WEC-220)
  const customerName = body.customerName?.trim() ?? ''
  if (!customerName) {
    addError(errors, 'general', 'Customer name is required')
  } else if (customerName.length < 2) {
    addError(errors, 'general', 'Customer name must be at least 2 characters')
  }
  const customerEmail = body.customerEmail?.trim() ?? ''
  if (!customerEmail) {
    addError(errors, 'general', 'Customer email is required')
  } else if (!isValidEmailServer(customerEmail)) {
    addError(errors, 'general', 'Παρακαλώ εισάγετε μια έγκυρη διεύθυνση email / Please enter a valid email')
  }
  // WEC-407: server-side cap on order notes (mirror of client maxLength=500).
  if (typeof body.notes === 'string' && body.notes.length > NOTES_MAX_LEN) {
    addError(errors, 'general', `Τα σχόλια δεν μπορούν να ξεπερνούν τους ${NOTES_MAX_LEN} χαρακτήρες / Notes must be at most ${NOTES_MAX_LEN} characters`)
  }
  // Phone is optional at the schema level (logged-in users without one),
  // but if provided we sanity-check it has at least 8 digits so something
  // like "+30" or "abc" can't slip through.
  if (body.customerPhone) {
    const digits = body.customerPhone.replace(/\D/g, '')
    if (digits.length < 8) addError(errors, 'general', 'Customer phone is invalid')
  }

  if (!VALID_METHODS.includes(body.paymentMethod)) addError(errors, 'general', `Invalid payment method: ${body.paymentMethod}`)
  if (!body.days || body.days.length === 0) addError(errors, 'general', 'Order must have at least one day')

  // Invoice (WEC-237 + WEC-354) — if the toggle was on, the fields must be
  // present AND the VAT must pass the Greek ΑΦΜ checksum. Client also
  // validates; this is the server-side belt to the client braces, and the
  // only line of defence against curl bypasses.
  if (body.invoiceType) {
    const invName = body.invoiceName?.trim() ?? ''
    const invVatDigits = (body.invoiceVat ?? '').replace(/\D/g, '')
    if (!invName) addError(errors, 'general', 'Invoice: company or name is required')
    if (invVatDigits.length === 0) {
      addError(errors, 'general', 'Invoice: VAT number is required')
    } else if (invVatDigits.length !== 9) {
      addError(errors, 'general', 'Invoice: VAT must be 9 digits')
    } else if (!isValidGreekVatServer(invVatDigits)) {
      addError(errors, 'general', 'Invoice: invalid VAT — check the digits')
    }
  }

  for (let i = 0; i < (body.days ?? []).length; i++) {
    const day = body.days[i]
    const k = `day_${i}`
    // Date + items are server-only structural rules — no client equivalent.
    if (!day.deliveryDate) addError(errors, k, 'Delivery date is required')
    if (!day.items || day.items.length === 0) addError(errors, k, 'Day must have at least one item')

    // WEC-490: route fulfillment-typed structural checks (address vs pickup
    // location, time slot) through the shared validateDay() helper so the
    // server cannot drift from the client (WEC-489 was the lesson).
    //
    // Phase 1 passes BYPASS values for DB-bound rules: minOrderCents=0
    // (skip — Phase 3 below applies the real min from settings) and
    // zipInZone always-true (skip — Phase 3 matches against loaded zones).
    // pickupLocationCount=99 means "treat as multi-location config", so
    // a pickup day without a pickupLocationId is flagged — matching the
    // pre-WEC-490 server behaviour and the client's effective rule.
    const snap: DaySnapshot = {
      hasItems: (day.items?.length ?? 0) > 0,
      amountCents: 0,
      fulfillmentType: day.fulfillmentType ?? 'delivery',
      timeSlot: day.timeFrom && day.timeTo ? { from: day.timeFrom, to: day.timeTo } : null,
      street: day.addressStreet ?? null,
      area: day.addressArea ?? null,
      zip: day.addressZip ?? null,
      pickupLocationId: day.pickupLocationId ?? null,
    }
    const result = validateDay(snap, {
      minOrderCents: 0,
      pickupLocationCount: 99,
      zipInZone: () => true,
    })
    for (const issue of result.issues) {
      addError(errors, k, formatDayIssueForServer(issue))
    }
  }

  return errors
}

// ─── Order number generation ────────────────────────────────────────────────

function generateOrderNumber(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `FP-${yy}${mm}${dd}-${rand}`
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async (request: Request) => {
  // CORS preflight (WEC-146: origin allowlist via shared helper)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, 'POST, OPTIONS') })
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // WEC-147: rate limit (fail-open) — 10 order submissions / minute / IP.
  if (!(await checkRateLimit(`submit-order:${clientIp(request)}`, 10, 60))) {
    return Response.json(
      { error: 'Πολλές προσπάθειες παραγγελίας. Δοκίμασε ξανά σε λίγο. / Too many order attempts — please try again in a moment.' },
      { status: 429, headers: corsHeaders(request, 'POST, OPTIONS') },
    )
  }

  try {
    const body: OrderPayload = await request.json()

    // ─── Phase 1: Basic payload validation ──────────────────────────────
    const payloadErrors = validatePayload(body)
    if (Object.keys(payloadErrors).length > 0) {
      return Response.json({ error: 'Validation failed', validationErrors: payloadErrors }, { status: 400 })
    }

    // ─── Create Supabase client ─────────────────────────────────────────
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    let supabase
    if (token) {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    } else if (SUPABASE_SERVICE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    } else {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    }

    // WEC-359 (Bucket B): privileged money-mutation RPCs must run as service-role
    // so those SQL functions can be revoked from anon/authenticated. submit-order
    // is their only caller (redeem_voucher_for_order, wallet_debit_for_order,
    // unredeem_voucher_for_order). Falls back to `supabase` only when no service
    // key is configured (local dev) so the flow still works there.
    const svcRpc = SUPABASE_SERVICE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : supabase

    // WEC-143: derive userId ONLY from the verified JWT. We never trust
    // body.userId — an attacker could omit the Authorization header (taking the
    // service-role branch above) and send body.userId = "<victim>" to attribute
    // the order to another user. Guests legitimately resolve to userId = null.
    let userId: string | null = null
    if (token) {
      // WEC-511: pass the token EXPLICITLY. No-arg getUser() resolves from the
      // client's stored session, but this per-request client has
      // persistSession:false and no session set, so it could return null even
      // with a valid Authorization header — leaving a logged-in customer
      // treated as a guest (→ "Wallet payment requires login"). getUser(token)
      // validates the passed JWT directly against Supabase.
      const { data: { user } } = await supabase.auth.getUser(token)
      userId = user?.id ?? null
    }

    // ─── Impersonation attribution via X-Impersonator-Admin-Id ─────────
    //
    // Session-swap impersonation: the admin's session was swapped to the
    // customer's on impersonate-start, so the Authorization header is the
    // customer's token — `userId` is correctly the customer. For audit
    // trail purposes we capture WHICH admin placed this order in
    // `admin_order_id`. The client sends the admin's user_id in
    // X-Impersonator-Admin-Id; we validate it corresponds to a real admin
    // (row in `public.admin_users`) before trusting it.
    //
    // Why a header with just an id (not a token):
    //   - The convention is "admin signs out at exit" — there's no admin
    //     token still alive once the customer's session is in play.
    //   - Worst case forgery: someone fakes another admin's id as the
    //     attribution. The order is still legitimately the customer's
    //     (their JWT is the active session); only the audit column is
    //     wrong, not the order data. We also verify the id is a real
    //     admin so non-admin ids can't be smuggled in as attribution.
    let adminUserId: string | null = null
    let isImpersonating = false
    const claimedAdminId = request.headers.get('X-Impersonator-Admin-Id')
    if (claimedAdminId && SUPABASE_SERVICE_KEY) {
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const { data: adminRow } = await svc
        .from('admin_users')
        .select('user_id')
        .eq('user_id', claimedAdminId)
        .maybeSingle()
      if (adminRow) {
        adminUserId = claimedAdminId
        isImpersonating = true
        // Use service-role for the rest so admin_order_id can be written
        // without RLS edge cases on cross-user audit columns.
        supabase = svc
      }
      // If the id wasn't a real admin we silently drop it and proceed as
      // a normal customer submission. No leak risk.
    }

    // ─── Phase 2: Fetch all reference data in parallel ──────────────────

    const allVariantIds = [...new Set(body.days.flatMap((d) => d.items.map((it) => it.variantId)))]
    const allDishIds = [...new Set(body.days.flatMap((d) => d.items.map((it) => it.dishId)))]
    const allDates = [...new Set(body.days.map((d) => d.deliveryDate))]

    const [variantsRes, dishesRes, menuDaysRes, zonesRes, settingsRes] = await Promise.all([
      // Variant prices + macros
      supabase
        .from('dish_variants')
        .select('id, dish_id, price, calories, protein, carbs, fat, label_el, label_en')
        .in('id', allVariantIds),

      // Dish names + active status
      supabase
        .from('dishes')
        .select('id, name_el, name_en, active, category_id')
        .in('id', allDishIds),

      // Menu-day assignments (which dishes are on which dates)
      supabase
        .from('menu_day_dishes')
        .select('date, dish_id, menu_id, weekly_menus!inner(active)')
        .in('date', allDates)
        .eq('weekly_menus.active', true),

      // Delivery zones with postcodes + time slots
      supabase
        .from('delivery_zones')
        .select('id, name_el, name_en, postcodes, active, zone_time_slots(time_from, time_to, active)')
        .eq('active', true),

      // Cutoff + min-order + enabled-methods + bank IBANs (WEC-267) settings
      // WEC-492: also pull pickup_locations so a pickup-day child_order can
      // be written with the store's address in address_street/area instead
      // of NULLs. Without this, kitchen/admin/email can't tell pickup from a
      // delivery whose address fill failed.
      supabase
        .from('settings')
        .select('key, value')
        .in('key', ['cutoff_hour', 'cutoff_weekday_overrides', 'cutoff_date_overrides', 'min_order', 'payment_methods_enabled', 'bank_transfer_info', 'pickup_locations']),
    ])

    if (variantsRes.error) return Response.json({ error: 'Failed to look up item prices' }, { status: 500 })
    if (dishesRes.error) return Response.json({ error: 'Failed to look up dish info' }, { status: 500 })
    if (menuDaysRes.error) return Response.json({ error: 'Failed to verify menu availability' }, { status: 500 })
    if (zonesRes.error) return Response.json({ error: 'Failed to look up delivery zones' }, { status: 500 })
    // settings lookup failure is non-fatal — fall back to defaults

    const cutoffCfg = parseCutoffSettings(
      settingsRes.error ? null : (settingsRes.data as { key: string; value: unknown }[] | null),
    )

    // ── WEC-177 + WEC-255: server-side enabled-methods guard ────────────
    // Client UI already filters by this, but never trust it. Accepts both
    // the legacy array shape and the new {method: {public, admin}} object.
    // For the server check we accept any method where public OR admin is
    // true — admin-impersonation context is a UI distinction; server can't
    // reliably tell since session-swap impersonation uses the customer JWT.
    const methodsRow = (settingsRes.data ?? [] as { key: string; value: unknown }[])
      .find((r: { key: string }) => r.key === 'payment_methods_enabled')
    if (methodsRow) {
      let allowed: Set<string> | null = null
      if (Array.isArray(methodsRow.value)) {
        const arr = methodsRow.value as string[]
        if (arr.length > 0) allowed = new Set(arr)
      } else if (methodsRow.value && typeof methodsRow.value === 'object') {
        const obj = methodsRow.value as Record<string, { public?: boolean; admin?: boolean }>
        allowed = new Set(
          Object.entries(obj)
            .filter(([, v]) => v && (v.public === true || v.admin === true))
            .map(([k]) => k),
        )
      }
      if (allowed && !allowed.has(body.paymentMethod)) {
        return Response.json(
          { error: `Payment method "${body.paymentMethod}" is not enabled`, validationErrors: { general: [`Payment method "${body.paymentMethod}" is not enabled`] } },
          { status: 400 },
        )
      }
    }

    // ── WEC-177: wallet method needs a logged-in user ────────────────────
    if (body.paymentMethod === 'wallet' && !userId) {
      return Response.json(
        { error: 'Wallet payment requires login', validationErrors: { general: ['Wallet payment requires login'] } },
        { status: 401 },
      )
    }
    const today = todayIso()
    const nowMs = Date.now()

    // Build lookup maps
    const variantMap = new Map((variantsRes.data ?? []).map((v: any) => [v.id, v]))
    const dishMap = new Map((dishesRes.data ?? []).map((d: any) => [d.id, d]))

    // Menu availability: set of "date|dishId" pairs that are valid
    const menuAvailability = new Set<string>()
    for (const row of (menuDaysRes.data ?? []) as any[]) {
      menuAvailability.add(`${row.date}|${row.dish_id}`)
    }

    // Zone lookup: area name → zone (with time slots)
    // Zones have a `postcodes` array; we also match by area name for flexibility
    const zones = (zonesRes.data ?? []) as any[]

    // WEC-492: pickup-location lookup. Used to populate address_street/area
    // on child_orders for pickup days, so downstream consumers (admin drawer,
    // emails, Airtable, kitchen) see a non-empty address instead of NULLs.
    // The fulfillment_type column still distinguishes pickup from delivery
    // — this just makes the row legible to anything that only reads address.
    const rawPickupLocs = (settingsRes.data ?? []).find((r: { key: string }) => r.key === 'pickup_locations')?.value
    const pickupLocsList: Array<{ id?: string; name_el?: string; name_en?: string; address?: string }> =
      Array.isArray(rawPickupLocs) ? rawPickupLocs : []
    const pickupLocById = new Map(pickupLocsList.filter((l) => typeof l.id === 'string').map((l) => [l.id!, l]))

    /**
     * Resolve the address fields to write into `child_orders` for one day.
     * For delivery days: passes through the customer-entered values.
     * For pickup days: writes the pickup location's name + address so the
     * row is readable; address_zip stays null (pickup has no postcode).
     */
    function resolveAddressFields(day: OrderPayload['days'][number]) {
      const isPickup = day.fulfillmentType === 'pickup'
      if (isPickup) {
        const loc = day.pickupLocationId ? pickupLocById.get(day.pickupLocationId) : null
        return {
          address_street: loc?.address?.trim() || '',     // e.g. "Δ. Σολωμού 24, Αθήνα"
          address_area:   loc?.name_el?.trim() || loc?.name_en?.trim() || '', // e.g. "Fitpal Spot"
          address_zip:    null,
          address_floor:  null,
          address_doorbell: null,
          address_notes:  null,
        }
      }
      return {
        address_street: day.addressStreet,
        address_area:   day.addressArea,
        address_zip:    day.addressZip?.replace(/\s/g, '') ?? null,
        address_floor:  day.addressFloor ?? null,
        address_doorbell: day.addressDoorbell ?? null,
        address_notes:  day.addressNotes ?? null,
      }
    }

    // ─── Phase 3: Deep validation ───────────────────────────────────────

    const errors: Errors = {}
    let orderSubtotal = 0
    const dayTotals: number[] = []

    for (let i = 0; i < body.days.length; i++) {
      const day = body.days[i]
      const k = `day_${i}`
      let dayTotal = 0

      // 3a-pre. Delivery date must be today or later, and cutoff must not have passed.
      // Both `today` and the cutoff are computed in Europe/Athens (WEC-205).
      if (day.deliveryDate < today) {
        addError(errors, k, `Delivery date ${day.deliveryDate} is in the past`)
      } else {
        // WEC-204: silent 5-min grace after the displayed cutoff. A customer
        // who pressed Place at 17:59 and whose submit lands at 18:01 should
        // succeed — the visible cutoff says 18:00, the gate is 18:05.
        const cutoffMs = getCutoffMs(day.deliveryDate, cutoffCfg)
        if (nowMs >= cutoffMs + CUTOFF_GRACE_MS) {
          addError(errors, k, `Ordering cutoff for ${day.deliveryDate} has passed`)
        }
      }

      // 3a. Validate each item: dish active, variant exists, on menu for this date
      for (const item of day.items) {
        const dish = dishMap.get(item.dishId)
        const variant = variantMap.get(item.variantId)

        if (!dish) {
          addError(errors, k, `Dish "${item.dishId}" not found`)
          continue
        }
        if (!dish.active) {
          addError(errors, k, `"${dish.name_en}" is no longer available`)
          continue
        }
        if (!variant) {
          addError(errors, k, `Variant "${item.variantId}" not found for "${dish.name_en}"`)
          continue
        }
        if (variant.dish_id !== item.dishId) {
          addError(errors, k, `Variant "${item.variantId}" does not belong to dish "${dish.name_en}"`)
          continue
        }

        // Check dish is on the menu for this specific date
        if (!menuAvailability.has(`${day.deliveryDate}|${item.dishId}`)) {
          addError(errors, k, `"${dish.name_en}" is not on the menu for ${day.deliveryDate}`)
          continue
        }

        dayTotal += variant.price * item.quantity
      }

      // 3b. Minimum order per day
      if (dayTotal > 0 && dayTotal < cutoffCfg.minOrderCents) {
        addError(errors, k, `Minimum order is €${(cutoffCfg.minOrderCents / 100).toFixed(2)} (current: €${(dayTotal / 100).toFixed(2)})`)
      }

      // 3c. Delivery zone — postcode only. Zone names are admin-organisational
      // labels, never matched against the customer's free-text area field.
      //
      // WEC-259: Skip the zone check entirely on pickup days — there's no
      // address to validate. Pickup days still need a time slot but use the
      // same global slot list (no per-fulfillment slot setting in V1).
      const isPickup = day.fulfillmentType === 'pickup'
      const zip = day.addressZip?.replace(/\s/g, '')
      let matchedZone: any = null
      if (isPickup) {
        // No-op for pickup; no address fields validated.
      } else if (!zip) {
        addError(errors, k, 'Postcode is required to determine delivery zone')
      } else {
        matchedZone = zones.find((z: any) => Array.isArray(z.postcodes) && z.postcodes.includes(zip)) ?? null
        if (!matchedZone) {
          addError(errors, k, `Postcode ${day.addressZip} is not in any active delivery zone. Ask an admin to assign it to a zone under /admin/zones.`)
        }
      }

      // 3d. Time slot validation
      if (matchedZone && day.timeFrom && day.timeTo) {
        const zoneSlots = (matchedZone.zone_time_slots ?? []).filter((s: any) => s.active)

        // Normalize time format: ensure HH:MM format for comparison
        const normalizeTime = (t: string) => {
          const parts = t.split(':')
          return `${parts[0].padStart(2, '0')}:${parts[1] ?? '00'}`
        }

        const reqFrom = normalizeTime(day.timeFrom)
        const reqTo = normalizeTime(day.timeTo)

        const slotMatch = zoneSlots.some((s: any) => {
          const slotFrom = normalizeTime(s.time_from)
          const slotTo = normalizeTime(s.time_to)
          return slotFrom === reqFrom && slotTo === reqTo
        })

        if (!slotMatch) {
          addError(errors, k, `Time slot ${day.timeFrom}–${day.timeTo} is not available for this zone`)
        }
      }

      dayTotals.push(dayTotal)
      orderSubtotal += dayTotal
    }

    // Return all validation errors at once
    if (Object.keys(errors).length > 0) {
      return Response.json({ error: 'Order validation failed', validationErrors: errors }, { status: 400 })
    }

    // ─── Phase 4: Voucher validation + discount calculation ──────────────

    let discountAmount = 0
    let voucherId: string | null = null

    if (body.voucherCode) {
      const vCode = body.voucherCode.trim().toUpperCase()

      const { data: voucher, error: vcErr } = await supabase
        .from('vouchers')
        .select('*')
        .eq('code', vCode)
        .single()

      if (vcErr || !voucher) {
        return Response.json({ error: `Invalid voucher code: ${vCode}`, validationErrors: { voucher: ['Invalid voucher code'] } }, { status: 400 })
      }

      // Validate voucher
      if (!voucher.active) {
        return Response.json({ error: 'Voucher is no longer active', validationErrors: { voucher: ['Voucher is no longer active'] } }, { status: 400 })
      }
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return Response.json({ error: 'Voucher has expired', validationErrors: { voucher: ['Voucher has expired'] } }, { status: 400 })
      }
      if (voucher.max_uses != null && voucher.uses_count >= voucher.max_uses) {
        return Response.json({ error: 'Voucher usage limit reached', validationErrors: { voucher: ['Voucher usage limit reached'] } }, { status: 400 })
      }
      if (voucher.min_order != null && orderSubtotal < voucher.min_order) {
        return Response.json({ error: 'Order does not meet minimum for this voucher', validationErrors: { voucher: ['Minimum order not met'] } }, { status: 400 })
      }
      if (userId && voucher.per_user_limit != null) {
        const { count } = await supabase
          .from('voucher_uses')
          .select('id', { count: 'exact', head: true })
          .eq('voucher_id', voucher.id)
          .eq('user_id', userId)
        if ((count ?? 0) >= voucher.per_user_limit) {
          return Response.json({ error: 'You have already used this voucher', validationErrors: { voucher: ['Already used'] } }, { status: 400 })
        }
      }

      // WEC-262: scope discount to a subset of categories when configured.
      // Empty array → applies to entire order (legacy behaviour).
      // Non-empty array → discount applies only to the items whose dishes'
      // category_id is in that list. Voucher is rejected if no cart items
      // qualify, with generic anti-enumeration wording (per WEC-148).
      const scopedCats = Array.isArray(voucher.applicable_category_ids) ? (voucher.applicable_category_ids as string[]) : []
      let discountBase = orderSubtotal
      if (scopedCats.length > 0) {
        let eligible = 0
        for (const day of body.days) {
          for (const item of day.items) {
            const dish = dishMap.get(item.dishId) as { category_id?: string } | undefined
            const variant = variantMap.get(item.variantId) as { price?: number } | undefined
            if (!dish || !variant) continue
            if (typeof dish.category_id === 'string' && scopedCats.includes(dish.category_id)) {
              eligible += (variant.price ?? 0) * item.quantity
            }
          }
        }
        if (eligible <= 0) {
          return Response.json({ error: 'Voucher not applicable', validationErrors: { voucher: ['Voucher not applicable to your selection'] } }, { status: 400 })
        }
        discountBase = eligible
      }

      // Calculate discount (all values in cents). Caps at discountBase so we
      // never refund more than the eligible items even with fixed/credit
      // vouchers worth more than the eligible total.
      if (voucher.type === 'pct') {
        discountAmount = Math.round(discountBase * voucher.value / 100)
      } else if (voucher.type === 'fixed') {
        discountAmount = Math.min(voucher.value, discountBase)
      } else if (voucher.type === 'credit') {
        discountAmount = Math.min(voucher.remaining ?? 0, discountBase)
      }

      voucherId = voucher.id
    }

    const orderTotal = orderSubtotal - discountAmount

    // ─── Phase 5: Insert order ──────────────────────────────────────────

    const orderNumber = generateOrderNumber()

    // WEC-390/392: admin-placed orders are recorded structurally via
    // `admin_order_id` (the impersonating admin's user_id) — that's the
    // provenance the admin UI renders as a read-only line. `admin_notes` is
    // left empty so it stays a free-text field for the team (kitchen /
    // packaging / management), NOT provenance.

    // WEC-418: promote-from-draft path. If the client sent a draft_id, atomically
    // UPDATE that row to status='pending' (guarded by WHERE status='draft' for
    // idempotency — a concurrent retry won't double-promote). Otherwise fall
    // back to the legacy INSERT path (any client/admin flow without a draft).
    const orderRecord = {
      order_number: orderNumber,
      user_id: userId,
      customer_name: body.customerName,
      customer_email: body.customerEmail,
      customer_phone: body.customerPhone ?? null,
      subtotal: orderSubtotal,
      discount_amount: discountAmount,
      total: orderTotal,
      payment_method: body.paymentMethod,
      payment_status: 'pending',
      status: 'pending',
      cutlery: body.cutlery,
      invoice_type: body.invoiceType ?? null,
      invoice_name: body.invoiceName ?? null,
      invoice_vat: body.invoiceVat ?? null,
      notes: body.notes ?? null,
      admin_order_id: adminUserId,
      admin_notes: null,
      updated_at: new Date().toISOString(),
    }

    // Time normaliser used both by the JS-side insert loop (legacy path)
    // and to build the RPC payload (WEC-429 #2 atomic-promote path).
    const fmtTime = (t: string) => {
      const parts = t.split(':')
      return `${parts[0].padStart(2, '0')}:${(parts[1] ?? '00').padStart(2, '0')}:00`
    }

    let orderId: string
    // WEC-429 #2: when promoting a draft, the RPC also writes child_orders +
    // order_items in the same transaction. We flip this flag so the legacy
    // JS-side insert loop below is skipped — otherwise we'd double-insert.
    let childrenAlreadyInserted = false

    // WEC-452: ownership sanity-check is fail-soft. A foreign / missing /
    // unreadable draft must not be PROMOTED (security: prevent vandalism +
    // metadata theft of someone else's draft) — but it must also not BLOCK
    // the customer's order. Stale draftIds accumulate in localStorage across
    // sessions (auth changes, demo→real user, multi-device); a hard 403/404
    // there leaves the customer with no recovery path. So: log the case, fall
    // through to the fresh-INSERT branch below.
    let promoteFromDraft = !!body.draftId
    if (body.draftId) {
      const { data: existingDraft, error: selErr } = await supabase
        .from('orders')
        .select('id, status, user_id')
        .eq('id', body.draftId)
        .maybeSingle()
      if (selErr) {
        console.warn('[submit-order] draft lookup failed — falling back to fresh order. draftId=%s err=%s', body.draftId, selErr.message)
        promoteFromDraft = false
      } else if (!existingDraft) {
        console.warn('[submit-order] stale draftId in client (not found in DB), proceeding fresh. draftId=%s', body.draftId)
        promoteFromDraft = false
      } else {
        const draftOwner = (existingDraft as { user_id: string | null }).user_id
        if (draftOwner && draftOwner !== userId) {
          console.warn('[submit-order] draft ownership mismatch — refusing to promote (security), creating fresh order. draftId=%s draftOwner=%s caller=%s', body.draftId, draftOwner, userId ?? 'guest')
          promoteFromDraft = false
        }
      }
    }

    if (promoteFromDraft) {
      // WEC-429 #2: single-RPC promote. Wraps SELECT-FOR-UPDATE +
      // DELETE child_orders + INSERT child_orders + INSERT order_items +
      // UPDATE orders.status='pending' in one transaction. Closes the
      // ~50ms window where the old JS-level UPDATE→DELETE→INSERT loop
      // let an admin see a 'pending' order with zero days/items.
      const childrenPayload = body.days.map((day) => ({
        delivery_date: day.deliveryDate,
        time_from: fmtTime(day.timeFrom),
        time_to: fmtTime(day.timeTo),
        // WEC-492: address fields come from resolveAddressFields() so pickup
        // days get the store's address instead of NULLs.
        ...resolveAddressFields(day),
        fulfillment_type: day.fulfillmentType ?? 'delivery',
        pickup_location_id: day.fulfillmentType === 'pickup' ? (day.pickupLocationId ?? null) : null,
        items: day.items.map((item) => {
          const variant = variantMap.get(item.variantId)!
          const dish = dishMap.get(item.dishId)
          return {
            dish_id: item.dishId,
            variant_id: item.variantId,
            name_el: dish?.name_el ?? '',
            name_en: dish?.name_en ?? '',
            variant_label_el: variant.label_el ?? null,
            variant_label_en: variant.label_en ?? null,
            quantity: item.quantity,
            unit_price: variant.price,
            total_price: variant.price * item.quantity,
            calories: variant.calories ?? null,
            protein: variant.protein ?? null,
            carbs: variant.carbs ?? null,
            fat: variant.fat ?? null,
            comment: item.comment ?? null,
          }
        }),
      }))
      // Strip admin_notes (column-not-present on the patch path; the RPC
      // doesn't touch it). updated_at is set inside the RPC via now().
      const { admin_notes: _adminNotes, updated_at: _updatedAt, ...orderPatch } = orderRecord
      // WEC-452: at this point promoteFromDraft is true, which we only set when
      // body.draftId was truthy AND passed the ownership check. TS doesn't
      // narrow across the let-reassign, so assert non-null.
      const { data: rpcRows, error: rpcErr } = await supabase.rpc('promote_draft_atomic', {
        p_order_id: body.draftId!,
        p_order_patch: orderPatch,
        p_children: childrenPayload,
      })
      if (rpcErr) {
        if ((rpcErr as { code?: string }).code === 'P0002') {
          return Response.json({ error: 'Draft not found' }, { status: 404 })
        }
        console.error('promote_draft_atomic failed:', rpcErr)
        return Response.json({ error: 'Failed to promote draft' }, { status: 500 })
      }
      const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
      // RETURNS column is `promoted_order_id` (not `order_id`) — renamed to
      // avoid plpgsql ambiguity with `child_orders.order_id` inside the fn.
      if (!row?.promoted_order_id) {
        return Response.json({ error: 'Promote returned no row' }, { status: 500 })
      }
      orderId = row.promoted_order_id as string
      childrenAlreadyInserted = true
    } else {
      const { data: orderRow, error: oErr } = await supabase
        .from('orders')
        .insert(orderRecord)
        .select('id')
        .single()
      if (oErr || !orderRow) {
        console.error('Order insert error:', oErr)
        return Response.json({ error: 'Failed to create order' }, { status: 500 })
      }
      orderId = orderRow.id
    }

    // ─── Insert child orders + items (legacy non-draft path only) ───────
    // WEC-429 #2: when promoting from a draft, the RPC already wrote these
    // rows atomically. Skip the JS-side loop to avoid double-inserting.

    for (let i = 0; i < body.days.length && !childrenAlreadyInserted; i++) {
      const day = body.days[i]

      const { data: childRow, error: cErr } = await supabase
        .from('child_orders')
        .insert({
          order_id: orderId,
          delivery_date: day.deliveryDate,
          time_from: fmtTime(day.timeFrom),
          time_to: fmtTime(day.timeTo),
          // WEC-492: same resolver as the promote-from-draft path above — pickup
          // days write the store's address into address_street/area, delivery
          // days pass through the customer-entered values. Address_zip is
          // normalized inside the resolver.
          ...resolveAddressFields(day),
          // WEC-259: per-day fulfillment.
          fulfillment_type: day.fulfillmentType ?? 'delivery',
          pickup_location_id: day.fulfillmentType === 'pickup' ? (day.pickupLocationId ?? null) : null,
        })
        .select('id')
        .single()

      if (cErr || !childRow) {
        console.error('Child order insert error:', cErr)
        return Response.json({ error: `Failed to create child order for ${day.deliveryDate}` }, { status: 500 })
      }

      const itemRows = day.items.map((item) => {
        const variant = variantMap.get(item.variantId)!
        const dish = dishMap.get(item.dishId)

        return {
          child_order_id: childRow.id,
          dish_id: item.dishId,
          variant_id: item.variantId,
          name_el: dish?.name_el ?? '',
          name_en: dish?.name_en ?? '',
          variant_label_el: variant.label_el ?? null,
          variant_label_en: variant.label_en ?? null,
          quantity: item.quantity,
          unit_price: variant.price,
          total_price: variant.price * item.quantity,
          calories: variant.calories ?? null,
          protein: variant.protein ?? null,
          carbs: variant.carbs ?? null,
          fat: variant.fat ?? null,
          comment: item.comment ?? null,
        }
      })

      const { error: iErr } = await supabase
        .from('order_items')
        .insert(itemRows)

      if (iErr) {
        console.error('Items insert error:', iErr)
        return Response.json({ error: `Failed to insert items for ${day.deliveryDate}` }, { status: 500 })
      }
    }

    // ─── Record voucher usage (WEC-211 + WEC-144) ──────────────────────
    //
    // Routes through `redeem_voucher_for_order` — a SECURITY DEFINER RPC
    // that locks the voucher row, re-validates max_uses/per_user_limit/
    // credit remaining (closes the redemption race), inserts voucher_uses,
    // and increments uses_count + decrements remaining atomically.
    //
    // Why an RPC instead of a JS-side insert + update:
    //   - voucher_uses had no INSERT RLS policy for non-admin callers,
    //     so the previous JS insert silently failed under RLS for
    //     authenticated customers (testBot S07 caught this — discount
    //     applied to order, voucher_uses row never landed).
    //   - The previous JS update had a TOCTOU gap between the limit
    //     check (Phase 4) and the increment (here) — two concurrent
    //     orders could both pass the limit check and both commit.
    //
    // Failure path: roll back the order (cascade cleans child_orders +
    // order_items + voucher_uses) and surface the specific reason. We
    // don't need to call unredeem here because no voucher_uses row was
    // ever created if the RPC raised.

    if (voucherId && discountAmount > 0) {
      const { error: redeemErr } = await svcRpc.rpc('redeem_voucher_for_order', {
        p_voucher_id: voucherId,
        p_user_id: userId,
        p_order_id: orderId,
        p_amount_cents: discountAmount,
      })
      if (redeemErr) {
        const msg = redeemErr.message ?? ''
        console.error('redeem_voucher_for_order failed for orderId=%s:', orderId, redeemErr)
        await supabase.from('orders').delete().eq('id', orderId)

        let userMsg = 'Voucher redemption failed'
        if (msg.includes('voucher_not_found'))             userMsg = 'Voucher not found'
        else if (msg.includes('voucher_inactive'))         userMsg = 'Voucher is no longer active'
        else if (msg.includes('voucher_expired'))          userMsg = 'Voucher has expired'
        else if (msg.includes('voucher_max_uses_reached')) userMsg = 'Voucher usage limit reached'
        else if (msg.includes('voucher_per_user_limit_reached')) userMsg = 'You have already used this voucher'
        else if (msg.includes('voucher_insufficient_credit'))    userMsg = 'Voucher does not have enough credit for this order'

        return Response.json(
          { error: userMsg, validationErrors: { voucher: [userMsg] } },
          { status: 400 },
        )
      }
    }

    // ─── Phase 6: Payment-method-specific finalization ──────────────────
    //
    // card / link → Viva Smart Checkout (WEC-171)
    // wallet      → atomic debit via RPC (WEC-177, closes WEC-145)
    // cash        → pending until admin marks on delivery
    // transfer    → pending until admin reconciles bank statement

    let paymentUrl: string | null = null
    let paymentSetupFailed = false
    let paidStatus: 'paid' | 'pending' = 'pending'

    if (body.paymentMethod === 'card' || body.paymentMethod === 'link') {
      try {
        const result = await createVivaOrder({
          orderId,
          amountCents: orderTotal,
          customerEmail: body.customerEmail,
          customerFullName: body.customerName,
          mode: body.paymentMethod,
        })
        paymentUrl = result.paymentUrl
      } catch (err) {
        console.error('Viva create-order failed for orderId=%s:', orderId, err)
        paymentSetupFailed = true
        // Order row stays pending, admin can regenerate via WEC-176.
      }
    } else if (body.paymentMethod === 'wallet') {
      // Atomic: lock wallet, verify balance, debit, record tx, mark order paid.
      // If the RPC raises P0002 (insufficient balance), roll back.
      const { error: debitErr } = await svcRpc.rpc('wallet_debit_for_order', {
        p_order_id: orderId,
        p_user_id: userId,
        p_amount_cents: orderTotal,
      })
      if (debitErr) {
        const code = (debitErr as { code?: string }).code ?? ''
        const msg = debitErr.message ?? ''
        console.error('wallet_debit_for_order failed for orderId=%s:', orderId, debitErr)
        // Roll back voucher BEFORE touching the order — unredeem_voucher_for_order
        // reverses uses_count + remaining, then deletes the voucher_uses row. The
        // FK cascade on order delete would only remove the use row, leaving the
        // counters incremented (existing pre-WEC-211 bug, fixed here).
        if (voucherId) {
          await svcRpc.rpc('unredeem_voucher_for_order', { p_order_id: orderId })
        }
        // WEC-429 #1: roll back the order row.
        //   - Legacy path (no draftId)  → DELETE (cascade cleans child_orders + items).
        //   - Promote-from-draft path   → REVERT to status='draft' + clear order_number.
        //     The whole point of WEC-414 drafts is that an after-form failure
        //     leaves the user's state intact so they can switch payment method
        //     without re-filling everything. Deleting wiped it.
        //     voucher_uses is already gone (unredeem above), and the
        //     wec421_block_voucher_uses_on_drafts trigger keeps it that way.
        // WEC-452: gate on promoteFromDraft (not body.draftId) so that a stale
        // /foreign draftId that we silently rejected at the top doesn't trick
        // this rollback into marking a brand-new (non-draft) order as 'draft'.
        if (promoteFromDraft) {
          await supabase.from('orders').update({
            status: 'draft',
            order_number: null,
            payment_status: 'pending',
            updated_at: new Date().toISOString(),
          }).eq('id', orderId)
        } else {
          await supabase.from('orders').delete().eq('id', orderId)
        }
        if (code === 'P0002' || msg.includes('insufficient_balance')) {
          return Response.json(
            { error: 'Insufficient wallet balance', validationErrors: { general: ['Insufficient wallet balance'] } },
            { status: 402 },
          )
        }
        if (code === 'P0001' || msg.includes('wallet_not_found')) {
          return Response.json(
            { error: 'No wallet found for this user', validationErrors: { general: ['No wallet found for this user'] } },
            { status: 400 },
          )
        }
        return Response.json(
          { error: 'Wallet debit failed', validationErrors: { general: [msg || 'Wallet debit failed'] } },
          { status: 500 },
        )
      }
      paidStatus = 'paid'
    }

    // ─── Success ────────────────────────────────────────────────────────

    // Fire-and-forget Klaviyo event so the Order Placed email flow can
    // pick up. No-op if KLAVIYO_API_KEY isn't set. We never block order
    // submission on email infrastructure — see netlify/lib/klaviyo.ts.
    //
    // Payload is rich enough that the email template doesn't need to make
    // any DB lookups. It iterates `event.days` and `day.items` and the
    // template variables substitute display name, variant label, prices,
    // macros, daily totals, etc.
    //
    // 2026-06-26 launch-blocker fix: the Klaviyo template (SMwaE8 Greek,
    // VB3CqW English) was authored using snake_case field names matching
    // notify-order-updated.ts (e.g. `name_el`, `total_price`, `qty`,
    // `day_label_el`, `time_window`, `address`, `order_number`,
    // `payment_method`, `discount_amount`, `bank_name`). submit-order
    // previously sent camelCase (`nameEl`, `lineTotal`, `quantity`,
    // `deliveryDate`, `orderNumber`, `paymentMethod`, etc.) so the
    // template's `{% if item.qty > 1 %}` and `{% if event.discount_amount > 0 %}`
    // raised TypeError (None > int) and Klaviyo silently skipped every
    // single send under the misleading reason "Skipped: Email Syntax Error".
    // Verified by hitting the render-template API directly: snake_case
    // payload renders cleanly, camelCase payload errors. See the fix in
    // both `klaviyoDays` and `orderPlacedProperties` below.
    // We emit BOTH naming schemes so any downstream consumer (Airtable
    // mirror, ad-hoc analytics, debugging) keeps working.

    // Helpers mirror notify-order-updated.ts so both event payloads
    // present identically to the template engine.
    function _dayLabelFor(iso: string): { el: string; en: string } {
      const d = new Date(iso + 'T12:00:00Z')
      const dow = d.getUTCDay() // 0=Sun..6=Sat
      const elDow = ['Κυριακή','Δευτέρα','Τρίτη','Τετάρτη','Πέμπτη','Παρασκευή','Σάββατο'][dow]
      const enDow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow]
      const dd = d.getUTCDate().toString().padStart(2, '0')
      const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
      return { el: `${elDow} ${dd}/${mm}`, en: `${enDow} ${dd}/${mm}` }
    }
    function _fmtTime(t: string): string {
      // 'HH:MM:SS' or 'HH:MM' → 'HH:MM'. Tolerant of either input.
      return typeof t === 'string' ? t.slice(0, 5) : ''
    }

    const klaviyoDays = body.days.map((d) => {
      const enrichedItems = d.items.map((it) => {
        const variant = variantMap.get(it.variantId) as
          | { price: number; calories: number | null; protein: number | null; carbs: number | null; fat: number | null; label_el: string | null; label_en: string | null }
          | undefined
        const dish = dishMap.get(it.dishId) as { name_el: string | null; name_en: string | null } | undefined
        const unitPriceCents = variant?.price ?? 0
        const lineTotalCents = unitPriceCents * it.quantity
        const cal     = (variant?.calories ?? 0) * it.quantity
        const protein = (variant?.protein  ?? 0) * it.quantity
        const carbs   = (variant?.carbs    ?? 0) * it.quantity
        const fat     = (variant?.fat      ?? 0) * it.quantity
        return {
          // ── snake_case (template expects these) ──────────────────────
          name_el: dish?.name_el ?? '',
          name_en: dish?.name_en ?? '',
          variant_label_el: variant?.label_el ?? '',
          variant_label_en: variant?.label_en ?? '',
          qty: it.quantity,
          unit_price: unitPriceCents / 100,
          total_price: lineTotalCents / 100,
          // ── camelCase (legacy / downstream compat) ───────────────────
          dishId: it.dishId,
          variantId: it.variantId,
          nameEl: dish?.name_el ?? '',
          nameEn: dish?.name_en ?? '',
          variantLabelEl: variant?.label_el ?? null,
          variantLabelEn: variant?.label_en ?? null,
          quantity: it.quantity,
          unitPrice: unitPriceCents / 100,
          lineTotal: lineTotalCents / 100,
          // Per-line macros (per-unit × qty). Templates can also derive
          // unit values from `unitMacros` if they need to display them.
          calories: cal,
          protein,
          carbs,
          fat,
          unitMacros: {
            calories: variant?.calories ?? 0,
            protein: variant?.protein ?? 0,
            carbs: variant?.carbs ?? 0,
            fat: variant?.fat ?? 0,
          },
          comment: it.comment ?? '',
        }
      })

      // Daily roll-ups so the template can show day-level totals without
      // re-summing in Django syntax (which is awkward).
      const daySubtotalCents = enrichedItems.reduce((s, i) => s + Math.round(i.total_price * 100), 0)
      const dayCalories = enrichedItems.reduce((s, i) => s + i.calories, 0)
      const dayProtein  = enrichedItems.reduce((s, i) => s + i.protein, 0)
      const dayCarbs    = enrichedItems.reduce((s, i) => s + i.carbs, 0)
      const dayFat      = enrichedItems.reduce((s, i) => s + i.fat, 0)
      const dayItemCount = enrichedItems.reduce((s, i) => s + i.qty, 0)
      const dayLabels = _dayLabelFor(d.deliveryDate)
      const timeWindow = d.timeFrom && d.timeTo
        ? `${_fmtTime(d.timeFrom)}–${_fmtTime(d.timeTo)}`
        : ''
      const addressLine = [d.addressStreet, d.addressZip, d.addressArea]
        .filter(Boolean)
        .join(', ')

      return {
        // ── snake_case (template expects these) ──────────────────────
        date: d.deliveryDate,
        day_label_el: dayLabels.el,
        day_label_en: dayLabels.en,
        time_window: timeWindow,
        address: addressLine,
        day_total: daySubtotalCents / 100,
        day_macros: {
          calories: dayCalories,
          protein: dayProtein,
          carbs: dayCarbs,
          fat: dayFat,
        },
        // ── camelCase (legacy / downstream compat) ───────────────────
        deliveryDate: d.deliveryDate,
        timeFrom: d.timeFrom,
        timeTo: d.timeTo,
        addressStreet: d.addressStreet,
        addressArea: d.addressArea,
        addressZip: d.addressZip ?? null,
        items: enrichedItems,
        subtotal: daySubtotalCents / 100,
        itemCount: dayItemCount,
        macros: {
          calories: dayCalories,
          protein: dayProtein,
          carbs: dayCarbs,
          fat: dayFat,
        },
      }
    })

    // WEC-267: parse the bank-IBAN settings into an array and pass it to
    // the Klaviyo event so the order-confirmation template can render
    // every configured IBAN. Accepts both shapes (legacy single object,
    // new array per WEC-260). Empty array if the operator hasn't
    // configured any IBANs — the template just renders nothing.
    const rawBankInfos = (settingsRes.data ?? [] as { key: string; value: unknown }[])
      .find((r: { key: string }) => r.key === 'bank_transfer_info')?.value
    const bankList = Array.isArray(rawBankInfos)
      ? (rawBankInfos as unknown[])
      : (rawBankInfos && typeof rawBankInfos === 'object' ? [rawBankInfos] : [])
    // Bank transfer entries — emit BOTH bank_name (snake, what the
    // template iterates) and bankName (camel, legacy/downstream).
    const bankTransferInfos = bankList
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((o) => {
        const name = typeof o.bankName === 'string' ? o.bankName : null
        return {
          iban: typeof o.iban === 'string' ? o.iban : '',
          beneficiary: typeof o.beneficiary === 'string' ? o.beneficiary : '',
          bank_name: name,
          bankName: name,
        }
      })
      .filter((e) => e.iban.length > 0)

    const totalItems = body.days.reduce(
      (s, d) => s + d.items.reduce((ss, it) => ss + it.quantity, 0),
      0,
    )
    const allDaysMacros = klaviyoDays.reduce(
      (acc, d) => ({
        calories: acc.calories + d.day_macros.calories,
        protein:  acc.protein  + d.day_macros.protein,
        carbs:    acc.carbs    + d.day_macros.carbs,
        fat:      acc.fat      + d.day_macros.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    )

    // WEC-486: extract the Order Placed payload into a const so we can reuse
    // it for the admin BCC fan-out below without duplicating 30 lines.
    //
    // Template expects snake_case top-level fields (order_number,
    // discount_amount, payment_method, first_name, etc.). camelCase is
    // also emitted for downstream compat. See klaviyoDays comment above
    // for the full backstory of the naming-mismatch bug (2026-06-26).
    const firstName = (body.customerName ?? '').split(' ')[0] ?? ''
    const orderPlacedProperties = {
      // WEC-433+: lang routes EL vs EN templates inside the Klaviyo flow.
      // Comes from the request body (set by CheckoutPage from useUIStore.lang)
      // and falls back to 'el' (Greece-first default).
      lang: (body.lang === 'en' || body.lang === 'el') ? body.lang : 'el',
      // ── snake_case (template-expected) ────────────────────────────
      first_name: firstName,
      order_number: orderNumber,
      total: orderTotal / 100,
      subtotal: orderSubtotal / 100,
      discount_amount: discountAmount / 100,
      payment_method: body.paymentMethod,
      payment_status: paidStatus,
      placed_by_admin: isImpersonating,
      admin_user_id: adminUserId ?? null,
      day_count: body.days.length,
      item_count: totalItems,
      total_macros: allDaysMacros,
      // Default isUpdate=false so the {% if event.isUpdate %} subject
      // branch behaves predictably on first-send.
      isUpdate: false,
      // ── camelCase (legacy / downstream compat) ────────────────────
      orderId,
      orderNumber,
      discountAmount: discountAmount / 100,
      paymentMethod: body.paymentMethod,
      paymentStatus: paidStatus,
      placedByAdmin: isImpersonating,
      adminUserId: adminUserId ?? null,
      dayCount: body.days.length,
      itemCount: totalItems,
      totalMacros: allDaysMacros,
      // WEC-267: array of IBAN entries — template iterates with the
      // {% for iban_entry in event.bank_transfer_infos %} loop.
      bank_transfer_infos: bankTransferInfos,
      // Back-compat: keep the singular field too in case the old template
      // is still live in some environments. First IBAN, or empty object.
      bank_transfer_info: bankTransferInfos[0] ?? null,
      // Day-by-day breakdown the email template can iterate over.
      days: klaviyoDays,
    }

    // 2026-06-24 incident fix: collect customer + admin BCC Klaviyo events,
    // await them all via Promise.all so Netlify can't kill the function
    // before the HTTP POSTs to Klaviyo complete. track() already swallows
    // errors and returns { ok, error } so Promise.all never rejects.
    const klaviyoFires: Promise<{ ok: boolean; error?: string }>[] = []

    // WEC-498: only email at SUBMIT for methods where the order is genuinely
    // placed at submission — cash / transfer (pay-later) and wallet (paid
    // synchronously above). For card / link the order is still `pending` and
    // the customer is about to be redirected to Viva; emailing "confirmed" now
    // would falsely confirm an order to anyone who abandons payment. For those
    // methods the SAME confirmation is fired later from `markPaid()` (the
    // idempotent paid-convergence point) via fireOrderConfirmationFromDb.
    const emailAtSubmit = body.paymentMethod !== 'card' && body.paymentMethod !== 'link'

    // 2026-06-25 launch fix: subscribe customer profile to email marketing
    // BEFORE firing the event. Klaviyo silently blocks flow sends to profiles
    // with consent: NEVER_SUBSCRIBED when the email is marketing-classified
    // (our order-confirmation flow is `transactional: false` until Klaviyo
    // support enables true-transactional sending on the account).
    // Order placement = implicit opt-in to receive order-related comms.
    // See klaviyo.ts → subscribeProfileToMarketing for full reasoning.
    if (emailAtSubmit) {
      klaviyoFires.push(subscribeProfileToMarketing(
        body.customerEmail,
        'Fitpal order placed (auto-subscribe)',
      ))

      klaviyoFires.push(track('Order Placed', {
        email: body.customerEmail,
        firstName: body.customerName?.split(' ')[0],
        lastName: body.customerName?.split(' ').slice(1).join(' '),
        phone: body.customerPhone,
        externalId: userId ?? undefined,
      }, orderPlacedProperties))
    }

    // WEC-486: admin BCC fan-out. Admins listed in
    // `settings.order_confirmation_admin_emails` (jsonb array) get a copy of
    // every order confirmation. Each fires as its own Klaviyo profile +
    // event, so the existing flow sends them the same templated email
    // automatically. The `isAdminCopy: true` flag lets the template prefix
    // the subject with "[ADMIN]" if you want — pure additive, no flow change
    // needed. Fail-soft, never blocks the customer order.
    try {
      const rawAdmins = (settingsRes.data ?? [] as { key: string; value: unknown }[])
        .find((r: { key: string }) => r.key === 'order_confirmation_admin_emails')?.value
      // WEC-498: admin BCC rides along with the customer email — so for
      // card / link it also moves to markPaid (fireOrderConfirmationFromDb
      // replays the same BCC fan-out). Gate on emailAtSubmit here.
      const adminEmails = (emailAtSubmit && Array.isArray(rawAdmins))
        ? (rawAdmins as unknown[])
            .filter((v): v is string =>
              typeof v === 'string' &&
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
            )
            .map((v) => v.trim())
        : []
      // De-dup against the customer's own email so the customer doesn't get
      // two copies if they happen to also be on the admin list.
      const customerLower = body.customerEmail.toLowerCase()
      for (const adminEmail of adminEmails) {
        if (adminEmail.toLowerCase() === customerLower) continue
        // Same subscribe-then-track pattern for admin BCC profiles.
        klaviyoFires.push(subscribeProfileToMarketing(
          adminEmail,
          'Fitpal admin BCC (auto-subscribe)',
        ))
        klaviyoFires.push(track('Order Placed', {
          email: adminEmail,
          firstName: 'Fitpal',
          lastName: 'Admin notification',
        }, {
          ...orderPlacedProperties,
          isAdminCopy: true,
        }))
      }
    } catch (e) {
      console.warn('[submit-order] WEC-486 admin BCC fan-out setup failed (non-fatal):', e)
    }

    // Await all Klaviyo events together. If any fail, log but continue
    // (the order is already persisted; email is a best-effort side effect).
    const klaviyoResults = await Promise.all(klaviyoFires)
    const klaviyoFailed = klaviyoResults.filter((r) => !r.ok)
    if (klaviyoFailed.length > 0) {
      console.warn('[submit-order] Klaviyo: %d/%d events failed: %s',
        klaviyoFailed.length, klaviyoResults.length,
        klaviyoFailed.map((r) => r.error).join(' | '))
    }

    // Stamp the submit time — Airtable mirrors this as "Submitted at (GO)".
    // created_at holds the draft/placement time; this records the actual
    // submit/promote moment. Fail-soft: never block checkout.
    try {
      await supabase.from('orders').update({ submitted_at: new Date().toISOString() }).eq('id', orderId)
    } catch (e) {
      console.error('[submit-order] submitted_at stamp failed (non-fatal):', e)
    }

    // ─── WEC-477: mirror retail order into Airtable (decoupled) ─────────
    // Flag dirty (reconcile backstop) + fire the background push so the
    // kitchen sees it fast. Card+pending is NOT eligible here — it mirrors
    // from markPaid once paid. Never blocks/breaks checkout: Airtable
    // latency/outage is absorbed by the 5-min airtable-reconcile.
    if (isMirrorEligible({ status: 'pending', payment_method: body.paymentMethod, payment_status: paidStatus })) {
      try {
        await supabase.from('orders').update({ airtable_dirty: true }).eq('id', orderId)
        const origin = new URL(request.url).origin
        // Generous timeout: a background function ACKs 202 fast when warm, but
        // a cold start can take several seconds. Too tight an abort (was 2.5s)
        // kills the invocation before it registers, and on dev there's no
        // scheduled reconcile to rescue it. 9s bounds a truly hung connection
        // without dropping cold-start pushes.
        const ctrl = new AbortController()
        const to = setTimeout(() => ctrl.abort(), 9000)
        await fetch(`${origin}/.netlify/functions/airtable-push-background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
          signal: ctrl.signal,
        }).catch(() => {})
        clearTimeout(to)
      } catch (err) {
        console.error('[submit-order] airtable trigger failed (reconcile will catch):', err)
      }
    }

    return Response.json({
      orderNumber,
      orderId,
      total: orderTotal / 100,
      paymentUrl,
      paymentSetupFailed,
      paymentStatus: paidStatus,
    })
  } catch (err) {
    console.error('Order submission error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
