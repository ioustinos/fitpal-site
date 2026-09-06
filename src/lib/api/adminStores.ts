/**
 * WEC-715 (B2B-7 — Admin: store CRUD): everything the admin panel needs to
 * create and run a company or reseller storefront without hand-written SQL.
 *
 * Part of WEC-649 «[EPIC] Company Portals & Reseller Portals».
 *
 * Admin writes go through the Supabase client under the `admin_all_*` RLS
 * policies, matching the rest of the admin panel (see CLAUDE.md; the migration
 * to service-role functions is tracked separately as WEC-121).
 */

import { supabase } from '../supabase'
import { isReservedSlug, SLUG_RE } from '../storefront/reserved'
import { purgeMenuCache, duplicateMenuContent } from './adminMenus'

export type StoreType = 'main' | 'company' | 'reseller'

export interface AdminStore {
  id: string
  slug: string
  type: StoreType
  nameEl: string
  nameEn: string
  logoUrl: string | null
  accentColor: string | null
  banner1El: string | null
  banner1En: string | null
  banner2El: string | null
  banner2En: string | null
  addressStreet: string | null
  addressArea: string | null
  addressZip: string | null
  addressFloor: string | null
  addressDoorbell: string | null
  addressNotes: string | null
  airtableStoreId: number | null
  isDefault: boolean
  active: boolean
  /** key → value, straight from `store_settings`. */
  settings: Record<string, unknown>
  /** Weekly menus owned by this store (id + dates), newest last. */
  menus: Array<{ id: string; name: string | null; fromDate: string; toDate: string; active: boolean }>
  memberCount: number
}

const STORE_COLS =
  'id, slug, type, name_el, name_en, logo_url, accent_color, banner_1_el, banner_1_en, banner_2_el, banner_2_en, ' +
  'address_street, address_area, address_zip, address_floor, address_doorbell, address_notes, ' +
  'airtable_store_id, is_default, active'

function mapStore(row: Record<string, unknown>): AdminStore {
  return {
    id: row.id as string,
    slug: row.slug as string,
    type: row.type as StoreType,
    nameEl: (row.name_el as string) ?? '',
    nameEn: (row.name_en as string) ?? '',
    logoUrl: (row.logo_url as string) ?? null,
    accentColor: (row.accent_color as string) ?? null,
    banner1El: (row.banner_1_el as string) ?? null,
    banner1En: (row.banner_1_en as string) ?? null,
    banner2El: (row.banner_2_el as string) ?? null,
    banner2En: (row.banner_2_en as string) ?? null,
    addressStreet: (row.address_street as string) ?? null,
    addressArea: (row.address_area as string) ?? null,
    addressZip: (row.address_zip as string) ?? null,
    addressFloor: (row.address_floor as string) ?? null,
    addressDoorbell: (row.address_doorbell as string) ?? null,
    addressNotes: (row.address_notes as string) ?? null,
    airtableStoreId: (row.airtable_store_id as number) ?? null,
    isDefault: !!row.is_default,
    active: !!row.active,
    settings: {},
    menus: [],
    memberCount: 0,
  }
}

/** Every store, with its settings, its own weekly menus and its member count. */
export async function fetchAdminStores(): Promise<{ data: AdminStore[] | null; error: string | null }> {
  const [storesRes, settingsRes, menusRes, membersRes] = await Promise.all([
    supabase.from('stores').select(STORE_COLS).order('is_default', { ascending: false }).order('slug'),
    supabase.from('store_settings').select('store_id, key, value'),
    supabase.from('weekly_menus').select('id, name, from_date, to_date, active, store_id').order('from_date'),
    supabase.from('store_members').select('store_id'),
  ])

  if (storesRes.error) return { data: null, error: storesRes.error.message }

  const stores = (storesRes.data ?? []).map((r) => mapStore(r as unknown as Record<string, unknown>))
  const byId = new Map(stores.map((s) => [s.id, s]))

  for (const r of (settingsRes.data ?? []) as Array<{ store_id: string; key: string; value: unknown }>) {
    const s = byId.get(r.store_id)
    if (s) s.settings[r.key] = r.value
  }
  for (const r of (menusRes.data ?? []) as Array<{ id: string; name: string | null; from_date: string; to_date: string; active: boolean; store_id: string | null }>) {
    const s = r.store_id ? byId.get(r.store_id) : null
    if (s) s.menus.push({ id: r.id, name: r.name, fromDate: r.from_date, toDate: r.to_date, active: r.active })
  }
  for (const r of (membersRes.data ?? []) as Array<{ store_id: string }>) {
    const s = byId.get(r.store_id)
    if (s) s.memberCount += 1
  }

  return { data: stores, error: null }
}

