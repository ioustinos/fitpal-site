import { create } from 'zustand'
import type { Lang } from '../lib/translations'
import type { Dish } from '../data/menu'

type Modal = 'auth' | 'dish' | 'wallet' | null

interface UIStore {
  lang: Lang
  activeDay: number
  activeWeek: number
  activeCat: string | null          // null = show all
  openModal: Modal
  selectedDish: Dish | null
  selectedDayIndex: number | null   // day index for dish modal context
  isCheckout: boolean
  isAccountPage: boolean
  accountTab: string
  isSubscriptionPage: boolean
  isWalletPage: boolean

  setLang: (lang: Lang) => void
  setActiveDay: (day: number) => void
  setActiveWeek: (week: number) => void
  setActiveWeekAndDay: (week: number, day: number) => void
  setActiveCat: (cat: string | null) => void
  openDishModal: (dish: Dish, dayIndex: number) => void
  openAuthModal: () => void
  openWalletModal: () => void
  closeModal: () => void
  goToCheckout: () => void
  closeCheckout: () => void
  goToAccount: (tab?: string) => void
  closeAccount: () => void
  goToSubscription: () => void
  closeSubscription: () => void
  goToWalletPage: () => void
  closeWalletPage: () => void
  /** Reset all overlay pages (checkout/account/wallet/sub) — lands on the menu. */
  goToMenu: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  lang: 'el',
  activeDay: 0,
  activeWeek: 1,
  activeCat: null,
  openModal: null,
  selectedDish: null,
  selectedDayIndex: null,
  isCheckout: false,
  isAccountPage: false,
  accountTab: 'orders',
  isSubscriptionPage: false,
  isWalletPage: false,

  // Session-only language toggle. Logged-in users manage a persistent default
  // via Account → Preferences (see PrefsTab). That's the explicit control; the
  // header toggle is just an in-session override — simpler mental model for
  // users than "every time I toggle, we save everywhere".
  setLang: (lang) => set({ lang }),
  setActiveDay: (activeDay) => set({ activeDay, activeCat: null }),
  setActiveWeek: (activeWeek) => set({ activeWeek, activeDay: 0, activeCat: null }),
  setActiveWeekAndDay: (activeWeek, activeDay) => set({ activeWeek, activeDay, activeCat: null }),
  setActiveCat: (activeCat) => set({ activeCat }),
  openDishModal: (dish, dayIndex) => set({ openModal: 'dish', selectedDish: dish, selectedDayIndex: dayIndex }),
  openAuthModal: () => set({ openModal: 'auth' }),
  openWalletModal: () => set({ openModal: 'wallet' }),
  closeModal: () => set({ openModal: null, selectedDish: null, selectedDayIndex: null }),
  goToCheckout: () => set({ isCheckout: true, isAccountPage: false, isWalletPage: false, isSubscriptionPage: false }),
  closeCheckout: () => set({ isCheckout: false }),
  goToAccount: (tab?: string) => set({ isAccountPage: true, accountTab: tab || 'orders', isCheckout: false, isWalletPage: false, isSubscriptionPage: false }),
  closeAccount: () => set({ isAccountPage: false }),
  goToSubscription: () => set({ isSubscriptionPage: true, isCheckout: false, isAccountPage: false, isWalletPage: false }),
  closeSubscription: () => set({ isSubscriptionPage: false }),
  goToWalletPage: () => set({ isWalletPage: true, isCheckout: false, isAccountPage: false, isSubscriptionPage: false }),
  closeWalletPage: () => set({ isWalletPage: false }),
  // Used by sign-out (WEC-141) — collapses every overlay page at once so the
  // user always lands on the menu, regardless of where they were when they
  // opened the profile dropdown.
  goToMenu: () => set({
    isCheckout: false,
    isAccountPage: false,
    isWalletPage: false,
    isSubscriptionPage: false,
    openModal: null,
  }),
}))
