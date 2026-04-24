import { supabase } from '../supabase'

// ─── Types ────────────────────────────────────────────────────────────────

export interface AdminWeeklyMenu {
  id: string
  name: string | null
  fromDate: string   // 'YYYY-MM-DD'
  toDate: string
  active: boolean
  /** Dates where the kitchen is closed — dishes assigned to these dates are hidden from customers. */
  inactiveDates: string[]
}

export interface AdminMenuDayDish {
  id: string
  menuId: string
  date: string       // 'YYYY-MM-DD'
  dishId: string
  sortOrder: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Monday (0-indexed as ISO) of the given date, normalised to YYYY-MM-DD. */
export function mondayOf(date: Date): Date {
  const d = new Date(date)
  const dow = d.getDay()               // 0=Sun, 1=Mon, ..., 6=Sat
  const shift = (dow === 0 ? -6 : 1 - dow)
  d.setDate(d.getDate() + shift)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Format a Date as YYYY-MM-DD in the LOCAL timezone.
 *
 * WEC-122 / #24 fix: previously this used `toISOString().slice(0, 10)`, which
 * silently converts to UTC. In Athens (UTC+2/+3) a Date representing local
 * Monday 00:00 is UTC Sunday 21:00 or 22:00, so `toISOString()` returned the
 * previous day's ISO string. That shifted the admin menu-builder's week grid,
 * the `days[]` array passed to `addDishToDay`, and the shifted rows in
 * `duplicateMenuContent` all one day backward, producing orphan Sunday rows
 * in `menu_day_dishes` that leaked onto the customer menu.
 *
 * Use local year/month/day — what the user sees on their wall calendar.
 */
export function fmtIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Mon..Fri dates starting from a given monday */
export function weekDays(monday: Date): Date[] {
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i))
}

// ─── Queries ──────────────────────────────────────────────────────────────

function mapMenuRow(r: unknown): AdminWeeklyMenu {
  const row = r as { id: string; name: string | null; from_date: string; to_date: string; active: boolean | null; inactive_dates: string[] | null }
  return {
    id: row.id, name: row.name, fromDate: row.from_date, toDate: row.to_date,
    active: row.active ?? false,
    inactiveDates: row.inactive_dates ?? [],
  }
}

export async function fetchMenusOverlapping(fromIso: string, toIso: string): Promise<{ data: AdminWeeklyMenu[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('weekly_menus')
    .select('*')
    .gte('to_date', fromIso)
    .lte('from_date', toIso)
    .order('from_date', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map(mapMenuRow), error: null }
}

/** Toggle inactive state for a specific date on a menu. Returns updated list. */
export async function setMenuDateActive(menuId: string, dateIso: string, active: boolean): Promise<{ data: string[] | null; error: string | null }> {
  // Read current list, modify, write back. Small list so no race concern in V1.
  const { data: current, error: readErr } = await supabase
    .from('weekly_menus')
    .select('inactive_dates')
    .eq('id', menuId)
    .single()
  if (readErr) return { data: null, error: readErr.message }
  const list = new Set(((current as { inactive_dates: string[] | null }).inactive_dates ?? []))
  if (active) list.delete(dateIso)
  else list.add(dateIso)
  const next = Array.from(list).sort()
  const { error } = await supabase.from('weekly_menus').update({ inactive_dates: next }).eq('id', menuId)
  if (error) return { data: null, error: error.message }
  return { data: next, error: null }
}

export async function fetchMenuDayDishes(menuId: string): Promise<{ data: AdminMenuDayDish[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('menu_day_dishes')
    .select('*')
    .eq('menu_id', menuId)
    .order('date')
    .order('sort_order')
  if (error) return { data: null, error: error.message }
  return {
    data: (data ?? []).map((r) => {
      const row = r as { id: string; menu_id: string; date: string; dish_id: string; sort_order: number | null }
      return { id: row.id, menuId: row.menu_id, date: row.date, dishId: row.dish_id, sortOrder: row.sort_order ?? 0 }
    }),
    error: null,
  }
}

// ─── Mutations ────────────────────────────────────────────────────────────

export async function createWeeklyMenu(input: { fromDate: string; toDate: string; name?: string | null }): Promise<{ data: AdminWeeklyMenu | null; error: string | null }> {
  const { data, error } = await supabase
    .from('weekly_menus')
    .insert({ from_date: input.fromDate, to_date: input.toDate, name: input.name ?? null, active: false })
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: mapMenuRow(data), error: null }
}

export async function deleteWeeklyMenu(id: string): Promise<{ error: string | null }> {
  // Delete day-dishes first for safety (FK should cascade, but be explicit)
  await supabase.from('menu_day_dishes').delete().eq('menu_id', id)
  const { error } = await supabase.from('weekly_menus').delete().eq('id', id)
  return { error: error?.message ?? null }
}

export async function setMenuActive(id: string, active: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase.from('weekly_menus').update({ active }).eq('id', id)
  return { error: error?.message ?? null }
}

export async function renameMenu(id: string, name: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase.from('weekly_menus').update({ name }).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Add a dish to a menu on a specific date. Returns the created row so the
 * caller can optimistic-update the UI.
 */
export async function addDishToDay(menuId: string, date: string, dishId: string, sortOrder: number): Promise<{ data: AdminMenuDayDish | null; error: string | null }> {
  const { data, error } = await supabase
    .from('menu_day_dishes')
    .insert({ menu_id: menuId, date, dish_id: dishId, sort_order: sortOrder })
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  const row = data as { id: string; menu_id: string; date: string; dish_id: string; sort_order: number | null }
  return {
    data: { id: row.id, menuId: row.menu_id, date: row.date, dishId: row.dish_id, sortOrder: row.sort_order ?? 0 },
    error: null,
  }
}

export async function removeMenuDayDish(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('menu_day_dishes').delete().eq('id', id)
  return { error: error?.message ?? null }
}

/** Replace sort_order of a list of assignments (called after drag-drop reorder). */
export async function reorderMenuDayDishes(items: Array<{ id: string; date: string; sortOrder: number }>): Promise<{ error: string | null }> {
  // Bulk update via Promise.all — PostgREST doesn't support bulk update by PK natively
  const errs: string[] = []
  await Promise.all(items.map(async (it) => {
    const { error } = await supabase
      .from('menu_day_dishes')
      .update({ date: it.date, sort_order: it.sortOrder })
      .eq('id', it.id)
    if (error) errs.push(error.message)
  }))
  return { error: errs.length ? errs[0] : null }
}

/**
 * Duplicate all menu_day_dishes rows from `sourceMenuId` into `targetMenuId`,
 * shifting dates by a number of days so they land in the new week.
 */
export async function duplicateMenuContent(sourceMenuId: string, targetMenuId: string, dateShiftDays: number): Promise<{ error: string | null }> {
  const { data: src, error: srcErr } = await supabase
    .from('menu_day_dishes')
    .select('date, dish_id, sort_order')
    .eq('menu_id', sourceMenuId)
  if (srcErr) return { error: srcErr.message }
  if (!src || src.length === 0) return { error: null }

  const rows = src.map((r) => {
    const d = new Date(r.date as string)
    d.setDate(d.getDate() + dateShiftDays)
    return {
      menu_id: targetMenuId,
      dish_id: r.dish_id as string,
      date: fmtIso(d),
      sort_order: (r.sort_order as number | null) ?? 0,
    }
  })
  const { error } = await supabase.from('menu_day_dishes').insert(rows)
  return { error: error?.message ?? null }
}
