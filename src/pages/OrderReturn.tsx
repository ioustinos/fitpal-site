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
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { planReference } from '../lib/api/wallet'
import { useUIStore } from '../store/useUIStore'
import { useCartStore } from '../store/useCartStore'
import { fetchOrderForConfirmation, type ConfirmationOrder } from '../lib/api/orders'
import { fmt } from '../lib/helpers'
import { makeTr } from '../lib/translations'

type Outcome =
  | { status: 'paid';     kind: 'order'; orderId: string; orderNumber: string; amountCents: number }
  // WEC-504: wallet-plan (package) purchase — no meal order to render.
  | { status: 'paid';     kind: 'wallet'; amountCents: number }
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
  // WEC-522: keep the Viva transactionId for the wallet success card to look
  // up the purchased plan and show the customer's selections.
  const transactionId = params.get('t') ?? params.get('transactionId') ?? ''
  const [outcome, setOutcome] = useState<Outcome>({ status: 'loading' })
  const [orderDetails, setOrderDetails] = useState<ConfirmationOrder | null>(null)
  const pollingRef = useRef(false)

  // WEC-591: the card/link success flow lands here (Viva redirect), NOT on
  // ConfirmationScreen — so the cart + persisted voucher were never cleared,
  // leaving a full cart (duplicate-order risk) and a ghost discount on the next
  // order. Clear everything once the order is confirmed paid. (Harmless for the
  // wallet-plan purchase, which doesn't use the cart.)
  const clearAll = useCartStore((s) => s.clearAll)
  useEffect(() => {
    if (outcome.status === 'paid') {
      clearAll()
      // WEC-682: a completed purchase must not leave a stale revert key behind.
      try { sessionStorage.removeItem('fitpal_pending_viva_wallet_plan') } catch { /* ignore */ }
    }
  }, [outcome.status, clearAll])

  useEffect(() => {
    const t = params.get('t') ?? params.get('transactionId') ?? ''
    const merchantTrns = params.get('merchantTrns') ?? '' // our orderId

    if (!t) {
      if (mode === 'failure') {
        // WEC-681: Viva's cancel return carries no `t`/merchantTrns — so we
        // rely on the orderId we stashed before redirecting. Revert that
        // abandoned order to draft so a retry reuses the same row instead of
        // creating a duplicate, and void its outstanding link. Cart + draftId
        // are intentionally left intact so the retry maps back to this row.
        const pendingOrderId = (() => {
          try { return sessionStorage.getItem('fitpal_pending_viva_order') } catch { return null }
        })()
        if (pendingOrderId) {
          void (async () => {
            try {
              const { data: sess } = await supabase.auth.getSession()
              const tok = sess?.session?.access_token
              await fetch('/api/revert-order-to-draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
                body: JSON.stringify({ orderId: pendingOrderId }),
              })
            } catch { /* non-fatal — viva-reconcile backstops after 48h */ }
            finally { try { sessionStorage.removeItem('fitpal_pending_viva_order') } catch { /* ignore */ } }
          })()
        }
        // WEC-682: the same cancel, but for a subscription (plan) purchase. The
        // wallet flow redirects to the SAME Viva return URLs, so we stash the
        // plan id under its own key and mark it `failed` on cancel — otherwise
        // the retry inserts a second snapshot and admin shows the package twice.
        const pendingWalletPlanId = (() => {
          try { return sessionStorage.getItem('fitpal_pending_viva_wallet_plan') } catch { return null }
        })()
        if (pendingWalletPlanId) {
          void (async () => {
            try {
              const { data: sess } = await supabase.auth.getSession()
              const tok = sess?.session?.access_token
              await fetch('/api/revert-wallet-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
                body: JSON.stringify({ walletPlanId: pendingWalletPlanId }),
              })
            } catch { /* non-fatal — viva-reconcile backstops */ }
            finally { try { sessionStorage.removeItem('fitpal_pending_viva_wallet_plan') } catch { /* ignore */ } }
          })()
        }
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
          if (data.kind === 'wallet') {
            // WEC-504: package purchase confirmed + wallet credited server-side.
            setOutcome({ status: 'paid', kind: 'wallet', amountCents: data.amountCents })
          } else {
            setOutcome({
              status: 'paid',
              kind: 'order',
              orderId: data.orderId,
              orderNumber: data.orderNumber,
              amountCents: data.amountCents,
            })
          }
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
            kind: 'order',
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
    // WEC-504: only meal orders have a rich confirmation to fetch; wallet-plan
    // purchases render their own (no order/children/items).
    if (outcome.status !== 'paid' || outcome.kind !== 'order') return
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
        ? (outcome.kind === 'wallet'
            ? <WalletPaidView amountCents={outcome.amountCents} transactionId={transactionId} lang={lang} />
            : <PaidView orderNumber={outcome.orderNumber} details={orderDetails} lang={lang} />)
        : <NonPaidView outcome={outcome} lang={lang} />}
    </div>
  )
}

