import { useState, useEffect, useRef, useMemo } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useCartStore } from '../store/useCartStore'
import { useAuthStore } from '../store/useAuthStore'
import { AddressSection } from '../components/checkout/AddressSection'
import { TimeSlotPicker } from '../components/checkout/TimeSlotPicker'
import { PaymentSection } from '../components/checkout/PaymentSection'
import { ExtrasSection } from '../components/checkout/ExtrasSection'
import { OrderSummary } from '../components/checkout/OrderSummary'
import { ConfirmationScreen } from '../components/checkout/ConfirmationScreen'
import { ContactSection, type ContactInfo } from '../components/checkout/ContactSection'
import { activeDays, dayAmt, zipInZone } from '../lib/helpers'
import { dayLabel } from '../lib/datelabels'
import { isValidPhone } from '../lib/phone'
import { updateProfile } from '../lib/api/auth'
import { useMenuStore } from '../store/useMenuStore'
import { useToast } from '../components/ui/Toast'
import { submitOrder } from '../lib/api/orders'
import { useImpersonationStore } from '../store/useImpersonationStore'

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
  const activeWeek = useUIStore((s) => s.activeWeek)
  const cart = useCartStore((s) => s.cart)
  const delivery = useCartStore((s) => s.delivery)
  const payment = useCartStore((s) => s.payment)
  const voucher = useCartStore((s) => s.voucher)
  const setDelivery = useCartStore((s) => s.setDelivery)
  const setPayment = useCartStore((s) => s.setPayment)
  const user = useAuthStore((s) => s.user)
  const toast = useToast((s) => s.show)

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
  // Toggles red borders on the contact inputs only *after* the user attempts
  // to submit — feels less aggressive than validating while they're typing.
  const [contactAttempted, setContactAttempted] = useState(false)
  const contactRef = useRef<HTMLDivElement>(null)
  const deliveryRef = useRef<HTMLDivElement>(null)
  const paymentRef = useRef<HTMLDivElement>(null)
  const extrasRef = useRef<HTMLDivElement>(null)

  const weeks = useMenuStore((s) => s.weeks)
  const zones = useMenuStore((s) => s.zones)
  const minOrder = useMenuStore((s) => s.settings.minOrder)
  const week = weeks[activeWeek] ?? weeks[0]
  const days = week?.days ?? []
  // Resolve the long weekday label for day-index `i` via the real ISO date
  // (WEC-137). Falls back to empty when a day is missing — should only happen
  // mid-hydration before the menu finishes loading.
  const dayLabelFor = (i: number) =>
    days[i] ? dayLabel(days[i].date, lang, 'long') : ''
  const activeDayIdxs = useMemo(() => activeDays(cart), [cart])

  // ─── Per-day + overall validation ─────────────────────────────────────────────

  const validationIssues: string[] = []

  // Contact info (WEC-130) — server requires name + email, we also require a
  // valid phone up-front so cash-on-delivery / support callbacks work.
  const contactName = contact.name.trim()
  const contactEmail = contact.email.trim()
  const emailRe = /^.+@.+\..+$/
  const contactNameOk = contactName.length > 0
  const contactEmailOk = contactEmail.length > 0 && emailRe.test(contactEmail)
  const contactPhoneOk = isValidPhone(contact.phone)

  if (!contactNameOk) {
    validationIssues.push(
      lang === 'el' ? 'Λείπει το ονοματεπώνυμο' : 'Name is required'
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

  activeDayIdxs.forEach((i) => {
    const del = delivery[i]
    const label = dayLabelFor(i)
    const amt = dayAmt(cart, i)

    if (!del?.street || !del?.area) {
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

  // Invoice validation (WEC-138). Keep in sync with ExtrasSection's check.
  const invoiceVatDigits = (payment.invoiceVat ?? '').replace(/\D/g, '')
  const invoiceOk = !payment.invoice
    || (!!payment.invoiceName?.trim() && invoiceVatDigits.length >= 5)
  if (payment.invoice && !payment.invoiceName?.trim()) {
    validationIssues.push(
      lang === 'el'
        ? 'Τιμολόγιο: λείπει η επωνυμία ή το όνομα'
        : 'Invoice: company or name is missing'
    )
  }
  if (payment.invoice && invoiceVatDigits.length === 0) {
    validationIssues.push(
      lang === 'el' ? 'Τιμολόγιο: λείπει το ΑΦΜ' : 'Invoice: VAT number is missing'
    )
  } else if (payment.invoice && invoiceVatDigits.length > 0 && invoiceVatDigits.length < 5) {
    validationIssues.push(
      lang === 'el'
        ? 'Τιμολόγιο: το ΑΦΜ πρέπει να έχει τουλάχιστον 5 ψηφία'
        : 'Invoice: VAT must be at least 5 digits'
    )
  }

  const deliveryOk = activeDayIdxs.every((i) => {
    const del = delivery[i]
    const amt = dayAmt(cart, i)
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

    // Prepopulate delivery preferences (slots and saved addresses)
    const dayIdxs = activeDays(cart)
    for (const dayIdx of dayIdxs) {
      // Prepopulate time slot if available
      if (user.prefs.slots?.[dayIdx]) {
        setDelivery(dayIdx, { timeSlot: user.prefs.slots[dayIdx] })
      }

      // Prepopulate address if saved
      if (user.prefs.dayAddress?.[dayIdx]) {
        const addrId = user.prefs.dayAddress[dayIdx]
        const addr = user.addresses.find((a) => a.id === addrId)
        if (addr) {
          setDelivery(dayIdx, {
            addrId,
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

    const dayPayloads = activeDayIdxs.map((i) => {
      const del = delivery[i]
      const items = cart[i] ?? []
      const dayDate = days[i]?.date ?? ''
      const { from, to } = parseSlot(del?.timeSlot ?? '')

      return {
        deliveryDate: dayDate,
        timeFrom: from,
        timeTo: to,
        addressStreet: del?.street ?? '',
        addressArea: del?.area ?? '',
        addressZip: del?.zip,
        addressFloor: del?.floor,
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

    const { data, error, validationErrors } = await submitOrder({
      userId: user?.id,
      customerName: contactName,
      customerEmail: contactEmail,
      customerPhone: contact.phone,  // E.164 from <PhoneInput>
      paymentMethod: payment.method as 'cash' | 'card' | 'link' | 'transfer' | 'wallet',
      cutlery: payment.cutlery ?? false,
      invoiceType: payment.invoice ? 'receipt' : undefined,
      invoiceName: payment.invoiceName,
      invoiceVat: payment.invoiceVat,
      notes: payment.notes,
      voucherCode: voucher.applied ? voucher.code : undefined,
      days: dayPayloads,
    })

    setSubmitting(false)

    if (error) {
      // Flatten server-side validationErrors into the red block. Keep a
      // matching toast so the user notices scrolling back to the list.
      if (validationErrors) {
        const flat: string[] = []
        for (const [key, msgs] of Object.entries(validationErrors)) {
          // Prefix day-scoped errors with the day label for clarity
          const m = /^day_(\d+)$/.exec(key)
          const prefix = m ? `${dayLabelFor(+m[1])}: ` : ''
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
            {activeDayIdxs.map((i) => {
              const day = days[i]
              const label = dayLabelFor(i)
              return (
                <div key={day.date} className="day-deliv-block">
                  <div className="ddb-title">
                    {label} — {formatDate(day.date, lang)}
                  </div>

                  {/* Time slots FIRST (matches demo) */}
                  <div className="ddb-zone">
                    <div className="ddb-section-hdr">
                      <span className="ddb-section-ico">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                      </span>
                      {lang === 'el' ? 'ΠΑΡΑΘΥΡΟ ΠΑΡΑΔΟΣΗΣ' : 'DELIVERY WINDOW'}
                    </div>
                    <TimeSlotPicker dayIndex={i} inline />
                  </div>

                  {/* Address SECOND (matches demo) */}
                  <div className="ddb-zone">
                    <div className="ddb-section-hdr">
                      <span className="ddb-section-ico">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                      </span>
                      {lang === 'el' ? 'ΔΙΕΥΘΥΝΣΗ' : 'ADDRESS'}
                    </div>
                    <AddressSection dayIndex={i} />
                  </div>
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
    </div>
  )
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}
