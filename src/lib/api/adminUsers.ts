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
    // WEC-419: drafts don't count as orders for the users-list stats.
    supabase
      .from('orders')
      .select('user_id, total, payment_status')
      .in('user_id', ids)
      .neq('status', 'draft'),
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
      .select('payment_method, cutlery, invoice, lang, newsletter, only_admin_orders, goal_tracking')
      .eq('user_id', userId).maybeSingle(),
    supabase.from('wallets')
      .select('id, active_plan_id, balance, base_balance, bonus_balance, auto_renew, next_renewal, active, admin_managed')
      .eq('user_id', userId).maybeSingle(),
    // WEC-419: drafts hidden from the user-detail orders list + lifetime stats.
    supabase.from('orders')
      .select('id, order_number, total, status, payment_status, payment_method, created_at')
      .eq('user_id', userId).neq('status', 'draft')
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('orders')
      .select('total, payment_status')
      .eq('user_id', userId).neq('status', 'draft'),
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

/**
 * WEC-516: toggle `wallets.active` — the spendable gate (separate from balance).
 * Admin-managed / manually-funded wallets can hold a balance while active=false
 * (unusable at checkout / greyed as "Χωρίς wallet" during impersonation). This
 * is the admin control to switch a wallet on/off. Direct update via admin RLS
 * (admin_all_wallets), plus a fail-soft audit entry.
 */
export async function setWalletActive(
  userId: string,
  active: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('wallets')
    .update({ active })
    .eq('user_id', userId)
  if (error) return { error: error.message }
  try {
    const { data: session } = await supabase.auth.getSession()
    await supabase.from('admin_change_log').insert({
      table_name: 'wallets',
      field_name: 'active',
      old_value: String(!active),
      new_value: String(active),
      label: `Wallet ${active ? 'activated' : 'deactivated'} (admin)`,
      admin_user: session?.session?.user?.id ?? null,
    })
  } catch { /* audit is non-fatal; the toggle already committed */ }
  return { error: null }
}

/**
 * Grant a wallet credit (refund / gift / adjustment) to a customer.
 *
 * Hits /api/admin-grant-wallet-credit which (a) verifies admin via JWT,
 * (b) calls the atomic public.wallet_admin_credit RPC, (c) writes audit
 * log. Creates the wallet row if the customer doesn't have one.
 *
 * Amounts are passed in cents (we don't trust the client to do the
 * conversion). Server caps at €500 — for larger one-offs do via SQL.
 */
export type WalletGrantType = 'refund' | 'gift' | 'adjustment'

export interface GrantWalletCreditResult {
  data: {
    transactionId: string | null
    newBalanceCents: number | null
    newBaseBalanceCents: number | null
    newBonusBalanceCents: number | null
  } | null
  error: string | null
}

