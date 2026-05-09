// Customer lands here when Viva redirects back from the hosted checkout.
//
// Flow:
//   1. Pull the `t` (transactionId) and `s` (orderCode) params Viva appended.
//   2. Call /api/viva-verify?t=... which does the authoritative GET against
//      Viva's Retrieve Transaction API and flips payment_status if paid.
//   3. If still pending (verify returned 'pending'), poll Supabase directly
//      for up to 10s — gives the webhook or reconcile a chance to finish
//      without making us look stuck.
//   4. On success: fetch the full order + children + items and render the
//      SAME confirmation UI the cash flow uses (`.conf-*` CSS classes,
//      mirrors components/checkout/ConfirmationScreen.tsx).
//
// WEC-172: part of the Viva Payments integration epic (WEC-125).

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUIStore } from '../store/useUIStore'
import { fetchOrderForConfirmation, type ConfirmationOrder } from '../lib/api/orders'
import { fmt } from '../lib/helpers'

type Outcome =
  | { status: 'paid';     orderId: string; orderNumber: string; amountCents: number }
  | { status: 'failed';   orderNumber: string; reason: string }
  | { status: 'pending';  orderNumber?: string }
  | { status: 'mismatch'; orderNumber: string }
  | { status: 'unknown';  message: string }
  | { status: 'loading' }
  | { status: 'error';    message: string }

interface Props {
  /** Preset outcome used by the failure-URL landing page. */
  mode: 'success' | 'failure'
}

function formatDate(iso: string, lang: 'el' | 'en') {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' })
}

export function OrderReturn({ mode }: Props) {
  const [params] = useSearchParams()
  const lang = useUIStore((s) => s.lang)
  const [outcome, setOutcome] = useState<Outcome>({ status: 'loading' })
  const [orderDetails, setOrderDetails] = useState<ConfirmationOrder | null>(null)
  const pollingRef = useRef(false)

  useEffect(() => {
    const t = params.get('t') ?? params.get('transactionId') ?? ''
    const merchantTrns = params.get('merchantTrns') ?? '' // our orderId

    if (!t) {
      if (mode === 'failure') {
        setOutcome({ status: 'failed', orderNumber: '', reason: params.get('eci') ?? 'cancelled' })
      } else {
        setOutcome({ status: 'unknown', message: 'Missing transaction reference' })
      }
      return
    }

    let cancelled = false

    async function verify() {
      try {
        const res = await fetch(`/api/viva-verify?t=${encodeURIComponent(t)}`)
        const data = await res.json()
        if (cancelled) return

        if (!res.ok) {
          setOutcome({ status: 'error', message: data.error ?? `Verify failed (${res.status})` })
          return
        }

        if (data.status === 'paid') {
          setOutcome({
            status: 'paid',
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            amountCents: data.amountCents,
          })
          return
        }
        if (data.status === 'failed') {
          setOutcome({ status: 'failed', orderNumber: data.orderNumber, reason: data.reason })
          return
        }
        if (data.status === 'mismatch') {
          setOutcome({ status: 'mismatch', orderNumber: data.orderNumber })
          return
        }
        if (data.status === 'unknown') {
          if (merchantTrns) pollOrder(merchantTrns)
          else setOutcome({ status: 'unknown', message: data.message ?? '' })
          return
        }

        // 'pending' — poll Supabase in case webhook/reconcile finishes soon.
        if (merchantTrns) pollOrder(merchantTrns)
        else setOutcome({ status: 'pending' })
      } catch (err) {
        if (cancelled) return
        setOutcome({
          status: 'error',
          message: err instanceof Error ? err.message : 'Network error',
        })
      }
    }

    async function pollOrder(orderId: string) {
      if (pollingRef.current) return
      pollingRef.current = true

      const deadline = Date.now() + 10_000
      while (!cancelled && Date.now() < deadline) {
        const { data } = await supabase
          .from('orders')
          .select('id, order_number, payment_status, total')
          .eq('id', orderId)
          .maybeSingle()
        if (cancelled) return
        if (data?.payment_status === 'paid') {
          setOutcome({
            status: 'paid',
            orderId: data.id as string,
            orderNumber: data.order_number as string,
            amountCents: data.total as number,
          })
          pollingRef.current = false
          return
        }
        if (data?.payment_status === 'failed') {
          setOutcome({
            status: 'failed',
            orderNumber: data.order_number as string,
            reason: 'Bank declined',
          })
          pollingRef.current = false
          return
        }
        await new Promise((r) => setTimeout(r, 1500))
      }

      pollingRef.current = false
      if (!cancelled) {
        const { data } = await supabase
          .from('orders')
          .select('order_number')
          .eq('id', orderId)
          .maybeSingle()
        setOutcome({
          status: 'pending',
          orderNumber: (data?.order_number as string) ?? undefined,
        })
      }
    }

    verify()
    return () => {
      cancelled = true
    }
  }, [params, mode])

  // When we land on `paid`, fetch the full order so we can render the rich
  // confirmation UI (matching the cash flow's ConfirmationScreen).
  useEffect(() => {
    if (outcome.status !== 'paid') return
    let cancelled = false
    ;(async () => {
      const { data } = await fetchOrderForConfirmation(outcome.orderId)
      if (!cancelled && data) setOrderDetails(data)
    })()
    return () => { cancelled = true }
  }, [outcome])

  return (
    <div className="order-return-page">
      {outcome.status === 'paid'
        ? <PaidView orderNumber={outcome.orderNumber} details={orderDetails} lang={lang} />
        : <NonPaidView outcome={outcome} lang={lang} />}
    </div>
  )
}

