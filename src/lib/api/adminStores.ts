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
export async function createStore(
  input: CreateStoreInput,
): Promise<{ data: AdminStore | null; error: string | null; menuCloned: boolean }> {
  const slug = input.slug.trim().toLowerCase()

  const { data: row, error } = await supabase
    .from('stores')
    .insert({
      slug,
      type: input.type,
      name_el: input.nameEl.trim() || slug,
      name_en: input.nameEn.trim() || input.nameEl.trim() || slug,
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
  const { data, error } = await supabase
    .from('store_members')
    .select('user_id, created_at, profiles:user_id (name, email)')
    .eq('store_id', storeId)
    .order('created_at')
  if (error) return { data: null, error: error.message }
  // PostgREST types an embedded FK as an array even when it resolves to one
  // row, so normalise both shapes rather than trusting either.
  type ProfileBit = { name: string | null; email: string | null }
  const rows = (data ?? []) as unknown as Array<{
    user_id: string; created_at: string; profiles: ProfileBit | ProfileBit[] | null
  }>
  return {
    data: rows.map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
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
  ]
}
