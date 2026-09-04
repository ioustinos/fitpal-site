// WEC-701 §A — the real, revisitable subscription success PAGE.
//
// Replaces the old bank/cash MODAL in WalletPage (a modal has no URL, so a
// customer who clicked outside it — like Μαρία Πλαγάκη with the €405.17 transfer
// — lost the IBAN + reference with no way back). This page:
//   • has a URL: /subscription/success/:reference  (reference = WP-XXXXXXXX)
//   • survives refresh + back/forward — it re-fetches from the durable
//     `wallet_plans` record every time, never from React state
//   • is re-visitable (linked from Account → Συνδρομές)
//   • covers every non-Viva payment path: bank transfer (IBAN block), cash
//     (reference only), plus paid states for card/wallet
//   • fires the WEC-701 §C `subscribe` conversion event exactly once (guarded on
//     the reference so a refresh can't double-count — inert while tracking off)
//
// Viva card/link purchases keep landing on OrderReturn (it owns the
// authoritative payment verification + WEC-682 cancel-revert); OrderReturn
// forwards its wallet-paid outcome here so all paths converge on this one page.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { CopyButton } from '../components/ui/CopyButton'
import {
  fetchSubscriptionByReference,
  type SubscriptionDetails,
} from '../lib/api/wallet'
import { track } from '../lib/tracking'

// WEC-665 parity: dev hosts go to the dev landing so testers stay on dev.
const LANDING_URL =
  typeof window !== 'undefined' &&
  (window.location.host.startsWith('dev--') || window.location.host.includes('localhost'))
    ? 'https://dev--fitpal-landing.netlify.app'
    : 'https://fitpal.gr'

function goalLabel(goal: string | null, el: boolean): string {
  if (!goal) return '—'
  const m: Record<string, string> = {
    lose: el ? 'Απώλεια βάρους' : 'Weight loss',
    maintain: el ? 'Διατήρηση' : 'Maintain',
    gain: el ? 'Αύξηση μυϊκής μάζας' : 'Muscle gain',
  }
  return m[goal] ?? goal
}

function lengthLabel(d: SubscriptionDetails, el: boolean): string {
  const byKey: Record<string, string> = {
    '2w': el ? '2 εβδομάδες' : '2 weeks',
    '1mo': el ? '1 μήνας' : '1 month',
    '3mo': el ? '3 μήνες' : '3 months',
  }
  if (d.planLength && byKey[d.planLength]) return byKey[d.planLength]
  if (d.planLengthWeeks)
    return `${Math.round(d.planLengthWeeks)} ${el ? 'εβδομάδες' : 'weeks'}`
  return d.planLength ?? '—'
}

function mealsLabel(d: SubscriptionDetails, el: boolean): string {
  return (
    [
      d.meals.breakfast && (el ? 'Πρωινό' : 'Breakfast'),
      d.meals.lunch && (el ? 'Μεσημεριανό' : 'Lunch'),
      d.meals.dinner && (el ? 'Βραδινό' : 'Dinner'),
      d.meals.snack && (el ? 'Σνακ' : 'Snack'),
    ]
      .filter(Boolean)
      .join(', ') || '—'
  )
}

