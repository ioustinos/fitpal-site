import { useEffect, useState } from 'react'
import {
  fetchAdminWalletPlans, fetchAdminWalletPlanDetail, refundAdminWalletPlan, markAdminWalletPlanPaid,
  updateWalletPlanStartDate, setWalletPlanContacted, editWalletPlanPrice,
  fetchWalletPlanComments, addWalletPlanComment, deleteWalletPlanComment, fetchWalletPlanChangeLog,
  type AdminWalletPlanRow, type AdminWalletPlanDetail, type WalletPlanComment, type WalletPlanChangeEntry,
} from '../../lib/api/adminWalletPlans'
import { setWalletPlanStatus, saveWalletPlanOpsFields } from '../../lib/api/adminUsers'
import { fetchPlanConsumption, planTotalDays, type PlanConsumption } from '../../lib/api/planConsumption'
import { useSearchParams, Link } from 'react-router-dom'
import { PlanDetailsPanel } from '../../components/shared/PlanDetailsPanel'
import type { PlanDetails } from '../../lib/api/planDetails'
import { useAuthStore } from '../../store/useAuthStore'

const STATUS_LABELS: Record<string, string> = {
  pending:  'Pending',
  paid:     'Paid',
  failed:   'Failed',
  refunded: 'Refunded',
}

