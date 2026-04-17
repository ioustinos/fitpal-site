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
import { makeTr } from '../lib/translations'
import { activeDays, dayAmt, fmt, subTotal, zoneOk } from '../lib/helpers'
import { useMenuStore } from '../store/useMenuStore'
import { useToast } from '../components/ui/Toast'
import { submitOrder } from '../lib/api/orders'

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
  const t = makeTr(lang)
  const toast = useToast((s) => s.show)

  const [confirmed, setConfirmed] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const deliveryRef = useRef<HTMLDivElement>(null)
  const paymentRef = useRef<HTMLDivElement>(null)
  const extrasRef = useRef<HTMLDivElement>(null)

  const weeks = useMenuStore((s) => s.weeks)
  const zones = useMenuStore((s) => s.zones)
  const minOrder = useMenuStore((s) => s.settings.minOrder)
  const week = weeks[activeWeek] ?? weeks[0]
  const days = week?.days ?? []
  const dayLabelsEl = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή']
  const dayLabelsEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const activeDayIdxs = useMemo(() => activeDays(cart), [cart])

  const total = subTotal(cart, voucher)

  // ─── Per-day + overall validation ─────────────────────────────────────────────

  const validationIssues: string[] = []

  activeDayIdxs.forEach((i) => {
    const del = delivery[i]
    const label = lang === 'el' ? dayLabelsEl[i] : dayLabelsEn[i]
    const amt = dayAmt(cart, i)

    if (!del?.street || !del?.area) {
      validationIssues.push(
        lang === 'el'
          ? `${label}: Δεν έχει επιλεγεί διεύθυνση`
          : `${label}: No address selected`
      )
    } else if (!zoneOk(del.area, zones)) {
      validationIssues.push(
        lang === 'el'
          ? `${label}: Η περιοχή "${del.area}" είναι εκτός ζώνης`
          : `${label}: Area "${del.area}" is outside delivery zone`
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

  const deliveryOk = activeDayIdxs.every((i) => {
    const del = delivery[i]
    const amt = dayAmt(cart, i)
    return del?.street && del?.area && del?.timeSlot && zoneOk(del.area, zones) && amt >= minOrder
  })

  const paymentOk = !!payment.method

  const extrasOk = deliveryOk && paymentOk

  const allOk = deliveryOk && paymentOk

  // ─── Prepopulate from user preferences on mount ──────────────────────────────

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

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

  function scrollToSection(ref: React.RefObject<HTMLDivElement>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handlePlaceOrder() {
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

    const { data, error } = await submitOrder({
      userId: user?.id,
      customerName: user?.name ?? '',
      customerEmail: user?.email ?? '',
      customerPhone: user?.phone,
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
      toast(error)
      return
    }

    setOrderNumber(data?.orderNumber ?? '')
    setConfirmed(true)
  }

  if (confirmed) return <ConfirmationScreen orderNumber={orderNumber} />

  const sections = [
    {
      id: 'sec-delivery',
      label: lang === 'el' ? '1.Παράδοση' : '1.Delivery',
      ok: deliveryOk,
      ref: deliveryRef,
    },
    {
      id: 'sec-payment',
      label: lang === 'el' ? '2.Πληρωμή' : '2.Payment',
      ok: paymentOk,
      ref: paymentRef,
    },
    {
      id: 'sec-extras',
      label: lang === 'el' ? '3.Επιπλέον Επιλογές' : '3.Extras',
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
          {/* SECTION 1: Delivery */}
          <div className="co-section" ref={deliveryRef} id="sec-delivery">
            <h2 className="co-section-title">
              {lang === 'el' ? 'ΣΤΟΙΧΕΙΑ ΠΑΡΑΔΟΣΗΣ' : 'DELIVERY DETAILS'}
            </h2>
            {activeDayIdxs.map((i) => {
              const day = days[i]
              const label = lang === 'el' ? dayLabelsEl[i] : dayLabelsEn[i]
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

          {/* SECTION 2: Payment */}
          <div className="co-section" ref={paymentRef} id="sec-payment">
            <h2 className="co-section-title">
              {lang === 'el' ? 'ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ' : 'PAYMENT METHOD'}
            </h2>
            <PaymentSection />
          </div>

          {/* SECTION 3: Extras */}
          <div className="co-section" ref={extrasRef} id="sec-extras">
            <h2 className="co-section-title">
              {lang === 'el' ? 'ΕΠΙΠΛΕΟΝ ΕΠΙΛΟΓΕΣ' : 'EXTRAS'}
            </h2>
            <ExtrasSection />
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

          {/* Validation reasons */}
          {validationIssues.length > 0 && (
            <div className="checkout-validation">
              {validationIssues.map((issue, idx) => (
                <div key={idx} className="validation-issue">
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