/**
 * Why a slug can be refused. Kept as a function rather than inline validation
 * so the same rules apply wherever a store is created — and so the message
 * says WHICH rule was broken instead of a generic "invalid".
 */
export function validateSlug(slug: string, existing: AdminStore[], selfId?: string): string | null {
  const s = slug.trim().toLowerCase()
  if (!s) return 'A slug is required — it becomes the store URL.'
  if (!SLUG_RE.test(s)) {
    return 'Use 2–41 characters: lowercase letters, numbers and hyphens, starting with a letter or number.'
  }
  if (isReservedSlug(s)) {
    return `"${s}" is a reserved word — it would shadow an existing page (orders.fitpal.gr/${s}). Pick another.`
  }
  if (existing.some((e) => e.slug === s && e.id !== selfId)) {
    return `"${s}" is already taken by another store.`
  }
  return null
}

export interface CreateStoreInput {
  slug: string
  type: 'company' | 'reseller'
  nameEl: string
  nameEn: string
  /** Copy the newest active retail week into the new store (Ioustinos, 2026-09-06). */
  cloneLatestMenu?: boolean
}

/**
 * Create a store. Optionally clones the newest active MAIN weekly menu into it,
 * which is what Ioustinos asked for on 2026-09-06: *"clone the last active
 * week's menu"*. It is a one-time copy, not inheritance — the new store owns
 * those rows outright and later edits to the retail menu never reach it.
 */
/**
 * WEC-743: next free Airtable store id.
 *
 * Retail is pinned at 9999, so portals count up from 9001. Assigned at CREATE
 * time rather than left blank, because blank is not a neutral state: the
 * Airtable push falls back to `RETAIL_STORE_ID` (9999), so a store without a
 * number files its orders into Airtable **as retail orders** — the kitchen sees
 * them, nobody sees they came from a company, and nothing errors.
 *
 * Ioustinos allocates from here and adds the matching Airtable row by hand
 * (his stated workflow: "you give an id and i add it on airtable for matching").
 */
