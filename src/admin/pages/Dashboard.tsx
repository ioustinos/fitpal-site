import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { fetchDashboardStats, type DashboardStats } from '../../lib/api/adminDashboard'

export function Dashboard() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data, error } = await fetchDashboardStats()
      if (error) setErr(error)
      if (data) setStats(data)
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
        </>
      )}
    </div>
  )
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
