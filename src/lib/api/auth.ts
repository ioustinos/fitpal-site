import { supabase } from '../supabase'
import type {
  Address,
  UserGoals,
  UserPrefs,
  FitpalUser,
  MacroRange,
} from '../../store/useAuthStore'

// ─── DB row shapes ───────────────────────────────────────────────────────────

interface DbProfile {
  id: string
  name: string | null
  name_en: string | null
  phone: string | null
  avatar_url: string | null
  dietician: string | null
  dietary_notes: string | null
}

interface DbAddress {
  id: string
  user_id: string
  label_el: string
  label_en: string
  street: string
  area: string
  zip: string | null
  floor: string | null
  doorbell: string | null
  notes: string | null
  lat: number | null
  lng: number | null
  is_default: boolean
  sort_order: number
}

interface DbUserGoals {
  user_id: string
  enabled: boolean
  cal_min: number | null
  cal_max: number | null
  protein_min: number | null
  protein_max: number | null
  carbs_min: number | null
  carbs_max: number | null
  fat_min: number | null
  fat_max: number | null
}

interface DbUserPrefs {
  user_id: string
  payment_method: string | null
  cutlery: boolean
  invoice: boolean
  vegetarian: boolean
  gluten_free: boolean
  low_carb: boolean
  lang: string | null
  newsletter: boolean
  only_admin_orders: boolean
  goal_tracking: boolean
}

interface DbDayPref {
  user_id: string
  day_of_week: number        // 1–5 (Mon–Fri)
  address_id: string | null
  time_from: string | null   // HH:MM:SS
  time_to: string | null
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

const toMacroRange = (min: number | null, max: number | null): MacroRange | undefined => {
  if (min == null && max == null) return undefined
  return { min: min ?? undefined, max: max ?? undefined }
}

/** Format time fields "HH:MM:SS" → "H:MM–H:MM" display string */
const fmtTimeSlot = (from: string | null, to: string | null): string | undefined => {
  if (!from || !to) return undefined
  const f = from.split(':').slice(0, 2)
  const t = to.split(':').slice(0, 2)
  return `${parseInt(f[0])}:${f[1]}–${parseInt(t[0])}:${t[1]}`
}

const toAddress = (row: DbAddress): Address => ({
  id: row.id,
  labelEl: row.label_el,
  labelEn: row.label_en,
  street: row.street,
  area: row.area,
  zip: row.zip ?? undefined,
  floor: row.floor ?? undefined,
  doorbell: row.doorbell ?? undefined,
  notes: row.notes ?? undefined,
})

const toGoals = (row: DbUserGoals): UserGoals => ({
  enabled: row.enabled,
  calories: toMacroRange(row.cal_min, row.cal_max),
  protein: toMacroRange(row.protein_min, row.protein_max),
  carbs: toMacroRange(row.carbs_min, row.carbs_max),
  fat: toMacroRange(row.fat_min, row.fat_max),
})

const toPrefs = (
  row: DbUserPrefs,
  dayPrefs: DbDayPref[],
): UserPrefs => {
  const slots: Record<number, string> = {}
  const dayAddress: Record<number, string> = {}

  for (const dp of dayPrefs) {
    const dayIdx = dp.day_of_week - 1 // DB is 1-based (Mon=1), frontend is 0-based
    const slot = fmtTimeSlot(dp.time_from, dp.time_to)
    if (slot) slots[dayIdx] = slot
    if (dp.address_id) dayAddress[dayIdx] = dp.address_id
  }

  return {
    paymentMethod: row.payment_method ?? undefined,
    cutlery: row.cutlery,
    invoice: row.invoice,
    vegetarian: row.vegetarian,
    glutenFree: row.gluten_free,
    lowCarb: row.low_carb,
    slots: Object.keys(slots).length > 0 ? slots : undefined,
    dayAddress: Object.keys(dayAddress).length > 0 ? dayAddress : undefined,
    lang: row.lang ?? undefined,
    newsletter: row.newsletter,
    goalTracking: row.goal_tracking,
  }
}

// ─── Auth actions ────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<{
  data: { userId: string } | null
  error: string | null
}> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { data: null, error: error.message }
  return { data: { userId: data.user.id }, error: null }
}

