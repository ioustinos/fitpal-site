import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

/**
 * Admin sidebar (WEC-256 polish).
 *
 * Reorganised into semantic groups with collapsible headers:
 *
 *   Dashboard
 *   Orders
 *   Customers
 *   Catalogue       (Menu builder, Dishes, Categories, Tags, Ingredients,
 *                    Allergies, Dish images, Import menu)
 *   Promotions      (Vouchers, Wallet purchases, Wallet settings)
 *   Settings        (Cutoff & time slots → /admin/settings,
 *                    Delivery zones → /admin/zones — for now both leaves
 *                    point at the existing single Settings page; a future
 *                    ticket can split the Settings page itself.)
 *
 * Open/closed state per group persists in localStorage so the admin's
 * preference survives reloads. Default: all groups expanded.
 */

type IconName =
  | 'dashboard' | 'menus' | 'dishes' | 'categories' | 'tags' | 'ingredients'
  | 'allergies' | 'images' | 'import' | 'orders' | 'settings' | 'zones'
  | 'users' | 'vouchers' | 'wallet' | 'walletSettings'
  | 'catalogue' | 'promotions' | 'customers'
  | 'chevron'

interface NavLeaf {
  path: string
  label: string
  icon: IconName
  end?: boolean
}

interface NavGroup {
  /** Stable key for localStorage persistence. */
  id: string
  label: string
  icon: IconName
  items: NavLeaf[]
}

/**
 * Top-level entries. A `string-keyed` group renders as a collapsible
 * section; a single leaf renders as a standalone link (for Dashboard etc).
 */
type NavEntry = NavLeaf | NavGroup

function isGroup(e: NavEntry): e is NavGroup {
  return (e as NavGroup).items !== undefined
}

const NAV: NavEntry[] = [
  // Dashboard — standalone, top
  { path: '/admin', label: 'Dashboard', icon: 'dashboard', end: true },

  // Orders — bumped to second per Ioustinos's reorg
  {
    id: 'orders',
    label: 'Orders',
    icon: 'orders',
    items: [
      { path: '/admin/orders', label: 'Orders', icon: 'orders' },
    ],
  },

  // Customers
  {
    id: 'customers',
    label: 'Customers',
    icon: 'customers',
    items: [
      { path: '/admin/users', label: 'Users', icon: 'users' },
    ],
  },

  // Catalogue — everything that describes the menu
  {
    id: 'catalogue',
    label: 'Catalogue',
    icon: 'catalogue',
    items: [
      { path: '/admin/menus',        label: 'Menu builder', icon: 'menus' },
      { path: '/admin/dishes',       label: 'Dishes',       icon: 'dishes' },
      { path: '/admin/categories',   label: 'Categories',   icon: 'categories' },
      { path: '/admin/tags',         label: 'Tags',         icon: 'tags' },
      { path: '/admin/ingredients',  label: 'Ingredients',  icon: 'ingredients' },
      { path: '/admin/allergies',    label: 'Allergies',    icon: 'allergies' },
      { path: '/admin/dish-images',  label: 'Dish images',  icon: 'images' },
      { path: '/admin/import-menu',  label: 'Import menu',  icon: 'import' },
    ],
  },

  // Promotions & Wallet
  {
    id: 'promotions',
    label: 'Promotions & Wallet',
    icon: 'promotions',
    items: [
      { path: '/admin/vouchers',         label: 'Vouchers',         icon: 'vouchers' },
      { path: '/admin/wallet-purchases', label: 'Wallet purchases', icon: 'wallet' },
      { path: '/admin/wallet-settings',  label: 'Wallet settings',  icon: 'walletSettings' },
    ],
  },

  // Settings — split into typed-per-domain pages (WEC-274).
  // Order matches the parent epic spec; Site Details first because that's
  // the most "starting point" page when an admin first opens the section.
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    items: [
      { path: '/admin/site-details',     label: 'Site Details',             icon: 'settings' },
      { path: '/admin/cutoff-schedules', label: 'Cutoff Times & Schedules', icon: 'settings' },
      { path: '/admin/payments',         label: 'Payments',                 icon: 'wallet' },
      { path: '/admin/menu-options',     label: 'Menu Options',             icon: 'dishes' },
      { path: '/admin/zones',            label: 'Delivery Zones',           icon: 'zones' },
      { path: '/admin/advanced',         label: 'Advanced',                 icon: 'settings' },
    ],
  },
]

