// WEC-490: single source of truth for "is this delivery day complete enough
// to submit". Solves a real drift bug (WEC-489) where the client had THREE
// places computing the same thing — validationIssues forEach, deliveryOk
// every, and submit-order's structural validation — and only two of them
// gated the address checks by fulfillment_type. Result: pickup days silently
// disabled the submit button with no error shown.
//
// This module is the canonical rule set. Callers:
//   - CheckoutPage.tsx → validationIssues block (renders localized strings)
//   - CheckoutPage.tsx → deliveryOk boolean   (gates the submit button)
//   - submit-order.ts → Phase 1 validatePayload (structural rejection)
//
// Rule changes go HERE, never in a caller. Issues are returned as structured
// codes; callers localize them as needed (or pass them through to the wire
// like submit-order does in the validationErrors payload).
//
// The function is pure (no React / Zustand / fetch / DB) so it imports
// safely from both the Vite client bundle and Netlify Functions.

export type FulfillmentType = 'delivery' | 'pickup'

export interface DaySnapshot {
  /** True when the day's cart has ≥ 1 item. Days with no items aren't validated. */
  hasItems: boolean
  /** Day total in **cents**. Compared against `minOrderCents` to flag below_min_order. */
  amountCents: number
  /** Per-day fulfillment mode. Default 'delivery' should be applied by the caller before passing. */
  fulfillmentType: FulfillmentType
  /** Selected delivery window, e.g. `{ from: '10:00', to: '12:00' }`. Null = no slot picked. */
  timeSlot: { from: string; to: string } | null
  /** Address line. Pickup days have this empty — that's expected, the helper gates on fulfillmentType. */
  street: string | null
  area: string | null
  zip: string | null
  /** Set for pickup days. Single-location config auto-fills it; multi-location requires user pick. */
  pickupLocationId: string | null
}

export interface DayValidationCtx {
  /**
   * Per-day minimum order in **cents**. Pass 0 to skip the check (e.g. when the
   * caller does its own minimum-order accounting later with DB-loaded settings).
   */
  minOrderCents: number
  /**
   * How many pickup locations are configured. Pickup-day rules depend on this:
   *   0 → `no_pickup_locations_available`
   *   1 → auto-selected, no issue if pickupLocationId is empty
   *   ≥ 2 → user must explicitly pick (no_pickup_location)
   */
  pickupLocationCount: number
  /**
   * Zone-membership predicate. Return true if `zip` is in an active delivery
   * zone. Pass `() => true` to skip the zone check (e.g. server Phase 1
   * before zones are loaded from DB; the real zone check runs in Phase 3).
   */
  zipInZone: (zip: string) => boolean
  /**
   * WEC-525: slot-availability predicate for the day's resolved zone. Return
   * true if the selected window (from/to) is offered by the zone the day's
   * zip resolves to. Omit (undefined) to skip — the server Phase 1 does this,
   * its Phase 3 runs the authoritative zone-slot check against the DB.
   * Only consulted for delivery days that have BOTH a zip and a slot.
   */
  slotInZone?: (zip: string, from: string, to: string) => boolean
}

export type DayIssueCode =
  | 'no_address'                       // delivery: street or area missing
  | 'no_postcode'                      // delivery: postcode missing
  | 'postcode_out_of_zone'             // delivery: postcode not in any active zone
  | 'no_pickup_location'               // pickup: multi-location config and none picked
  | 'no_pickup_locations_available'    // pickup: zero locations configured
  | 'no_time_slot'                     // both: no delivery window picked
  | 'time_slot_not_in_zone'            // delivery: selected window not offered by the resolved zone (WEC-525)
  | 'below_min_order'                  // both: day total < minimum

export interface DayIssue {
  code: DayIssueCode
  /** Optional structured context for the localizer (e.g. zip, minOrderCents, amountCents). */
  params?: Record<string, unknown>
}

export interface DayValidationResult {
  ok: boolean
  issues: DayIssue[]
}

/**
 * Pure validator. Same rules across client validationIssues block, client
 * deliveryOk boolean, and server Phase 1 structural validation.
 *
 * Returns `{ ok: true, issues: [] }` for empty-cart days — those aren't
 * validated. They show up as "active days" in the caller's iteration only
 * if they have items; if they don't, skip them at the call site.
 */
export function validateDay(snap: DaySnapshot, ctx: DayValidationCtx): DayValidationResult {
  const issues: DayIssue[] = []

  if (!snap.hasItems) {
    // Days without items aren't expected to pass through here; the caller
    // should filter them out via activeDays(). If one slips through, treat
    // it as ok=true (no items = nothing to validate against).
    return { ok: true, issues }
  }

  // ── Fulfillment-typed checks (the gating WEC-489 missed) ──────────────
  if (snap.fulfillmentType === 'pickup') {
    if (ctx.pickupLocationCount === 0) {
      issues.push({ code: 'no_pickup_locations_available' })
    } else if (ctx.pickupLocationCount > 1 && !snap.pickupLocationId) {
      issues.push({ code: 'no_pickup_location' })
    }
    // Pickup days intentionally don't check street/area/zip — the customer
    // is going to the store, there's no delivery address.
  } else {
    if (!snap.street?.trim() || !snap.area?.trim()) {
      issues.push({ code: 'no_address' })
    } else if (!snap.zip?.trim()) {
      issues.push({ code: 'no_postcode' })
    } else if (!ctx.zipInZone(snap.zip.trim())) {
      issues.push({ code: 'postcode_out_of_zone', params: { zip: snap.zip.trim() } })
    }
  }

  // ── Both fulfillment types need a time slot ──────────────────────────
  if (!snap.timeSlot || !snap.timeSlot.from || !snap.timeSlot.to) {
    issues.push({ code: 'no_time_slot' })
  } else if (
    // WEC-525: a slot can be present in the store but not offered by the
    // resolved zone (prefs-prefilled, or zip changed after picking). The
    // server always rejected this in Phase 3; the client validator didn't —
    // that gap let "Place order" pass and surface only as a server error.
    // Gated to delivery days with a zone-resolvable zip: postcode problems
    // are already flagged above, no point stacking a second issue on them.
    snap.fulfillmentType === 'delivery' &&
    ctx.slotInZone &&
    snap.zip?.trim() &&
    ctx.zipInZone(snap.zip.trim()) &&
    !ctx.slotInZone(snap.zip.trim(), snap.timeSlot.from, snap.timeSlot.to)
  ) {
    issues.push({
      code: 'time_slot_not_in_zone',
      params: { from: snap.timeSlot.from, to: snap.timeSlot.to },
    })
  }

  // ── Both fulfillment types are gated by the minimum order ────────────
  // ctx.minOrderCents = 0 disables the check (server uses this in Phase 1
  // before DB-loaded settings; Phase 3 runs its own check with real data).
  if (ctx.minOrderCents > 0 && snap.amountCents < ctx.minOrderCents) {
    issues.push({
      code: 'below_min_order',
      params: { minOrderCents: ctx.minOrderCents, amountCents: snap.amountCents },
    })
  }

  return { ok: issues.length === 0, issues }
}
