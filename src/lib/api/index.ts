// ─── Fitpal API Layer ────────────────────────────────────────────────────────
// Centralised Supabase query functions.
// All modules return { data, error } — no exceptions thrown.
// Money converts from DB cents → frontend euros at the boundary.

export {
  fetchCategories,
  fetchActiveMenu,
  fetchActiveWeeksMeta,
  fetchWeekDishes,
  fetchDishesForDay,
  type WeekMeta,
} from './menu'

export {
  signIn,
  signUp,
  signOut,
  getSession,
  fetchProfile,
  fetchAddresses,
  fetchGoals,
  fetchPrefs,
  fetchFullUser,
} from './auth'

export {
  fetchUserOrders,
  submitOrder,
  type SubmitOrderPayload,
  type SubmitDayPayload,
  type SubmitItemPayload,
  type OrderHistoryItem,
  type ChildOrderView,
  type OrderItemView,
} from './orders'

export {
  fetchWallet,
  fetchTransactions,
} from './wallet'

export {
  validateVoucher,
  type VoucherResult,
} from './vouchers'
