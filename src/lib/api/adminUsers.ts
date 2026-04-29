import { supabase } from '../supabase'

/**
 * Users admin API.
 *
 * The list endpoint joins profiles + wallets + a count of orders per user,
 * pulled in parallel and stitched client-side. We do NOT expose auth.users
 * directly — admin RLS reads `profiles` (which extends auth.users 1:1) and
 * derives email from there. Email is captured into profiles by the signup
 * trigger.
 *
 * Detail endpoint returns the full picture: profile, addresses, goals,
 * prefs, wallet (incl. plan), recent orders, and the new admin_managed flag.
 */

export interface AdminUserRow {
  userId: string
  email: string
  name: string
  phone: string | null
  ordersCount: number
  totalSpent: number    // cents
  walletBalance: number // cents (0 if no wallet)
  walletActive: boolean
  walletAdminManaged: boolean
  isAdmin: boolean
  createdAt: string
}

export interface AdminUserDetail extends AdminUserRow {
  nameEn: string | null
  dietician: string | null
  dietaryNotes: string | null
  avatarUrl: string | null
  addresses: Array<{
    id: string; labelEl: string; labelEn: string; street: string;
    area: string; zip: string | null; isDefault: boolean
  }>
  goals: {
    enabled: boolean
    calMin: number | null; calMax: number | null
    proteinMin: number | null; proteinMax: number | null
    carbsMin: number | null; carbsMax: number | null
    fatMin: number | null; fatMax: number | null
  } | null
  prefs: {
    paymentMethod: string | null; cutlery: boolean; invoice: boolean
    vegetarian: boolean; glutenFree: boolean; lowCarb: boolean
    lang: string | null; newsletter: boolean; onlyAdminOrders: boolean
    goalTracking: boolean
  } | null
  walletDetail: {
    id: string; planId: string | null; balance: number; baseBalance: number
    bonusBalance: number; autoRenew: boolean; nextRenewal: string | null
    active: boolean; adminManaged: boolean
  } | null
  recentOrders: Array<{
    id: string; orderNumber: string; total: number; status: string
    paymentStatus: string; paymentMethod: string; createdAt: string
  }>
}

/**
 * List users with high-level summary. Pages of 50.
 * Search is matched against email + name (case-insensitive).
 */
export async function fetchAdminUsers(opts?: {
  search?: string; limit?: number; offset?: number
}): Promise<{ data: AdminUserRow[]; total: number; error: string | null }> {
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0
  const search = opts?.search?.trim() ?? ''

  // Profiles is the source of truth for email + name.
  let q = supabase
    .from('profiles')
    .select('id, email, name, phone, created_at', { count: 'exact' })

  if (search) {
    // Match against email or name. Postgres `ilike` is case-insensitive.
    q = q.or(`email.ilike.%${search}%,name.ilike.%${search}%`)
  }

  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

  const { data: profiles, count, error } = await q
  if (error) return { data: [], total: 0, error: error.message }
  if (!profiles || profiles.length === 0) return { data: [], total: count ?? 0, error: null }

  const ids = profiles.map((p) => (p as { id: string }).id)

  // Parallel fetches: orders (count + sum), wallets, admin_users.
  const [ordersRes, walletsRes, adminsRes] = await Promise.all([
    supabase
      .from('orders')
      .select('user_id, total, payment_status')
      .in('user_id', ids),
    supabase
      .from('wallets')
      .select('user_id, balance, active, admin_managed')
      .in('user_id', ids),
    supabase
      .from('admin_users')
      .select('user_id')
      .in('user_id', ids),
  ])

  // Bucket orders by user_id.
  const orderStats = new Map<string, { count: number; total: number }>()
  for (const o of (ordersRes.data ?? []) as Array<{ user_id: string; total: number; payment_status: string }>) {
    const cur = orderStats.get(o.user_id) ?? { count: 0, total: 0 }
    cur.count += 1
    if (o.payment_status === 'paid') cur.total += (o.total ?? 0)
    orderStats.set(o.user_id, cur)
  }

  const walletByUser = new Map<string, { balance: number; active: boolean; adminManaged: boolean }>()
  for (const w of (walletsRes.data ?? []) as Array<{
    user_id: string; balance: number; active: boolean; admin_managed: boolean | null
  }>) {
    walletByUser.set(w.user_id, {
      balance: w.balance ?? 0,
      active: w.active ?? false,
      adminManaged: w.admin_managed ?? false,
    })
  }

  const adminSet = new Set<string>(
    ((adminsRes.data ?? []) as Array<{ user_id: string }>).map((a) => a.user_id),
  )

  const rows: AdminUserRow[] = profiles.map((p) => {
    const r = p as { id: string; email: string | null; name: string | null; phone: string | null; created_at: string }
    const stats = orderStats.get(r.id) ?? { count: 0, total: 0 }
    const wallet = walletByUser.get(r.id)
    return {
      userId: r.id,
      email: r.email ?? '',
      name: r.name ?? '',
      phone: r.phone,
      ordersCount: stats.count,
      totalSpent: stats.total,
      walletBalance: wallet?.balance ?? 0,
      walletActive: wallet?.active ?? false,
      walletAdminManaged: wallet?.adminManaged ?? false,
      isAdmin: adminSet.has(r.id),
      createdAt: r.created_at,
    }
  })

  return { data: rows, total: count ?? rows.length, error: null }
}