export async function signUp(email: string, password: string, name?: string): Promise<{
  data: { userId: string } | null
  error: string | null
}> {
  // Override the Supabase project's Site URL per-call so confirmation emails
  // from the new ordering platform land back on the *new* site's origin
  // (localhost:8888 / dev--fitpal-order.netlify.app / fitpal-order.netlify.app)
  // instead of the legacy admin.fitpal.gr (which is the default Site URL and
  // needs to stay there for the legacy admin project). The origin passed here
  // must be present in the project's Additional Redirect URLs allowlist.
  const emailRedirectTo =
    typeof window !== 'undefined' ? window.location.origin : undefined

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo,
    },
  })
  if (error) return { data: null, error: error.message }
  if (!data.user) return { data: null, error: 'Signup failed — no user returned' }
  return { data: { userId: data.user.id }, error: null }
}

export async function signOut(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut()
  return { error: error?.message ?? null }
}

export async function getSession(): Promise<{
  data: { userId: string; email: string } | null
  error: string | null
}> {
  const { data, error } = await supabase.auth.getSession()
  if (error) return { data: null, error: error.message }
  if (!data.session?.user) return { data: null, error: null }
  return {
    data: {
      userId: data.session.user.id,
      email: data.session.user.email ?? '',
    },
    error: null,
  }
}

// ─── User data fetchers ──────────────────────────────────────────────────────

export async function fetchProfile(userId: string): Promise<{
  data: { name: string; nameEn?: string; email: string; phone?: string } | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, name_en, phone, avatar_url')
    .eq('id', userId)
    .single()

  if (error) return { data: null, error: error.message }
  const row = data as DbProfile

  // Get email from auth session
  const { data: session } = await supabase.auth.getSession()
  const email = session?.session?.user?.email ?? ''

  return {
    data: {
      name: row.name ?? '',
      nameEn: row.name_en ?? undefined,
      email,
      phone: row.phone ?? undefined,
    },
    error: null,
  }
}

export async function fetchAddresses(userId: string): Promise<{
  data: Address[] | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order')

  if (error) return { data: null, error: error.message }
  return { data: (data as DbAddress[]).map(toAddress), error: null }
}

export async function fetchGoals(userId: string): Promise<{
  data: UserGoals | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('user_goals')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: toGoals(data as DbUserGoals), error: null }
}

export async function fetchPrefs(userId: string): Promise<{
  data: UserPrefs | null
  error: string | null
}> {
  const { data: prefsRow, error: prefsErr } = await supabase
    .from('user_prefs')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (prefsErr) return { data: null, error: prefsErr.message }

  const { data: dayPrefsRows, error: dpErr } = await supabase
    .from('user_day_prefs')
    .select('*')
    .eq('user_id', userId)

  if (dpErr) return { data: null, error: dpErr.message }

  return {
    data: toPrefs(prefsRow as DbUserPrefs, (dayPrefsRows ?? []) as DbDayPref[]),
    error: null,
  }
}

// ─── Profile mutations ──────────────────────────────────────────────────────

export async function updateProfile(
  userId: string,
  patch: { name?: string; phone?: string },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.phone !== undefined && { phone: patch.phone }),
    })
    .eq('id', userId)

  return { error: error?.message ?? null }
}

// ─── Address mutations ──────────────────────────────────────────────────────

export async function insertAddress(
  userId: string,
  addr: Omit<Address, 'id'>,
): Promise<{ data: Address | null; error: string | null }> {
  const { data, error } = await supabase
    .from('addresses')
    .insert({
      user_id: userId,
      label_el: addr.labelEl,
      label_en: addr.labelEn,
      street: addr.street,
      area: addr.area,
      zip: addr.zip ?? null,
      floor: addr.floor ?? null,
      doorbell: addr.doorbell ?? null,
      notes: addr.notes ?? null,
    })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: toAddress(data as DbAddress), error: null }
}

export async function updateAddress(
  addrId: string,
  patch: Omit<Address, 'id'>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('addresses')
    .update({
      label_el: patch.labelEl,
      label_en: patch.labelEn,
      street: patch.street,
      area: patch.area,
      zip: patch.zip ?? null,
      floor: patch.floor ?? null,
      doorbell: patch.doorbell ?? null,
      notes: patch.notes ?? null,
    })
    .eq('id', addrId)

  return { error: error?.message ?? null }
}

export async function deleteAddress(addrId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('addresses')
    .delete()
    .eq('id', addrId)

  return { error: error?.message ?? null }
}

// ─── Preferences mutations ──────────────────────────────────────────────────

// NOTE (WEC-141): Language persistence now flows through savePrefs (user saves
// the full prefs form from Account → Preferences). The old narrow saveLangPref
// helper that fired on every header toggle was removed — the header toggle is
// session-only to avoid surprise cross-device changes.

