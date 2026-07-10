import { useState, useEffect, useRef, useMemo } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useCartStore } from '../store/useCartStore'
import { useAuthStore } from '../store/useAuthStore'
import { AddressSection } from '../components/checkout/AddressSection'
import { TimeSlotPicker } from '../components/checkout/TimeSlotPicker'
import { PaymentSection } from '../components/checkout/PaymentSection'
import { ExtrasSection } from '../components/checkout/ExtrasSection'
import { OrderSummary } from '../components/checkout/OrderSummary'
import { MobileCartSheet } from '../components/cart/MobileCartSheet'
import { CartDietWarning } from '../components/cart/CartDietWarning'
import { ConfirmationScreen } from '../components/checkout/ConfirmationScreen'
import { ContactSection, type ContactInfo } from '../components/checkout/ContactSection'
import { activeDays, dayAmt, zipInZone, resolveZone } from '../lib/helpers'
import { validateDay, type DayIssue, type DaySnapshot, type DayValidationCtx } from '../lib/dayValidation'
import { dayLabel } from '../lib/datelabels'
import { isValidPhone } from '../lib/phone'
import { isValidGreekVat, vatDigits } from '../lib/vat'
import { isValidEmail } from '../lib/email'
import { updateProfile } from '../lib/api/auth'
import { useMenuStore } from '../store/useMenuStore'
import { useToast } from '../components/ui/Toast'
import { submitOrder } from '../lib/api/orders'
import { saveDraft } from '../lib/api/draft'
import { useImpersonationStore } from '../store/useImpersonationStore'
import { makeTr } from '../lib/translations'
import { track } from '../lib/tracking'

const GUEST_CONTACT_KEY = 'fitpal_guest_contact'

function readGuestContact(): ContactInfo {
  if (typeof window === 'undefined') return { name: '', email: '', phone: '' }
  try {
    const raw = window.localStorage.getItem(GUEST_CONTACT_KEY)
    if (!raw) return { name: '', email: '', phone: '' }
    const parsed = JSON.parse(raw) as Partial<ContactInfo>
    return {
      name: parsed.name ?? '',
      email: parsed.email ?? '',
      phone: parsed.phone ?? '',
    }
  } catch {
    return { name: '', email: '', phone: '' }
  }
}

function writeGuestContact(info: ContactInfo) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GUEST_CONTACT_KEY, JSON.stringify(info))
  } catch {
    // Private mode / quota — non-critical
  }
}

/**
 * WEC-490: localize a structured DayIssue from `src/lib/dayValidation.ts`
 * into the bilingual string the validation banner expects. Kept beside
 * CheckoutPage because this is the only consumer that renders user-facing
 * messages — server-side callers ship the raw code over the wire.
 */
function localizeDayIssue(label: string, issue: DayIssue, lang: 'el' | 'en'): string {
  switch (issue.code) {
    case 'no_address':
      return lang === 'el'
        ? `${label}: Δεν έχει επιλεγεί διεύθυνση`
        : `${label}: No address selected`
    case 'no_postcode':
      return lang === 'el'
        ? `${label}: Ο ταχυδρομικός κώδικας είναι απαραίτητος για τον έλεγχο ζώνης παράδοσης`
        : `${label}: Postcode is required to determine delivery zone`
    case 'postcode_out_of_zone': {
      const zip = issue.params?.zip as string | undefined
      return lang === 'el'
        ? `${label}: Ο Τ.Κ. ${zip ?? ''} δεν ανήκει σε καμία ενεργή ζώνη παράδοσης`
        : `${label}: Postcode ${zip ?? ''} is not in any active delivery zone`
    }
    case 'no_pickup_locations_available':
      return lang === 'el'
        ? `${label}: Δεν υπάρχουν διαθέσιμα σημεία παραλαβής`
        : `${label}: No pickup locations available`
    case 'no_pickup_location':
      return lang === 'el'
        ? `${label}: Δεν έχει επιλεγεί σημείο παραλαβής`
        : `${label}: No pickup location selected`
    case 'no_time_slot':
      return lang === 'el'
        ? `${label}: Δεν έχει επιλεγεί ώρα παράδοσης`
        : `${label}: No delivery time selected`
    case 'time_slot_not_in_zone': {
      // WEC-525: slot selected but the resolved zone doesn't offer it.
      const from = issue.params?.from as string | undefined
      const to = issue.params?.to as string | undefined
      const slot = from && to ? `${from}–${to}` : ''
      return lang === 'el'
        ? `${label}: Το παράθυρο ${slot} δεν είναι διαθέσιμο για τη ζώνη παράδοσής σου — διάλεξε άλλη ώρα`
        : `${label}: The ${slot} window is not available for your delivery zone — pick another time`
    }
    case 'below_min_order': {
      const minCents = (issue.params?.minOrderCents as number | undefined) ?? 0
      const amtCents = (issue.params?.amountCents as number | undefined) ?? 0
      const min = (minCents / 100).toFixed(2)
      const amt = (amtCents / 100).toFixed(2)
      return lang === 'el'
        ? `${label}: Ελάχιστη παραγγελία €${min} (τρέχον: €${amt})`
        : `${label}: Minimum order €${min} (current: €${amt})`
    }
  }
}

