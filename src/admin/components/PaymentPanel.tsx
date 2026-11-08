// WEC-799 [Refactor A] — the admin payment UI, shared by the order drawer
// (Orders.tsx) and the subscription drawer (WalletPurchases.tsx). Lifted out of
// Orders.tsx unchanged; each drawer supplies a thin adapter (method, status,
// link snapshot, callbacks). The ORDER path must render byte-identical markup —
// every plan-only difference is behind a prop that defaults to the order look.

import { useEffect, useState } from 'react'
import type { PaymentMethod, PaymentStatus } from '../../lib/api/adminOrders'
import { paymentShort } from '../../lib/paymentMethods'

// ─── Badges (moved verbatim from Orders.tsx) ──────────────────────────────

export const PAYMENT_COLOURS: Record<PaymentStatus, string> = {
  // WEC-599: pending_link_sent leans more orange than plain amber pending.
  pending: '#f59e0b', pending_link_sent: '#ea580c', paid: '#10b981', failed: '#ef4444', refunded: '#6b7280',
}
// WEC-599: friendly labels for the badge (raw enum otherwise). English admin.
export const PAYMENT_STATUS_LABEL: Partial<Record<PaymentStatus, string>> = {
  pending_link_sent: 'Pending (link sent)',
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className="admin-badge" style={{ background: `${PAYMENT_COLOURS[status]}22`, color: PAYMENT_COLOURS[status] }}>{PAYMENT_STATUS_LABEL[status] ?? status}</span>
}

// WEC-577: raw payment-method badge. Distinct subtle colour per method
// (WEC-520 lesson: same-colour pills read as one). Labels from the single
// source of truth (paymentShort, WEC-499). Non-clickable look.
export const PAYMENT_METHOD_COLOURS: Record<PaymentMethod, string> = {
  cash: '#059669', card: '#2563eb', link: '#7c3aed', transfer: '#0891b2', wallet: '#d97706',
}
export function PaymentMethodBadge({ method }: { method: PaymentMethod | null }) {
  if (!method) return <span className="admin-sub">—</span>
  return (
    <span
      className="admin-badge"
      style={{ background: `${PAYMENT_METHOD_COLOURS[method]}22`, color: PAYMENT_METHOD_COLOURS[method], whiteSpace: 'nowrap' }}
      title="Payment method (raw)"
    >
      {paymentShort(method, 'el')}
    </span>
  )
}

// ─── Method dropdown (WEC-668 inline edit) ────────────────────────────────

export function PaymentMethodSelect({ value, allowed, disabled, onChange }: {
  value: PaymentMethod | null
  /** Orders: every PAYMENT_METHOD_IDS. Plans: NO 'wallet' (a plan credits the wallet). */
  allowed: readonly PaymentMethod[]
  disabled?: boolean
  onChange: (next: PaymentMethod) => void
}) {
  return (
    <select
      className="admin-input"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as PaymentMethod)}
      style={{ padding: '2px 6px', fontSize: 13 }}
    >
      {value == null && <option value="">—</option>}
      {allowed.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  )
}

// ─── Payment link block ───────────────────────────────────────────────────

export interface PaymentLinkSnapshot {
  status: 'pending' | 'success' | 'failure' | 'expired'
  paymentUrl: string | null
  vivaOrderCode: string | null
  createdAt: string
  lastVerifiedAt: string | null
}

export interface PaymentLinkPanelProps {
  /** Nothing to collect (paid/refunded, or cancelled with no link) → render nothing. */
  hidden: boolean
  link: PaymentLinkSnapshot | null
  /** May (re)send a link now. */
  canGenerate: boolean
  /** Orders only: still awaiting confirmation → disabled button + reason. */
  blockedByPending?: boolean
  /** Prefill / ceiling for the amount (cents). Orders: remaining balance. */
  remainingCents: number
  /** Orders: admin may set a (partial) amount. Plans: fixed full amount. */
  editableAmount?: boolean
  /** Orders: the card checkout's auto-created link note. */
  cardAutoNote?: boolean
  /** Send / regenerate. `firstTime` drives «sent» vs «regenerated» on the timeline. */
  onSend: (amountCents: number, allowOver: boolean, firstTime: boolean) => Promise<{ error: string | null }>
  /** Orders only (payment_links row). Absent → no «mark expired» control. */
  onExpire?: () => Promise<{ error: string | null }>
  onChanged: () => void
  /** 'plan' = visually distinct block (so it isn't confused with the renewal link) + plan copy. */
  variant?: 'order' | 'plan'
}

