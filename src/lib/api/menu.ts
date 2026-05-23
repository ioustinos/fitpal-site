/**
 * Customer menu read API.
 *
 * Since WEC-350: every function here delegates to one of the three
 * memoized fetchers in `bootstrap.ts`. There are NO direct Supabase
 * queries from this module.
 *
 * Endpoints:
 *   - getMeta()       → /api/menu/meta        (5KB, once)
 *   - getCatalog()    → /api/menu/catalog     (5KB, once)
 *   - getWeek(menuId) → /api/menu/week        (25KB per week)
 *
 * Per-week loading: `fetchWeekDishes` is a REAL network call now. Each
 * week response is edge-cached independently at Netlify, so historical
 * weeks only hit Supabase on the very first visitor; everyone else
 * gets it sub-50ms from the nearest PoP.
 *
 * Public surface (unchanged):
 *   - fetchTags()              → TagDef[]
 *   - fetchCategories()        → CategoryDef[]
 *   - fetchActiveWeeksMeta()   → WeekMeta[]  (week list + day inactivity flags)
 *   - fetchWeekDishes(menuId)  → { weekId, days, dishes } for one week
 *   - fetchActiveMenu()        → deprecated — errors out (loading every week
 *                                defeats the per-week eager pattern)
 *   - fetchDishesForDay(date)  → Dish[] for one date
 *
 * The `dishIngredientMap` field on `fetchWeekDishes` results lets the
 * store extend its diet catalog incrementally per-week (see
 * `bootstrap.ts:extendDietCatalog`).
 */

import {
  getMeta,
  getCatalog,
  getWeek,
  wireDishToDish,
  wireCategoryToCategory,
  wireTagToTag,
  type WireDish,
} from './bootstrap'
import type { Dish, CategoryDef, WeekDef, TagDef } from '../../data/menu'

// ─── WeekMeta type — lightweight week description for navigation/landing ─────

export interface WeekMeta {
  id: string
  labelEl: string
  labelEn: string
  /**
   * One entry per delivery day in the menu, chronological order. WEC-273:
   * `inactive` is true when the admin marked the date closed in
   * `weekly_menus.inactive_dates`. The day stays in the list so the
   * customer day-strip can render it greyed out with a "closed" caption
   * instead of silently disappearing.
   */
  days: { date: string; inactive?: boolean }[]
  /** Snapshot of category id ordering for this menu (WEC-253). */
  categoryOrder: string[]
}

// ─── Tags ────────────────────────────────────────────────────────────────────

/**
 * Fetch the global tags catalog (WEC-256). Reads from /api/menu/catalog,
 * which is shared with `fetchCategories` and `fetchDietCatalog` (one
 * underlying round-trip on first call).
 */