const STORAGE_KEY = 'fitpal-admin-sidebar-groups-v1'

function loadOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>
  } catch { /* no-op */ }
  return {}
}

export function Sidebar() {
  // Default everything to expanded — admins discovering things matters more
  // than chrome cleanliness on first load.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const saved = loadOpenState()
    const out: Record<string, boolean> = {}
    for (const e of NAV) if (isGroup(e)) out[e.id] = saved[e.id] ?? true
    return out
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(open)) } catch { /* no-op */ }
  }, [open])

  function toggle(id: string) {
    setOpen((s) => ({ ...s, [id]: !s[id] }))
  }

  return (
    <nav className="admin-sidebar">
      {NAV.map((e) => {
        if (!isGroup(e)) {
          return (
            <NavLink
              key={e.path}
              to={e.path}
              end={e.end}
              className={({ isActive }) => `admin-nav-item${isActive ? ' active' : ''}`}
            >
              <Icon name={e.icon} />
              <span>{e.label}</span>
            </NavLink>
          )
        }
        const isOpen = !!open[e.id]
        return (
          <div key={e.id} className="admin-nav-group">
            <button
              type="button"
              className={`admin-nav-group-hdr${isOpen ? ' open' : ''}`}
              onClick={() => toggle(e.id)}
              aria-expanded={isOpen}
              aria-controls={`nav-group-${e.id}`}
            >
              <Icon name={e.icon} />
              <span>{e.label}</span>
              <span className="admin-nav-chevron"><Icon name="chevron" /></span>
            </button>
            {isOpen && (
              <div className="admin-nav-group-body" id={`nav-group-${e.id}`}>
                {e.items.map((it) => (
                  <NavLink
                    key={it.path}
                    to={it.path}
                    end={it.end}
                    className={({ isActive }) => `admin-nav-item nested${isActive ? ' active' : ''}`}
                  >
                    <Icon name={it.icon} />
                    <span>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

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
    case 'categories':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      )
    case 'tags':
      return (
        <svg {...p}>
          <path d="M20.59 13.41 11 23l-9-9V3h11l9.59 9.59a1 1 0 010 1.41z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      )
    case 'images':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case 'allergies':
      return (
        <svg {...p}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'ingredients':
      return (
        <svg {...p}>
          <path d="M3 12c0-4 4-7 9-7s9 3 9 7-4 7-9 7-9-3-9-7z" />
          <path d="M12 5v14" />
          <path d="M7 12h10" />
        </svg>
      )
    case 'import':
      return (
        <svg {...p}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
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
    case 'users':
      return (
        <svg {...p}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    case 'vouchers':
      return (
        <svg {...p}>
          <path d="M20 12V8H4v4a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 0 0-4z" />
          <line x1="13" y1="5" x2="13" y2="19" strokeDasharray="2 2" />
        </svg>
      )
    case 'wallet':
      return (
        <svg {...p}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M16 12h.01" />
          <path d="M2 10h20" />
        </svg>
      )
    case 'walletSettings':
      return (
        <svg {...p}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" />
        </svg>
      )
    case 'catalogue':
      return (
        <svg {...p}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      )
    case 'promotions':
      return (
        <svg {...p}>
          <path d="M12 2 15 9l7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
        </svg>
      )
    case 'customers':
      return (
        <svg {...p}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <path d="M20 8v6M23 11h-6" />
        </svg>
      )
    case 'chevron':
      return (
        <svg {...p}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      )
  }
}