/* ─── Paid → Fitpal-styled confirmation (same .conf-* classes as ConfirmationScreen) ─── */

function PaidView({
  orderNumber, details, lang,
}: { orderNumber: string; details: ConfirmationOrder | null; lang: 'el' | 'en' }) {
  const t = makeTr(lang)
  return (
    <div className="confirmation-screen">
      <div className="conf-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>

      <h2 className="conf-title">
        {t('coOrderPlaced')}
      </h2>

      <div className="conf-order-hero">
        <div className="conf-order-hero-label">
          {t('coOrderNumber')}
        </div>
        <div className="conf-order-hero-number">{orderNumber}</div>
      </div>

      <p className="conf-sub">
        {t('coConfEmailNote')}
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
                        {/* WEC-571: per-line customer note (kitchen). */}
                        {it.comment && it.comment.trim() && (
                          <span className="conf-item-comment">“{it.comment.trim()}”</span>
                        )}
                      </span>
                      <span className="conf-item-price">{fmt(it.totalPrice)}</span>
                    </div>
                  )
                })}
              </div>
              <div className="conf-day-amt">
                {t('coDayTotal')}: {fmt(d.dayTotal)}
              </div>
            </div>
          ))}

          {details.notes && (
            <div className="conf-comment">"{details.notes}"</div>
          )}

          {/* WEC-698: show the recorded invoice details on the card-payment confirmation too. */}
          {details.invoiceType === 'invoice' && (
            <div className="conf-invoice">
              <span className="conf-invoice-title">{lang === 'el' ? 'Τιμολόγιο' : 'Invoice'}</span>
              <span className="conf-invoice-val">
                {details.invoiceName || '—'}
                {details.invoiceVat ? ` · ${lang === 'el' ? 'ΑΦΜ' : 'VAT'} ${details.invoiceVat}` : ''}
              </span>
            </div>
          )}

          <div className="conf-total">
            <span>{t('total')}</span>
            <span>{fmt(details.total)}</span>
          </div>
        </div>
      ) : (
        <p className="conf-loading-detail">
          {t('coLoadingOrderDetails')}
        </p>
      )}

      <div className="conf-actions">
        <a className="btn-conf-done" href="/">
          {t('coBackToMenu')}
        </a>
      </div>
    </div>
  )
}

/* ─── Paid wallet-plan (package) purchase — WEC-504 ───
   The wallet was credited server-side by verifyWalletPlanTransaction during the
   return verify. No meal order to render, so we show a compact success card. */

interface WalletPlanSummary {
  id: string
  goal: string | null
  plan_length: string | null
  plan_length_weeks: number | string | null
  days_per_week: number | null
  meal_breakfast: boolean | null
  meal_lunch: boolean | null
  meal_dinner: boolean | null
  meal_snack: boolean | null
  amount_to_pay_cents: number | null
  wallet_credit_cents: number | null
  bonus_credits_cents: number | null
  daily_kcal: number | null
}

