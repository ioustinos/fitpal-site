import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { fetchDashboardStats, fetchLatestReconcileRun, type DashboardStats, type ReconcileSummary } from '../../lib/api/adminDashboard'
import { fetchAdminWalletStats, type WalletPlanStats } from '../../lib/api/adminWalletPlans'

export function Dashboard() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [reconcile, setReconcile] = useState<ReconcileSummary | null>(null)
  const [walletStats, setWalletStats] = useState<WalletPlanStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [statsRes, reconcileRes, walletRes] = await Promise.all([
        fetchDashboardStats(),
        fetchLatestReconcileRun(),
        fetchAdminWalletStats(),
      ])
      if (statsRes.error) setErr(statsRes.error)
      if (statsRes.data) setStats(statsRes.data)
      if (reconcileRes.data) setReconcile(reconcileRes.data)
      if (walletRes.data) setWalletStats(walletRes.data)
      setLoading(false)
    })()
  }, [])

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Dashboard</h1>
      <p className="admin-page-sub">
        Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}. Daily ops overview.
      </p>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && stats && (
        <>
          <div className="admin-stats-grid">
            <StatCard
              title="Today's deliveries"
              value={stats.todayOrdersCount}
              hint={stats.todayOrdersCount === 1 ? 'child order' : 'child orders'}
              accent="primary"
              onClick={() => navigate('/admin/orders')}
            />
            <StatCard
              title="Needs attention"
              value={stats.pendingOrdersCount}
              hint="pending status or payment"
              accent={stats.pendingOrdersCount > 0 ? 'warning' : 'muted'}
              onClick={() => navigate('/admin/orders')}
            />
            <StatCard
              title="Active menu"
              value={stats.activeMenuName ?? '—'}
              hint={stats.activeMenuRange ? `${stats.activeMenuRange.from} → ${stats.activeMenuRange.to}` : 'No menu published for today'}
              accent={stats.activeMenuName ? 'primary' : 'muted'}
              onClick={() => navigate('/admin/menus')}
              small
            />
            <StatCard
              title="Active dishes"
              value={stats.activeDishesCount}
              hint="visible on the customer menu"
              accent="primary"
              onClick={() => navigate('/admin/dishes')}
            />
          </div>

          <div className="admin-quick-actions">
            <div className="admin-quick-head">Quick actions</div>
            <div className="admin-quick-buttons">
              <button className="admin-btn-primary" onClick={() => navigate('/admin/menus')}>
                Build next week's menu
              </button>
              <button className="admin-btn-ghost" onClick={() => navigate('/admin/dishes')}>
                + New dish
              </button>
              <button className="admin-btn-ghost" onClick={() => navigate('/admin/orders')}>
                View today's orders
              </button>
            </div>
          </div>

          {stats.nextPublishedMenuName && (
            <div className="admin-info-banner">
              <strong>Next published menu:</strong> {stats.nextPublishedMenuName}{' '}
              {stats.nextPublishedMenuRange && (
                <span style={{ color: 'var(--a-text-muted)' }}>
                  ({stats.nextPublishedMenuRange.from} → {stats.nextPublishedMenuRange.to})
                </span>
              )}
            </div>
          )}

          {!stats.activeMenuName && (
            <div className="admin-warn-banner">
              No menu is currently published for today. Customers will see an empty menu until a weekly menu covering today is published.{' '}
              <button className="admin-inline-link" onClick={() => navigate('/admin/menus')}>Open menu builder →</button>
            </div>
          )}

          {walletStats && <WalletStatsRow stats={walletStats} onClick={() => navigate('/admin/wallet-purchases')} />}

          <ReconcileHealthRow reconcile={reconcile} />
        </>
      )}
    </div>
  )
}

/** Wallet purchases stats — quick glance over recent activity. */
function WalletStatsRow({ stats, onClick }: { stats: WalletPlanStats; onClick: () => void }) {
  const stuckTone = stats.stuckPendingCount > 0 ? '#ef4444' : '#6b7280'
  return (
    <div className="admin-quick-actions" style={{ marginTop: 24 }}>
      <div className="admin-quick-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Wallet purchases</span>
        <button className="admin-inline-link" onClick={onClick}>View all →</button>
      </div>
      <div className="admin-stats-grid" style={{ marginTop: 12 }}>
        <StatCard
          title="Paid today"
          value={stats.paidToday}
          hint={stats.paidToday === 1 ? 'plan' : 'plans'}
          accent="primary"
          onClick={onClick}
        />
        <StatCard
          title="This week"
          value={stats.paidWeek}
          hint={`€${(stats.revenueWeekCents / 100).toFixed(2)} revenue`}
          accent="primary"
          onClick={onClick}
        />
        <StatCard
          title="This month"
          value={stats.paidMonth}
          hint={`€${(stats.revenueMonthCents / 100).toFixed(2)} revenue`}
          accent="primary"
          onClick={onClick}
        />
        <StatCard
          title="Pending now"
          value={stats.pendingCount}
          hint={stats.stuckPendingCount > 0 ? `⚠ ${stats.stuckPendingCount} stuck >3min` : 'awaiting payment'}
          accent={stats.stuckPendingCount > 0 ? 'warning' : 'muted'}
          onClick={onClick}
        />
      </div>
      {stats.stuckPendingCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: stuckTone }}>
          ⚠ {stats.stuckPendingCount} wallet purchase{stats.stuckPendingCount === 1 ? '' : 's'} stuck in pending — check Viva integration health.
        </div>
      )}
    </div>
  )
}

/** WEC-174b — tiny ops-health row showing when viva-reconcile last ran. */
function ReconcileHealthRow({ reconcile }: { reconcile: ReconcileSummary | null }) {
  if (!reconcile) {
    return (
      <div className="admin-text-muted" style={{ marginTop: 20, fontSize: 12 }}>
        Viva reconcile: no runs recorded yet
      </div>
    )
  }

  const ageLabel = formatAge(reconcile.ageSeconds)
  const stale = reconcile.ageSeconds > 15 * 60 // >15 min = missed 3 runs
  const canary = reconcile.paidRescued > 0    // reconcile rescued orders → webhook unhealthy
  const tone = canary ? '#ef4444' : stale ? '#f59e0b' : '#6b7280'

  return (
    <div
      style={{
        marginTop: 20,
        padding: '8px 12px',
        border: '1px solid var(--a-border, #e5e7eb)',
        borderRadius: 6,
        fontSize: 12,
        color: tone,
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
      title={reconcile.notes ?? 'viva-reconcile scheduled function'}
    >
      <span><strong>Viva reconcile</strong>: {ageLabel} ago</span>
      <span>· checked <strong>{reconcile.checked}</strong></span>
      {canary && (
        <span>· ⚠ rescued <strong>{reconcile.paidRescued}</strong> (webhook may be down)</span>
      )}
      {reconcile.errors > 0 && (
        <span>· {reconcile.errors} error{reconcile.errors === 1 ? '' : 's'}</span>
      )}
      {stale && !canary && <span>· (stale — no run in 15+ min)</span>}
    </div>
  )
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function StatCard({
  title, value, hint, accent, onClick, small,
}: {
  title: string
  value: number | string
  hint?: string
  accent: 'primary' | 'warning' | 'muted'
  onClick?: () => void
  small?: boolean
}) {
  return (
    <button className={`admin-stat-card accent-${accent}`} onClick={onClick}>
      <div className="admin-stat-title">{title}</div>
      <div className={`admin-stat-value${small ? ' small' : ''}`}>{value}</div>
      {hint && <div className="admin-stat-hint">{hint}</div>}
    </button>
  )
}
