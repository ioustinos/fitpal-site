import { useState } from 'react'
import { useUIStore } from '../store/useUIStore'
import { useCartStore } from '../store/useCartStore'
import { AddressSection } from '../components/checkout/AddressSection'
import { TimeSlotPicker } from '../components/checkout/TimeSlotPicker'
import { PaymentSection } from '../components/checkout/PaymentSection'
import { ExtrasSection } from '../components/checkout/ExtrasSection'
import { OrderSummary } from '../components/checkout/OrderSummary'
import { ConfirmationScreen } from '../components/checkout/ConfirmationScreen'
import { makeTr } from '../lib/translations'
import { activeDays, dayAmt, delivOk, fmt, MIN_ORDER, subTotal } from '../lib/helpers'
import { WEEK_DATA } from '../data/menu'
import { useToast } from '../components/ui/Toast'

const STEPS = ['delivery', 'payment', 'review'] as const
type Step = typeof STEPS[number]

export function CheckoutPage() {
  const lang = useUIStore((s) => s.lang)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const cart = useCartStore((s) => s.cart)
  const delivery = useCartStore((s) => s.delivery)
  const payment = useCartStore((s) => s.payment)
  const voucher = useCartStore((s) => s.voucher)
  const t = makeTr(lang)
  const toast = useToast((s) => s.show)

  const [step, setStep] = useState<Step>('delivery')
  const [confirmed, setConfirmed] = useState(false)

  const week = WEEK_DATA[activeWeek] ?? WEEK_DATA[0]
  const days = week.days
  const dayLabelsEl = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή']
  const dayLabelsEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const activeDayIdxs = activeDays(cart)

  const total = subTotal(cart, voucher)

  function validateDelivery(): boolean {
    for (const i of activeDayIdxs) {
      const del = delivery[i]
      if (!del?.street || !del?.area) {
        toast(
          lang === 'el'
            ? `Παρακαλώ συμπλήρωσε διεύθυνση για ${dayLabelsEl[i]}`
            : `Please add address for ${dayLabelsEn[i]}`
        )
        return false
      }
      if (!del?.timeSlot) {
        toast(
          lang === 'el'
            ? `Παρακαλώ επίλεξε ώρα παράδοσης για ${dayLabelsEl[i]}`
            : `Please select delivery time for ${dayLabelsEn[i]}`
        )
        return false
      }
      if (!delivOk(del.area, total)) {
        toast(
          lang === 'el'
            ? `Η ελάχιστη παραγγελία για ${del.area} δεν έχει συμπληρωθεί`
            : `Minimum order for ${del.area} not met`
        )
        return false
      }
    }
    return true
  }

  function validatePayment(): boolean {
    if (!payment.method) {
      toast(lang === 'el' ? 'Παρακαλώ επίλεξε τρόπο πληρωμής' : 'Please select a payment method')
      return false
    }
    return true
  }

  function handleNext() {
    if (step === 'delivery') {
      if (!validateDelivery()) return
      setStep('payment')
    } else if (step === 'payment') {
      if (!validatePayment()) return
      setStep('review')
    } else {
      // Place order
      setConfirmed(true)
    }
  }

  function handleBack() {
    if (step === 'payment') setStep('delivery')
    else if (step === 'review') setStep('payment')
    else closeCheckout()
  }

  if (confirmed) return <ConfirmationScreen />

  const stepLabels = {
    delivery: { el: 'Παράδοση', en: 'Delivery' },
    payment:  { el: 'Πληρωμή', en: 'Payment' },
    review:   { el: 'Επισκόπηση', en: 'Review' },
  }

  return (
    <div className="checkout-page">
      {/* Progress pills */}
      <div className="checkout-progress">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`progress-step${step === s ? ' active' : ''}${STEPS.indexOf(step) > i ? ' done' : ''}`}
          >
            <div className="progress-dot">{STEPS.indexOf(step) > i ? '✓' : i + 1}</div>
            <span>{lang === 'el' ? stepLabels[s].el : stepLabels[s].en}</span>
          </div>
        ))}
      </div>

      <div className="checkout-layout">
        <div className="checkout-main">

          {/* STEP 1: Delivery */}
          {step === 'delivery' && (
            <div className="checkout-step">
              <h2 className="checkout-step-title">{t('deliveryDetails')}</h2>
              {activeDayIdxs.map((i) => {
                const day = days[i]
                const label = lang === 'el' ? dayLabelsEl[i] : dayLabelsEn[i]
                return (
                  <div key={day.date} className="checkout-day-block">
                    <div className="checkout-day-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      {label} — {formatDate(day.date, lang)}
                    </div>
                    <AddressSection dayIndex={i} />
                    <TimeSlotPicker dayIndex={i} />
                    {(() => {
                      const amt = dayAmt(cart, i)
                      return (
                        <div className="checkout-day-totals">
                          <span className="checkout-day-amt">
                            {lang === 'el' ? 'Σύνολο ημέρας:' : 'Day total:'} <strong>{fmt(amt)}</strong>
                          </span>
                          {amt < MIN_ORDER && (
                            <div className="min-warn">
                              ⚠ {t('minWarn')}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          )}

          {/* STEP 2: Payment */}
          {step === 'payment' && (
            <div className="checkout-step">
              <h2 className="checkout-step-title">{t('paymentMethod')}</h2>
              <PaymentSection />
              <h2 className="checkout-step-title" style={{ marginTop: 24 }}>{t('extras')}</h2>
              <ExtrasSection />
            </div>
          )}

          {/* STEP 3: Review */}
          {step === 'review' && (
            <div className="checkout-step">
              <h2 className="checkout-step-title">{t('reviewOrder')}</h2>
              <OrderSummary />
            </div>
          )}

          {/* Navigation */}
          <div className="checkout-nav">
            <button className="btn-back" onClick={handleBack}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              {step === 'delivery' ? t('backToMenu') : t('back')}
            </button>
            <button className="btn-next" onClick={handleNext}>
              {step === 'review'
                ? (lang === 'el' ? 'Ολοκλήρωση παραγγελίας' : 'Place order')
                : t('continue')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
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
