import { NavLink } from 'react-router-dom'

interface NavItem {
  path: string
  label: string
  icon: IconName
  end?: boolean
  wec?: string
}

const items: NavItem[] = [
  { path: '/admin',          label: 'Dashboard',   icon: 'dashboard', end: true, wec: 'WEC-112' },
  { path: '/admin/menus',    label: 'Menu builder',icon: 'menus',                 wec: 'WEC-114' },
  { path: '/admin/dishes',   label: 'Dishes',      icon: 'dishes',                wec: 'WEC-113' },
  { path: '/admin/orders',   label: 'Orders',      icon: 'orders',                wec: 'WEC-115' },
  { path: '/admin/settings', label: 'Settings',    icon: 'settings',              wec: 'WEC-118' },
  { path: '/admin/zones',    label: 'Delivery zones', icon: 'zones',              wec: 'WEC-119' },
]

type IconName = 'dashboard' | 'menus' | 'dishes' | 'orders' | 'settings' | 'zones'

function Icon({ name }: { name: IconName }) {
  const p = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'dashboard':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="9" />
          <rect x="14" y="3" width="7" height="5" />
          <rect x="14" y="12" width="7" height="9" />
          <rect x="3" y="16" width="7" height="5" />
        </svg>
      )
    case 'menus':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="9" y1="10" x2="9" y2="20" />
        </svg>
      )
    case 'dishes':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'orders':
      return (
        <svg {...p}>
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    case 'zones':
      return (
        <svg {...p}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      )
  }
}

export function Sidebar() {
  return (
    <nav className="admin-sidebar">
      {items.map((it) => (
        <NavLink
          key={it.path}
          to={it.path}
          end={it.end}
          className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
        >
          <Icon name={it.icon} />
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