function WalletPaidView({
  amountCents, transactionId, lang,
}: { amountCents: number; transactionId: string; lang: 'el' | 'en' }) {
  const t = makeTr(lang)
  const el = lang === 'el'
  const navigate = useNavigate()
  const [plan, setPlan] = useState<WalletPlanSummary | null>(null)

  // WEC-522: fetch the purchased plan for the reference + selections summary.
  // The active session is the customer's, so RLS lets them read their own row.
  // WEC-701 §A: a paid card/link subscription converges on the canonical
  // success PAGE (/subscription/success/:reference) so ALL payment paths share
  // one success surface + one conversion event. This inline card stays as a
  // fallback while the plan loads, or if the lookup can't resolve a reference.
  useEffect(() => {
    if (!transactionId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('wallet_plans')
        .select('id, goal, plan_length, plan_length_weeks, days_per_week, meal_breakfast, meal_lunch, meal_dinner, meal_snack, amount_to_pay_cents, wallet_credit_cents, bonus_credits_cents, daily_kcal')
        .eq('viva_transaction_id', transactionId)
        .maybeSingle()
      if (cancelled || !data) return
      const id = (data as WalletPlanSummary).id
      if (id) {
        navigate(`/subscription/success/${planReference(id)}`, { replace: true })
        return
      }
      setPlan(data as WalletPlanSummary)
    })()
    return () => { cancelled = true }
  }, [transactionId, navigate])

  const goalLabel = plan?.goal
    ? ({ lose: el ? 'Απώλεια βάρους' : 'Weight loss', maintain: el ? 'Διατήρηση' : 'Maintain', gain: el ? 'Αύξηση μυϊκής μάζας' : 'Muscle gain' } as Record<string, string>)[plan.goal] ?? plan.goal
    : '—'
  const lenLabel = plan
    ? (({ '2w': el ? '2 εβδομάδες' : '2 weeks', '1mo': el ? '1 μήνας' : '1 month', '3mo': el ? '3 μήνες' : '3 months' } as Record<string, string>)[plan.plan_length ?? '']
        ?? (plan.plan_length_weeks ? `${Math.round(Number(plan.plan_length_weeks))} ${el ? 'εβδομάδες' : 'weeks'}` : (plan.plan_length ?? '—')))
    : '—'
  const meals = plan
    ? [
        plan.meal_breakfast && (el ? 'Πρωινό' : 'Breakfast'),
        plan.meal_lunch && (el ? 'Μεσημεριανό' : 'Lunch'),
        plan.meal_dinner && (el ? 'Βραδινό' : 'Dinner'),
        plan.meal_snack && (el ? 'Σνακ' : 'Snack'),
      ].filter(Boolean).join(', ')
    : ''

  // The wallet is credited the FULL base+bonus (wallet_credit_cents), not the
  // amount paid. Fall back to the transaction amount until the plan loads.
  const creditedCents = plan?.wallet_credit_cents ?? amountCents

  return (
    <div className="confirmation-screen">
      <div className="conf-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h2 className="conf-title">{t('coPackagePaidTitle')}</h2>
      <p className="conf-sub">
        {t('coWalletCredited')} {(creditedCents / 100).toFixed(2)} €
      </p>

      {plan && (
        <div className="conf-summary" style={{ textAlign: 'left' }}>
          <div className="conf-order-hero" style={{ marginBottom: 12 }}>
            <div className="conf-order-hero-label">{el ? 'Κωδικός συνδρομής' : 'Subscription reference'}</div>
            <div className="conf-order-hero-number" style={{ fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>{plan.id}</div>
          </div>
          <WalletKV k={el ? 'Στόχος' : 'Goal'} v={goalLabel} />
          <WalletKV k={el ? 'Διάρκεια' : 'Duration'} v={lenLabel} />
          <WalletKV k={el ? 'Ημέρες / εβδομάδα' : 'Days per week'} v={plan.days_per_week != null ? String(plan.days_per_week) : '—'} />
          <WalletKV k={el ? 'Γεύματα' : 'Meals'} v={meals || '—'} />
          {plan.daily_kcal != null && <WalletKV k={el ? 'Ημερήσιες θερμίδες' : 'Daily calories'} v={`${plan.daily_kcal} kcal`} />}
          {plan.amount_to_pay_cents != null && <WalletKV k={el ? 'Πλήρωσες' : 'Amount paid'} v={`${(plan.amount_to_pay_cents / 100).toFixed(2)} €`} />}
          {plan.wallet_credit_cents != null && <WalletKV k={el ? 'Πίστωση πορτοφολιού' : 'Wallet credited'} v={`${(plan.wallet_credit_cents / 100).toFixed(2)} €`} />}
          {(plan.bonus_credits_cents ?? 0) > 0 && <WalletKV k={el ? 'Δώρο (bonus)' : 'Bonus credit'} v={`${((plan.bonus_credits_cents ?? 0) / 100).toFixed(2)} €`} />}
        </div>
      )}

      {/* WEC-551 O7 — post-purchase reassurance: the dietitian team calls to
          build the customer's meals. */}
      <p className="conf-sub" style={{ fontWeight: 600 }}>
        {el
          ? 'Θα σε καλέσουμε εντός 1 εργάσιμης ημέρας για να χτίσουμε μαζί τα γεύματά σου — χωρίς κόπο.'
          : "We'll call you within 1 business day to build your meals together — zero effort."}
      </p>
      <p className="conf-sub">{t('coConfEmailNote')}</p>
      <div className="conf-actions">
        <a className="btn-conf-done" href="/">{t('coBackToMenu')}</a>
      </div>
    </div>
  )
}

function WalletKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 13 }}>{k}</span>
      <span style={{ fontWeight: 800, fontSize: 13, textAlign: 'right' }}>{v}</span>
    </div>
  )
}

