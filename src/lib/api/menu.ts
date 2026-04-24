import { supabase } from '../supabase'
import type { Dish, Variant, Macros, CategoryDef, WeekDef, WeekDay } from '../../data/menu'

// ─── DB row shapes (snake_case, money in cents) ──────────────────────────────

interface DbDish {
  id: string
  category_id: string
  name_el: string
  name_en: string
  desc_el: string | null
  desc_en: string | null
  image_url: string | null
  emoji: string | null
  discount_pct: number | null
  active: boolean
  preview_cal: number | null
  preview_pro: number | null
  preview_carb: number | null
  preview_fat: number | null
}

interface DbVariant {
  id: string
  dish_id: string
  label_el: string
  label_en: string
  price: number          // cents
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  sort_order: number
}

interface DbCategory {
  id: string
  name_el: string
  name_en: string
  sort_order: number
  active: boolean
}

interface DbTag {
  id: string
  label_el: string
  label_en: string
  bg_color: string | null
  font_color: string | null
}

interface DbMenuDayDish {
  menu_id: string
  date: string           // ISO date
  dish_id: string
  sort_order: number
}

interface DbWeeklyMenu {
  id: string
  name: string
  from_date: string
  to_date: string
  active: boolean
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

const centsToEuros = (cents: number): number => +(cents / 100).toFixed(2)

const toMacros = (row: Pick<DbVariant, 'calories' | 'protein' | 'carbs' | 'fat'>): Macros => ({
  cal: row.calories ?? 0,
  pro: row.protein ?? 0,
  carb: row.carbs ?? 0,
  fat: row.fat ?? 0,
})

const toVariant = (row: DbVariant): Variant => ({
  id: row.id,
  labelEl: row.label_el,
  labelEn: row.label_en,
  price: centsToEuros(row.price),
  macros: toMacros(row),
})

const toDish = (
  row: DbDish,
  variants: DbVariant[],
  tagIds: string[],
): Dish => ({
  id: row.id,
  emoji: row.emoji ?? '🍽️',
  img: row.image_url ?? undefined,
  nameEl: row.name_el,
  nameEn: row.name_en,
  descEl: row.desc_el ?? undefined,
  descEn: row.desc_en ?? undefined,
  catId: row.category_id,
  tags: tagIds.length > 0 ? tagIds : undefined,
  discount: row.discount_pct ?? undefined,
  variants: variants
    .filter((v) => v.dish_id === row.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(toVariant),
  previewCal: row.preview_cal ?? undefined,
  previewPro: row.preview_pro ?? undefined,
  previewCarb: row.preview_carb ?? undefined,
  previewFat: row.preview_fat ?? undefined,
})

const toCategory = (row: DbCategory): CategoryDef => ({
  id: row.id,
  labelEl: row.name_el,
  labelEn: row.name_en,
})

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch all active categories, sorted by sort_order.
 */
export async function fetchCategories(): Promise<{ data: CategoryDef[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name_el, name_en, sort_order, active')
    .eq('active', true)
    .order('sort_order')

  if (error) return { data: null, error: error.message }
  return { data: (data as DbCategory[]).map(toCategory), error: null }
}

// ─── WeekMeta type — lightweight week description for navigation/landing ─────

export interface WeekMeta {
  id: string
  labelEl: string
  labelEn: string
  days: { date: string }[]
}

/**
 * Fetch lightweight metadata for all active weekly menus:
 * - id, name, from_date/to_date from `weekly_menus`
 * - distinct `date` list per menu from `menu_day_dishes`
 *
 * Used by the store to decide pivot week + enable week-toggle navigation
 * without pulling dish content for every active menu. Scales when N menus grows.
 */
export async function fetchActiveWeeksMeta(): Promise<{
  data: WeekMeta[] | null
  error: string | null
}> {
  const { data: menuRows, error: menuErr } = await supabase
    .from('weekly_menus')
    .select('id, name, from_date, to_date, active, inactive_dates')
    .eq('active', true)
    .order('from_date')

  if (menuErr) return { data: null, error: menuErr.message }
  const menus = (menuRows ?? []) as Array<DbWeeklyMenu & { inactive_dates: string[] | null }>
  if (menus.length === 0) return { data: null, error: 'No active menu found' }

  const menuIds = menus.map((m) => m.id)
  const inactiveByMenu = new Map<string, Set<string>>()
  for (const m of menus) inactiveByMenu.set(m.id, new Set(m.inactive_dates ?? []))

  // Distinct dates per menu (we don't need dish_ids for meta)
  const { data: dayRows, error: dayErr } = await supabase
    .from('menu_day_dishes')
    .select('menu_id, date')
    .in('menu_id', menuIds)
    .order('date')

  if (dayErr) return { data: null, error: dayErr.message }

  // Build a { menuId → Set<date> } map, preserving order by date.
  // Skip any date marked closed via weekly_menus.inactive_dates.
  const dateMap = new Map<string, string[]>()
  for (const row of (dayRows ?? []) as { menu_id: string; date: string }[]) {
    if (inactiveByMenu.get(row.menu_id)?.has(row.date)) continue
    const list = dateMap.get(row.menu_id) ?? []
    if (!list.includes(row.date)) list.push(row.date)
    dateMap.set(row.menu_id, list)
  }

  const weeks: WeekMeta[] = menus.map((menu) => ({
    id: menu.id,
    labelEl: menu.name,
    labelEn: menu.name,
    days: (dateMap.get(menu.id) ?? []).map((date) => ({ date })),
  }))

  return { data: weeks, error: null }
}

/**
 * Fetch full dish content for a single weekly menu.
 * Used for eager-loading the pivot/prev/next and lazy-loading on week navigation.
 */
export async function fetchWeekDishes(menuId: string): Promise<{
  data: { weekId: string; days: { date: string; dishIds: string[] }[]; dishes: Dish[] } | null
  error: string | null
}> {
  // 1. menu_day_dishes for this menu
  const { data: assignments, error: aErr } = await supabase
    .from('menu_day_dishes')
    .select('menu_id, date, dish_id, sort_order')
    .eq('menu_id', menuId)
    .order('date')
    .order('sort_order')

  if (aErr) return { data: null, error: aErr.message }
  const rows = (assignments ?? []) as DbMenuDayDish[]
  if (rows.length === 0) {
    return { data: { weekId: menuId, days: [], dishes: [] }, error: null }
  }

  const dishIds = [...new Set(rows.map((r) => r.dish_id))]

  // 2. Dishes
  const { data: rawDishes, error: dishErr } = await supabase
    .from('dishes')
    .select('id, category_id, name_el, name_en, desc_el, desc_en, image_url, emoji, discount_pct, active, preview_cal, preview_pro, preview_carb, preview_fat')
    .in('id', dishIds)
    .eq('active', true)

  if (dishErr) return { data: null, error: dishErr.message }

  // 3. Variants
  const { data: rawVariants, error: varErr } = await supabase
    .from('dish_variants')
    .select('id, dish_id, label_el, label_en, price, calories, protein, carbs, fat, sort_order')
    .in('dish_id', dishIds)

  if (varErr) return { data: null, error: varErr.message }

  // 4. Tag junction + tags
  const { data: rawDishTags, error: dtErr } = await supabase
    .from('dish_tags')
    .select('dish_id, tag_id')
    .in('dish_id', dishIds)

  if (dtErr) return { data: null, error: dtErr.message }

  const dishTagMap: Record<string, string[]> = {}
  for (const dt of rawDishTags ?? []) {
    const { dish_id, tag_id } = dt as { dish_id: string; tag_id: string }
    ;(dishTagMap[dish_id] ??= []).push(tag_id)
  }

  // 5. Build WeekDay[]
  const dayMap = new Map<string, string[]>()
  for (const r of rows) {
    const list = dayMap.get(r.date) ?? []
    list.push(r.dish_id)
    dayMap.set(r.date, list)
  }
  const days = [...dayMap.entries()].map(([date, ids]) => ({ date, dishIds: ids }))

  // 6. Map dishes
  const variants = (rawVariants ?? []) as DbVariant[]
  const dishes: Dish[] = (rawDishes as DbDish[]).map((d) =>
    toDish(d, variants, dishTagMap[d.id] ?? []),
  )

  return { data: { weekId: menuId, days, dishes }, error: null }
}

/**
 * @deprecated Use `fetchActiveWeeksMeta` + `fetchWeekDishes` for scoped loading.
 * Kept for backwards compat. Fetches ALL active weeks with dish content in one go.
 */
export async function fetchActiveMenu(): Promise<{
  data: { weeks: WeekDef[]; dishes: Dish[]; categories: CategoryDef[] } | null
  error: string | null
}> {
  // 1. All active weekly menus
  const { data: menuRows, error: menuErr } = await supabase
    .from('weekly_menus')
    .select('id, name, from_date, to_date, active')
    .eq('active', true)
    .order('from_date')

  if (menuErr) return { data: null, error: menuErr.message }
  const menus = (menuRows ?? []) as DbWeeklyMenu[]
  if (menus.length === 0) {
    return { data: null, error: 'No active menu found' }
  }

  const menuIds = menus.map((m) => m.id)

  // 2. Menu-day-dish assignments for ALL active menus
  const { data: dayDishes, error: ddErr } = await supabase
    .from('menu_day_dishes')
    .select('menu_id, date, dish_id, sort_order')
    .in('menu_id', menuIds)
    .order('date')
    .order('sort_order')

  if (ddErr) return { data: null, error: ddErr.message }
  const assignments = dayDishes as DbMenuDayDish[]

  // Collect unique dish IDs across all menus
  const dishIds = [...new Set(assignments.map((a) => a.dish_id))]
  if (dishIds.length === 0) {
    return { data: null, error: 'Active menus have no dishes assigned' }
  }

  // 3. Dishes
  const { data: rawDishes, error: dishErr } = await supabase
    .from('dishes')
    .select('id, category_id, name_el, name_en, desc_el, desc_en, image_url, emoji, discount_pct, active, preview_cal, preview_pro, preview_carb, preview_fat')
    .in('id', dishIds)
    .eq('active', true)

  if (dishErr) return { data: null, error: dishErr.message }

  // 4. Variants for those dishes
  const { data: rawVariants, error: varErr } = await supabase
    .from('dish_variants')
    .select('id, dish_id, label_el, label_en, price, calories, protein, carbs, fat, sort_order')
    .in('dish_id', dishIds)

  if (varErr) return { data: null, error: varErr.message }

  // 5. Tags junction + tag labels
  const { data: rawDishTags, error: dtErr } = await supabase
    .from('dish_tags')
    .select('dish_id, tag_id')
    .in('dish_id', dishIds)

  if (dtErr) return { data: null, error: dtErr.message }

  const tagIds = [...new Set((rawDishTags ?? []).map((dt: { dish_id: string; tag_id: string }) => dt.tag_id))]
  let tagsMap: Record<string, DbTag> = {}
  if (tagIds.length > 0) {
    const { data: rawTags } = await supabase
      .from('tags')
      .select('id, label_el, label_en, bg_color, font_color')
      .in('id', tagIds)
    if (rawTags) {
      tagsMap = Object.fromEntries((rawTags as DbTag[]).map((t) => [t.id, t]))
    }
  }

  // Build dish-tag lookup: dishId → tag id[]
  const dishTagMap: Record<string, string[]> = {}
  for (const dt of rawDishTags ?? []) {
    const { dish_id, tag_id } = dt as { dish_id: string; tag_id: string }
    ;(dishTagMap[dish_id] ??= []).push(tag_id)
  }

  // 6. Categories
  const { data: cats, error: catErr } = await fetchCategories()
  if (catErr || !cats) return { data: null, error: catErr ?? 'Failed to load categories' }

  // 7. Assemble dishes (deduplicated across menus)
  const variants = rawVariants as DbVariant[]
  const dishes: Dish[] = (rawDishes as DbDish[]).map((d) =>
    toDish(d, variants, dishTagMap[d.id] ?? []),
  )

  // 8. Build WeekDef per menu
  const weeks: WeekDef[] = menus.map((menu) => {
    const menuAssignments = assignments.filter((a) => a.menu_id === menu.id)

    const dayMap = new Map<string, string[]>()
    for (const a of menuAssignments) {
      const list = dayMap.get(a.date) ?? []
      list.push(a.dish_id)
      dayMap.set(a.date, list)
    }

    const days: WeekDay[] = [...dayMap.entries()].map(([date, ids]) => ({
      date,
      dishIds: ids,
    }))

    return {
      id: menu.id,
      labelEl: menu.name,
      labelEn: menu.name,
      days,
    }
  })

  return { data: { weeks, dishes, categories: cats }, error: null }
}

/**
 * Fetch dishes available on a specific date from the active menu.
 */
export async function fetchDishesForDay(date: string): Promise<{
  data: Dish[] | null
  error: string | null
}> {
  // Find active menu covering this date
  const { data: menus, error: menuErr } = await supabase
    .from('weekly_menus')
    .select('id')
    .eq('active', true)
    .lte('from_date', date)
    .gte('to_date', date)
    .limit(1)
    .single()

  if (menuErr || !menus) {
    return { data: null, error: menuErr?.message ?? 'No menu covers this date' }
  }

  const { data: assignments, error: aErr } = await supabase
    .from('menu_day_dishes')
    .select('dish_id, sort_order')
    .eq('menu_id', (menus as { id: string }).id)
    .eq('date', date)
    .order('sort_order')

  if (aErr) return { data: null, error: aErr.message }

  const dishIds = (assignments as { dish_id: string; sort_order: number }[]).map((a) => a.dish_id)
  if (dishIds.length === 0) return { data: [], error: null }

  // Fetch dishes + variants + tags
  const { data: rawDishes, error: dErr } = await supabase
    .from('dishes')
    .select('id, category_id, name_el, name_en, desc_el, desc_en, image_url, emoji, discount_pct, active, preview_cal, preview_pro, preview_carb, preview_fat')
    .in('id', dishIds)
    .eq('active', true)

  if (dErr) return { data: null, error: dErr.message }

  const { data: rawVariants, error: vErr } = await supabase
    .from('dish_variants')
    .select('id, dish_id, label_el, label_en, price, calories, protein, carbs, fat, sort_order')
    .in('dish_id', dishIds)

  if (vErr) return { data: null, error: vErr.message }

  const { data: rawDishTags } = await supabase
    .from('dish_tags')
    .select('dish_id, tag_id')
    .in('dish_id', dishIds)

  const dishTagMap: Record<string, string[]> = {}
  for (const dt of rawDishTags ?? []) {
    const { dish_id, tag_id } = dt as { dish_id: string; tag_id: string }
    ;(dishTagMap[dish_id] ??= []).push(tag_id)
  }

  const variants = (rawVariants ?? []) as DbVariant[]
  const dishes = (rawDishes as DbDish[]).map((d) =>
    toDish(d, variants, dishTagMap[d.id] ?? []),
  )

  // Sort in the order they appear in menu_day_dishes
  const idOrder = new Map(dishIds.map((id, i) => [id, i]))
  dishes.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0))

  return { data: dishes, error: null }
}
