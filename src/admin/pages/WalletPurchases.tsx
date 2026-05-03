import { useEffect, useState } from 'react'
import {
  fetchAdminWalletPlans, fetchAdminWalletPlanDetail, refundAdminWalletPlan,
  type AdminWalletPlanRow, type AdminWalletPlanDetail,
} from '../../lib/api/adminWalletPlans'

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

  // Drawer
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminWalletPlanDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function refresh() {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminWalletPlans({
      status: status || undefined,
      planLength: planLength || undefined,
      goal: goal || undefined,
    })
    if (error) setErr(error)
    setRows(data ?? [])
    setLoading(false)
  }
  useEffect(() => { refresh() /* eslint-disable-next-line */ }, [status, planLength, goal])

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
          <option value="">All statuses</option>
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
              <th>When</th>
              <th>Customer</th>
              <th>Goal</th>
              <th>Plan</th>
              <th>Method</th>
              <th>Status</th>
              <th>Pay</th>
              <th>Credit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString('el-GR')}</td>
                <td>
                  <div>{r.customerName ?? '—'}</div>
                  <div className="admin-text-muted">{r.customerEmail ?? '—'}</div>
                </td>
                <td>{r.goal ?? '—'}</td>
                <td>{r.planLength ?? '—'} · {r.daysPerWeek ?? '?'}d/wk · {r.selectedMeals.length} meals</td>
                <td>{r.paymentMethod ?? '—'}</td>
                <td><span className={`admin-pill admin-pill-${r.paymentStatus}`}>{STATUS_LABELS[r.paymentStatus] ?? r.paymentStatus}</span></td>
                <td>€{(r.amountToPayCents / 100).toFixed(2)}</td>
                <td>€{(r.walletCreditCents / 100).toFixed(2)}</td>
                <td><button className="admin-btn-secondary admin-btn-sm" onClick={() => openDrawer(r.id)}>Details</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openId && (
        <Drawer
          detail={detail}
          loading={detailLoading}
          onClose={() => { setOpenId(null); setDetail(null) }}
          onRefunded={() => { setOpenId(null); setDetail(null); refresh() }}
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
}

function Drawer({ detail, loading, onClose, onRefunded }: DrawerProps) {
  const [refundReason, setRefundReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('') // empty = full refund of remaining
  const [refunding, setRefunding] = useState(false)
  const [refundErr, setRefundErr] = useState<string | null>(null)

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
              <Section title="Customer">
                <KV k="Name" v={detail.customerName ?? '—'} />
                <KV k="Email" v={detail.customerEmail ?? '—'} />
                <KV k="User ID" v={detail.userId ?? '—'} mono />
              </Section>

              <Section title="Plan">
                <KV k="Goal" v={detail.goal ?? '—'} />
                <KV k="Length" v={`${detail.planLength ?? '?'} (${detail.daysPerWeek ?? '?'} days/wk · ${detail.selectedMeals.join(' + ') || '—'})`} />
                <KV k="Daily kcal" v={String(detail.dailyKcal ?? '—')} />
                <KV k="Macro split" v={`P ${detail.macroSplit.p ?? 0}% / C ${detail.macroSplit.c ?? 0}% / F ${detail.macroSplit.f ?? 0}%`} />
                <KV k="Dietician-managed" v={detail.services.dieticianManaged ? 'Yes' : 'No'} />
              </Section>

              <Section title="Profile snapshot (at purchase)">
                <KV k="Sex" v={detail.profileSnapshot.sex ?? '—'} />
                <KV k="Age (from birth_year)" v={detail.profileSnapshot.birth_year ? String(new Date().getFullYear() - detail.profileSnapshot.birth_year) : '—'} />
                <KV k="Height" v={detail.profileSnapshot.height_cm ? `${detail.profileSnapshot.height_cm} cm` : '—'} />
                <KV k="Weight" v={detail.profileSnapshot.weight_kg ? `${detail.profileSnapshot.weight_kg} kg` : '—'} />
                <KV k="Activity" v={detail.profileSnapshot.activity_level ?? '—'} />
              </Section>

              <Section title="Per-meal breakdown">
                <table className="admin-table-tight">
                  <thead><tr><th>Meal</th><th>kcal</th><th>P/C/F (g)</th><th>Price</th></tr></thead>
                  <tbody>
                    {Object.entries(detail.pricingBreakdown).map(([meal, mb]) => (
                      <tr key={meal}>
                        <td><b>{meal}</b></td>
                        <td>{mb.kcal}</td>
                        <td>{mb.grams.p}/{mb.grams.c}/{mb.grams.f}</td>
                        <td>€{mb.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="Pricing">
                <KV k="Subtotal" v={`€${(detail.subtotalCents / 100).toFixed(2)}`} />
                <KV k="Discount" v={`${Math.round(detail.discountPct * 100)}% (−€${(detail.discountCents / 100).toFixed(2)})`} />
                <KV k="Amount paid" v={`€${(detail.amountToPayCents / 100).toFixed(2)}`} />
                <KV k="Wallet credit" v={`€${(detail.walletCreditCents / 100).toFixed(2)}`} />
                <KV k="Bonus credits" v={`€${(detail.bonusCreditsCents / 100).toFixed(2)}`} />
                <KV k="Refunded so far" v={`€${(detail.refundAmountCents / 100).toFixed(2)}`} />
              </Section>

              <Section title="Payment">
                <KV k="Method" v={detail.paymentMethod ?? '—'} />
                <KV k="Status" v={detail.paymentStatus} />
                <KV k="Viva orderCode" v={detail.vivaOrderCode ?? '—'} mono />
                <KV k="Viva transactionId" v={detail.vivaTransactionId ?? '—'} mono />
                <KV k="Created" v={new Date(detail.createdAt).toLocaleString('el-GR')} />
                <KV k="Confirmed" v={detail.confirmedAt ? new Date(detail.confirmedAt).toLocaleString('el-GR') : '—'} />
              </Section>

              {detail.paymentStatus === 'paid' && detail.refundAmountCents < detail.amountToPayCents && (
                <Section title="Refund">
                  <div className="admin-inline-form" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <input
                      className="admin-input"
                      placeholder="Reason (required)"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                    />
                    <input
                      className="admin-input"
                      type="number"
                      step="0.01"
                      placeholder={`Amount in € (leave empty for full €${((detail.amountToPayCents - detail.refundAmountCents) / 100).toFixed(2)})`}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                    />
                    {refundErr && <div className="admin-error-banner">{refundErr}</div>}
                    <button className="admin-btn-danger" onClick={doRefund} disabled={refunding || !refundReason}>
                      {refunding ? 'Refunding…' : 'Refund via Viva'}
                    </button>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="admin-drawer-section">
      <h3>{title}</h3>
      {children}
    </section>
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