/* ─── Non-paid states (loading, pending, failed, mismatch, error, unknown) ─── */

function NonPaidView({ outcome, lang }: { outcome: Outcome; lang: 'el' | 'en' }) {
  const t = makeTr(lang)
  if (outcome.status === 'loading') {
    return (
      <div className="order-return-state">
        <div className="ors-spinner" aria-hidden="true" />
        <h2>{t('coVerifyingPayment')}</h2>
      </div>
    )
  }

  if (outcome.status === 'pending') {
    return (
      <div className="order-return-state">
        <div className="ors-spinner" aria-hidden="true" />
        <h2>{t('coFinalisingPayment')}</h2>
        <p>
          {t('coPendingBankNote')}
        </p>
        {outcome.orderNumber && (
          <p className="ors-ref">
            {t('coOrderNumberColon')}
            <strong>{outcome.orderNumber}</strong>
          </p>
        )}
        <a className="btn-conf-done" href="/">
          {t('coBackToMenu')}
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
        <h2>{t('coPaymentNotComplete')}</h2>
        <p>
          {t('coNotCharged')}
        </p>
        {outcome.orderNumber && (
          <p className="ors-ref">
            {t('coReferenceColon')} {outcome.orderNumber}
          </p>
        )}
        <a className="btn-conf-done" href="/">
          {t('coBackToMenu')}
        </a>
      </div>
    )
  }

  if (outcome.status === 'mismatch') {
    return (
      <div className="order-return-state ors-error">
        <h2>{t('coSomethingWrong')}</h2>
        <p>
          {t('coAmountMismatch')}
        </p>
        <p className="ors-ref">
          {t('coReferenceColon')} {outcome.orderNumber}
        </p>
      </div>
    )
  }

  if (outcome.status === 'error') {
    return (
      <div className="order-return-state ors-error">
        <h2>{t('coErrorTitle')}</h2>
        <p>{outcome.message}</p>
      </div>
    )
  }

  // unknown (only status left in this union after the early returns above)
  const msg = outcome.status === 'unknown' ? outcome.message : ''
  return (
    <div className="order-return-state">
      <h2>{t('coMissingParams')}</h2>
      <p>{msg}</p>
    </div>
  )
}