export async function nextAirtableStoreId(): Promise<number> {
  const { data } = await supabase
    .from('stores')
    .select('airtable_store_id')
    .not('airtable_store_id', 'is', null)
    .lt('airtable_store_id', 9999)
    .order('airtable_store_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  const highest = (data as { airtable_store_id: number } | null)?.airtable_store_id ?? 9000
  return highest + 1
}

export async function createStore(
  input: CreateStoreInput,
): Promise<{ data: AdminStore | null; error: string | null; menuCloned: boolean }> {
  const slug = input.slug.trim().toLowerCase()
  const airtableStoreId = await nextAirtableStoreId()

  const { data: row, error } = await supabase
    .from('stores')
    .insert({
      slug,
      type: input.type,
      name_el: input.nameEl.trim() || slug,
      name_en: input.nameEn.trim() || input.nameEl.trim() || slug,
      airtable_store_id: airtableStoreId,
      active: true,
      is_default: false,
    })
    .select(STORE_COLS)
    .single()

  if (error) return { data: null, error: error.message, menuCloned: false }
  const store = mapStore(row as unknown as Record<string, unknown>)

  let menuCloned = false
  if (input.cloneLatestMenu !== false) {
    const res = await cloneLatestRetailWeek(store.id, store.nameEl)
    menuCloned = res.cloned
  }

  void purgeMenuCache()
  return { data: store, error: null, menuCloned }
}

/**
 * Copy the newest ACTIVE main-store weekly menu into `storeId`, same dates.
 * Fail-soft: a store with no menu is a visible, fixable state (the readiness
 * checklist flags it), whereas a failed create leaves nothing at all.
 */
export async function cloneLatestRetailWeek(
  storeId: string,
  storeName: string,
): Promise<{ cloned: boolean; error: string | null }> {
  const { data: mainStore } = await supabase.from('stores').select('id').eq('is_default', true).maybeSingle()
  if (!mainStore) return { cloned: false, error: 'No default store found' }

  const { data: src } = await supabase
    .from('weekly_menus')
    .select('id, name, from_date, to_date, category_order, inactive_dates')
    .eq('store_id', (mainStore as { id: string }).id)
    .eq('active', true)
    .order('from_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!src) return { cloned: false, error: 'No active retail week to clone' }
  const source = src as { id: string; name: string | null; from_date: string; to_date: string; category_order: string[] | null; inactive_dates: string[] | null }

  const { data: target, error: insErr } = await supabase
    .from('weekly_menus')
    .insert({
      name: `${source.name ?? source.from_date} — ${storeName}`,
      from_date: source.from_date,
      to_date: source.to_date,
      active: true,
      category_order: source.category_order,
      inactive_dates: source.inactive_dates ?? [],
      store_id: storeId,
    })
    .select('id')
    .single()

  if (insErr || !target) return { cloned: false, error: insErr?.message ?? 'clone failed' }

  const { error: dupErr } = await duplicateMenuContent(source.id, (target as { id: string }).id, 0)
  return { cloned: !dupErr, error: dupErr }
}

export interface SaveStorePatch {
  nameEl?: string
  nameEn?: string
  logoUrl?: string | null
  accentColor?: string | null
  banner1El?: string | null
  banner1En?: string | null
  banner2El?: string | null
  banner2En?: string | null
  addressStreet?: string | null
  addressArea?: string | null
  addressZip?: string | null
  addressFloor?: string | null
  addressDoorbell?: string | null
  addressNotes?: string | null
  airtableStoreId?: number | null
  active?: boolean
  type?: 'company' | 'reseller'
}

export async function saveStore(id: string, patch: SaveStorePatch): Promise<{ error: string | null }> {
  const row: Record<string, unknown> = {}
  const map: Record<keyof SaveStorePatch, string> = {
    nameEl: 'name_el', nameEn: 'name_en', logoUrl: 'logo_url', accentColor: 'accent_color',
    banner1El: 'banner_1_el', banner1En: 'banner_1_en', banner2El: 'banner_2_el', banner2En: 'banner_2_en',
    addressStreet: 'address_street', addressArea: 'address_area', addressZip: 'address_zip',
    addressFloor: 'address_floor', addressDoorbell: 'address_doorbell', addressNotes: 'address_notes',
    airtableStoreId: 'airtable_store_id', active: 'active', type: 'type',
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) row[map[k as keyof SaveStorePatch]] = v
  }
  if (Object.keys(row).length === 0) return { error: null }
  row.updated_at = new Date().toISOString()

  const { error } = await supabase.from('stores').update(row).eq('id', id)
  // The resolver endpoint is edge-cached under the 'stores' tag.
  void purgeMenuCache(['stores'])
  return { error: error?.message ?? null }
}

/** Upsert one per-store setting. Passing `null` removes the override. */
export async function setStoreSetting(
  storeId: string,
  key: string,
  value: unknown,
): Promise<{ error: string | null }> {
  if (value === null || value === undefined || value === '') {
    const { error } = await supabase.from('store_settings').delete().eq('store_id', storeId).eq('key', key)
    void purgeMenuCache(['stores', 'settings'])
    return { error: error?.message ?? null }
  }
  const { error } = await supabase
    .from('store_settings')
    .upsert({ store_id: storeId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'store_id,key' })
  void purgeMenuCache(['stores', 'settings'])
  return { error: error?.message ?? null }
}

// ─── Reseller members ───────────────────────────────────────────────────────

export interface StoreMember {
  userId: string
  email: string | null
  name: string | null
  createdAt: string
}

export async function fetchStoreMembers(storeId: string): Promise<{ data: StoreMember[] | null; error: string | null }> {
  // Two queries on purpose. `store_members.user_id` references auth.users, NOT
  // public.profiles, so PostgREST has no relationship to embed across — a
  // `profiles:user_id(...)` embed fails with "Could not find a relationship".
  // Resolving the profiles separately is the only shape that actually works.
  const { data, error } = await supabase
    .from('store_members')
    .select('user_id, created_at')
    .eq('store_id', storeId)
    .order('created_at')
  if (error) return { data: null, error: error.message }

  const rows = (data ?? []) as Array<{ user_id: string; created_at: string }>
  if (rows.length === 0) return { data: [], error: null }

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, name, email')
    .in('id', rows.map((r) => r.user_id))
  const byId = new Map(
    ((profs ?? []) as Array<{ id: string; name: string | null; email: string | null }>).map((p) => [p.id, p]),
  )

  return {
    data: rows.map((r) => {
      const p = byId.get(r.user_id)
      return {
        userId: r.user_id,
        email: p?.email ?? null,
        name: p?.name ?? null,
        createdAt: r.created_at,
      }
    }),
    error: null,
  }
}

/** Add a member by email. Refuses politely when no such customer exists. */
export async function addStoreMemberByEmail(storeId: string, email: string): Promise<{ error: string | null }> {
  const clean = email.trim().toLowerCase()
  if (!clean) return { error: 'Enter an email address.' }

  const { data: prof, error: pErr } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', clean)
    .maybeSingle()
  if (pErr) return { error: pErr.message }
  if (!prof) return { error: `No customer account found for ${clean}. They need to sign up first.` }

  const { error } = await supabase
    .from('store_members')
    .upsert({ store_id: storeId, user_id: (prof as { id: string }).id }, { onConflict: 'store_id,user_id' })
  return { error: error?.message ?? null }
}

export async function removeStoreMember(storeId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('store_members').delete().eq('store_id', storeId).eq('user_id', userId)
  return { error: error?.message ?? null }
}

// ─── Readiness checklist ────────────────────────────────────────────────────

export interface ReadinessItem {
  key: string
  label: string
  ok: boolean
  hint: string
}

/**
 * The four things that fail SILENTLY if skipped, and whose failure surfaces to
 * Ioustinos as "a customer paid and nothing happened". Shown red until fixed.
 */
export function storeReadiness(store: AdminStore): ReadinessItem[] {
  const s = store.settings
  const hasWindow = Array.isArray(s.time_slots) && (s.time_slots as unknown[]).length > 0
  const methods = s.payment_methods_enabled
  const hasMethods = Array.isArray(methods)
    ? methods.length > 0
    : !!methods && typeof methods === 'object' &&
      Object.values(methods as Record<string, { public?: boolean; admin?: boolean }>)
        .some((v) => v?.public === true || v?.admin === true)

  const today = new Date().toISOString().slice(0, 10)
  const hasUpcomingMenu = store.menus.some((m) => m.active && m.toDate >= today)

  return [
    {
      key: 'address',
      label: 'Delivery address',
      ok: !!(store.addressStreet && store.addressZip),
      hint: 'Every order on this store is delivered here. Street and postcode are the minimum.',
    },
    {
      key: 'window',
      label: 'Delivery window',
      ok: hasWindow,
      hint: 'Without one the store falls back to the retail windows, which is probably not the deal you agreed.',
    },
    {
      key: 'methods',
      label: 'Payment methods',
      ok: hasMethods,
      hint: 'Without an override the store inherits the retail payment methods.',
    },
    {
      key: 'menu',
      label: 'Weekly menu for an upcoming week',
      ok: hasUpcomingMenu,
      hint: 'A store with no menu of its own shows an empty week — nothing can be ordered.',
    },
    {
      // WEC-743: blank is not neutral. pushOrder falls back to RETAIL_STORE_ID
      // (9999), so this store's orders land in Airtable labelled as retail —
      // silently, and only visible once someone audits the ops board.
      key: 'airtable',
      label: 'Airtable store id',
      ok: store.airtableStoreId != null,
      hint: 'Without one, this store\'s orders push to Airtable as RETAIL (9999). Assign a number here, then add the matching row in Airtable.',
    },
  ]
}

// ─── WEC-716: multi-target menu cloning ─────────────────────────────────────
//
// Store menus never inherit — Ioustinos: *"a tree of inherits and overides
// (like gonnaOrder does) is dangerous."* The accepted cost is that weekly
// effort scales with store count, and THIS is the agreed mitigation: one
// deliberate action applied to several targets, writing independent copies.
// Nothing propagates afterwards. There is no sync, no scheduled re-clone.

export interface CloneSourceWeek {
  id: string
  name: string | null
  fromDate: string
  toDate: string
  storeId: string | null
  storeName: string
  dayCount: number
  dishCount: number
}

export interface ClonePlanTarget {
  storeId: string
  storeName: string
  slug: string
  /** An existing menu covering the same week — cloning would collide with it. */
  existingMenuId: string | null
  existingMenuName: string | null
}

export interface CloneResult {
  storeId: string
  storeName: string
  status: 'created' | 'replaced' | 'skipped' | 'failed'
  detail: string
}

/** Weeks that can be used as a clone source, newest first, with their size. */
export async function fetchCloneSources(): Promise<{ data: CloneSourceWeek[] | null; error: string | null }> {
  const { data: menus, error } = await supabase
    .from('weekly_menus')
    .select('id, name, from_date, to_date, store_id, active')
    .eq('active', true)
    .order('from_date', { ascending: false })
    .limit(20)
  if (error) return { data: null, error: error.message }

  const rows = (menus ?? []) as Array<{ id: string; name: string | null; from_date: string; to_date: string; store_id: string | null }>
  if (rows.length === 0) return { data: [], error: null }

  const { data: stores } = await supabase.from('stores').select('id, name_el, is_default')
  const storeById = new Map(((stores ?? []) as Array<{ id: string; name_el: string; is_default: boolean }>).map((s) => [s.id, s]))

  // ⚠️ PostgREST caps a single response at 1000 rows and truncates SILENTLY.
  // Nine weeks of assignments is ~1,300 rows, so an unpaginated select
  // undercounted — and arbitrarily, since no order is specified: the panel
  // showed "0 assignments" for a menu that has 103. The whole point of the
  // preview is to say what WILL happen, so a wrong number here is worse than
  // no number. Same pagination the menu endpoints already use.
  const assignments: Array<{ menu_id: string; date: string }> = []
  {
    const PAGE = 1000
    const ids = rows.map((r) => r.id)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('menu_day_dishes')
        .select('menu_id, date')
        .in('menu_id', ids)
        .range(from, from + PAGE - 1)
      if (error) break
      const batch = (data ?? []) as Array<{ menu_id: string; date: string }>
      assignments.push(...batch)
      if (batch.length < PAGE) break
    }
  }

  const stats = new Map<string, { days: Set<string>; dishes: number }>()
  for (const a of assignments) {
    const st = stats.get(a.menu_id) ?? { days: new Set<string>(), dishes: 0 }
    st.days.add(a.date); st.dishes += 1
    stats.set(a.menu_id, st)
  }

  return {
    data: rows.map((r) => {
      const st = stats.get(r.id)
      const store = r.store_id ? storeById.get(r.store_id) : null
      return {
        id: r.id, name: r.name, fromDate: r.from_date, toDate: r.to_date,
        storeId: r.store_id,
        storeName: store ? (store.is_default ? 'Fitpal (retail)' : store.name_el) : 'unassigned',
        dayCount: st?.days.size ?? 0,
        dishCount: st?.dishes ?? 0,
      }
    }),
    error: null,
  }
}