export function CheckoutPage() {
  const lang = useUIStore((s) => s.lang)
  const t = makeTr(lang)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const cart = useCartStore((s) => s.cart)
  const delivery = useCartStore((s) => s.delivery)
  const payment = useCartStore((s) => s.payment)
  const voucher = useCartStore((s) => s.voucher)
  const fulfillment = useCartStore((s) => s.fulfillment)
  const setDelivery = useCartStore((s) => s.setDelivery)
  const setPayment = useCartStore((s) => s.setPayment)
  const setFulfillment = useCartStore((s) => s.setFulfillment)
  const draftId = useCartStore((s) => s.draftId)
  const clearDraft = useCartStore((s) => s.clearDraft)
  const user = useAuthStore((s) => s.user)
  // WEC-495: during impersonation the CLIENT store `user` stays the ADMIN — the
  // session/JWT swaps to the customer (so server-side user_id + wallet are the
  // customer's), but useAuthStore.user is not repopulated to them. So the
  // impersonated customer's identity must come from the server-provided
  // `target`; sourcing `user.email` stored the admin's address as
  // orders.customer_email and the confirmation email went to the admin.
  const isImpersonating = useImpersonationStore((s) => s.active)
  const impersonationTarget = useImpersonationStore((s) => s.target)
  const toast = useToast((s) => s.show)
  // WEC-422: these three MUST be declared above the WEC-410 auto-pickup
  // useEffect (its dep array reads pickupLocations.length). Previously they
  // sat ~50 lines below — fine in dev (HMR tolerates the TDZ) but a hard
  // ReferenceError in the minified production bundle that blanked /checkout.
  const zones = useMenuStore((s) => s.zones)
  // WEC-525: needed to validate that a selected slot is actually offered by
  // the day's resolved zone (and to gate the prefs slot-prefill on the same).
  const timeSlots = useMenuStore((s) => s.timeSlots)
  const minOrder = useMenuStore((s) => s.settings.minOrder)
  const pickupLocations = useMenuStore((s) => s.settings.pickupLocations)

  const [confirmed, setConfirmed] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Errors returned from the server-side submit (validationErrors object),
  // flattened into strings and rendered in the red validation block below
  // the Place Order button — same treatment as client-side issues.
  const [serverIssues, setServerIssues] = useState<string[]>([])
  // Contact info (WEC-130). Initialized from user profile (if logged in) or
  // localStorage (guest prefill), filled in via the useEffect below.
  const [contact, setContact] = useState<ContactInfo>({ name: '', email: '', phone: '' })

  // WEC-397: InitiateCheckout once when the checkout screen opens. INERT unless
  // VITE_TRACKING_ENABLED. Guarded so tracking can never break the page.
  useEffect(() => {
    try {
      const dates = Object.keys(cart).filter((d) => (cart[d]?.length ?? 0) > 0)
      const allItems = dates.flatMap((d) => cart[d] ?? [])
      if (allItems.length === 0) return
      track('initiate_checkout', {
        value: Math.round(dates.reduce((s, d) => s + dayAmt(cart[d] ?? []), 0) * 100) / 100,
        currency: 'EUR',
        contentIds: Array.from(new Set(allItems.map((i) => i.dishId))),
        numItems: allItems.reduce((n, i) => n + (i.qty ?? 1), 0),
      })
    } catch {
      /* non-fatal */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // WEC-410: when a day is flipped to pickup and there's exactly one configured
  // pickup location, auto-select it so the customer immediately sees WHERE to
  // go (no extra click needed). For multi-location, leave it unset so the
  // picker prompts the user. Reads delivery via getState to avoid the dep loop.
  useEffect(() => {
    const all = useMenuStore.getState().settings.pickupLocations
    if (all.length !== 1) return
    const onlyId = all[0].id
    const dates = activeDays(useCartStore.getState().cart)
    const fl = useCartStore.getState().fulfillment
    for (const dDate of dates) {
      if ((fl[dDate] ?? 'delivery') !== 'pickup') continue
      const cur = useCartStore.getState().delivery[dDate]
      if (cur?.pickupLocationId === onlyId) continue
      setDelivery(dDate, { pickupLocationId: onlyId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfillment, pickupLocations.length])

  // ── WEC-417 / WEC-423: draft persistence (triggers B + C) ────────────────
  // B: debounced 2s on changes to cart / addresses / time slots / payment /
  //    voucher / fulfillment / customer contact. Also fires on mount (React
  //    runs every effect on initial render), so B is the *only* save we need
  //    on /checkout entry — no separate "mount save".
  // C is in handleSubmit below — synchronous pre-submit save so a Viva 500
  //    leaves an intact draft an admin can recover.
  //
  // WEC-423: trigger A (`useEffect(() => saveDraft(), [])`) was removed.
  // It raced trigger B on the first render: both fired before either had a
  // draft_id, so the server treated them as two inserts and produced an
  // orphan row that no future save touched. B alone is sufficient; the 2 s
  // first-save delay is acceptable.
  //
  // Fail-soft: drafts never block the UI; the cart store is authoritative.
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current)
    draftDebounceRef.current = setTimeout(() => {
      void saveDraft({ contact })
    }, 2000)
    return () => {
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current)
    }
  }, [cart, delivery, fulfillment, payment, voucher, contact])

  // Toggles red borders on the contact inputs only *after* the user attempts
  // to submit — feels less aggressive than validating while they're typing.
  const [contactAttempted, setContactAttempted] = useState(false)
  const contactRef = useRef<HTMLDivElement>(null)
  const deliveryRef = useRef<HTMLDivElement>(null)
  const paymentRef = useRef<HTMLDivElement>(null)
  const extrasRef = useRef<HTMLDivElement>(null)

  // WEC-422: zones / minOrder / pickupLocations hoisted to the top hook block
  // (above the WEC-410 useEffect that uses pickupLocations.length).
  // WEC-336: resolve the long weekday label for an ISO date. Always
  // computes from getDay() of the actual date — never from list index
  // (which was the WEC-122 trap). No longer dependent on the currently-
  // active week's day strip.
  const dayLabelForDate = (date: string) => dayLabel(date, lang, 'long')
  // Active *dates* with items, sorted (lexical YYYY-MM-DD = calendar order).
  const activeDates = useMemo(() => activeDays(cart), [cart])

  // ─── Per-day + overall validation ─────────────────────────────────────────────

  const validationIssues: string[] = []

  // Contact info (WEC-130) — server requires name + email, we also require a
  // valid phone up-front so cash-on-delivery / support callbacks work.
  // WEC-220: tightened — name needs ≥ 2 chars (was just non-empty, accepted "X"),
  // email regex disallows whitespace + @ in either side (was `^.+@.+\..+$`,
  // which is permissive but still rejects "foo"; the new pattern is just the
  // canonical one, kept in case the previous regex had edge-case false-positives).
  const contactName = contact.name.trim()
  const contactEmail = contact.email.trim()
  const contactNameOk = contactName.length >= 2
  // WEC-408: tighter shared email validator (rejects HTML-shaped local parts,
  // > 254 chars, etc.) — same helper used by ContactSection's per-field error.
  const contactEmailOk = isValidEmail(contactEmail)
  const contactPhoneOk = isValidPhone(contact.phone)

  if (!contactNameOk) {
    validationIssues.push(
      contactName.length === 0
        ? t('coNameRequired')
        : t('coNameMin2')
    )
  }
  if (!contactEmailOk) {
    validationIssues.push(
      t('coEmailInvalid')
    )
  }
  if (!contactPhoneOk) {
    validationIssues.push(
      t('coPhoneInvalid')
    )
  }

  // WEC-490: per-day validation routed through shared validateDay() helper
  // (src/lib/dayValidation.ts). Both this forEach (issue messages) and the
  // deliveryOk boolean below consume the SAME validator call so they cannot
  // drift — which is what burned us in WEC-489 (pickup days silently
  // disabling the submit button while the banner showed no issue).
  //
  // perDayResults is the single computation; we render its `.issues` into
  // localized strings here, and use its `.ok` for deliveryOk below.
  // WEC-525: does the zone this zip resolves to offer the from–to window?
  // Mirrors TimeSlotPicker's zoneSlotSet and the server's Phase-3 zone-slot
  // check. Unresolvable zip → true (postcode issues are flagged separately;
  // stacking a slot issue on top would just be noise).
  const slotInZone = (zip: string, from: string, to: string): boolean => {
    const zone = resolveZone(zip, zones)
    if (!zone) return true
    return timeSlots.some((s) => s.zoneId === zone.id && s.timeFrom === from && s.timeTo === to)
  }

  const perDayResults = activeDates.map((dDate) => {
    const del = delivery[dDate]
    const snap: DaySnapshot = {
      hasItems: (cart[dDate]?.length ?? 0) > 0,
      amountCents: Math.round(dayAmt(cart, dDate) * 100),
      fulfillmentType: fulfillment[dDate] ?? 'delivery',
      timeSlot: del?.timeSlot
        ? (() => {
            const [from, to] = del.timeSlot.split(/[–-]/).map((s) => s.trim())
            return from && to ? { from, to } : null
          })()
        : null,
      street: del?.street ?? null,
      area: del?.area ?? null,
      zip: del?.zip ?? null,
      pickupLocationId: del?.pickupLocationId ?? null,
    }
    const ctx: DayValidationCtx = {
      minOrderCents: Math.round(minOrder * 100),
      pickupLocationCount: pickupLocations.length,
      zipInZone: (zip) => zipInZone(zip, zones),
      slotInZone, // WEC-525
    }
    return { dDate, result: validateDay(snap, ctx) }
  })

  for (const { dDate, result } of perDayResults) {
    const label = dayLabelForDate(dDate)
    for (const issue of result.issues) {
      validationIssues.push(localizeDayIssue(label, issue, lang))
    }
  }

  if (!payment.method) {
    validationIssues.push(
      t('coNoPaymentMethod')
    )
  }

  // Invoice validation (WEC-138 + WEC-354). Keep in sync with ExtrasSection.
  // WEC-354: VAT validation tightened from "≥ 5 digits" to "exactly 9 digits
  // AND passes Greek ΑΦΜ checksum" (see src/lib/vat.ts).
  const invoiceVatStripped = vatDigits(payment.invoiceVat ?? '')
  const invoiceVatChecksumOk =
    invoiceVatStripped.length === 9 && isValidGreekVat(invoiceVatStripped)
  const invoiceOk = !payment.invoice
    || (!!payment.invoiceName?.trim() && invoiceVatChecksumOk)
  if (payment.invoice && !payment.invoiceName?.trim()) {
    validationIssues.push(
      t('coInvoiceNameMissing')
    )
  }
  if (payment.invoice && invoiceVatStripped.length === 0) {
    validationIssues.push(
      t('coInvoiceVatMissing')
    )
  } else if (payment.invoice && invoiceVatStripped.length !== 9) {
    validationIssues.push(
      t('coInvoiceVat9')
    )
  } else if (payment.invoice && !invoiceVatChecksumOk) {
    validationIssues.push(
      t('coInvoiceVatInvalid')
    )
  }

  // WEC-490: deliveryOk consumes the same perDayResults the validationIssues
  // block above uses. Two surfaces, ONE computation — they cannot drift
  // (WEC-489 was the lesson: separate implementations of the same rule will
  // always go out of sync eventually).
  const deliveryOk = perDayResults.every((r) => r.result.ok)

  const paymentOk = !!payment.method

  const contactOk = contactNameOk && contactEmailOk && contactPhoneOk

  const extrasOk = deliveryOk && paymentOk && invoiceOk

  const allOk = contactOk && deliveryOk && paymentOk && invoiceOk

  // ─── Prepopulate from user preferences on mount ──────────────────────────────

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Contact prefill (WEC-130):
  //  - Logged-in: pull from user profile (name / email / phone).
  //  - Guest: pull from localStorage if we saved contact info from a previous
  //    order. If the user logs in mid-checkout, we overwrite guest values
  //    with their profile values (profile wins — it's the source of truth).
  // We only prefill fields that the user hasn't typed into yet, so an
  // in-progress edit isn't clobbered by an auth refresh.
  const contactPrefilledForUser = useRef<string | 'guest' | null>(null)
  useEffect(() => {
    // WEC-495: fold the impersonation flag into the key so the prefill
    // RE-RUNS if impersonation flips active after this page mounted (the
    // session-swap → refreshUser → store.active transitions don't all land
    // in the same tick, so `user` may already be the customer before
    // `active` is true). Without this the effect's once-per-identity guard
    // could skip the authoritative re-apply.
    const key = `${user?.id ?? 'guest'}:${isImpersonating ? 'imp' : 'self'}`
    if (contactPrefilledForUser.current === key) return
    contactPrefilledForUser.current = key

    if (isImpersonating && impersonationTarget) {
      // WEC-495: `user` is the ADMIN here — seed the contact from the
      // impersonated customer's server-provided identity so the field shows
      // (and stores) the customer, not the admin. Phone isn't part of the
      // target; keep the admin's for form validation (customer_phone under
      // impersonation is a smaller, separate gap — the reported bug is the
      // confirmation email). Submit also hard-overrides name/email from the
      // target, so the stored customer_email is correct regardless of timing.
      setContact((prev) => ({
        name: impersonationTarget.name || '',
        email: impersonationTarget.email || '',
        phone: prev.phone || user?.phone || '',
      }))
    } else if (user) {
      setContact((prev) => ({
        name: prev.name || user.name || '',
        email: prev.email || user.email || '',
        phone: prev.phone || user.phone || '',
      }))
    } else {
      const guest = readGuestContact()
      setContact((prev) => ({
        name: prev.name || guest.name,
        email: prev.email || guest.email,
        phone: prev.phone || guest.phone,
      }))
    }
  }, [user, isImpersonating, impersonationTarget])

  const prepopulatedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!user) return
    // Only prepopulate once per user (allows re-running when logging in mid-checkout)
    if (prepopulatedFor.current === user.email) return
    prepopulatedFor.current = user.email

    // Prepopulate payment preferences
    if (user.prefs.cutlery !== undefined) {
      setPayment({ cutlery: user.prefs.cutlery })
    }
    if (user.prefs.invoice !== undefined) {
      setPayment({ invoice: user.prefs.invoice })
    }
    if (user.prefs.paymentMethod) {
      setPayment({ method: user.prefs.paymentMethod as 'cash' | 'card' | 'link' | 'transfer' | 'wallet' })
    }

    // Prepopulate delivery preferences (slots and saved addresses).
    // WEC-336: user.prefs.slots / dayAddress are keyed by day-of-week index
    // (0..4 for Mon..Fri, stored in `user_day_prefs` server-side). We resolve
    // the index → date by looking up each cart date's `getDay()` value.
    // Sunday-as-7 conversion: getDay() returns 0..6 with 0=Sun. Our index
    // is 0..4 for Mon..Fri, so prefIdx = getDay()-1 (Mon=0..Fri=4).
    const dates = activeDays(cart)
    for (const dDate of dates) {
      const jsDow = new Date(dDate + 'T12:00:00').getDay()
      const prefIdx = jsDow === 0 ? 6 : jsDow - 1  // 0..6 for Mon..Sun
      if (prefIdx > 4) continue  // Sat/Sun — no per-weekday pref slots

      // WEC-405: resolve the saved address FIRST so we can gate the slot-pref
      // prepopulate on it. If the saved address is out-of-zone, pre-selecting a
      // saved slot would paint that slot with `.sel` (green) over `.unavailable`
      // (grey) — the customer reads it as "available" and is confused. We still
      // pre-fill the address (so they see their saved choice + the zone warning),
      // we just don't pre-select an unselectable slot.
      const addrPrefId = user.prefs.dayAddress?.[prefIdx]
      const addrPref = addrPrefId ? user.addresses.find((a) => a.id === addrPrefId) : undefined
      const addressInZone = addrPref?.zip ? zipInZone(addrPref.zip, zones) : true

      // WEC-525: on top of the WEC-405 in-zone gate, also require the
      // preferred window to be OFFERED by the resolved zone. Pre-selecting a
      // zone-unavailable slot painted a disabled button as selected, passed
      // the (presence-only) client validation and got rejected server-side —
      // "Time slot X is not available for this zone" out of nowhere.
      const prefSlot = user.prefs.slots?.[prefIdx]
      let prefSlotOffered = true
      if (prefSlot && addrPref?.zip) {
        const [pFrom, pTo] = prefSlot.split(/[–-]/).map((s) => s.trim())
        prefSlotOffered = !!pFrom && !!pTo && slotInZone(addrPref.zip, pFrom, pTo)
      }

      if (prefSlot && addressInZone && prefSlotOffered) {
        setDelivery(dDate, { timeSlot: prefSlot })
      }

      // Prepopulate address if saved
      if (addrPref) {
        const addr = addrPref
        {
          setDelivery(dDate, {
            addrId: addr.id,
            street: addr.street,
            area: addr.area,
            zip: addr.zip,
            floor: addr.floor,
            doorbell: addr.doorbell,
            notes: addr.notes,
          })
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // ─── Navigation ──────────────────────────────────────────────────────────────

  function scrollToSection(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // WEC-433: quote-before-submit confirm modal state. Mirrors WalletPage's
  // safety net for the meal-order flow. If the server-quoted total differs
  // from the locally-computed sum (admin edited a variant price mid-flow,
  // useMenuStore cached the old one), we pause submit and require an
  // explicit re-confirm so the customer doesn't get a surprise charge.
  const [priceConfirm, setPriceConfirm] = useState<{ serverCents: number; clientCents: number } | null>(null)

  // WEC-494: synchronous reentrancy guard. `submitting` is async React state,
  // so three .click()s fired in a single tick all pass the `disabled` check and
  // each call submitOrder. The DB dedupe still yields exactly ONE persisted
  // order, but every attempt returns a response and the LAST one to resolve
  // (often a losing attempt whose row never committed) overwrites the
  // success-screen order_number — producing a number absent from the DB. A ref
  // flips synchronously before the first await, so reentrant calls bail.
  const submitInFlight = useRef(false)

  async function handlePlaceOrder(opts: { skipQuoteCheck?: boolean } = {}) {
    if (!contactOk) {
      setContactAttempted(true)
      toast(t('coCompleteContact'))
      scrollToSection(contactRef)
      return
    }
    if (!deliveryOk) {
      toast(t('coCompleteDelivery'))
      scrollToSection(deliveryRef)
      return
    }
    if (!paymentOk) {
      toast(t('coSelectPayment'))
      scrollToSection(paymentRef)
      return
    }

    // WEC-494: bail if a submit is already in flight (set synchronously, before
    // any await, so rapid multi-clicks in one tick can't get past here). Placed
    // AFTER the validation returns above so a failed validation never locks the
    // button. Released on every non-success exit below; on success the page
    // unmounts into <ConfirmationScreen>.
    if (submitInFlight.current) return
    submitInFlight.current = true

    setSubmitting(true)

    // Parse time slots "HH:MM–HH:MM" into timeFrom / timeTo
    const parseSlot = (slot: string) => {
      const parts = slot.split('–')
      return { from: parts[0]?.trim() ?? '', to: parts[1]?.trim() ?? '' }
    }

    // WEC-336: dates are the cart's own ISO date keys — no longer
    // dependent on `days[index]?.date` from whichever week happens to be
    // active. This is the structural fix for the cross-week leakage bug:
    // the date that ends up on the child_order ROW is the same date the
    // customer added the item under.
    const dayPayloads = activeDates.map((dDate) => {
      const del = delivery[dDate]
      const items = cart[dDate] ?? []
      const { from, to } = parseSlot(del?.timeSlot ?? '')
      const ftype = fulfillment[dDate] ?? 'delivery'
      // WEC-410: per-day pickup choice. Falls back to the single configured
      // location for backwards-compat / single-location auto-select.
      const pickupLocId = ftype === 'pickup'
        ? (del?.pickupLocationId ?? (pickupLocations.length === 1 ? pickupLocations[0]?.id : null))
        : null

      return {
        deliveryDate: dDate,
        timeFrom: from,
        timeTo: to,
        // WEC-259: pickup days don't carry an address — server skips zone check.
        addressStreet: ftype === 'pickup' ? '' : (del?.street ?? ''),
        addressArea: ftype === 'pickup' ? '' : (del?.area ?? ''),
        addressZip: ftype === 'pickup' ? undefined : del?.zip,
        addressFloor: ftype === 'pickup' ? undefined : del?.floor,
        // WEC-473: doorbell + delivery notes were captured in the form/store
        // but never sent — they're carried through now.
        addressDoorbell: ftype === 'pickup' ? undefined : del?.doorbell,
        addressNotes: ftype === 'pickup' ? undefined : del?.notes,
        fulfillmentType: ftype,
        pickupLocationId: pickupLocId,
        items: items.map((item) => ({
          dishId: item.dishId,
          variantId: item.variantId,
          quantity: item.qty,
          comment: item.comment,
        })),
      }
    })

    // With session-swap impersonation, `user` already IS the customer
    // when the admin is impersonating — so we just pass user.id as we
    // would for any self-service submit. The admin attribution piggybacks
    // on submitOrder's X-Impersonator-Token header, which it picks up
    // from the impersonation store automatically.
    const isImpersonating = useImpersonationStore.getState().active

    // WEC-433: server-side authoritative quote before we proceed. If the
    // total cents differ from the locally-computed sum (admin changed a
    // variant price between page load and submit, or a variant was deleted),
    // we pause and surface a confirm modal so the customer can re-confirm
    // the new amount. Skipped on the second click ("Confirm" in the modal).
    if (!opts.skipQuoteCheck) {
      const linesForQuote = dayPayloads.flatMap((d) => d.items.map((it) => ({
        dish_id: it.dishId, variant_id: it.variantId, qty: it.quantity,
      })))
      try {
        const qRes = await fetch('/api/menu-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: linesForQuote }),
        })
        if (qRes.ok) {
          const q = await qRes.json() as { totalCents?: number; missingVariantIds?: string[] }
          const serverCents = q.totalCents ?? 0
          // WEC-451: dayAmt's signature is (cart, dayDate) — not (items[]).
          // The previous call passed cart[d] as the first arg and undefined as
          // the second, which silently returned 0 inside dayAmt and tripped
          // the drift modal on every order. Pass the full cart + the date key.
          const clientCents = Math.round(
            activeDates.reduce((s, d) => s + dayAmt(cart, d), 0) * 100,
          )
          if (serverCents > 0 && Math.abs(serverCents - clientCents) > 1) {
            setPriceConfirm({ serverCents, clientCents })
            submitInFlight.current = false  // WEC-494: allow the explicit "Confirm" re-submit
            setSubmitting(false)
            return
          }
        }
        // Quote endpoint failed → fall through. submit-order is the
        // authoritative price source anyway; a transient API hiccup
        // shouldn't block the customer from paying.
      } catch {
        /* network error — fall through */
      }
    }

    // WEC-417 trigger C: synchronous pre-submit save. Captures the final state
    // BEFORE the network/Viva call so a 500 / timeout / 3DS bounce leaves an
    // intact draft an admin can recover. Awaited so the draft id we forward
    // to submit-order is the freshest one. saveDraft is fail-soft, so a
    // transient draft failure still lets us proceed (cart is authoritative).
    const presubmit = await saveDraft({ contact })
    const draftIdForPromote = presubmit?.draftId ?? draftId ?? undefined

    const { data, error, validationErrors } = await submitOrder({
      userId: user?.id,
      // Routes EL/EN Klaviyo template inside the Order Placed flow.
      lang,
      // WEC-495: during impersonation, force the customer identity from the
      // server-provided target (useAuthStore.user is the admin), so the order
      // stores the customer's email and the confirmation reaches THEM, not the
      // admin. Belt-and-suspenders with the prefill above.
      customerName: (isImpersonating && impersonationTarget) ? impersonationTarget.name : contactName,
      customerEmail: (isImpersonating && impersonationTarget) ? impersonationTarget.email : contactEmail,
      customerPhone: contact.phone,  // E.164 from <PhoneInput>
      paymentMethod: payment.method as 'cash' | 'card' | 'link' | 'transfer' | 'wallet',
      cutlery: payment.cutlery ?? false,
      // WEC-403: when the customer ticks "Τιμολόγιο" + fills Επωνυμία/ΑΦΜ
      // it's a B2B invoice — persist as 'invoice', not 'receipt'. The 'receipt'
      // enum value remains for a future "issue a receipt, no VAT" path (no UI today).
      invoiceType: payment.invoice ? 'invoice' : undefined,
      invoiceName: payment.invoiceName,
      invoiceVat: payment.invoiceVat,
      notes: payment.notes,
      voucherCode: voucher.applied ? voucher.code : undefined,
      days: dayPayloads,
      // WEC-418: promote this draft (idempotent via WHERE status='draft' on the server).
      draftId: draftIdForPromote,
    })

    setSubmitting(false)
    // WEC-494: released here, before the error/success branches. The error path
    // returns just below (button re-enabled for a retry); the success path
    // unmounts into <ConfirmationScreen>, so this reset is harmless there.
    submitInFlight.current = false

    if (error) {
      // Flatten server-side validationErrors into the red block. Keep a
      // matching toast so the user notices scrolling back to the list.
      //
      // WEC-336 / WEC-122 family bug fix: the server returns errors keyed
      // by `day_<index>`, where the index is the POSITION of the day inside
      // the submitted payload (0..N-1). The old code mapped that index
      // through `dayLabelFor(+m[1])`, which used the currently-active
      // week's day-of-week list — so day_0 in a payload that started on
      // Thursday rendered as "Δευτέρα" because Mon is index 0 in that
      // week's strip. Fix: resolve the index back to the cart-submission
      // date and compute the label from the actual date's getDay().
      if (validationErrors) {
        const flat: string[] = []
        for (const [key, msgs] of Object.entries(validationErrors)) {
          const m = /^day_(\d+)$/.exec(key)
          let prefix = ''
          if (m) {
            const idx = +m[1]
            const dDate = dayPayloads[idx]?.deliveryDate
            if (dDate) prefix = `${dayLabelForDate(dDate)}: `
          }
          for (const msg of msgs) flat.push(prefix + msg)
        }
        setServerIssues(flat)
        toast(t('coOrderRejected'))
      } else {
        setServerIssues([error])
        toast(error)
      }
      return
    }

    setServerIssues([])

    // Persist contact info for future orders.
    //  - Guest: write to localStorage so next order prefills.
    //  - Logged-in with empty profile.phone: backfill profile.phone from this
    //    order's phone (one-shot, quiet). We don't overwrite an existing
    //    profile phone — that's a profile-page concern.
    if (!user) {
      writeGuestContact({
        name: contactName,
        email: contactEmail,
        phone: contact.phone,
      })
    } else if (!user.phone && contact.phone) {
      // Fire-and-forget — don't block the confirmation screen on it.
      updateProfile(user.id, { phone: contact.phone }).then(({ error: profErr }) => {
        if (profErr) {
          // eslint-disable-next-line no-console
          console.warn('[checkout] profile phone backfill failed:', profErr)
          return
        }
        // Keep the in-memory user in sync so the profile page reflects it
        // immediately without a refresh.
        const current = useAuthStore.getState().user
        if (current) {
          useAuthStore.getState().setUser({ ...current, phone: contact.phone })
        }
      })
    }

    setOrderNumber(data?.orderNumber ?? '')

    // WEC-417: the draft just promoted to a real order on the server (or this
    // was a legacy no-draft submit). Clear the client draft id so a refresh /
    // new tab doesn't try to keep updating a now-pending row.
    clearDraft()

    // WEC-454: refresh user.orders so the new order shows on Account → Orders
    // without a hard refresh. WalletPage already does this on its success path
    // (see lines 413 / 466) — CheckoutPage was missed. Fire-and-forget; the
    // confirmation flow doesn't wait on it.
    if (user) {
      useAuthStore.getState().refreshUser(user.id).catch((e) =>
        // eslint-disable-next-line no-console
        console.warn('[checkout] post-order refreshUser failed (non-fatal):', e)
      )
    }

    // ─── Viva redirect (WEC-171) ────────────────────────────────────────
    // For `card` only — customer pays in-session, redirect to Viva's hosted
    // checkout. They come back via /order/pending/success once paid (WEC-172).
    //
    // For `link`, submit-order also returns a paymentUrl (admin reads it from
    // the order drawer to send to the customer out-of-band) but we must NOT
    // redirect the customer themselves — they should land on the confirmation
    // screen with a "we'll send you a payment link shortly" message.
    //
    // If paymentSetupFailed, the order row exists but we couldn't reach
    // Viva. Show confirmation with a soft warning; admin can regenerate
    // the payment link later (WEC-176).
    if (data?.paymentUrl && payment.method === 'card') {
      window.location.replace(data.paymentUrl)
      return
    }
    if (data?.paymentSetupFailed) {
      toast(t('coPaymentSetupFailed'))
    }

    // If we placed this order via impersonation, exit impersonation now —
    // restores the admin's session so their next click takes them back to
    // their own admin context. The store handles setSession + cleanup.
    if (isImpersonating) {
      // Fire and forget — the confirmation screen still renders for the
      // customer-side eyes the admin is showing the result to.
      void useImpersonationStore.getState().stop()
    }

    // WEC-397: Purchase conversion (browser Pixel + server CAPI, deduped by the
    // order number). INERT unless VITE_TRACKING_ENABLED. Card orders redirect to
    // Viva above and fire Purchase on the return page instead, so everything that
    // reaches here is a non-card confirmation. Guarded so a tracking hiccup can
    // never break the confirmation screen.
    try {
      const allItems = activeDates.flatMap((d) => cart[d] ?? [])
      const value = activeDates.reduce((sum, d) => sum + dayAmt(cart[d] ?? []), 0)
      track(
        'purchase',
        {
          value: Math.round(value * 100) / 100,
          currency: 'EUR',
          contentIds: Array.from(new Set(allItems.map((i) => i.dishId))),
          numItems: allItems.reduce((n, i) => n + (i.qty ?? 1), 0),
          orderId: data?.orderNumber, // stable dedup key
          orderNumber: data?.orderNumber,
        },
        { email: contactEmail, phone: contact.phone, externalId: user?.id },
      )
    } catch (e) {
      console.warn('[tracking] purchase event failed (non-fatal):', e)
    }

    setConfirmed(true)
  }

  if (confirmed) return <ConfirmationScreen orderNumber={orderNumber} />

  const sections = [
    {
      id: 'sec-contact',
      label: t('coSec1Contact'),
      ok: contactOk,
      ref: contactRef,
    },
    {
      id: 'sec-delivery',
      label: t('coSec2Delivery'),
      ok: deliveryOk,
      ref: deliveryRef,
    },
    {
      id: 'sec-payment',
      label: t('coSec3Payment'),
      ok: paymentOk,
      ref: paymentRef,
    },
    {
      id: 'sec-extras',
      label: t('coSec4Extras'),
      ok: extrasOk,
      ref: extrasRef,
    },
  ]

  return (
    <div className="checkout-page">
      {/* Header: back button + title on one line */}
      <div className="co-page-top">
        <button className="btn-co-back" onClick={closeCheckout}>←</button>
        <h1 className="co-page-title">
          {t('checkout')}
        </h1>
      </div>

      {/* Section nav pills — on own line */}
      <div className="co-sections-nav">
        {sections.map((sec) => (
          <button
            key={sec.id}
            className={`co-pill${sec.ok ? ' co-pill-done' : ''}`}
            onClick={() => scrollToSection(sec.ref)}
          >
            {sec.ok && <span className="co-pill-checkmark">✓ </span>}
            <span>{sec.label}</span>
          </button>
        ))}
      </div>

      <div className="checkout-layout">
        <div className="checkout-main">
          {/* SECTION 1: Contact info (WEC-130) */}
          <div className="co-section" ref={contactRef} id="sec-contact">
            <h2 className="co-section-title">
              {t('coContactInfoUpper')}
            </h2>
            <ContactSection
              value={contact}
              onChange={(patch) => setContact((prev) => ({ ...prev, ...patch }))}
              showErrors={contactAttempted}
            />
          </div>

          {/* SECTION 2: Delivery */}
          <div className="co-section" ref={deliveryRef} id="sec-delivery">
            <h2 className="co-section-title">
              {t('coDeliveryDetailsUpper')}
            </h2>
            {activeDates.map((dDate) => {
              const label = dayLabelForDate(dDate)
              const ftype = fulfillment[dDate] ?? 'delivery'
              // WEC-259 redesign: pickup matches the delivery schedule
              // exactly. As long as a pickup location is configured, the
              // toggle is offered on every day block (the weekday gate
              // we shipped in stage 1 was dropped at Ioustinos's request).
              const pickupLoc = pickupLocations[0]
              const pickupAvailable = !!pickupLoc
              return (
                <div key={dDate} className="day-deliv-block">
                  <div className="ddb-title">
                    {label} — {formatDate(dDate, lang)}
                  </div>

                  {/* WEC-259: Fulfillment toggle. Shown only when at least one
                      pickup location is configured globally; otherwise the
                      whole feature stays hidden and behaviour is exactly as
                      before this change shipped. */}
                  {pickupLoc && (
                    <div className="ddb-zone">
                      <div className="ddb-section-hdr">
                        {t('coFulfillmentUpper')}
                      </div>
                      <div className="ddb-fulfillment-toggle" role="radiogroup">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={ftype === 'delivery'}
                          className={`ddb-fulfillment-opt${ftype === 'delivery' ? ' selected' : ''}`}
                          onClick={() => setFulfillment(dDate, 'delivery')}
                        >
                          {t('coHomeDelivery')}
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={ftype === 'pickup'}
                          disabled={!pickupAvailable}
                          className={`ddb-fulfillment-opt${ftype === 'pickup' ? ' selected' : ''}${!pickupAvailable ? ' disabled' : ''}`}
                          onClick={() => pickupAvailable && setFulfillment(dDate, 'pickup')}
                          title={!pickupAvailable
                            ? t('coPickupNotAvailableDay')
                            : undefined}
                        >
                          {t('coPickupFromStore')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Time slots — same picker for delivery + pickup (per spec). */}
                  <div className="ddb-zone">
                    <div className="ddb-section-hdr">
                      <span className="ddb-section-ico">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                      </span>
                      {ftype === 'pickup'
                        ? t('coPickupWindowUpper')
                        : t('coDeliveryWindowUpper')}
                    </div>
                    <TimeSlotPicker dayDate={dDate} inline />
                  </div>

                  {/* Address (delivery) OR pickup-location info — never both. */}
                  {ftype === 'pickup' ? (
                    <div className="ddb-zone">
                      <div className="ddb-section-hdr">
                        <span className="ddb-section-ico">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                          </svg>
                        </span>
                        {t('coPickupLocationUpper')}
                      </div>
                      {/* WEC-410: render zero/single/multi pickup states explicitly so a
                          customer in pickup mode always sees WHERE to go (or a
                          clear contact-us fallback). For multi-location, render a
                          radio picker and persist the choice per-day. */}
                      {(() => {
                        if (pickupLocations.length === 0) {
                          return (
                            <div className="pickup-loc-warning">
                              {t('coNoPickupConfigured')}
                            </div>
                          )
                        }
                        const activeId =
                          delivery[dDate]?.pickupLocationId ??
                          (pickupLocations.length === 1 ? pickupLocations[0].id : undefined)
                        const selectedLoc = pickupLocations.find((l) => l.id === activeId)
                        return (
                          <>
                            {pickupLocations.length > 1 && (
                              <div className="pickup-loc-picker" role="radiogroup">
                                {pickupLocations.map((loc) => {
                                  const sel = activeId === loc.id
                                  return (
                                    <button
                                      key={loc.id}
                                      type="button"
                                      role="radio"
                                      aria-checked={sel}
                                      className={`pickup-loc-opt${sel ? ' selected' : ''}`}
                                      onClick={() => setDelivery(dDate, { pickupLocationId: loc.id })}
                                    >
                                      <div className="pickup-loc-opt-name">{lang === 'el' ? loc.nameEl : loc.nameEn}</div>
                                      <div className="pickup-loc-opt-addr">{loc.address}</div>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            {selectedLoc ? (
                              <div className="pickup-loc-card">
                                <div className="pickup-loc-name">{lang === 'el' ? selectedLoc.nameEl : selectedLoc.nameEn}</div>
                                <div className="pickup-loc-addr">
                                  {selectedLoc.address}
                                  {' · '}
                                  <a
                                    className="pickup-loc-map"
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedLoc.address)}`}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                  >
                                    {t('coOpenInMaps')}
                                  </a>
                                </div>
                                {((lang === 'el' ? selectedLoc.hoursNoteEl : selectedLoc.hoursNoteEn) ?? '').length > 0 && (
                                  <div className="pickup-loc-hours">{lang === 'el' ? selectedLoc.hoursNoteEl : selectedLoc.hoursNoteEn}</div>
                                )}
                              </div>
                            ) : (
                              <div className="pickup-loc-hint">
                                {t('coPickLocationAbove')}
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  ) : (
                    <div className="ddb-zone">
                      <div className="ddb-section-hdr">
                        <span className="ddb-section-ico">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                          </svg>
                        </span>
                        {t('coAddressUpper')}
                      </div>
                      <AddressSection dayDate={dDate} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* SECTION 3: Payment */}
          <div className="co-section" ref={paymentRef} id="sec-payment">
            <h2 className="co-section-title">
              {t('coPaymentMethodUpper')}
            </h2>
            <PaymentSection />
          </div>

          {/* SECTION 4: Extras */}
          <div className="co-section" ref={extrasRef} id="sec-extras">
            <h2 className="co-section-title">
              {t('coExtrasUpper')}
            </h2>
            <ExtrasSection attempted={contactAttempted} />
          </div>

          {/* WEC-345: diet warning above the Place-order button. Last-
              chance defence before the customer submits — same
              CartDietWarning component used in the sidebar and order
              summary so the copy stays in lockstep. */}
          <CartDietWarning />

          {/* Footer with action buttons */}
          <div className="checkout-footer">
            <button className="btn-back" onClick={closeCheckout}>
              {t('coBackArrow')}
            </button>
            <button
              className="btn-place-order"
              onClick={handlePlaceOrder}
              disabled={!allOk || submitting}
            >
              {submitting
                ? t('coSubmitting')
                : t('coPlaceOrderArrow')}
            </button>
          </div>

          {/* Validation reasons — client-side (pre-submit) AND server-side (post-submit) */}
          {(validationIssues.length > 0 || serverIssues.length > 0) && (
            <div className="checkout-validation">
              {serverIssues.length > 0 && (
                <div className="validation-issue" style={{ fontWeight: 800, marginBottom: 4 }}>
                  {t('coServerRejected')}
                </div>
              )}
              {serverIssues.map((issue, idx) => (
                <div key={`s-${idx}`} className="validation-issue">
                  <span className="validation-dot">●</span> {issue}
                </div>
              ))}
              {validationIssues.map((issue, idx) => (
                <div key={`c-${idx}`} className="validation-issue">
                  <span className="validation-dot">●</span> {issue}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar summary (desktop) */}
        <div className="checkout-sidebar">
          <OrderSummary />
        </div>
      </div>

      {/* WEC-264: mobile-only bottom-sheet for the order summary. The
          checkout-sidebar is hidden on mobile via CSS; the customer needs
          to be able to review what they're about to pay. Read-only mode
          (no checkout CTA — they're already on this page). */}
      <MobileCartSheet mode="checkout" />

      {/* WEC-433: price-drift confirm modal. Shown only if the server
          authoritative total differs from what the page showed (e.g. admin
          changed a variant price mid-flow). Customer must re-confirm. */}
      {priceConfirm && (
        <div
          className="admin-drawer-overlay"
          style={{ background: 'rgba(0,0,0,0.45)', zIndex: 2000 }}
          onClick={() => { setPriceConfirm(null); setSubmitting(false) }}
        >
          <div
            style={{
              maxWidth: 440, margin: '14vh auto', background: '#fff',
              border: '1px solid #e5e7eb', borderRadius: 10, padding: 24,
              boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>
              {t('coPriceUpdated')}
            </h3>
            <p style={{ margin: '0 0 16px', color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>
              {lang === 'el'
                ? <>Νέο σύνολο: <strong>€{(priceConfirm.serverCents / 100).toFixed(2)}</strong> (εμφανιζόταν €{(priceConfirm.clientCents / 100).toFixed(2)}). Συνεχίζοντας θα χρεωθείς το νέο ποσό.</>
                : <>New total: <strong>€{(priceConfirm.serverCents / 100).toFixed(2)}</strong> (was €{(priceConfirm.clientCents / 100).toFixed(2)}). Continuing charges the new amount.</>}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="admin-btn-ghost"
                onClick={() => { setPriceConfirm(null); setSubmitting(false) }}
              >
                {t('coCancel')}
              </button>
              <button
                className="admin-btn-danger"
                onClick={() => { setPriceConfirm(null); void handlePlaceOrder({ skipQuoteCheck: true }) }}
              >
                {t('continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}
