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
import { activeDays, dayAmt, zipInZone } from '../lib/helpers'
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

export function CheckoutPage() {
  const lang = useUIStore((s) => s.lang)
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
  const toast = useToast((s) => s.show)
  // WEC-422: these three MUST be declared above the WEC-410 auto-pickup
  // useEffect (its dep array reads pickupLocations.length). Previously they
  // sat ~50 lines below — fine in dev (HMR tolerates the TDZ) but a hard
  // ReferenceError in the minified production bundle that blanked /checkout.
  const zones = useMenuStore((s) => s.zones)
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
        ? (lang === 'el' ? 'Λείπει το ονοματεπώνυμο' : 'Name is required')
        : (lang === 'el' ? 'Το ονοματεπώνυμο πρέπει να έχει τουλάχιστον 2 χαρακτήρες' : 'Name must be at least 2 characters')
    )
  }
  if (!contactEmailOk) {
    validationIssues.push(
      lang === 'el' ? 'Λείπει ή είναι λάθος το email' : 'Email is missing or invalid'
    )
  }
  if (!contactPhoneOk) {
    validationIssues.push(
      lang === 'el' ? 'Λείπει ή είναι λάθος ο αριθμός τηλεφώνου' : 'Phone is missing or invalid'
    )
  }

  activeDates.forEach((dDate) => {
    const del = delivery[dDate]
    const label = dayLabelForDate(dDate)
    const amt = dayAmt(cart, dDate)
    const dayFulfillment = fulfillment[dDate] ?? 'delivery'

    if (dayFulfillment === 'pickup') {
      // WEC-410: pickup days require a chosen location (auto-selected when
      // there's only one configured; multi-location must be picked).
      if (pickupLocations.length === 0) {
        validationIssues.push(
          lang === 'el'
            ? `${label}: Δεν υπάρχουν διαθέσιμα σημεία παραλαβής`
            : `${label}: No pickup locations available`
        )
      } else if (!del?.pickupLocationId && pickupLocations.length > 1) {
        validationIssues.push(
          lang === 'el'
            ? `${label}: Δεν έχει επιλεγεί σημείο παραλαβής`
            : `${label}: No pickup location selected`
        )
      }
    } else if (!del?.street || !del?.area) {
      validationIssues.push(
        lang === 'el'
          ? `${label}: Δεν έχει επιλεγεί διεύθυνση`
          : `${label}: No address selected`
      )
    } else if (!del.zip?.trim()) {
      validationIssues.push(
        lang === 'el'
          ? `${label}: Ο ταχυδρομικός κώδικας είναι απαραίτητος για τον έλεγχο ζώνης παράδοσης`
          : `${label}: Postcode is required to determine delivery zone`
      )
    } else if (!zipInZone(del.zip, zones)) {
      validationIssues.push(
        lang === 'el'
          ? `${label}: Ο Τ.Κ. ${del.zip} δεν ανήκει σε καμία ενεργή ζώνη παράδοσης`
          : `${label}: Postcode ${del.zip} is not in any active delivery zone`
      )
    }

    if (!del?.timeSlot) {
      validationIssues.push(
        lang === 'el'
          ? `${label}: Δεν έχει επιλεγεί ώρα παράδοσης`
          : `${label}: No delivery time selected`
      )
    }

    if (amt < minOrder) {
      validationIssues.push(
        lang === 'el'
          ? `${label}: Ελάχιστη παραγγελία €${minOrder} (τρέχον: €${amt.toFixed(2)})`
          : `${label}: Minimum order €${minOrder} (current: €${amt.toFixed(2)})`
      )
    }
  })

  if (!payment.method) {
    validationIssues.push(
      lang === 'el'
        ? 'Δεν έχει επιλεγεί τρόπος πληρωμής'
        : 'No payment method selected'
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
      lang === 'el'
        ? 'Τιμολόγιο: λείπει η επωνυμία ή το όνομα'
        : 'Invoice: company or name is missing'
    )
  }
  if (payment.invoice && invoiceVatStripped.length === 0) {
    validationIssues.push(
      lang === 'el' ? 'Τιμολόγιο: λείπει το ΑΦΜ' : 'Invoice: VAT number is missing'
    )
  } else if (payment.invoice && invoiceVatStripped.length !== 9) {
    validationIssues.push(
      lang === 'el'
        ? 'Τιμολόγιο: το ΑΦΜ πρέπει να έχει 9 ψηφία'
        : 'Invoice: VAT must be 9 digits'
    )
  } else if (payment.invoice && !invoiceVatChecksumOk) {
    validationIssues.push(
      lang === 'el'
        ? 'Τιμολόγιο: μη έγκυρο ΑΦΜ — έλεγξε τα ψηφία'
        : 'Invoice: invalid VAT — check the digits'
    )
  }

  const deliveryOk = activeDates.every((dDate) => {
    const del = delivery[dDate]
    const amt = dayAmt(cart, dDate)
    return del?.street && del?.area && del?.zip && del?.timeSlot && zipInZone(del.zip, zones) && amt >= minOrder
  })

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
    const key = user?.id ?? 'guest'
    if (contactPrefilledForUser.current === key) return
    contactPrefilledForUser.current = key

    if (user) {
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
  }, [user])

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

      if (user.prefs.slots?.[prefIdx] && addressInZone) {
        setDelivery(dDate, { timeSlot: user.prefs.slots[prefIdx] })
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

  async function handlePlaceOrder() {
    if (!contactOk) {
      setContactAttempted(true)
      toast(lang === 'el' ? 'Συμπλήρωσε τα στοιχεία επικοινωνίας' : 'Please complete contact info')
      scrollToSection(contactRef)
      return
    }
    if (!deliveryOk) {
      toast(lang === 'el' ? 'Παρακαλώ συμπλήρωσε τα στοιχεία παράδοσης' : 'Please complete delivery details')
      scrollToSection(deliveryRef)
      return
    }
    if (!paymentOk) {
      toast(lang === 'el' ? 'Παρακαλώ επίλεξε τρόπο πληρωμής' : 'Please select a payment method')
      scrollToSection(paymentRef)
      return
    }

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

    // WEC-417 trigger C: synchronous pre-submit save. Captures the final state
    // BEFORE the network/Viva call so a 500 / timeout / 3DS bounce leaves an
    // intact draft an admin can recover. Awaited so the draft id we forward
    // to submit-order is the freshest one. saveDraft is fail-soft, so a
    // transient draft failure still lets us proceed (cart is authoritative).
    const presubmit = await saveDraft({ contact })
    const draftIdForPromote = presubmit?.draftId ?? draftId ?? undefined

    const { data, error, validationErrors } = await submitOrder({
      userId: user?.id,
      customerName: contactName,
      customerEmail: contactEmail,
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
        toast(lang === 'el' ? 'Η παραγγελία απορρίφθηκε — δες τα σφάλματα' : 'Order rejected — see errors below')
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
      toast(
        lang === 'el'
          ? 'Η παραγγελία καταχωρήθηκε αλλά η πληρωμή δεν διαμορφώθηκε — θα επικοινωνήσουμε μαζί σου.'
          : "Order saved, but we couldn't set up payment — we'll reach out shortly.",
      )
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
      label: lang === 'el' ? '1.Επικοινωνία' : '1.Contact',
      ok: contactOk,
      ref: contactRef,
    },
    {
      id: 'sec-delivery',
      label: lang === 'el' ? '2.Παράδοση' : '2.Delivery',
      ok: deliveryOk,
      ref: deliveryRef,
    },
    {
      id: 'sec-payment',
      label: lang === 'el' ? '3.Πληρωμή' : '3.Payment',
      ok: paymentOk,
      ref: paymentRef,
    },
    {
      id: 'sec-extras',
      label: lang === 'el' ? '4.Επιπλέον Επιλογές' : '4.Extras',
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
          {lang === 'el' ? 'Ολοκλήρωση Παραγγελίας' : 'Checkout'}
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
              {lang === 'el' ? 'ΣΤΟΙΧΕΙΑ ΕΠΙΚΟΙΝΩΝΙΑΣ' : 'CONTACT INFO'}
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
              {lang === 'el' ? 'ΣΤΟΙΧΕΙΑ ΠΑΡΑΔΟΣΗΣ' : 'DELIVERY DETAILS'}
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
                        {lang === 'el' ? 'ΤΡΟΠΟΣ ΠΑΡΑΔΟΣΗΣ' : 'FULFILLMENT'}
                      </div>
                      <div className="ddb-fulfillment-toggle" role="radiogroup">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={ftype === 'delivery'}
                          className={`ddb-fulfillment-opt${ftype === 'delivery' ? ' selected' : ''}`}
                          onClick={() => setFulfillment(dDate, 'delivery')}
                        >
                          {lang === 'el' ? 'Παράδοση στο σπίτι' : 'Home delivery'}
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={ftype === 'pickup'}
                          disabled={!pickupAvailable}
                          className={`ddb-fulfillment-opt${ftype === 'pickup' ? ' selected' : ''}${!pickupAvailable ? ' disabled' : ''}`}
                          onClick={() => pickupAvailable && setFulfillment(dDate, 'pickup')}
                          title={!pickupAvailable
                            ? (lang === 'el' ? 'Παραλαβή μη διαθέσιμη αυτή την ημέρα' : 'Pickup not available on this day')
                            : undefined}
                        >
                          {lang === 'el' ? 'Παραλαβή από κατάστημα' : 'Pickup'}
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
                        ? (lang === 'el' ? 'ΠΑΡΑΘΥΡΟ ΠΑΡΑΛΑΒΗΣ' : 'PICKUP WINDOW')
                        : (lang === 'el' ? 'ΠΑΡΑΘΥΡΟ ΠΑΡΑΔΟΣΗΣ' : 'DELIVERY WINDOW')}
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
                        {lang === 'el' ? 'ΣΗΜΕΙΟ ΠΑΡΑΛΑΒΗΣ' : 'PICKUP LOCATION'}
                      </div>
                      {/* WEC-410: render zero/single/multi pickup states explicitly so a
                          customer in pickup mode always sees WHERE to go (or a
                          clear contact-us fallback). For multi-location, render a
                          radio picker and persist the choice per-day. */}
                      {(() => {
                        if (pickupLocations.length === 0) {
                          return (
                            <div className="pickup-loc-warning">
                              {lang === 'el'
                                ? 'Δεν υπάρχουν διαμορφωμένα σημεία παραλαβής. Επικοινώνησε μαζί μας.'
                                : 'No pickup locations configured. Please contact us.'}
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
                                    {lang === 'el' ? 'Άνοιγμα στον χάρτη ↗' : 'Open in maps ↗'}
                                  </a>
                                </div>
                                {((lang === 'el' ? selectedLoc.hoursNoteEl : selectedLoc.hoursNoteEn) ?? '').length > 0 && (
                                  <div className="pickup-loc-hours">{lang === 'el' ? selectedLoc.hoursNoteEl : selectedLoc.hoursNoteEn}</div>
                                )}
                              </div>
                            ) : (
                              <div className="pickup-loc-hint">
                                {lang === 'el' ? 'Διάλεξε σημείο παραλαβής παραπάνω' : 'Pick a location above'}
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
                        {lang === 'el' ? 'ΔΙΕΥΘΥΝΣΗ' : 'ADDRESS'}
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
              {lang === 'el' ? 'ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ' : 'PAYMENT METHOD'}
            </h2>
            <PaymentSection />
          </div>

          {/* SECTION 4: Extras */}
          <div className="co-section" ref={extrasRef} id="sec-extras">
            <h2 className="co-section-title">
              {lang === 'el' ? 'ΕΠΙΠΛΕΟΝ ΕΠΙΛΟΓΕΣ' : 'EXTRAS'}
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
              {lang === 'el' ? '← Πίσω' : '← Back'}
            </button>
            <button
              className="btn-place-order"
              onClick={handlePlaceOrder}
              disabled={!allOk || submitting}
            >
              {submitting
                ? (lang === 'el' ? 'Υποβολή...' : 'Submitting...')
                : (lang === 'el' ? 'Ολοκλήρωση παραγγελίας →' : 'Place order →')}
            </button>
          </div>

          {/* Validation reasons — client-side (pre-submit) AND server-side (post-submit) */}
          {(validationIssues.length > 0 || serverIssues.length > 0) && (
            <div className="checkout-validation">
              {serverIssues.length > 0 && (
                <div className="validation-issue" style={{ fontWeight: 800, marginBottom: 4 }}>
                  {lang === 'el' ? 'Ο διακομιστής απέρριψε την παραγγελία:' : 'Server rejected the order:'}
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
    </div>
  )
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}