/**
 * What a clone WOULD do, before it does it — including which targets already
 * hold a menu for that week. Never overwrite anything without showing this
 * first: replacing a hand-edited corporate menu is unrecoverable.
 */
export async function planClone(
  source: CloneSourceWeek,
  targetStoreIds: string[],
): Promise<{ data: ClonePlanTarget[] | null; error: string | null }> {
  if (targetStoreIds.length === 0) return { data: [], error: null }

  const { data: stores, error } = await supabase
    .from('stores').select('id, slug, name_el').in('id', targetStoreIds)
  if (error) return { data: null, error: error.message }

  const { data: existing } = await supabase
    .from('weekly_menus')
    .select('id, name, store_id, from_date, to_date')
    .in('store_id', targetStoreIds)
    .lte('from_date', source.toDate)
    .gte('to_date', source.fromDate)

  const existingByStore = new Map(
    ((existing ?? []) as Array<{ id: string; name: string | null; store_id: string }>).map((m) => [m.store_id, m]),
  )

  return {
    data: ((stores ?? []) as Array<{ id: string; slug: string; name_el: string }>).map((s) => {
      const hit = existingByStore.get(s.id)
      return {
        storeId: s.id, storeName: s.name_el, slug: s.slug,
        existingMenuId: hit?.id ?? null,
        existingMenuName: hit?.name ?? null,
      }
    }),
    error: null,
  }
}