/* ─── Paid → Fitpal-styled confirmation (same .conf-* classes as ConfirmationScreen) ─── */

function PaidView({
  orderNumber, details, lang,
}: { orderNumber: string; details: ConfirmationOrder | null; lang: 'el' | 'en' }) {
  return (
    <div className="confirmation-screen">
      <div className="conf-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>

      <h2 className="conf-title">
        {lang === 'el' ? 'Η παραγγελία σου καταχωρήθηκε!' : 'Your order has been placed!'}
      </h2>

      <div className="conf-order-hero">
        <div className="conf-order-hero-label">
          {lang === 'el' ? 'Αριθμός παραγγελίας' : 'Order number'}
        </div>
        <div className="conf-order-hero-number">{orderNumber}</div>
      </div>

      <p className="conf-sub">
        {lang === 'el'
          ? 'Θα λάβεις σύντομα email επιβεβαίωσης. Αν δεν εμφανιστεί στα εισερχόμενα, έλεγξε και τον φάκελο ανεπιθύμητης αλληλογραφίας.'
          : "You'll receive a confirmation email shortly. If it doesn't show up in your inbox, check your spam folder too."}
      </p>

      {details ? (
        <div className="conf-summary">
          {details.days.map((d) => (
            <div className="conf-day" key={d.dateISO}>
              <div className="conf-day-name">
                {(lang === 'el' ? d.dayLabelEl : d.dayLabelEn)} {formatDate(d.dateISO, lang)}
              </div>
              <div className="conf-day-meta">
                {d.timeSlot} | {d.street}, {d.area}
              </div>
              <div className="conf-day-items">
                {d.items.map((it, idx) => {
                  const itemName = lang === 'el' ? it.nameEl : it.nameEn
                  const itemVariant = lang === 'el' ? it.variantLabelEl : it.variantLabelEn
                  return (
                    <div className="conf-item" key={idx}>
                      <span className="conf-item-qty">{it.qty}×</span>
                      <span className="conf-item-name">
                        {itemName}
                        {itemVariant && (
                          <>
                            {' '}·{' '}
                            <span className="conf-item-variant">{itemVariant}</span>
                          </>
                        )}
                      </span>
                      <span className="conf-item-price">{fmt(it.totalPrice)}</span>
                    </div>
                  )
                })}
              </div>
              <div className="conf-day-amt">
                {lang === 'el' ? 'Σύνολο ημέρας' : 'Day total'}: {fmt(d.dayTotal)}
              </div>
            </div>
          ))}

          {details.notes && (
            <div className="conf-comment">"{details.notes}"</div>
          )}

          <div className="conf-total">
            <span>{lang === 'el' ? 'Σύνολο' : 'Total'}</span>
            <span>{fmt(details.total)}</span>
          </div>
        </div>
      ) : (
        <p className="conf-loading-detail">
          {lang === 'el' ? 'Φόρτωση λεπτομερειών παραγγελίας…' : 'Loading order details…'}
        </p>
      )}

      <div className="conf-actions">
        <a className="btn-conf-done" href="/">
          {lang === 'el' ? 'Επιστροφή στο μενού' : 'Back to menu'}
        </a>
      </div>
    </div>
  )
}