export function WalletPurchases() {
  const [rows, setRows] = useState<AdminWalletPlanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Filters
  const [status, setStatus] = useState<string>('')
  const [planLength, setPlanLength] = useState<string>('')
  const [goal, setGoal] = useState<string>('')
  const [lifecycle, setLifecycle] = useState<string>('')

  // Drawer
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminWalletPlanDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const adminUser = useAuthStore((s) => s.user)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  async function toggleStatus(r: AdminWalletPlanRow) {
    const next = r.status === 'cancelled' ? 'active' : 'cancelled'
    if (next === 'cancelled' && !window.confirm('Ακύρωση συνδρομής; Θα απενεργοποιηθεί το wallet (χωρίς επιστροφή χρημάτων). Μπορείς να την επαναφέρεις.')) return
    setTogglingId(r.id); setErr(null)
    const { error } = await setWalletPlanStatus(r.id, next, adminUser?.email ?? 'admin')
    setTogglingId(null)
    if (error) { setErr(error); return }
    refresh()
  }

  // Contacted flag — optimistic, persisted + audit-logged + mirrored to Airtable.
  async function toggleContacted(id: string, next: boolean) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, contacted: next } : r)))
    setDetail((d) => (d && d.id === id ? { ...d, contacted: next } : d))
    const { error } = await setWalletPlanContacted(id, next, adminUser?.email ?? 'admin')
    if (error) {
      setErr(error)
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, contacted: !next } : r)))
      setDetail((d) => (d && d.id === id ? { ...d, contacted: !next } : d))
    }
  }

  async function refresh() {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminWalletPlans({
      status: status || undefined,
      planLength: planLength || undefined,
      goal: goal || undefined,
      lifecycle: lifecycle || undefined,
    })
    if (error) setErr(error)
    setRows(data ?? [])
    setLoading(false)
  }
  useEffect(() => { refresh() /* eslint-disable-next-line */ }, [status, planLength, goal, lifecycle])

  // WEC-893 Leg 1: deep-link from the customer card — /admin/wallet-purchases?planId=…
  const [searchParams] = useSearchParams()
  const deepLinkPlanId = searchParams.get('planId')
  useEffect(() => { if (deepLinkPlanId) openDrawer(deepLinkPlanId) /* eslint-disable-next-line */ }, [deepLinkPlanId])

  async function openDrawer(id: string) {
    setOpenId(id); setDetail(null); setDetailLoading(true)
    const { data, error } = await fetchAdminWalletPlanDetail(id)
    if (error) setErr(error)
    setDetail(data); setDetailLoading(false)
  }

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Wallet purchases</h1>
      <p className="admin-page-sub">All wallet plan purchases. Click a row to view the snapshot, payment events, and refund.</p>

      {err && <div className="admin-error-banner">{err}</div>}

      <div className="admin-filter-bar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All payment statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
        <select className="admin-select" value={planLength} onChange={(e) => setPlanLength(e.target.value)}>
          <option value="">All lengths</option>
          <option value="2w">2 weeks</option>
          <option value="1mo">1 month</option>
          <option value="3mo">3 months</option>
        </select>
        <select className="admin-select" value={goal} onChange={(e) => setGoal(e.target.value)}>
          <option value="">All goals</option>
          <option value="lose">Lose</option>
          <option value="maintain">Maintain</option>
          <option value="gain">Gain</option>
        </select>
        <select className="admin-select" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Ενεργή</option>
          <option value="cancelled">Ακυρωμένη</option>
        </select>
        <button className="admin-btn-secondary" onClick={refresh}>Refresh</button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="admin-empty">No wallet purchases match those filters.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Contacted</th>
              <th>When</th>
              <th>Customer</th>
              <th>Goal</th>
              <th>Plan</th>
              <th>Method</th>
              <th>Payment Status</th>
              <th>Κατάσταση</th>
              <th>Pay</th>
              <th>Credit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // WEC-682: a pending card/link plan with no Viva transaction is an
              // abandoned checkout (customer closed the tab). Fade it + label it
              // so it doesn't read as an equal sibling of a real purchase.
              const abandoned = r.paymentStatus === 'pending' && (r.paymentMethod === 'card' || r.paymentMethod === 'link') && !r.vivaTransactionId
              return (
              <tr key={r.id} style={abandoned ? { opacity: 0.55 } : undefined}>
                <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={r.contacted}
                    onChange={(e) => toggleContacted(r.id, e.target.checked)}
                    title={r.contacted ? 'Contacted' : 'Not contacted'}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                </td>
                <td>{new Date(r.createdAt).toLocaleString('el-GR')}</td>
                <td>
                  <div>
                    {r.customerName ?? '—'}
                    {/* WEC-693: flag purchases that requested a τιμολόγιο so the
                        team doesn't have to open every row to find them. */}
                    {r.invoiceType === 'invoice' && (
                      <span className="admin-pill-invoice" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.04em', background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }}>ΤΙΜΟΛΟΓΙΟ</span>
                    )}
                  </div>
                  <div className="admin-text-muted">{r.customerEmail ?? '—'}</div>
                </td>
                <td>{r.goal ?? '—'}</td>
                <td>
                  {r.planLength ?? '—'} · {r.daysPerWeek ?? '?'}d/wk · {r.selectedMeals.length} meals
                  {/* WEC-836: total delivery-days the plan covers (round(weeks × days/wk)). */}
                  {planTotalDays(r.planLengthWeeks, r.daysPerWeek) != null && (
                    <div className="admin-text-muted" style={{ fontSize: 11 }}>
                      {planTotalDays(r.planLengthWeeks, r.daysPerWeek)} ημέρες σύνολο
                    </div>
                  )}
                </td>
                <td>{r.paymentMethod ?? '—'}</td>
                <td>
                  <span className={`admin-pill-${r.paymentStatus}`}>{STATUS_LABELS[r.paymentStatus] ?? r.paymentStatus}</span>
                  {abandoned && <div className="admin-text-muted" style={{ fontSize: 10, fontStyle: 'italic' }}>abandoned checkout</div>}
                </td>
                <td>
                  <span
                    style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                      background: r.status === 'cancelled' ? '#ef444422' : '#10b98122',
                      color: r.status === 'cancelled' ? '#b91c1c' : '#047857' }}
                  >{r.status === 'cancelled' ? 'Ακυρωμένη' : 'Ενεργή'}</span>
                  <div>
                    <button className="admin-btn-secondary admin-btn-sm" disabled={togglingId === r.id}
                      onClick={() => toggleStatus(r)} style={{ marginTop: 4, fontSize: 10 }}>
                      {togglingId === r.id ? '…' : r.status === 'cancelled' ? 'Ενεργοποίηση' : 'Ακύρωση'}
                    </button>
                  </div>
                </td>
                <td>{(r.amountToPayCents / 100).toFixed(2)} €</td>
                <td>{(r.walletCreditCents / 100).toFixed(2)} €</td>
                <td><button className="admin-btn-secondary admin-btn-sm" onClick={() => openDrawer(r.id)}>Details</button></td>
              </tr>
            )})}
          </tbody>
        </table>
      )}

      {openId && (
        <Drawer
          detail={detail}
          loading={detailLoading}
          onClose={() => { setOpenId(null); setDetail(null) }}
          onRefunded={() => { setOpenId(null); setDetail(null); refresh() }}
          onToggleContacted={(next) => detail && toggleContacted(detail.id, next)}
        />
      )}
    </div>
  )
}

