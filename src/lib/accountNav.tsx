// WEC-518 — Single source of truth for the account navigation.
//
// Order, labels (el/en) and icons live here ONCE and are consumed by BOTH:
//   • the account sidebar   (src/pages/AccountPage.tsx)
//   • the header user menu  (src/components/layout/Header.tsx)
// so the two lists can never drift in order, wording or iconography again.
//
// To add / reorder / rename a tab, edit ACCOUNT_TABS below — nothing else.

import type { ReactElement } from 'react'

export type AccountTab =
  | 'profile'
  | 'orders'
  | 'prefs'
  | 'addresses'
  | 'subscription'
  | 'wallet'
  | 'goals'
  | 'diet'

export interface AccountTabDef {
  key: AccountTab
  el: string
  en: string
  icon: ReactElement
}

const svg = (children: ReactElement | ReactElement[]): ReactElement => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
)

// Order is authoritative — this array drives both lists top-to-bottom.
export const ACCOUNT_TABS: AccountTabDef[] = [
  {
    key: 'profile',
    el: 'Στοιχεία',
    en: 'Details',
    icon: svg([<path key="a" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />, <circle key="b" cx="12" cy="7" r="4" />]),
  },
  {
    key: 'orders',
    el: 'Παραγγελίες',
    en: 'Orders',
    icon: svg([<rect key="a" x="3" y="3" width="18" height="18" rx="2" />, <path key="b" d="M8 7h8M8 12h8M8 17h5" />]),
  },
  {
    key: 'prefs',
    el: 'Ρυθμίσεις',
    en: 'Settings',
    icon: svg([<circle key="a" cx="12" cy="12" r="3" />, <path key="b" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />]),
  },
  {
    key: 'addresses',
    el: 'Διευθύνσεις',
    en: 'Addresses',
    icon: svg([<path key="a" d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />, <circle key="b" cx="12" cy="10" r="3" />]),
  },
  {
    key: 'subscription',
    el: 'Συνδρομή',
    en: 'Subscription',
    icon: svg([<circle key="a" cx="12" cy="8" r="6" />, <polyline key="b" points="8.21 13.89 7 23 12 19 17 23 15.79 13.88" />]),
  },
  {
    key: 'wallet',
    el: 'Πορτοφόλι',
    en: 'Wallet',
    icon: svg([<rect key="a" x="2" y="5" width="20" height="14" rx="2" />, <path key="b" d="M16 12h.01" />, <path key="c" d="M2 10h20" />]),
  },
  {
    key: 'goals',
    el: 'Στόχοι',
    en: 'Goals',
    icon: svg([<circle key="a" cx="12" cy="12" r="10" />, <circle key="b" cx="12" cy="12" r="6" />, <circle key="c" cx="12" cy="12" r="2" />]),
  },
  {
    key: 'diet',
    el: 'Διατροφή',
    en: 'Diet',
    icon: svg([<path key="a" d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />, <line key="b" x1="12" y1="9" x2="12" y2="13" />, <line key="c" x1="12" y1="17" x2="12.01" y2="17" />]),
  },
]

export const logoutIcon: ReactElement = svg([
  <path key="a" d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />,
  <polyline key="b" points="16 17 21 12 16 7" />,
  <line key="c" x1="21" y1="12" x2="9" y2="12" />,
])

export const accountTabLabel = (key: AccountTab, lang: 'el' | 'en'): string => {
  const t = ACCOUNT_TABS.find((x) => x.key === key)
  return t ? (lang === 'el' ? t.el : t.en) : key
}