/* ─── Non-paid states (loading, pending, failed, mismatch, error, unknown) ─── */

function NonPaidView({ outcome, lang }: { outcome: Outcome; lang: 'el' | 'en' }) {
  if (outcome.status === 'loading') {
    return (
      <div className="order-return-state">
        <div className="ors-spinner" aria-hidden="true" />
        <h2>{lang === 'el' ? 'Επαλήθευση πληρωμής…' : 'Verifying your payment…'}</h2>
      </div>
    )
  }

  if (outcome.status === 'pending') {
    return (
      <div className="order-return-state">
        <div className="ors-spinner" aria-hidden="true" />
        <h2>{lang === 'el' ? 'Ολοκλήρωση πληρωμής…' : 'Finalising payment…'}</h2>
        <p>
          {lang === 'el'
            ? 'Η τράπεζα επεξεργάζεται την πληρωμή. Θα λάβεις email επιβεβαίωσης μόλις ολοκληρωθεί.'
            : "Your bank is processing the payment. You'll receive a confirmation email as soon as it completes."}
        </p>
        {outcome.orderNumber && (
          <p className="ors-ref">
            {lang === 'el' ? 'Αριθμός παραγγελίας: ' : 'Order number: '}
            <strong>{outcome.orderNumber}</strong>
          </p>
        )}
        <a className="btn-conf-done" href="/">
          {lang === 'el' ? 'Επιστροφή στο μενού' : 'Back to menu'}
        </a>
      </div>
    )
  }

  if (outcome.status === 'failed') {
    return (
      <div className="order-return-state ors-error">
        <div className="ors-icon-x" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <h2>{lang === 'el' ? 'Η πληρωμή δεν ολοκληρώθηκε' : 'Payment did not complete'}</h2>
        <p>
          {lang === 'el'
            ? 'Η παραγγελία σου δεν χρεώθηκε. Μπορείς να δοκιμάσεις ξανά.'
            : 'Your order was not charged. You can try again.'}
        </p>
        {outcome.orderNumber && (
          <p className="ors-ref">
            {lang === 'el' ? 'Αναφορά: ' : 'Reference: '} {outcome.orderNumber}
          </p>
        )}
        <a className="btn-conf-done" href="/">
          {lang === 'el' ? 'Επιστροφή στο μενού' : 'Back to menu'}
        </a>
      </div>
    )
  }

  if (outcome.status === 'mismatch') {
    return (
      <div className="order-return-state ors-error">
        <h2>{lang === 'el' ? 'Κάτι δεν πάει καλά' : 'Something went wrong'}</h2>
        <p>
          {lang === 'el'
            ? 'Υπάρχει ασυμφωνία ποσού. Η ομάδα μας έχει ειδοποιηθεί.'
            : 'There is an amount mismatch. Our team has been notified.'}
        </p>
        <p className="ors-ref">
          {lang === 'el' ? 'Αναφορά: ' : 'Reference: '} {outcome.orderNumber}
        </p>
      </div>
    )
  }

  if (outcome.status === 'error') {
    return (
      <div className="order-return-state ors-error">
        <h2>{lang === 'el' ? 'Σφάλμα' : 'Error'}</h2>
        <p>{outcome.message}</p>
      </div>
    )
  }

  // unknown
  return (
    <div className="order-return-state">
      <h2>{lang === 'el' ? 'Η σελίδα απαιτεί παραμέτρους' : 'Missing parameters'}</h2>
      <p>{outcome.message}</p>
    </div>
  )
}