interface DrawerProps {
  detail: AdminWalletPlanDetail | null
  loading: boolean
  onClose: () => void
  onRefunded: () => void
  onToggleContacted: (next: boolean) => void
}

function Drawer({ detail, loading, onClose, onRefunded, onToggleContacted }: DrawerProps) {
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const [refundReason, setRefundReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('') // empty = full refund of remaining
  const [refunding, setRefunding] = useState(false)
  const [refundErr, setRefundErr] = useState<string | null>(null)
  // WEC-509: manual "mark bank-transfer paid".
  const [marking, setMarking] = useState(false)
  const [markErr, setMarkErr] = useState<string | null>(null)
  // WEC-836: delivery-days consumed under this subscription (one live count).
  const [consumption, setConsumption] = useState<PlanConsumption | null>(null)
  useEffect(() => {
    setConsumption(null)
    if (!detail?.userId) return
    let cancelled = false
    ;(async () => {
      const { data } = await fetchPlanConsumption(detail.userId!, {
        planLengthWeeks: detail.planLengthWeeks,
        daysPerWeek: detail.daysPerWeek,
        startDate: detail.startDate,
        activeUntil: detail.activeUntil,
        createdAt: detail.createdAt,
      })
      if (!cancelled) setConsumption(data)
    })()
    return () => { cancelled = true }
  }, [detail?.id, detail?.userId, detail?.startDate, detail?.activeUntil, detail?.planLengthWeeks, detail?.daysPerWeek, detail?.createdAt])

  async function doMarkPaid() {
    if (!detail) return
    if (!confirm(`Mark this ${detail.paymentMethod === 'cash' ? 'cash (Αντικαταβολή)' : 'bank-transfer'} plan as PAID? This immediately credits ${(detail.amountToPayCents / 100).toFixed(2)} € (+ bonus) to the customer's wallet and activates it.`)) return
    setMarking(true); setMarkErr(null)
    const { error } = await markAdminWalletPlanPaid(detail.id)
    setMarking(false)
    if (error) { setMarkErr(error); return }
    onRefunded() // reuse the refresh-after-mutation callback
  }

  async function doRefund() {
    if (!detail) return
    if (!refundReason.trim()) { setRefundErr('Reason required'); return }
    setRefunding(true); setRefundErr(null)
    const cents = refundAmount ? Math.round(parseFloat(refundAmount) * 100) : undefined
    const { error } = await refundAdminWalletPlan(detail.id, cents, refundReason)
    setRefunding(false)
    if (error) { setRefundErr(error); return }
    onRefunded()
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="admin-drawer-head">
          <h2>Wallet plan</h2>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="admin-drawer-body">
          {loading || !detail ? (
            <div className="admin-loading">Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <TabBtn active={tab === 'details'} onClick={() => setTab('details')}>Λεπτομέρειες</TabBtn>
                <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>Ιστορικό & σχόλια</TabBtn>
              </div>
              {tab === 'history' ? (
                <HistoryTab planId={detail.id} />
              ) : (
            <div className="admin-od"><div className="admin-od-grid">
              <label className="admin-od-card admin-od-col-12" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={detail.contacted} onChange={(e) => onToggleContacted(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                <span style={{ fontWeight: 700 }}>Contacted</span>
              </label>

              {/* WEC-893: Pricing + Payment first. */}
              <Section title="Pricing" col={6} icon={ICO.euro}>
                <KV k="Subtotal" v={`${(detail.subtotalCents / 100).toFixed(2)} €`} />
                {detail.voucherId && (
                  <KV k="Voucher" v={`${detail.voucherCode ?? detail.voucherId}${detail.voucherAmountCents ? ` · −${(detail.voucherAmountCents / 100).toFixed(2)} €` : ''}`} />
                )}
                <KV k="Wallet credit" v={`${(detail.walletCreditCents / 100).toFixed(2)} €`} />
                <KV k="Bonus credits" v={`${(detail.bonusCreditsCents / 100).toFixed(2)} €`} />
                <KV k="Refunded so far" v={`${(detail.refundAmountCents / 100).toFixed(2)} €`} />
                {/* WEC-894: editable final price (revenue) + discount. */}
                <PriceEditor detail={detail} onSaved={onRefunded} />
              </Section>

              {/* WEC-893: invoice (Παραστατικό) folded into Payment. */}
              <Section title="Payment" col={6} icon={ICO.card}>
                <KV k="Method" v={detail.paymentMethod ?? '—'} />
                <KV k="Status" v={detail.paymentStatus} />
                <KV k="Viva orderCode" v={detail.vivaOrderCode ?? '—'} mono />
                <KV k="Viva transactionId" v={detail.vivaTransactionId ?? '—'} mono />
                <KV k="Created" v={new Date(detail.createdAt).toLocaleString('el-GR')} />
                <KV k="Confirmed" v={detail.confirmedAt ? new Date(detail.confirmedAt).toLocaleString('el-GR') : '—'} />
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--a-border)' }}>
                  <KV k="Παραστατικό" v={detail.invoiceType === 'invoice' ? 'Τιμολόγιο (invoice)' : 'Απόδειξη (receipt)'} />
                  {detail.invoiceType === 'invoice' && (
                    <>
                      <KV k="Επωνυμία" v={detail.invoiceName ?? '—'} />
                      <KV k="ΑΦΜ" v={detail.invoiceVat ?? '—'} mono />
                    </>
                  )}
                </div>
              </Section>

              <Section title="Customer" col={12} icon={ICO.user}>
                <KV k="Name" v={detail.customerName ?? '—'} />
                <KV k="Email" v={detail.customerEmail ?? '—'} />
                <KV k="User ID" v={detail.userId ?? '—'} mono />
                {detail.userId && (
                  <Link to={`/admin/users?userId=${detail.userId}`} className="admin-od-link" style={{ marginTop: 6, display: 'inline-flex' }}>
                    Προφίλ πελάτη →
                  </Link>
                )}
              </Section>

              {/* WEC-893 Leg 1: plan management (editable). */}
              <Section title="Διαχείριση πλάνου" col={12} icon={ICO.calendar}>
                <StartDateEditor detail={detail} onSaved={onRefunded} />
                <KV
                  k="Ημέρες (χρήση / σύνολο)"
                  v={
                    consumption
                      ? `${consumption.usedDays} / ${consumption.totalDays ?? '?'}${
                          consumption.daysLeft != null ? ` · ${consumption.daysLeft} απομένουν` : ''
                        }`
                      : '…'
                  }
                />
                <OpsFields detail={detail} onChanged={onRefunded} />
              </Section>

              {/* WEC-893 Leg 5: read-only plan + macros via the shared panel
                  (also covers the body characteristics — no separate snapshot card). */}
              <div className="admin-od-card admin-od-col-12">
                <div className="admin-od-card-head"><span className="admin-od-card-title">{ICO.activity}Πλάνο & μακροθρεπτικά</span></div>
                <PlanDetailsPanel plan={toPlanDetails(detail)} />
              </div>

              {detail.paymentStatus === 'pending' && (detail.paymentMethod === 'transfer' || detail.paymentMethod === 'cash') && (
                <Section col={12} icon={ICO.check} title={detail.paymentMethod === 'cash' ? 'Cash on delivery (Αντικαταβολή)' : 'Bank transfer'}>
                  <p className="admin-page-sub" style={{ margin: '0 0 8px' }}>
                    {detail.paymentMethod === 'cash'
                      ? `Courier collected the cash? Mark the plan paid to credit ${(detail.amountToPayCents / 100).toFixed(2)} € (+ bonus) to the customer's wallet and activate it.`
                      : `Funds received? Mark the plan paid to credit ${(detail.amountToPayCents / 100).toFixed(2)} € (+ bonus) to the customer's wallet and activate it.`}
                  </p>
                  {markErr && <div className="admin-error-banner">{markErr}</div>}
                  <button className="admin-btn-primary" onClick={doMarkPaid} disabled={marking}>
                    {marking ? 'Marking…' : (detail.paymentMethod === 'cash' ? 'Mark cash as paid' : 'Mark transfer as paid')}
                  </button>
                </Section>
              )}

              {detail.paymentStatus === 'paid' && detail.refundAmountCents < detail.amountToPayCents && (
                <Section title="Refund" col={12} icon={ICO.refund}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
                    <input
                      className="admin-input"
                      style={{ width: '100%' }}
                      placeholder="Reason (required)"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                    />
                    <input
                      className="admin-input"
                      style={{ width: '100%' }}
                      type="text"
                      inputMode="decimal"
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder={`Amount in € (leave empty for full ${((detail.amountToPayCents - detail.refundAmountCents) / 100).toFixed(2)} €)`}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                    />
                    {refundErr && <div className="admin-error-banner">{refundErr}</div>}
                    <button className="admin-btn-danger" style={{ alignSelf: 'flex-start' }} onClick={doRefund} disabled={refunding || !refundReason}>
                      {refunding ? 'Refunding…' : 'Refund via Viva'}
                    </button>
                  </div>
                </Section>
              )}
            </div></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// WEC-893 Leg 5: sections render as cards in the orders-drawer grid system
// (--fp-era component, two-era rule). `col` = span out of 12.
function Section({ title, children, col = 12, icon }: { title: string; children: React.ReactNode; col?: number; icon?: React.ReactNode }) {
  return (
    <div className={`admin-od-card admin-od-col-${col}`}>
      <div className="admin-od-card-head"><span className="admin-od-card-title">{icon}{title}</span></div>
      {children}
    </div>
  )
}

// WEC-893: small title icons (same .admin-od-ico treatment as the orders drawer).
const svgIco = (children: React.ReactNode) => (
  <svg className="admin-od-ico" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const ICO = {
  euro: svgIco(<><path d="M15 6a6 6 0 1 0 0 12" /><path d="M4 10h8" /><path d="M4 14h8" /></>),
  card: svgIco(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
  user: svgIco(<><circle cx="12" cy="8" r="4" /><path d="M5.5 21a7.5 7.5 0 0 1 13 0" /></>),
  calendar: svgIco(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>),
  activity: svgIco(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  check: svgIco(<path d="M20 6 9 17l-5-5" />),
  refund: svgIco(<><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></>),
}

function StartDateEditor({ detail, onSaved }: { detail: AdminWalletPlanDetail; onSaved: () => void }) {
  const sdAdmin = useAuthStore((s) => s.user)
  const [val, setVal] = useState(detail.startDate ?? '')
  const [activeUntil, setActiveUntil] = useState<string | null>(detail.activeUntil)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  useEffect(() => {
    setVal(detail.startDate ?? ''); setActiveUntil(detail.activeUntil); setErr(null); setOk(false)
  }, [detail.id, detail.startDate, detail.activeUntil])

  // WEC-817: this is an ADMIN edit on an EXISTING plan — an admin must be able to
  // backfill/correct a start date that has already passed. So NO forward minimum
  // (the wizard's "today + 2 business days" from WEC-798a applies only to a
  // customer buying a plan today, NOT here). Weekday-only still holds.

  const fmt = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('el-GR') : '—'
  const dirty = val !== (detail.startDate ?? '')

  async function save() {
    setErr(null); setOk(false)
    if (!val) { setErr('Διάλεξε ημερομηνία'); return }
    const dow = new Date(val + 'T00:00:00').getDay()
    if (dow === 0 || dow === 6) { setErr('Μόνο εργάσιμες (Δευ–Παρ)'); return }
    setSaving(true)
    const { activeUntil: newEnd, error } = await updateWalletPlanStartDate(detail.id, val, detail.planLengthWeeks, sdAdmin?.email ?? 'admin')
    setSaving(false)
    if (error) { setErr(error); return }
    setActiveUntil(newEnd); setOk(true); onSaved()
  }

  return (
    <>
      <div className="admin-kv">
        <span className="admin-kv-k">Start date (έναρξη)</span>
        <span className="admin-kv-v" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={val} onChange={(e) => setVal(e.target.value)} />
          <button type="button" className="admin-btn" disabled={saving || !dirty} onClick={save}>
            {saving ? '…' : 'Save'}
          </button>
          {ok && <span style={{ color: '#0a7d2c' }}>✓ αποθηκεύτηκε</span>}
          {err && <span style={{ color: '#c2410c' }}>{err}</span>}
        </span>
      </div>
      <KV k="Active until (ενεργή έως)" v={fmt(activeUntil)} />
    </>
  )
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="admin-kv">
      <span className="admin-kv-k">{k}</span>
      <span className={`admin-kv-v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  )
}

// WEC-893 Leg 1: ops management for a plan, moved here from the Users page.
// Expiry override + lifecycle status (notes now live in the comments thread).
// Deliberately toothless — a past
// «Ενεργή έως» blocks nothing (the wallet never expires); it's for our own view.
function OpsFields({ detail, onChanged }: { detail: AdminWalletPlanDetail; onChanged: () => void }) {
  const adminUser = useAuthStore((s) => s.user)
  const [until, setUntil] = useState(detail.activeUntil ?? '')
  const [persisted, setPersisted] = useState({ until: detail.activeUntil ?? '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState(detail.status ?? 'active')
  const [statusBusy, setStatusBusy] = useState(false)

  useEffect(() => {
    setUntil(detail.activeUntil ?? '')
    setPersisted({ until: detail.activeUntil ?? '' })
    setStatus(detail.status ?? 'active'); setSaved(false)
  }, [detail.id, detail.activeUntil, detail.status])

  const dirty = persisted.until !== until

  async function save() {
    setSaving(true); setErr(null)
    const { error } = await saveWalletPlanOpsFields(
      detail.id, { activeUntil: until || null }, adminUser?.email ?? 'admin',
    )
    setSaving(false)
    if (error) { setErr(error); return }
    setPersisted({ until }); setSaved(true)
  }

  async function changeStatus(nextS: 'active' | 'cancelled') {
    if (nextS === status || statusBusy) return
    if (nextS === 'cancelled' && !window.confirm('Ακύρωση συνδρομής; Θα απενεργοποιηθεί το wallet (χωρίς επιστροφή χρημάτων). Μπορείς να την επαναφέρεις μετά.')) return
    setStatusBusy(true); setErr(null)
    const { error } = await setWalletPlanStatus(detail.id, nextS, adminUser?.email ?? 'admin')
    setStatusBusy(false)
    if (error) { setErr(error); return }
    setStatus(nextS); onChanged()
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--fp-border, #e2ece2)' }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.45 }}>
        Μόνο για δική μας εικόνα. <strong>Δεν μπλοκάρει τίποτα</strong> — ο πελάτης μπορεί να
        παραγγείλει ακόμη κι αν η ημερομηνία έχει περάσει.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Κατάσταση:</span>
        <button type="button" onClick={() => changeStatus('active')} disabled={statusBusy}
          style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: status === 'active' ? '1.5px solid #10b981' : '1px solid var(--a-border)',
            background: status === 'active' ? '#10b98122' : 'transparent',
            color: status === 'active' ? '#047857' : '#6b7280' }}>Ενεργή</button>
        <button type="button" onClick={() => changeStatus('cancelled')} disabled={statusBusy}
          style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: status === 'cancelled' ? '1.5px solid #ef4444' : '1px solid var(--a-border)',
            background: status === 'cancelled' ? '#ef444422' : 'transparent',
            color: status === 'cancelled' ? '#b91c1c' : '#6b7280' }}>Ακυρωμένη</button>
        {statusBusy && <span style={{ fontSize: 12, color: '#6b7280' }}>…</span>}
      </div>
      <label style={{ display: 'block', maxWidth: 220 }}>
        <span style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 3 }}>Ενεργή έως (override)</span>
        <input type="date" className="admin-input" style={{ width: '100%' }} value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      {err && <div className="admin-error-banner" style={{ marginTop: 10 }}>{err}</div>}
      <button className="admin-btn" style={{ marginTop: 10 }} onClick={save} disabled={saving || !dirty}>
        {saving ? 'Αποθήκευση…' : saved && !dirty ? '✓ Αποθηκεύτηκε' : 'Αποθήκευση'}
      </button>
    </div>
  )
}

// WEC-894: editable final price (revenue) + discount. Changing the discount
// PROPOSES a price (subtotal − discount); the admin can override it. Changing
// the price does NOT touch the discount. Wallet balance/credits are untouched
// (handled server-side). goalBands note below is unrelated.
function PriceEditor({ detail, onSaved }: { detail: AdminWalletPlanDetail; onSaved: () => void }) {
  const subtotal = detail.subtotalCents
  const eur = (c: number) => (c / 100).toFixed(2)
  const [discount, setDiscount] = useState(eur(detail.discountCents))
  const [price, setPrice] = useState(eur(detail.amountToPayCents))
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setDiscount(eur(detail.discountCents)); setPrice(eur(detail.amountToPayCents)); setOk(false); setErr(null)
  }, [detail.id, detail.discountCents, detail.amountToPayCents])

  const toCents = (v: string) => Math.round(parseFloat(v.replace(',', '.')) * 100)
  function onDiscount(v: string) {
    setDiscount(v); setOk(false)
    const dc = toCents(v)
    if (Number.isFinite(dc)) setPrice(eur(Math.max(0, subtotal - dc))) // proposal only
  }
  const dc = toCents(discount), pc = toCents(price)
  const dirty = (Number.isFinite(dc) && dc !== detail.discountCents) || (Number.isFinite(pc) && pc !== detail.amountToPayCents)

  async function save() {
    if (!Number.isFinite(dc) || !Number.isFinite(pc) || dc < 0 || pc < 0) { setErr('Μη έγκυρο ποσό'); return }
    setSaving(true); setErr(null)
    const { error } = await editWalletPlanPrice(detail.id, pc, dc)
    setSaving(false)
    if (error) { setErr(error); return }
    setOk(true); onSaved()
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--a-border)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--a-text-muted)', marginBottom: 8 }}>
        Επεξεργασία τιμής
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 3 }}>Έκπτωση (€)</span>
          <input className="admin-input" style={{ width: '100%' }} inputMode="decimal" value={discount} onChange={(e) => onDiscount(e.target.value)} />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 3 }}>Τελική τιμή (€)</span>
          <input className="admin-input" style={{ width: '100%' }} inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setOk(false) }} />
        </label>
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
        Η αλλαγή έκπτωσης προτείνει τιμή (υποσύνολο − έκπτωση)· μπορείς να την παρακάμψεις. Το υπόλοιπο wallet δεν αλλάζει.
      </div>
      {err && <div className="admin-error-banner" style={{ marginTop: 8 }}>{err}</div>}
      <button className="admin-btn" style={{ marginTop: 10 }} onClick={save} disabled={saving || !dirty}>
        {saving ? 'Αποθήκευση…' : ok && !dirty ? '✓ Αποθηκεύτηκε' : 'Αποθήκευση τιμής'}
      </button>
    </div>
  )
}

// WEC-893 Leg 5: adapt the admin plan detail into the shared PlanDetailsPanel
// input, so the macros/characteristics/per-meal render through the same proven
// component instead of a cramped one-liner + squished table. goalBands are the
// customer's live account bands — not shown here (plan-intrinsic only).
function toPlanDetails(d: AdminWalletPlanDetail): PlanDetails {
  const pct = { p: d.macroSplit.p ?? null, c: d.macroSplit.c ?? null, f: d.macroSplit.f ?? null }
  const K = { p: 4, c: 4, f: 9 } as const
  const g = (m: 'p' | 'c' | 'f') =>
    d.dailyKcal != null && pct[m] != null ? Math.round((d.dailyKcal * (pct[m] as number)) / 100 / K[m]) : null
  const sn = d.profileSnapshot
  const perMeal = Object.entries(d.pricingBreakdown).map(([key, mb]) => ({
    key: key as unknown as PlanDetails['meals'][number],
    kcal: Math.round(mb.kcal ?? 0),
    protein: Math.round(mb.grams?.p ?? 0),
    carbs: Math.round(mb.grams?.c ?? 0),
    fat: Math.round(mb.grams?.f ?? 0),
    priceEur: typeof mb.price === 'number' ? mb.price : null,
  }))
  return {
    planId: d.id, goal: d.goal, planLength: d.planLength, planLengthWeeks: d.planLengthWeeks,
    daysPerWeek: d.daysPerWeek, meals: d.selectedMeals as unknown as PlanDetails['meals'],
    startDate: d.startDate, createdAt: d.createdAt, activeUntil: d.activeUntil,
    adminNote: d.adminNote, status: d.status,
    sex: sn.sex ?? null,
    age: sn.birth_year ? new Date().getFullYear() - sn.birth_year : null,
    heightCm: sn.height_cm ?? null, weightKg: sn.weight_kg ?? null, activityLevel: sn.activity_level ?? null,
    dailyKcal: d.dailyKcal, macroPct: pct, macroGrams: { p: g('p'), c: g('c'), f: g('f') },
    perMeal, dieticianManaged: !!d.services.dieticianManaged, bodyFatMeasurement: !!d.services.bodyFatMeasurement,
    goalBands: null,
  }
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      border: active ? '1.5px solid var(--a-primary)' : '1px solid var(--a-border)',
      background: active ? 'var(--a-primary)' : 'transparent',
      color: active ? '#fff' : 'var(--a-text-muted)',
    }}>{children}</button>
  )
}

// WEC-895: subscription action history + comments thread (admin).
function HistoryTab({ planId }: { planId: string }) {
  const adminUser = useAuthStore((s) => s.user)
  const [comments, setComments] = useState<WalletPlanComment[]>([])
  const [changes, setChanges] = useState<WalletPlanChangeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [c, ch] = await Promise.all([fetchWalletPlanComments(planId), fetchWalletPlanChangeLog(planId)])
    setComments(c.data); setChanges(ch.data); setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [planId])

  async function add() {
    if (!body.trim()) return
    setBusy(true); setErr(null)
    const { error } = await addWalletPlanComment(planId, body.trim(), visible, adminUser?.email ?? 'admin')
    setBusy(false)
    if (error) { setErr(error); return }
    setBody(''); setVisible(false); load()
  }
  async function remove(id: number) {
    if (!window.confirm('Διαγραφή σχολίου;')) return
    const { error } = await deleteWalletPlanComment(id)
    if (error) { setErr(error); return }
    load()
  }

  const feed = [
    ...comments.map((c) => ({ t: c.createdAt, type: 'comment' as const, c })),
    ...changes.map((c) => ({ t: c.createdAt, type: 'change' as const, c })),
  ].sort((a, b) => (a.t < b.t ? 1 : -1))
  const fmt = (iso: string) => new Date(iso).toLocaleString('el-GR')

  return (
    <div className="admin-od"><div className="admin-od-grid">
      <div className="admin-od-card admin-od-col-12">
        <div className="admin-od-card-head"><span className="admin-od-card-title">Νέο σχόλιο</span></div>
        <textarea className="admin-input" style={{ width: '100%', minHeight: 60 }} placeholder="Σχόλιο…" value={body} onChange={(e) => setBody(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0', fontSize: 13 }}>
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Ορατό στον πελάτη
        </label>
        {err && <div className="admin-error-banner">{err}</div>}
        <button className="admin-btn" onClick={add} disabled={busy || !body.trim()}>{busy ? '…' : 'Προσθήκη σχολίου'}</button>
      </div>

      <div className="admin-od-card admin-od-col-12">
        <div className="admin-od-card-head"><span className="admin-od-card-title">Ιστορικό</span></div>
        {loading ? (
          <div className="admin-loading">…</div>
        ) : feed.length === 0 ? (
          <div className="admin-text-muted">Καμία ενέργεια ακόμη.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {feed.map((e) => e.type === 'comment' ? (
              <div key={`c${e.c.id}`} style={{ borderLeft: '3px solid #2563eb', padding: '4px 10px', background: '#f8fafc', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{fmt(e.c.createdAt)} · {e.c.author ?? '—'} · {e.c.visibleToCustomer ? 'ορατό στον πελάτη' : 'κρυφό'}</span>
                  <button type="button" onClick={() => remove(e.c.id)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>Διαγραφή</button>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{e.c.body}</div>
              </div>
            ) : (
              <div key={`h${e.c.id}`} style={{ borderLeft: '3px solid #cbd5e1', padding: '4px 10px', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{fmt(e.c.createdAt)} · {e.c.adminUser ?? 'system'}</div>
                <div>{e.c.label ?? e.c.field}{(e.c.oldValue || e.c.newValue) ? `: ${e.c.oldValue || '—'} → ${e.c.newValue || '—'}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div></div>
  )
}