export function SubscriptionSuccess() {
  const { reference = '' } = useParams<{ reference: string }>()
  const lang = useUIStore((s) => s.lang)
  const el = lang === 'el'
  const user = useAuthStore((s) => s.user)
  const sessionChecked = useAuthStore((s) => s.sessionChecked)

  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'need-login' }
    | { kind: 'not-found' }
    | { kind: 'ready'; details: SubscriptionDetails }
  >({ kind: 'loading' })

  // Fetch (or re-fetch on refresh) from the durable plan record.
  useEffect(() => {
    if (!sessionChecked) return
    if (!user) {
      setState({ kind: 'need-login' })
      return
    }
    let cancelled = false
    setState({ kind: 'loading' })
    ;(async () => {
      const { data } = await fetchSubscriptionByReference(user.id, reference)
      if (cancelled) return
      setState(data ? { kind: 'ready', details: data } : { kind: 'not-found' })
    })()
    return () => {
      cancelled = true
    }
  }, [user, sessionChecked, reference])

  // WEC-701 §C — fire the `subscribe` conversion exactly once per reference.
  // A page (unlike a modal) can be reloaded, so guard on the reference in
  // localStorage; duplicate conversions corrupt ROAS. Inert while
  // VITE_TRACKING_ENABLED is off — wired now so it counts the day it flips on.
  const firedRef = useRef(false)
  useEffect(() => {
    if (state.kind !== 'ready' || firedRef.current) return
    const d = state.details
    const guardKey = `fitpal_sub_tracked_${d.reference}`
    try {
      if (localStorage.getItem(guardKey)) {
        firedRef.current = true
        return
      }
    } catch {
      /* private mode — fall through, in-tab ref still de-dupes */
    }
    firedRef.current = true
    try {
      localStorage.setItem(guardKey, '1')
    } catch {
      /* ignore */
    }
    track(
      'subscribe',
      {
        value: d.amountPaid,
        currency: 'EUR',
        orderId: d.reference, // stable eventId → Pixel/CAPI dedup
        orderNumber: d.reference,
        contentName: `Subscription ${lengthLabel(d, false)}`.trim(),
      },
      user
        ? { email: user.email, externalId: user.id, firstName: user.name }
        : undefined,
    )
  }, [state, user])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [state.kind])

  if (state.kind === 'loading') {
    return (
      <div className="order-return-page">
        <div className="order-return-state">
          <div className="ors-spinner" aria-hidden="true" />
          <h2>{el ? 'Φόρτωση συνδρομής…' : 'Loading subscription…'}</h2>
        </div>
      </div>
    )
  }

  if (state.kind === 'need-login') {
    return (
      <div className="order-return-page">
        <div className="order-return-state">
          <h2>{el ? 'Σύνδεση απαιτείται' : 'Sign in required'}</h2>
          <p>
            {el
              ? 'Συνδέσου στον λογαριασμό σου για να δεις τα στοιχεία της συνδρομής σου.'
              : 'Sign in to your account to view your subscription details.'}
          </p>
          <a className="btn-conf-done" href="/">
            {el ? 'Σύνδεση' : 'Sign in'}
          </a>
        </div>
      </div>
    )
  }

  if (state.kind === 'not-found') {
    return (
      <div className="order-return-page">
        <div className="order-return-state ors-error">
          <h2>{el ? 'Δεν βρέθηκε η συνδρομή' : 'Subscription not found'}</h2>
          <p>
            {el
              ? 'Δεν βρήκαμε συνδρομή με αυτόν τον κωδικό στον λογαριασμό σου.'
              : "We couldn't find a subscription with this reference on your account."}
          </p>
          <a className="btn-conf-done" href="/">
            {el ? 'Επιστροφή στο μενού' : 'Back to menu'}
          </a>
        </div>
      </div>
    )
  }

  const d = state.details
  const isTransfer = d.paymentMethod === 'transfer'
  const isCash = d.paymentMethod === 'cash'
  const isPending = d.paymentStatus === 'pending'

  return (
    <div className="order-return-page">
      <div className="confirmation-screen">
        <div className="conf-icon">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>

        <h2 className="conf-title">
          {isPending
            ? el
              ? 'Η συνδρομή σου καταχωρήθηκε!'
              : 'Your subscription is registered!'
            : el
              ? 'Η συνδρομή σου ενεργοποιήθηκε!'
              : 'Your subscription is active!'}
        </h2>

        <div className="conf-order-hero">
          <div className="conf-order-hero-label">
            {el ? 'Κωδικός συνδρομής' : 'Subscription reference'}
          </div>
          <div className="conf-order-hero-number">{d.reference}</div>
        </div>

        {/* ── Bank transfer: the payment details, mirrored from the email ── */}
        {isTransfer && isPending && (
          <div className="sub-bank-block">
            <p className="sub-bank-lead">
              {el
                ? 'Ολοκλήρωσε την πληρωμή με τραπεζική μεταφορά στον παρακάτω λογαριασμό:'
                : 'Complete your payment by bank transfer to the account below:'}
            </p>
            {d.bankInfos.map((b, i) => (
              <dl className="wpv2-bank-details" key={i}>
                <dt>IBAN</dt>
                <dd className="bank-info-copyrow">
                  <span>{b.iban}</span>
                  <CopyButton value={b.iban} lang={lang} ariaLabel={el ? 'Αντιγραφή IBAN' : 'Copy IBAN'} />
                </dd>
                <dt>{el ? 'Δικαιούχος' : 'Beneficiary'}</dt>
                <dd>
                  {b.beneficiary}
                  {b.bankName ? ` · ${b.bankName}` : ''}
                </dd>
              </dl>
            ))}
            <dl className="wpv2-bank-details">
              <dt>{el ? 'Αιτιολογία' : 'Reference'}</dt>
              <dd className="bank-info-copyrow">
                <span>{d.reference}</span>
                <CopyButton value={d.reference} lang={lang} ariaLabel={el ? 'Αντιγραφή αιτιολογίας' : 'Copy reference'} />
              </dd>
              <dt>{el ? 'Ποσό' : 'Amount'}</dt>
              <dd>{d.amountPaid.toFixed(2)} €</dd>
            </dl>
            <p className="sub-bank-note">
              {el
                ? 'Για την ενεργοποίηση της συνδρομής σου, στείλε μας στο orders@fitpal.gr το αποδεικτικό κατάθεσής σου.'
                : 'To activate your subscription, email your deposit receipt to orders@fitpal.gr.'}
            </p>
          </div>
        )}

        {/* ── Cash on delivery: reference only, pay the courier ── */}
        {isCash && isPending && (
          <div className="sub-bank-block">
            <p className="sub-bank-note">
              {el
                ? 'Θα εξοφλήσεις το ποσό στον διανομέα κατά την πρώτη παράδοση. Κράτησε τον κωδικό συνδρομής σου.'
                : "You'll pay the courier on your first delivery. Keep your subscription reference handy."}
            </p>
          </div>
        )}

        {/* ── Paid (card / wallet): wallet credited ── */}
        {!isPending && (
          <p className="conf-sub">
            {el ? 'Πιστώθηκαν στο Wallet σου' : 'Credited to your Wallet'}{' '}
            <strong>{d.walletCredit.toFixed(2)} €</strong>
          </p>
        )}

        {/* ── Plan summary ── */}
        <div className="conf-summary" style={{ textAlign: 'left' }}>
          <SubKV k={el ? 'Στόχος' : 'Goal'} v={goalLabel(d.goal, el)} />
          <SubKV k={el ? 'Διάρκεια' : 'Duration'} v={lengthLabel(d, el)} />
          <SubKV k={el ? 'Ημέρες / εβδομάδα' : 'Days per week'} v={d.daysPerWeek != null ? String(d.daysPerWeek) : '—'} />
          <SubKV k={el ? 'Γεύματα' : 'Meals'} v={mealsLabel(d, el)} />
          {d.dailyKcal != null && <SubKV k={el ? 'Ημερήσιες θερμίδες' : 'Daily calories'} v={`${d.dailyKcal} kcal`} />}
          <SubKV k={el ? 'Ποσό πληρωμής' : 'Amount to pay'} v={`${d.amountPaid.toFixed(2)} €`} />
          <SubKV k={el ? 'Πίστωση Wallet' : 'Wallet credit'} v={`${d.walletCredit.toFixed(2)} €`} />
          {d.bonusCredits > 0 && <SubKV k={el ? 'Δώρο (bonus)' : 'Bonus credit'} v={`${d.bonusCredits.toFixed(2)} €`} />}
          {d.invoiceType === 'invoice' && (
            <SubKV
              k={el ? 'Τιμολόγιο' : 'Invoice'}
              v={`${d.invoiceName ?? ''}${d.invoiceVat ? ` · ΑΦΜ ${d.invoiceVat}` : ''}`.trim() || (el ? 'Ναι' : 'Yes')}
            />
          )}
        </div>

        {/* ── Post-purchase reassurance (dietitian call) ── */}
        <p className="conf-sub" style={{ fontWeight: 600 }}>
          {el
            ? 'Θα σε καλέσουμε εντός 1 εργάσιμης ημέρας για να χτίσουμε μαζί τα γεύματά σου — χωρίς κόπο.'
            : "We'll call you within 1 business day to build your meals together — zero effort."}
        </p>
        <p className="conf-sub">
          {el
            ? 'Θα λάβεις και email με όλα τα στοιχεία της συνδρομής σου.'
            : "You'll also receive an email with all your subscription details."}
        </p>

        <div className="conf-actions">
          <a className="btn-conf-done" href="/">
            {el ? 'Στο μενού' : 'To the menu'}
          </a>
          <a className="btn-conf-secondary" href={LANDING_URL}>
            {el ? 'Στην αρχική' : 'To homepage'}
          </a>
        </div>
      </div>
    </div>
  )
}

function SubKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 13 }}>{k}</span>
      <span style={{ fontWeight: 800, fontSize: 13, textAlign: 'right' }}>{v}</span>
    </div>
  )
}