export async function grantWalletCredit(args: {
  targetUserId: string
  amountCents: number
  type: WalletGrantType
  descriptionEl: string
  descriptionEn: string
}): Promise<GrantWalletCreditResult> {
  try {
    const { data: session } = await supabase.auth.getSession()
    const token = session?.session?.access_token
    if (!token) return { data: null, error: 'Not signed in' }

    // Hit the direct function path (the /api/* rewrite has known dev-mode
    // hiccups; see WEC-188 / netlify.toml notes). Production unaffected.
    const res = await fetch('/.netlify/functions/admin-grant-wallet-credit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    })
    const json = await res.json()
    if (!res.ok) {
      const message = [json?.error, json?.detail].filter(Boolean).join(' — ')
      return { data: null, error: message || `Grant failed (${res.status})` }
    }
    return {
      data: {
        transactionId: json.transactionId ?? null,
        newBalanceCents: json.newBalanceCents ?? null,
        newBaseBalanceCents: json.newBaseBalanceCents ?? null,
        newBonusBalanceCents: json.newBonusBalanceCents ?? null,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  WEC-770 · Create a customer on their behalf
 *
 *  The team takes orders by phone from people who have never used the site.
 *  Before this they had to ask Ioustinos to insert rows by hand.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface NewCustomerInput {
  email: string
  name?: string
  phone?: string
  address?: {
    street?: string
    area?: string
    zip?: string
    floor?: string
    doorbell?: string
    notes?: string
  }
}

export interface NewCustomerResult {
  userId: string | null
  error: string | null
  /** Set when the email already belongs to a customer, so the UI can offer
   *  to jump to them instead of just refusing. */
  existingUserId?: string
  existingName?: string | null
}

export async function createAdminCustomer(input: NewCustomerInput): Promise<NewCustomerResult> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) return { userId: null, error: 'Not signed in' }

  // Direct function path, not /api/* — same reason as impersonation: under
  // `netlify dev --offline` Vite's SPA fallback swallows /api/* and hands back
  // index.html. Production is unaffected either way.
  const res = await fetch('/.netlify/functions/admin-create-customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      userId: null,
      error: json?.error ?? `Failed (${res.status})`,
      existingUserId: json?.existingUserId,
      existingName: json?.existingName ?? null,
    }
  }
  return { userId: json.userId as string, error: null }
}

/**
 * Invite a customer created by an admin.
 *
 * Reuses the site's existing OTP / magic-link login email rather than a
 * password-reset mail: the customer never had a password, so "reset your
 * password" would be nonsense to them. This is the same bilingual email the
 * normal login flow sends, already delivering through Brevo.
 */
export async function sendCustomerInvite(email: string, name?: string): Promise<{ ok: boolean; error?: string }> {
  const { sendEmailOtp } = await import('./auth')
  return sendEmailOtp(email, name)
}


/* ────────────────────────────────────────────────────────────────────────────
 *  WEC-783 · Ops-facing subscription dates
 *
 *  «Ενεργή έως» and a free-text note, so the team can record things like
 *  «παύση 12–19/10, παράταση 1 εβδομάδα» and know at a glance who is away.
 *
 *  ⚠️ INFORMATIONAL ONLY. Ioustinos, 17/09: «αν θελήσει ο πελάτης να φάει
 *  νωρίτερα δεν θα πρέπει να υπάρχει blocker». Nothing reads these columns to
 *  allow or deny an order — wallet_debit_for_order checks the wallet and the
 *  balance, nothing else. A date in the past changes nothing.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * WEC-811 · Subscription lifecycle status (admin-controlled).
 * Independent of payment_status. Cancelling deactivates the owning wallet
 * (wallets.active=false) — a flag only, NO refund and the balance is left as
 * is. active_plan_id is intentionally kept so the cancelled plan stays visible
 * and reversible here. Reactivating flips wallets.active back to true.
 */
export async function setWalletPlanStatus(
  planId: string, next: 'active' | 'cancelled', adminEmail: string,
): Promise<{ error: string | null }> {
  const { data: before } = await supabase
    .from('wallet_plans').select('status, wallet_id').eq('id', planId).maybeSingle()
  const prev = (before ?? {}) as { status?: string; wallet_id?: string | null }
  if (prev.status === next) return { error: null }

  const { error } = await supabase.from('wallet_plans').update({ status: next }).eq('id', planId)
  if (error) return { error: error.message }

  // Deactivate / reactivate the owning wallet flag. active_plan_id is NOT
  // cleared — nulling it would hide the plan from this panel and make it
  // un-reversible. No balance change, no refund.
  //
  // WEC-812 fix: a wallet can own MULTIPLE plans (e.g. renewals / duplicates).
  // The shared wallets.active flag must reflect whether ANY plan is still
  // active — NOT the single plan just toggled. The old `active: next==='active'`
  // meant cancelling one stale/duplicate plan deactivated a wallet that still
  // had a live subscription, silently disabling a real customer's wallet
  // (Μαρία Τσούνη: 3 duplicates cancelled → wallet off despite an active plan).
  if (prev.wallet_id) {
    const { data: activePlans } = await supabase
      .from('wallet_plans')
      .select('id')
      .eq('wallet_id', prev.wallet_id)
      .eq('status', 'active')
      .limit(1)
    const walletShouldBeActive = (activePlans?.length ?? 0) > 0
    const { error: wErr } = await supabase.from('wallets')
      .update({ active: walletShouldBeActive }).eq('id', prev.wallet_id)
    if (wErr) console.warn('[setWalletPlanStatus] wallet active flag failed:', wErr.message)
  }

  const { error: logErr } = await supabase.from('admin_change_log').insert({
    table_name: 'wallet_plans', field_name: 'status',
    old_value: String(prev.status ?? 'active'), new_value: next,
    label: `WEC-811 subscription status \u00b7 plan ${planId}`, admin_user: adminEmail,
  })
  if (logErr) console.warn('[setWalletPlanStatus] change log failed:', logErr.message)
  return { error: null }
}

export async function saveWalletPlanOpsFields(
  planId: string,
  patch: { activeUntil?: string | null; adminNote?: string | null },
  adminEmail: string,
): Promise<{ error: string | null }> {
  // Read first so the change log records what it actually replaced rather than
  // an assumed previous value.
  const { data: before } = await supabase
    .from('wallet_plans')
    .select('active_until, admin_note')
    .eq('id', planId)
    .maybeSingle()

  const payload: Record<string, unknown> = {}
  if (patch.activeUntil !== undefined) payload.active_until = patch.activeUntil || null
  if (patch.adminNote !== undefined) payload.admin_note = patch.adminNote || null
  if (Object.keys(payload).length === 0) return { error: null }

  const { error } = await supabase.from('wallet_plans').update(payload).eq('id', planId)
  if (error) return { error: error.message }

  // Provenance — «who moved this date» must be answerable. Best-effort: a
  // failed log entry is not worth failing the save the admin just made.
  const prev = (before ?? {}) as { active_until?: string | null; admin_note?: string | null }
  const rows = Object.entries(payload).map(([field, value]) => ({
    table_name: 'wallet_plans',
    field_name: field,
    old_value: String((prev as Record<string, unknown>)[field] ?? ''),
    new_value: String(value ?? ''),
    label: 'WEC-783 subscription ops fields',
    admin_user: adminEmail,
  }))
  const { error: logErr } = await supabase.from('admin_change_log').insert(rows)
  if (logErr) console.warn('[saveWalletPlanOpsFields] change log failed:', logErr.message)

  return { error: null }
}
