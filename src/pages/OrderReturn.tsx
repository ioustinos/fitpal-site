// Customer lands here when Viva redirects back from the hosted checkout.
//
// Flow:
//   1. Pull the `t` (transactionId) and `s` (orderCode) params Viva appended.
//   2. Call /api/viva-verify?t=... which does the authoritative GET against
//      Viva's Retrieve Transaction API and flips payment_status if paid.
//   3. If still pending (verify returned 'pending'), poll Supabase directly
//      for up to 10s — gives the webhook or reconcile a chance to finish
//      without making us look stuck.
//   4. Render final state.
//
// WEC-172: part of the Viva Payments integration epic (WEC-125).

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUIStore } from '../store/useUIStore'

type Outcome =
  | { status: 'paid';     orderNumber: string; amountCents: number }
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

export function OrderReturn({ mode }: Props) {
  const [params] = useSearchParams()
  const lang = useUIStore((s) => s.lang)
  const [outcome, setOutcome] = useState<Outcome>({ status: 'loading' })
  const pollingRef = useRef(false)

  useEffect(() => {
    const t = params.get('t') ?? params.get('transactionId') ?? ''
    const merchantTrns = params.get('merchantTrns') ?? '' // our orderId

    if (!t) {
      // No transactionId — either the user bookmarked the URL or Viva
      // didn't pass params. If the failure-URL, show generic failure.
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
          setOutcome({ status: 'paid', orderNumber: data.orderNumber, amountCents: data.amountCents })
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
          // Either the payment_links row isn't written yet, or we never
          // initiated this tx. Try polling Supabase by merchantTrns.
          if (merchantTrns) {
            pollOrder(merchantTrns)
          } else {
            setOutcome({ status: 'unknown', message: data.message ?? '' })
          }
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

      const deadline = Date.now() + 10_000 // 10s budget
      while (!cancelled && Date.now() < deadline) {
        const { data } = await supabase
          .from('orders')
          .select('order_number, payment_status, total')
          .eq('id', orderId)
          .maybeSingle()
        if (cancelled) return
        if (data?.payment_status === 'paid') {
          setOutcome({
            status: 'paid',
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
      // Timed out waiting for webhook/reconcile. Show pending state with
      // a message that confirmation will arrive by email.
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

  return (
    <div style={{ maxWidth: 600, margin: '48px auto', padding: '24px', textAlign: 'center' }}>
      {renderOutcome(outcome, lang)}
    </div>
  )
}

function renderOutcome(o: Outcome, lang: 'el' | 'en') {
  if (o.status === 'loading') {
    return <p>{lang === 'el' ? 'Επαλήθευση πληρωμής…' : 'Verifying your payment…'}</p>
  }

  if (o.status === 'paid') {
    return (
      <>
        <h1 style={{ color: '#10b981' }}>
          {lang === 'el' ? '✓ Η παραγγελία σας επιβεβαιώθηκε' : '✓ Your order is confirmed'}
        </h1>
        <p>
          {lang === 'el' ? 'Αριθμός παραγγελίας: ' : 'Order number: '}
          <strong>{o.orderNumber}</strong>
        </p>
        <p>
          {lang === 'el' ? 'Ποσό: ' : 'Amount: '}€{(o.amountCents / 100).toFixed(2)}
        </p>
        <p style={{ color: '#6b7280', marginTop: 16 }}>
          {lang === 'el'
            ? 'Θα λάβετε email επιβεβαίωσης σύντομα.'
            : "You'll receive a confirmation email shortly."}
        </p>
        <a href="/" style={{ display: 'inline-block', marginTop: 24 }}>
          {lang === 'el' ? '← Επιστροφή στο μενού' : '← Back to menu'}
        </a>
      </>
    )
  }

  if (o.status === 'pending') {
    return (
      <>
        <h1>{lang === 'el' ? 'Ολοκλήρωση πληρωμής…' : 'Finalising payment…'}</h1>
        <p>
          {lang === 'el'
            ? 'Η τράπεζα επεξεργάζεται την πληρωμή. Θα λάβετε email επιβεβαίωσης μόλις ολοκληρωθεί.'
            : "Your bank is processing the payment. You'll receive a confirmation email as soon as it completes."}
        </p>
        {o.orderNumber && (
          <p>
            {lang === 'el' ? 'Αριθμός παραγγελίας: ' : 'Order number: '}
            <strong>{o.orderNumber}</strong>
          </p>
        )}
        <a href="/" style={{ display: 'inline-block', marginTop: 24 }}>
          {lang === 'el' ? '← Επιστροφή στο μενού' : '← Back to menu'}
        </a>
      </>
    )
  }

  if (o.status === 'failed') {
    return (
      <>
        <h1 style={{ color: '#ef4444' }}>
          {lang === 'el' ? 'Η πληρωμή δεν ολοκληρώθηκε' : 'Payment did not complete'}
        </h1>
        <p>
          {lang === 'el'
            ? 'Η παραγγελία σας δεν χρεώθηκε. Μπορείτε να δοκιμάσετε ξανά.'
            : 'Your order was not charged. You can try again.'}
        </p>
        {o.orderNumber && (
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            {lang === 'el' ? 'Αναφορά: ' : 'Reference: '}
            {o.orderNumber}
          </p>
        )}
        <a href="/" style={{ display: 'inline-block', marginTop: 24 }}>
          {lang === 'el' ? '← Επιστροφή στο μενού' : '← Back to menu'}
        </a>
      </>
    )
  }

  if (o.status === 'mismatch') {
    return (
      <>
        <h1 style={{ color: '#ef4444' }}>
          {lang === 'el' ? 'Κάτι δεν πάει καλά' : 'Something went wrong'}
        </h1>
        <p>
          {lang === 'el'
            ? 'Υπάρχει ασυμφωνία ποσού. Η ομάδα μας έχει ειδοποιηθεί.'
            : 'There is an amount mismatch. Our team has been notified.'}
        </p>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          {lang === 'el' ? 'Αναφορά: ' : 'Reference: '}
          {o.orderNumber}
        </p>
      </>
    )
  }

  if (o.status === 'error') {
    return (
      <>
        <h1 style={{ color: '#ef4444' }}>{lang === 'el' ? 'Σφάλμα' : 'Error'}</h1>
        <p>{o.message}</p>
      </>
    )
  }

  // unknown
  return (
    <>
      <h1>{lang === 'el' ? 'Η σελίδα απαιτεί παραμέτρους' : 'Missing parameters'}</h1>
      <p>{o.message}</p>
    </>
  )
}