export async function fetchAdminUserDetail(userId: string): Promise<{
  data: AdminUserDetail | null; error: string | null
}> {
  const [
    profileRes, addrRes, goalsRes, prefsRes, walletRes,
    ordersRes, ordersAggRes, adminsRes,
  ] = await Promise.all([
    supabase.from('profiles')
      .select('id, email, name, name_en, phone, avatar_url, dietician, dietary_notes, created_at')
      .eq('id', userId).maybeSingle(),
    supabase.from('addresses')
      .select('id, label_el, label_en, street, area, zip, is_default')
      .eq('user_id', userId).order('sort_order', { ascending: true }),
    supabase.from('user_goals')
      .select('enabled, cal_min, cal_max, protein_min, protein_max, carbs_min, carbs_max, fat_min, fat_max')
      .eq('user_id', userId).maybeSingle(),
    supabase.from('user_prefs')
      .select('payment_method, cutlery, invoice, vegetarian, gluten_free, low_carb, lang, newsletter, only_admin_orders, goal_tracking')
      .eq('user_id', userId).maybeSingle(),
    supabase.from('wallets')
      .select('id, active_plan_id, balance, base_balance, bonus_balance, auto_renew, next_renewal, active, admin_managed')
      .eq('user_id', userId).maybeSingle(),
    supabase.from('orders')
      .select('id, order_number, total, status, payment_status, payment_method, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('orders')
      .select('total, payment_status')
      .eq('user_id', userId),
    supabase.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle(),
  ])

  if (profileRes.error || !profileRes.data) {
    return { data: null, error: profileRes.error?.message ?? 'User not found' }
  }

  const p = profileRes.data as {
    id: string; email: string | null; name: string | null; name_en: string | null
    phone: string | null; avatar_url: string | null; dietician: string | null
    dietary_notes: string | null; created_at: string
  }

  const ordersAll = (ordersAggRes.data ?? []) as Array<{ total: number; payment_status: string }>
  const totalSpent = ordersAll.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + (o.total ?? 0), 0)

  const w = walletRes.data as null | {
    id: string; active_plan_id: string | null; balance: number; base_balance: number
    bonus_balance: number; auto_renew: boolean; next_renewal: string | null
    active: boolean; admin_managed: boolean | null
  }

  const detail: AdminUserDetail = {
    userId: p.id,
    email: p.email ?? '',
    name: p.name ?? '',
    phone: p.phone,
    nameEn: p.name_en,
    avatarUrl: p.avatar_url,
    dietician: p.dietician,
    dietaryNotes: p.dietary_notes,
    createdAt: p.created_at,
    ordersCount: ordersAll.length,
    totalSpent,
    walletBalance: w?.balance ?? 0,
    walletActive: w?.active ?? false,
    walletAdminManaged: w?.admin_managed ?? false,
    isAdmin: !!adminsRes.data,
    addresses: ((addrRes.data ?? []) as Array<{
      id: string; label_el: string; label_en: string; street: string; area: string;
      zip: string | null; is_default: boolean
    }>).map((a) => ({
      id: a.id, labelEl: a.label_el, labelEn: a.label_en, street: a.street,
      area: a.area, zip: a.zip, isDefault: a.is_default,
    })),
    goals: goalsRes.data ? {
      enabled: (goalsRes.data as { enabled: boolean }).enabled,
      calMin: (goalsRes.data as { cal_min: number | null }).cal_min,
      calMax: (goalsRes.data as { cal_max: number | null }).cal_max,
      proteinMin: (goalsRes.data as { protein_min: number | null }).protein_min,
      proteinMax: (goalsRes.data as { protein_max: number | null }).protein_max,
      carbsMin: (goalsRes.data as { carbs_min: number | null }).carbs_min,
      carbsMax: (goalsRes.data as { carbs_max: number | null }).carbs_max,
      fatMin: (goalsRes.data as { fat_min: number | null }).fat_min,
      fatMax: (goalsRes.data as { fat_max: number | null }).fat_max,
    } : null,
    prefs: prefsRes.data ? {
      paymentMethod: (prefsRes.data as { payment_method: string | null }).payment_method,
      cutlery: (prefsRes.data as { cutlery: boolean }).cutlery,
      invoice: (prefsRes.data as { invoice: boolean }).invoice,
      vegetarian: (prefsRes.data as { vegetarian: boolean }).vegetarian,
      glutenFree: (prefsRes.data as { gluten_free: boolean }).gluten_free,
      lowCarb: (prefsRes.data as { low_carb: boolean }).low_carb,
      lang: (prefsRes.data as { lang: string | null }).lang,
      newsletter: (prefsRes.data as { newsletter: boolean }).newsletter,
      onlyAdminOrders: (prefsRes.data as { only_admin_orders: boolean }).only_admin_orders,
      goalTracking: (prefsRes.data as { goal_tracking: boolean }).goal_tracking,
    } : null,
    walletDetail: w ? {
      id: w.id, planId: w.active_plan_id, balance: w.balance,
      baseBalance: w.base_balance, bonusBalance: w.bonus_balance,
      autoRenew: w.auto_renew, nextRenewal: w.next_renewal, active: w.active,
      adminManaged: w.admin_managed ?? false,
    } : null,
    recentOrders: ((ordersRes.data ?? []) as Array<{
      id: string; order_number: string; total: number; status: string;
      payment_status: string; payment_method: string; created_at: string
    }>).map((o) => ({
      id: o.id, orderNumber: o.order_number, total: o.total, status: o.status,
      paymentStatus: o.payment_status, paymentMethod: o.payment_method,
      createdAt: o.created_at,
    })),
  }

  return { data: detail, error: null }
}

/**
 * Update admin-only fields on a user's profile.
 * Owner can also flip is_admin via separate route (not exposed here).
 */
export async function saveAdminUserNotes(
  userId: string,
  patch: { dietician?: string | null; dietaryNotes?: string | null },
): Promise<{ error: string | null }> {
  const payload: Record<string, unknown> = {}
  if (patch.dietician !== undefined) payload.dietician = patch.dietician
  if (patch.dietaryNotes !== undefined) payload.dietary_notes = patch.dietaryNotes

  const { error } = await supabase.from('profiles').update(payload).eq('id', userId)
  return { error: error?.message ?? null }
}

/**
 * Toggle the `admin_managed` flag on a user's wallet. When true, customer-side
 * checkout hides the wallet payment option and only impersonating admins can
 * spend it. Used for the "curator-managed subscription" service tier.
 */
export async function setWalletAdminManaged(
  userId: string,
  adminManaged: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('wallets')
    .update({ admin_managed: adminManaged })
    .eq('user_id', userId)
  return { error: error?.message ?? null }
}
