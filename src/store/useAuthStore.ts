import { create } from 'zustand'

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface Address {
  street: string
  area: string
  zip?: string
  notes?: string
}

export interface UserGoals {
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
}

export interface WalletTransaction {
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
  discountPct?: number
  autoRenew?: boolean
  transactions?: WalletTransaction[]
}

export interface UserPrefs {
  vegetarian?: boolean
  glutenFree?: boolean
  lowCarb?: boolean
  paymentMethod?: string
  lang?: string
  newsletter?: boolean
}

export interface FitpalUser {
  name: string
  nameEn?: string
  email: string
  phone?: string
  addresses: Address[]
  prefs: UserPrefs
  goals: UserGoals
  wallet: UserWallet
  orders?: any[]
}

// ─── Store interface ───────────────────────────────────────────────────────────

interface AuthStore {
  user: FitpalUser | null
  isLoading: boolean
  authError: string | null
  authTab: 'login' | 'register'

  setUser: (user: FitpalUser | null) => void
  setAuthTab: (tab: 'login' | 'register') => void
  setError: (error: string | null) => void
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
  updateAddresses: (addresses: Address[]) => void
  updatePrefs: (prefs: Partial<UserPrefs>) => void
  updateGoals: (goals: UserGoals) => void
  updateWallet: (wallet: Partial<UserWallet>) => void
}

// ─── Mock users (replace with Supabase auth — WEC-13) ────────────────────────

const MOCK_USERS: Record<string, FitpalUser & { password: string }> = {
  'demo@fitpal.gr': {
    password: '1234',
    name: 'Ιουστίνος Σάρρης',
    nameEn: 'Ioustinos Sarris',
    email: 'demo@fitpal.gr',
    phone: '+30 697 123 4567',
    addresses: [
      { street: 'Λεωφόρος Κηφισίας 45', area: 'Αμαρούσι', zip: '15123', notes: 'Κουδούνι αριστερά, 3ος όροφος' },
      { street: 'Βασιλίσσης Σοφίας 12', area: 'Αθήνα', zip: '10674', notes: 'Ρεσεψιόν — πείτε Fitpal, 5ος' },
    ],
    prefs: {
      paymentMethod: 'card',
      lang: 'el',
      newsletter: true,
    },
    goals: {
      calories: 1800,
      protein: 120,
      carbs: 200,
      fat: 60,
    },
    wallet: {
      active: true,
      planId: 'plus',
      planEl: 'Plus',
      planEn: 'Plus',
      balance: 78.40,
      discountPct: 10,
      autoRenew: true,
      transactions: [
        { descEl: 'Αναπλήρωση Plus', descEn: 'Plus Top-up', date: '2026-04-01', amount: 110 },
        { descEl: 'Παραγγελία #FP-260401', descEn: 'Order #FP-260401', date: '2026-04-03', amount: -18.50 },
        { descEl: 'Παραγγελία #FP-260405', descEn: 'Order #FP-260405', date: '2026-04-05', amount: -13.10 },
      ],
    },
    orders: [
      { id: 'FP-260405', date: '2026-04-05', status: 'Παραδόθηκε', total: 13.10 },
      { id: 'FP-260401', date: '2026-04-01', status: 'Παραδόθηκε', total: 18.50 },
    ],
  },
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoading: false,
  authError: null,
  authTab: 'login',

  setUser: (user) => set({ user }),
  setAuthTab: (authTab) => set({ authTab, authError: null }),
  setError: (authError) => set({ authError }),

  login: async (email, password) => {
    set({ isLoading: true, authError: null })
    // Simulate network latency — replace with Supabase signIn (WEC-13)
    await new Promise((r) => setTimeout(r, 400))
    const mock = MOCK_USERS[email.toLowerCase()]
    if (mock && mock.password === password) {
      const { password: _p, ...user } = mock
      set({ user, isLoading: false })
      return true
    }
    set({ authError: 'Λάθος email ή κωδικός', isLoading: false })
    return false
  },

  logout: () => set({ user: null }),

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