/** WEC-176 / WEC-598 — Payment link, inside the Payment area of the drawer.
 *  Generate is gated on a confirmed order (with the reason shown inline); once a
 *  link exists the primary action is Copy and a "sent" state + timestamp + code
 *  are unmistakable; generating logs a timeline entry. */
export function PaymentLinkPanel({
  hidden, link, canGenerate, blockedByPending = false, remainingCents, editableAmount = true,
  cardAutoNote = false, onSend, onExpire, onChanged, variant = 'order',
}: PaymentLinkPanelProps) {
  const isPlan = variant === 'plan'
  const [err, setErr] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)
  // WEC-607: admin-chosen amount, prefilled with the remaining balance.
  const remaining = remainingCents
  const [amountEuros, setAmountEuros] = useState((remaining / 100).toFixed(2))
  const [amountDirty, setAmountDirty] = useState(false)
  const [confirmOver, setConfirmOver] = useState(false)
  // WEC-678 Bug 2: the drawer can stay open while items are removed, which
  // recomputes `remaining`. Re-sync the amount field to the new remaining
  // UNLESS the admin has typed a value (don't clobber deliberate input).
  useEffect(() => {
    if (!amountDirty) setAmountEuros((remaining / 100).toFixed(2))
  }, [remaining, amountDirty])

  if (hidden) return null

  const linkExpired = link?.status === 'expired'

  const amountCents = editableAmount
    ? Math.round((parseFloat(amountEuros.replace(',', '.')) || 0) * 100)
    : remaining
  const overAmount = editableAmount && amountCents > remaining

  async function copy() {
    if (!link?.paymentUrl) return
    try {
      await navigator.clipboard.writeText(link.paymentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr('Copy failed — browser blocked clipboard access.')
    }
  }

  async function generate() {
    setErr(null)
    // WEC-607: validate the admin-entered amount; over-amount needs an explicit tick.
    if (amountCents <= 0) { setErr('Enter an amount greater than 0.'); return }
    if (overAmount && !confirmOver) {
      setErr(`Amount exceeds the remaining ${(remaining / 100).toFixed(2)} € — tick the box to confirm an extra charge.`)
      return
    }
    // WEC-799: a plan holds ONE Viva order code — a new link supersedes the old one.
    if (isPlan && link && !linkExpired && !window.confirm('Ο προηγούμενος σύνδεσμος θα αντικατασταθεί. Αν ο πελάτης πληρώσει τον ΠΑΛΙΟ σύνδεσμο, η πληρωμή δεν θα αντιστοιχιστεί αυτόματα. Συνέχεια;')) return
    setWorking(true)
    // firstTime distinguishes "sent" from "regenerated" in the timeline label.
    const { error } = await onSend(amountCents, confirmOver, !link)
    setWorking(false)
    if (error) { setErr(error); return }
    onChanged()
  }

  // WEC-806: flip a dead 'pending' link to 'expired' so the fresh-link control appears.
  async function markExpired() {
    if (!onExpire) return
    setErr(null); setWorking(true)
    const { error } = await onExpire()
    setWorking(false)
    if (error) { setErr(error); return }
    onChanged()
  }

  // WEC-607: shared amount input + send button (first link and "send another").
  const amountControls = (btnLabel: string) => editableAmount ? (
    <div style={{ marginTop: 4 }}>
      <label className="admin-form-label" style={{ fontSize: 12 }}>
        Amount (€) · remaining {(remaining / 100).toFixed(2)} €
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="admin-input" inputMode="decimal" value={amountEuros}
          onChange={(e) => { setAmountEuros(e.target.value); setAmountDirty(true) }} style={{ width: 120 }}
        />
        <button className="admin-btn-primary" disabled={working} onClick={generate}>
          {working ? 'Sending…' : btnLabel}
        </button>
      </div>
      {overAmount && (
        <label className="admin-recipe-selectable" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={confirmOver} onChange={(e) => setConfirmOver(e.target.checked)} />{' '}
          Charge more than the remaining balance (extra charge on request)
        </label>
      )}
    </div>
  ) : (
    // WEC-799 plan: the charge is fixed (createWalletPlanVivaOrder enforces it).
    <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ fontWeight: 700 }}>{(remaining / 100).toFixed(2)} €</span>
      <button className="admin-btn-primary" disabled={working} onClick={generate}>
        {working ? 'Sending…' : btnLabel}
      </button>
    </div>
  )

  return (
    <section
      className="admin-form-section"
      // WEC-799: plan variant is visually distinct from the (deprecated) renewal link.
      style={isPlan ? { borderLeft: '4px solid #7c3aed', paddingLeft: 12, background: '#7c3aed0a', borderRadius: 6 } : undefined}
    >
      <h3 className="admin-section-title" style={{ marginTop: 0 }}>
        {isPlan ? 'Σύνδεσμος πληρωμής Viva (payment link)' : 'Payment link'}
      </h3>
      {err && <div className="admin-error-banner">{err}</div>}

      {!link && (
        <>
          {blockedByPending ? (
            <>
              <button className="admin-btn-primary" disabled title="Confirm the order first">
                Generate payment link
              </button>
              {/* WEC-598 #2: explain the disabled state — bilingual per ticket. */}
              <p className="admin-text-muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.4 }}>
                Επιβεβαίωσε πρώτα την παραγγελία για να στείλεις link πληρωμής.
                <br />
                <span style={{ opacity: 0.75 }}>Confirm the order first to send a payment link.</span>
              </p>
            </>
          ) : canGenerate ? (
            <>
              <p className="admin-text-muted" style={{ marginBottom: 8 }}>
                {isPlan ? 'Στείλε στον πελάτη σύνδεσμο πληρωμής για τη συνδρομή (ο τρόπος πληρωμής γίνεται «link»).' : 'Set the amount and send a payment link.'}
              </p>
              {amountControls('Generate payment link')}
            </>
          ) : (
            <p className="admin-text-muted">{isPlan ? 'Δεν υπάρχει σύνδεσμος πληρωμής για αυτή τη συνδρομή.' : 'No payment link for this order.'}</p>
          )}
        </>
      )}

      {link && (
        <>
          {/* WEC-598 #3: unmistakable "sent" state. */}
          <div className="admin-paylink-sent" style={{ marginBottom: 8 }}>
            <span className="admin-pill-ok">✓ Payment link sent</span>
            <span className="admin-text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
              {new Date(link.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          {/* WEC-800: on a card order this link isn't admin-sent — it's the one
              auto-created by the customer's card checkout. Say so, so ops don't
              read it as a manually issued payment request. */}
          {cardAutoNote && (
            <p className="admin-text-muted" style={{ marginTop: -4, marginBottom: 8, fontSize: 12, lineHeight: 1.4 }}>
              Αυτόματος σύνδεσμος πληρωμής — ο πελάτης επέλεξε πληρωμή με κάρτα.
              <br />
              <span style={{ opacity: 0.75 }}>Auto-generated payment link — the customer chose to pay by card.</span>
            </p>
          )}
          <dl className="admin-od-kv" style={{ marginBottom: 8 }}>
            {link.vivaOrderCode && <div><dt>Viva code</dt><dd style={{ fontFamily: 'monospace' }}>{link.vivaOrderCode}</dd></div>}
            <div><dt>Status</dt><dd>
              <span className={`admin-pill-${link.status === 'success' ? 'ok' : link.status === 'failure' ? 'err' : 'warn'}`}>{link.status}</span>
            </dd></div>
          </dl>
          {link.paymentUrl && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input className="admin-input" type="text" value={link.paymentUrl} readOnly style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
              {/* WEC-598 #4: Copy is the PRIMARY action when a link exists. */}
              <button className="admin-btn-primary" onClick={copy}>{copied ? 'Copied! ✓' : 'Copy'}</button>
            </div>
          )}
          {/* WEC-806: a pending link may be dead (Viva orders expire) — let the
              admin mark it expired, which unlocks sending a fresh link below. */}
          {onExpire && link.status === 'pending' && (
            <button className="admin-btn" disabled={working} onClick={markExpired} style={{ marginBottom: 8 }}>
              {working ? '…' : 'Μαρκάρισμα ως expired (ο σύνδεσμος έληξε)'}
            </button>
          )}
          {/* WEC-806/WEC-607: (re)send a link on any confirmed unpaid order —
              adaptive copy for an expired link vs a remaining-balance top-up. */}
          {canGenerate && (
            <div style={{ marginTop: 4 }}>
              <p className="admin-text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                {isPlan
                  ? 'Ο σύνδεσμος λήγει σε 18 ώρες — στείλε νέο αν χρειαστεί:'
                  : linkExpired ? 'Ο σύνδεσμος έληξε — στείλε νέο:' : 'Στείλε (νέο) link πληρωμής — π.χ. για το υπόλοιπο:'}
              </p>
              {amountControls(isPlan ? 'Regenerate link' : linkExpired ? 'Send new link' : 'Send another link')}
            </div>
          )}
          {!isPlan && (
            <p className="admin-text-muted" style={{ marginTop: 8, fontSize: 12 }}>
              Last verified: {link.lastVerifiedAt ? new Date(link.lastVerifiedAt).toLocaleString('en-GB') : 'never'}
            </p>
          )}
        </>
      )}
    </section>
  )
}