/**
 * Clone one week into several stores. Each target is handled independently, so
 * two succeeding and one failing reports as exactly that rather than one
 * opaque error.
 *
 * `onCollision` is required rather than defaulted — the caller must have made
 * a deliberate choice about overwriting.
 */
export async function cloneWeekToStores(
  source: CloneSourceWeek,
  targets: ClonePlanTarget[],
  onCollision: 'skip' | 'replace',
): Promise<CloneResult[]> {
  const results: CloneResult[] = []

  for (const t of targets) {
    try {
      if (t.existingMenuId && onCollision === 'skip') {
        results.push({
          storeId: t.storeId, storeName: t.storeName, status: 'skipped',
          detail: `already has «${t.existingMenuName ?? 'a menu'}» for this week`,
        })
        continue
      }

      if (t.existingMenuId && onCollision === 'replace') {
        // Clear the destination week's assignments, keeping the menu row so
        // its id (and anything referencing it) survives.
        const { error: delErr } = await supabase
          .from('menu_day_dishes').delete().eq('menu_id', t.existingMenuId)
        if (delErr) {
          results.push({ storeId: t.storeId, storeName: t.storeName, status: 'failed', detail: delErr.message })
          continue
        }
        const { error: dupErr } = await duplicateMenuContent(source.id, t.existingMenuId, 0)
        results.push(dupErr
          ? { storeId: t.storeId, storeName: t.storeName, status: 'failed', detail: dupErr }
          : { storeId: t.storeId, storeName: t.storeName, status: 'replaced', detail: `${source.dishCount} assignments over ${source.dayCount} days` })
        continue
      }

      const { data: srcRow } = await supabase
        .from('weekly_menus').select('category_order, inactive_dates').eq('id', source.id).maybeSingle()

      const { data: created, error: insErr } = await supabase
        .from('weekly_menus')
        .insert({
          name: `${source.name ?? source.fromDate} — ${t.storeName}`,
          from_date: source.fromDate,
          to_date: source.toDate,
          active: true,
          category_order: (srcRow as { category_order: string[] | null } | null)?.category_order ?? null,
          inactive_dates: (srcRow as { inactive_dates: string[] | null } | null)?.inactive_dates ?? [],
          store_id: t.storeId,
        })
        .select('id')
        .single()

      if (insErr || !created) {
        results.push({ storeId: t.storeId, storeName: t.storeName, status: 'failed', detail: insErr?.message ?? 'insert failed' })
        continue
      }

      const { error: dupErr } = await duplicateMenuContent(source.id, (created as { id: string }).id, 0)
      results.push(dupErr
        ? { storeId: t.storeId, storeName: t.storeName, status: 'failed', detail: dupErr }
        : { storeId: t.storeId, storeName: t.storeName, status: 'created', detail: `${source.dishCount} assignments over ${source.dayCount} days` })
    } catch (e) {
      results.push({
        storeId: t.storeId, storeName: t.storeName, status: 'failed',
        detail: e instanceof Error ? e.message : 'unknown error',
      })
    }
  }

  void purgeMenuCache(['menu', 'stores'])
  return results
}