export async function fetchTags(): Promise<{ data: TagDef[] | null; error: string | null }> {
  const cat = await getCatalog()
  if (!cat) return { data: null, error: 'Failed to load menu catalog' }
  return { data: cat.tags.map(wireTagToTag), error: null }
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<{ data: CategoryDef[] | null; error: string | null }> {
  const cat = await getCatalog()
  if (!cat) return { data: null, error: 'Failed to load menu catalog' }
  return { data: cat.categories.map(wireCategoryToCategory), error: null }
}

// ─── Active weeks meta ──────────────────────────────────────────────────────

/**
 * Lightweight metadata for all active weekly menus. Drives the
 * week-toggle nav and landing-day resolution before any dish content
 * is needed.
 */
export async function fetchActiveWeeksMeta(): Promise<{
  data: WeekMeta[] | null
  error: string | null
}> {
  const meta = await getMeta()
  if (!meta) return { data: null, error: 'Failed to load menu meta' }
  if (meta.weeks.length === 0) return { data: null, error: 'No active menu found' }

  const weeks: WeekMeta[] = meta.weeks.map((w) => ({
    id: w.id,
    labelEl: w.labelEl,
    labelEn: w.labelEn,
    days: w.days.map((d) => ({ date: d.date, inactive: d.inactive || undefined })),
    categoryOrder: w.categoryOrder,
  }))
  return { data: weeks, error: null }
}

// ─── Full week with dishes ───────────────────────────────────────────────────

/**
 * Fetch full dish content for ONE weekly menu. Since WEC-350 this hits
 * `/api/menu/week?menuId=...` — edge-cached at Netlify per menuId.
 *
 * Returns:
 *   - `days`: `[{date, dishIds}]` in admin's sort_order
 *   - `dishes`: deduplicated `Dish[]`
 *   - `dishIngredientMap`: `Map<dish_id, ingredient_id[]>` — the store
 *      uses this to extend the diet catalog with per-dish ingredient
 *      links, so the dish→allergy join stays correct as weeks load.
 *      Other callers can ignore it.
 *   - `wireDishes`: raw wire-format dishes (same purpose as
 *      dishIngredientMap; some callers prefer the structured form).
 */
export async function fetchWeekDishes(menuId: string): Promise<{
  data: {
    weekId: string
    days: { date: string; dishIds: string[] }[]
    dishes: Dish[]
    dishIngredientMap: Map<string, string[]>
    wireDishes: WireDish[]
  } | null
  error: string | null
}> {
  const week = await getWeek(menuId)
  if (!week) return { data: null, error: 'Failed to load week' }

  // Empty week is a clean result (not an error) — matches the legacy
  // behaviour so callers don't need conditional handling.
  if (week.dishes.length === 0 && week.days.length === 0) {
    return {
      data: {
        weekId: menuId,
        days: [],
        dishes: [],
        dishIngredientMap: new Map(),
        wireDishes: [],
      },
      error: null,
    }
  }

  const days = week.days.map((d) => ({ date: d.date, dishIds: d.dishIds }))
  const dishes: Dish[] = week.dishes.map(wireDishToDish)
  const dishIngredientMap = new Map<string, string[]>()
  for (const d of week.dishes) dishIngredientMap.set(d.id, d.ingredientIds)

  return {
    data: {
      weekId: menuId,
      days,
      dishes,
      dishIngredientMap,
      wireDishes: week.dishes,
    },
    error: null,
  }
}

// ─── Active menu (deprecated — would defeat per-week eager pattern) ──────────

/**
 * @deprecated Loading every active week's dishes at once is exactly the
 * anti-pattern WEC-350 corrected away from. Use `fetchActiveWeeksMeta`
 * for navigation + `fetchWeekDishes(menuId)` for the weeks the customer
 * is currently looking at. Kept as a stub to avoid silent breakage if
 * an old caller still imports it.
 */
export async function fetchActiveMenu(): Promise<{
  data: { weeks: WeekDef[]; dishes: Dish[]; categories: CategoryDef[] } | null
  error: string | null
}> {
  return {
    data: null,
    error:
      'fetchActiveMenu is deprecated (WEC-350): use fetchActiveWeeksMeta + fetchWeekDishes per week instead.',
  }
}

// Re-export an unused type so callers importing it from this module still compile.
// (No-op — kept to preserve back-compat with `import { fetchActiveMenu } from './menu'`.)
export type { WeekDef, WeekDay } from '../../data/menu'

// ─── Dishes for a specific day ───────────────────────────────────────────────

/**
 * Resolve the dishes available on a specific delivery date. Uses meta
 * to find which week covers that date, then loads (or reads from
 * cache) that week's dishes. Two network round-trips first time
 * (`/api/menu/meta` + `/api/menu/week`), zero on subsequent calls
 * within the same week.
 */
export async function fetchDishesForDay(date: string): Promise<{
  data: Dish[] | null
  error: string | null
}> {
  const meta = await getMeta()
  if (!meta) return { data: null, error: 'Failed to load menu meta' }

  // Find the week containing this date. Weeks are date-ordered.
  const week = meta.weeks.find((w) => w.days.some((d) => d.date === date))
  if (!week) return { data: [], error: null }

  const wRes = await getWeek(week.id)
  if (!wRes) return { data: null, error: 'Failed to load week dishes' }

  const day = wRes.days.find((d) => d.date === date)
  if (!day || day.dishIds.length === 0) return { data: [], error: null }

  const dishMap = new Map(wRes.dishes.map((d) => [d.id, d]))
  const dishes: Dish[] = []
  for (const id of day.dishIds) {
    const wire = dishMap.get(id)
    if (wire) dishes.push(wireDishToDish(wire))
  }
  return { data: dishes, error: null }
}
