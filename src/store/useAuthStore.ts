import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import {
  signIn,
  signUp as apiSignUp,
  signOut,
  fetchFullUser,
} from '../lib/api/auth'
import { fetchWallet } from '../lib/api/wallet'
import { fetchUserOrders, type OrderHistoryItem } from '../lib/api/orders'
import { fetchAdminStatus, type AdminRole } from '../lib/api/admin'

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface Address {
  id: string
  labelEl: string
  labelEn: string
  street: string
  area: string
  zip?: string
  floor?: string
  doorbell?: string
  notes?: string
}

export interface MacroRange {
  min?: number
  max?: number
}

export interface UserGoals {
  enabled?: boolean
  calories?: number | MacroRange
  protein?: number | MacroRange
  carbs?: number | MacroRange
  fat?: number | MacroRange
}

export interface WalletTransaction {
  type: 'credit' | 'debit'
  descEl: string
  descEn: string
  date: string
  amount: number   // positive = credit, negative = debit
}

export interface UserWallet {
  active: boolean
  planId?: string
  planEl?: string
  planEn?: string
  balance: number
  baseBalance?: number
  bonusBalance?: number
  bonusPct?: number
  autoRenew?: boolean
  nextRenewal?: string   // ISO date string
  monthlyAmount?: number
  creditAmount?: number
  transactions?: WalletTransaction[]
  /**
   * When true, only an admin (via impersonation) can spend this wallet —
   * customer-side checkout hides the wallet payment option. Used for the
   * curator-managed subscription tier where Fitpal staff orders on the
   * customer's behalf.
   */
  adminManaged?: boolean
}

export interface UserPrefs {
  vegetarian?: boolean
  glutenFree?: boolean
  lowCarb?: boolean
  paymentMethod?: string
  cutlery?: boolean
  invoice?: boolean
  slots?: Record<number, string>       // preferred time slot per day-of-week
  dayAddress?: Record<number, string>   // preferred address ID per day-of-week
  lang?: string
  newsletter?: boolean
  goalTracking?: boolean               // show on-page goal vs order comparison
}

export interface FitpalUser {
  id: string                // Supabase user ID
  name: string
  nameEn?: string
  email: string
  phone?: string
  addresses: Address[]
  prefs: UserPrefs
  goals: UserGoals
  wallet: UserWallet
  orders?: OrderHistoryItem[]
  /** True if the user has a row in public.admin_users (WEC-110). */
  isAdmin: boolean
  /** The admin role when isAdmin is true, otherwise null. */
  adminRole: AdminRole | null
}

// ─── Store interface ───────────────────────────────────────────────────────────

interface AuthStore {
  user: FitpalUser | null
  isLoading: boolean
  authError: string | null
  authTab: 'login' | 'register'
  sessionChecked: boolean     // true once we've checked for existing session

  setUser: (user: FitpalUser | null) => void
  setAuthTab: (tab: 'login' | 'register') => void
  setError: (error: string | null) => void
  login: (email: string, password: string) => Promise<boolean>
  signup: (email: string, password: string, name?: string) => Promise<boolean>
  logout: () => Promise<void>
  /** Rehydrate user from existing Supabase session (call on app mount) */
  checkSession: () => Promise<void>
  /** Re-fetch all user data (profile, addresses, goals, prefs, wallet, orders) */
  refreshUser: (userId: string) => Promise<void>
  updateAddresses: (addresses: Address[]) => void
  updatePrefs: (prefs: Partial<UserPrefs>) => void
  updateGoals: (goals: UserGoals) => void
  updateWallet: (wallet: Partial<UserWallet>) => void
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function buildFullUser(userId: string, email: string): Promise<FitpalUser | null> {
  // Fetch profile + wallet + orders + admin status in parallel
  const [userRes, walletRes, ordersRes, adminRes] = await Promise.all([
    fetchFullUser(userId),
    fetchWallet(userId),
    fetchUserOrders(userId),
    fetchAdminStatus(userId),
  ])

  if (!userRes.data) return null

  return {
    id: userId,
    name: userRes.data.name,
    nameEn: userRes.data.nameEn,
    email,
    phone: userRes.data.phone,
    addresses: userRes.data.addresses,
    prefs: userRes.data.prefs,
    goals: userRes.data.goals,
    wallet: walletRes.data ?? { active: false, balance: 0 },
    orders: ordersRes.data ?? [],
    isAdmin: adminRes.data.isAdmin,
    adminRole: adminRes.data.role,
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isLoading: false,
  authError: null,
  authTab: 'login',
  sessionChecked: false,

  setUser: (user) => set({ user }),
  setAuthTab: (authTab) => set({ authTab, authError: null }),
  setError: (authError) => set({ authError }),

  login: async (email, password) => {
    set({ isLoading: true, authError: null })

    const { data, error } = await signIn(email, password)
    if (error || !data) {
      set({ authError: error ?? 'Login failed', isLoading: false })
      return false
    }

    const user = await buildFullUser(data.userId, email)
    if (!user) {
      set({ authError: 'Failed to load user data', isLoading: false })
      return false
    }

    set({ user, isLoading: false })
    return true
  },

  signup: async (email, password, name) => {
    set({ isLoading: true, authError: null })

    const { data, error } = await apiSignUp(email, password, name)
    if (error || !data) {
      set({ authError: error ?? 'Signup failed', isLoading: false })
      return false
    }

    // After signup, fetch user data (the signup trigger creates profiles/goals/prefs)
    const user = await buildFullUser(data.userId, email)
    if (!user) {
      // User might need to confirm email first — still successful signup
      set({ isLoading: false })
      return true
    }

    set({ user, isLoading: false })
    return true
  },

  logout: async () => {
    // Impersonation state is cleared by App.tsx's onAuthStateChange handler
    // on the SIGNED_OUT event triggered below. No special-casing here.
    await signOut()
    set({ user: null })
  },

  checkSession: async () => {
    if (get().sessionChecked) return

    const { data: sessionData } = await supabase.auth.getSession()
    const session = sessionData?.session

    if (session?.user) {
      const user = await buildFullUser(
        session.user.id,
        session.user.email ?? '',
      )
      set({ user, sessionChecked: true })
    } else {
      set({ sessionChecked: true })
    }
  },

  refreshUser: async (userId: string) => {
    const currentUser = get().user
    if (!currentUser) return

    const user = await buildFullUser(userId, currentUser.email)
    if (user) set({ user })
  },

  updateAddresses: (addresses) =>
    set((state) => state.user ? { user: { ...state.user, addresses } } : state),

  updatePrefs: (prefs) =>
    set((state) =>
      state.user ? { user: { ...state.user, prefs: { ...state.user.prefs, ...prefs } } } : state
    ),

  updateGoals: (goals) =>
    set((state) => state.user ? { user: { ...state.user, goals } } : state),

  updateWallet: (wallet) =>
    set((state) =>
      state.user ? { user: { ...state.user, wallet: { ...state.user.wallet, ...wallet } } } : state
    ),
}))