// ─── WEC-717: category discounts, per store AND on the retail site ──────────
//
// Ioustinos: *"A company can choose to have a discount on whole categories
// (add this feature to the regular site as well but each company can set their
// own)."* Retail's rows are the ones with `store_id IS NULL`; a company store
// reads only its own and never inherits retail's.
//
// 🔵 Interaction with `dishes.discount_pct`: the DISH-level discount wins and
// the two do NOT stack. Fil's call, flagged on the ticket — stacking makes the
// effective price impossible to explain to a customer on the phone.

export interface CategoryDiscountRow {
  categoryId: string
  nameEl: string
  nameEn: string
  /** 0 = no discount configured for this store. */
  pct: number
}

/** Pass `null` for the retail site. */
export async function fetchCategoryDiscounts(
  storeId: string | null,
): Promise<{ data: CategoryDiscountRow[] | null; error: string | null }> {
  const catsRes = await supabase
    .from('categories')
    .select('id, name_el, name_en, sort_order, active')
    .eq('active', true)
    .order('sort_order')
  if (catsRes.error) return { data: null, error: catsRes.error.message }

  const q = supabase.from('category_discounts').select('category_id, discount_pct')
  const discRes = storeId ? await q.eq('store_id', storeId) : await q.is('store_id', null)
  if (discRes.error) return { data: null, error: discRes.error.message }

  const byCat = new Map(
    ((discRes.data ?? []) as Array<{ category_id: string; discount_pct: number | string }>)
      .map((r) => [r.category_id, Number(r.discount_pct)]),
  )

  return {
    data: ((catsRes.data ?? []) as Array<{ id: string; name_el: string; name_en: string }>).map((c) => ({
      categoryId: c.id,
      nameEl: c.name_el,
      nameEn: c.name_en,
      pct: byCat.get(c.id) ?? 0,
    })),
    error: null,
  }
}

