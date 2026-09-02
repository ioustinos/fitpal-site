// WEC-557 — «Αίτημα αλλαγής»: customer-side change-request button + modal on an
// account order. Self-contained so AccountPage only needs a one-line insert.
// Only renders for still-actionable orders (pending/confirmed). Submits a row
// that ops sees in the admin panel; no email leg (decided by Ioustinos).

import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import {
  createOrderChangeRequest,
  fetchMyChangeRequests,
  type OrderChangeReason,
} from '../../lib/api/orderChangeRequests'

const ACTIONABLE = new Set(['pending', 'confirmed'])

const REASONS: { id: OrderChangeReason; el: string; en: string }[] = [
  { id: 'cancel',          el: 'Ακύρωση παραγγελίας',            en: 'Cancel order' },
  { id: 'address_or_time', el: 'Αλλαγή διεύθυνσης ή ώρας',        en: 'Change address or time' },
  { id: 'dish',            el: 'Αλλαγή / Προσθήκη / Αφαίρεση πιάτου', en: 'Change / add / remove a dish' },
  { id: 'other',           el: 'Άλλο',                           en: 'Other' },
]

interface Props {
  orderId: string
  orderStatusRaw?: string
  userId?: string
  lang: 'el' | 'en'
}

export function OrderChangeRequestButton({ orderId, orderStatusRaw, userId, lang }: Props) {
  const isEl = lang === 'el'

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<OrderChangeReason>('cancel')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [alreadyRequested, setAlreadyRequested] = useState(false)
  // WEC-664: post-submit confirmation is a centred «Ελήφθη» that auto-dismisses
  // after 7s and has an × to close early. No toast, no acknowledgement email.
  const [received, setReceived] = useState(false)
  useEffect(() => {
    if (!received) return
    const id = window.setTimeout(() => setReceived(false), 7000)
    return () => window.clearTimeout(id)
  }, [received])

  // Only actionable orders can be changed. (Guard AFTER hooks to keep hook order stable.)
  const actionable = !!orderStatusRaw && ACTIONABLE.has(orderStatusRaw)

  // Show a "request already submitted" state if one exists (component mounts
  // only when the card is expanded, so this is one query per opened card).
  useEffect(() => {
    if (!actionable) return
    let cancelled = false
    fetchMyChangeRequests([orderId]).then(({ data }) => {
      if (!cancelled && data.some((r) => r.status === 'new')) setAlreadyRequested(true)
    })
    return () => { cancelled = true }
  }, [orderId, actionable])

  if (!actionable || !userId) return null

  async function submit() {
    setBusy(true)
    setErr(null)
    const { error } = await createOrderChangeRequest({ orderId, userId: userId!, reason, message })
    setBusy(false)
    if (error) { setErr(error); return }
    setOpen(false)
    setAlreadyRequested(true)
    setMessage('')
    setReceived(true)
  }

  return (
    <div className="order-change-req">
      <button
        type="button"
        className="order-change-req-btn"
        disabled={alreadyRequested}
        onClick={() => setOpen(true)}
      >
        {alreadyRequested
          ? (isEl ? 'Αίτημα αλλαγής υποβλήθηκε' : 'Change request submitted')
          : (isEl ? 'Αίτημα αλλαγής' : 'Request a change')}
      </button>

      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="order-change-modal">
          <h3 className="order-change-modal-title">{isEl ? 'Αίτημα αλλαγής' : 'Request a change'}</h3>
          <p className="order-change-modal-sub">
            {isEl
              ? 'Πες μας τι θέλεις να αλλάξεις και θα επικοινωνήσουμε μαζί σου. Οι αλλαγές δεν είναι αυτόματες.'
              : "Tell us what you'd like to change and we'll get back to you. Changes aren't automatic."}
          </p>

          <label className="form-label">{isEl ? 'Λόγος' : 'Reason'}</label>
          <select className="form-input" value={reason} onChange={(e) => setReason(e.target.value as OrderChangeReason)}>
            {REASONS.map((r) => (
              <option key={r.id} value={r.id}>{isEl ? r.el : r.en}</option>
            ))}
          </select>

          <label className="form-label" style={{ marginTop: 12 }}>{isEl ? 'Λεπτομέρειες' : 'Details'}</label>
          <textarea
            className="form-input"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={isEl ? 'Γράψε τι θέλεις να αλλάξει…' : 'Describe what you want changed…'}
          />

          {err && <div className="auth-error" style={{ marginTop: 8 }}>{err}</div>}

          <div className="order-change-modal-actions">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
              {isEl ? 'Άκυρο' : 'Cancel'}
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? (isEl ? 'Αποστολή…' : 'Sending…') : (isEl ? 'Υποβολή αιτήματος' : 'Submit request')}
            </button>
          </div>
        </div>
      </Modal>

      {received && (
        <div
          role="status"
          onClick={() => setReceived(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.35)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative', background: '#fff', borderRadius: 16,
              padding: '28px 44px', boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
              fontSize: 20, fontWeight: 700, color: '#0f172a',
            }}
          >
            <button
              type="button"
              aria-label={isEl ? 'Κλείσιμο' : 'Close'}
              onClick={() => setReceived(false)}
              style={{
                position: 'absolute', top: 6, right: 12, border: 'none',
                background: 'transparent', fontSize: 24, lineHeight: 1,
                cursor: 'pointer', color: '#64748b',
              }}
            >
              ×
            </button>
            {isEl ? 'Ελήφθη' : 'Received'}
          </div>
        </div>
      )}
    </div>
  )
}