export async function savePrefs(
  userId: string,
  prefs: UserPrefs,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_prefs')
    .update({
      payment_method: prefs.paymentMethod ?? 'cash',
      cutlery: prefs.cutlery ?? false,
      invoice: prefs.invoice ?? false,
      vegetarian: prefs.vegetarian ?? false,
      gluten_free: prefs.glutenFree ?? false,
      low_carb: prefs.lowCarb ?? false,
      lang: prefs.lang ?? 'el',
      newsletter: prefs.newsletter ?? true,
      goal_tracking: prefs.goalTracking ?? false,
    })
    .eq('user_id', userId)

  if (error) return { error: error.message }

  // Upsert day prefs (slots + dayAddress)
  const dayRows: Array<{
    user_id: string
    day_of_week: number
    address_id: string | null
    time_from: string | null
    time_to: string | null
  }> = []

  for (let i = 0; i < 5; i++) {
    const slot = prefs.slots?.[i]
    const addrId = prefs.dayAddress?.[i]
    // Only upsert if there's data for this day
    if (slot || addrId) {
      let timeFrom: string | null = null
      let timeTo: string | null = null
      if (slot) {
        // Parse "H:MM–H:MM" or "HH:MM–HH:MM"
        const parts = slot.split('–')
        if (parts.length === 2) {
          timeFrom = parts[0].trim() + ':00'
          timeTo = parts[1].trim() + ':00'
        }
      }
      dayRows.push({
        user_id: userId,
        day_of_week: i + 1, // DB is 1-based
        address_id: addrId || null,
        time_from: timeFrom,
        time_to: timeTo,
      })
    }
  }

  if (dayRows.length > 0) {
    const { error: dpErr } = await supabase
      .from('user_day_prefs')
      .upsert(dayRows, { onConflict: 'user_id,day_of_week' })

    if (dpErr) return { error: dpErr.message }
  }

  // Delete day prefs for days that no longer have data
  for (let i = 0; i < 5; i++) {
    if (!prefs.slots?.[i] && !prefs.dayAddress?.[i]) {
      await supabase
        .from('user_day_prefs')
        .delete()
        .eq('user_id', userId)
        .eq('day_of_week', i + 1)
    }
  }

  return { error: null }
}

// ─── Goals mutations ────────────────────────────────────────────────────────

export async function saveGoals(
  userId: string,
  goals: UserGoals,
): Promise<{ error: string | null }> {
  const range = (r?: number | MacroRange) => {
    if (!r || typeof r === 'number') return { min: null, max: null }
    return { min: r.min ?? null, max: r.max ?? null }
  }
  const cal = range(goals.calories)
  const pro = range(goals.protein)
  const carb = range(goals.carbs)
  const fat = range(goals.fat)

  const { error } = await supabase
    .from('user_goals')
    .update({
      enabled: goals.enabled ?? false,
      cal_min: cal.min,
      cal_max: cal.max,
      protein_min: pro.min,
      protein_max: pro.max,
      carbs_min: carb.min,
      carbs_max: carb.max,
      fat_min: fat.min,
      fat_max: fat.max,
    })
    .eq('user_id', userId)

  return { error: error?.message ?? null }
}

/**
 * Fetch the full user profile bundle — everything needed after login.
 * Runs all queries in parallel for speed.
 *
 * Does NOT include `id`, `wallet`, `orders`, `isAdmin`, `adminRole` — those
 * are supplied by the caller (buildFullUser in useAuthStore) which knows the
 * user id and fetches wallet / orders / admin status in parallel with this.
 */
export async function fetchFullUser(userId: string): Promise<{
  data: Omit<FitpalUser, 'id' | 'wallet' | 'orders' | 'isAdmin' | 'adminRole'> | null
  error: string | null
}> {
  const [profileRes, addressRes, goalsRes, prefsRes] = await Promise.all([
    fetchProfile(userId),
    fetchAddresses(userId),
    fetchGoals(userId),
    fetchPrefs(userId),
  ])

  // Any critical failure
  if (profileRes.error) return { data: null, error: profileRes.error }

  return {
    data: {
      name: profileRes.data!.name,
      nameEn: profileRes.data!.nameEn,
      email: profileRes.data!.email,
      phone: profileRes.data!.phone,
      addresses: addressRes.data ?? [],
      goals: goalsRes.data ?? {},
      prefs: prefsRes.data ?? {},
    },
    error: null,
  }
}