/** `pct <= 0` removes the discount. `storeId` null = the retail site. */
export async function setCategoryDiscount(
  storeId: string | null,
  categoryId: string,
  pct: number,
): Promise<{ error: string | null }> {
  if (!Number.isFinite(pct) || pct <= 0) {
    const del = supabase.from('category_discounts').delete().eq('category_id', categoryId)
    const { error } = storeId ? await del.eq('store_id', storeId) : await del.is('store_id', null)
    void purgeMenuCache(['menu', 'stores'])
    return { error: error?.message ?? null }
  }
  if (pct > 100) return { error: 'A discount cannot exceed 100%.' }

  // No upsert: the retail rows have a NULL store_id, and `on conflict` cannot
  // match a NULL through the plain unique constraint — that is exactly why
  // WEC-709 added a partial unique index for them. Delete-then-insert is the
  // shape that works for both cases.
  const del = supabase.from('category_discounts').delete().eq('category_id', categoryId)
  const { error: delErr } = storeId ? await del.eq('store_id', storeId) : await del.is('store_id', null)
  if (delErr) return { error: delErr.message }

  const { error } = await supabase
    .from('category_discounts')
    .insert({ store_id: storeId, category_id: categoryId, discount_pct: pct })
  void purgeMenuCache(['menu', 'stores'])
  return { error: error?.message ?? null }
}
