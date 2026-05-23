/**
 * WEC-350: client-side menu data fetchers.
 *
 * Three independent endpoints, each memoized in-tab:
 *
 *   - getMeta()            → /api/menu-meta    — week list + day shells (no dish content)
 *   - getCatalog()         → /api/menu-catalog — tags + categories + allergies + ingredient_allergies
 *   - getWeek(menuId)      → /api/menu-week    — one week's dishes (memoized per menuId)
 *
 * Eager-load policy: the menu store fetches meta + catalog + 3 weeks
 * (pivot ± 1) on app load. Other weeks fetch on click via getWeek().
 * Each per-week response edge-caches independently at Netlify, so the
 * second visitor to historical week N gets it sub-50ms.
 *
 * The legacy `fetchActiveWeeksMeta`, `fetchWeekDishes`, `fetchTags`,
 * `fetchCategories`, `fetchDietCatalog` signatures are preserved in
 * `src/lib/api/menu.ts` and `src/lib/api/diet.ts` — they all delegate
 * through here. Components and the store don't need to change shape.
 *
 * Diet catalog: `getCatalog()` returns allergies + ingredient→allergy
 * mappings. The dish→ingredient + dish→allergy maps start EMPTY and are
 * extended by the store via `extendDietCatalog()` as weeks load. That
 * keeps the catalog growing alongside the eager + lazy week loads
 * without ever pulling every dish's ingredients up front.
 */

import type { Dish, Variant, Macros, CategoryDef, TagDef, TagPlacement } from '../../data/menu'
import type { AllergyDef, DietCatalog } from './diet'

// ─── Wire types ─────────────────────────────────────────────────────────────
// KEEP IN SYNC with netlify/functions/menu-{meta,catalog,week}.ts.

export interface WireWeekDayMeta {
  date: string
  inactive: boolean
}

export interface WireWeekMeta {
  id: string
  labelEl: string
  labelEn: string
  categoryOrder: string[]
  days: WireWeekDayMeta[]
}

export interface MetaResponse {
  weeks: WireWeekMeta[]
  generatedAt: string
}

export interface WireCategory {
  id: string
  labelEl: string
  labelEn: string
  sortOrder: number
}

export interface WireTag {
  id: string
  labelEl: string
  labelEn: string
  bgColor: string
  fontColor: string
  placement: 'top_left' | 'top_right' | 'bottom_left' | 'under_title'
}

export interface WireAllergy {
  id: string
  nameEl: string
  nameEn: string | null
  description: string | null
}

export interface WireIngredientAllergyMapping {
  ingredientId: string
  allergyIds: string[]
}

export interface CatalogResponse {
  categories: WireCategory[]
  tags: WireTag[]
  allergies: WireAllergy[]
  ingredientAllergies: WireIngredientAllergyMapping[]
  generatedAt: string
}

export interface WireVariant {
  id: string
  labelEl: string
  labelEn: string
  price: number  // cents
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  sortOrder: number
  isDefault: boolean
}

export interface WireDish {
  id: string
  categoryId: string
  nameEl: string
  nameEn: string
  descEl: string | null
  descEn: string | null
  imageUrl: string | null
  emoji: string | null
  discountPct: number | null
  previewCal: number | null
  previewPro: number | null
  previewCarb: number | null
  previewFat: number | null
  variantUxMode: 'auto' | 'pills' | 'dropdowns'
  variants: WireVariant[]
  tagIds: string[]
  ingredientIds: string[]
}

export interface WireDay {
  date: string
  dishIds: string[]
}

export interface WeekResponse {
  menuId: string
  days: WireDay[]
  dishes: WireDish[]
  generatedAt: string
}

// ─── Memoization state ──────────────────────────────────────────────────────
//
// Three independent caches. Per-week is keyed by menuId so different
// weeks don't share cache entries. Concurrent callers for the same key
// share one in-flight promise; resolved data is held in the matching
// cached slot for the lifetime of the tab.

let metaCached: MetaResponse | null = null
let metaInFlight: Promise<MetaResponse | null> | null = null

let catalogCached: CatalogResponse | null = null
let catalogInFlight: Promise<CatalogResponse | null> | null = null

const weekCache = new Map<string, WeekResponse>()
const weekInFlight = new Map<string, Promise<WeekResponse | null>>()

// ─── Generic GET helper ─────────────────────────────────────────────────────

async function getJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      if (typeof console !== 'undefined') {
        console.error(`[${label}] non-OK response`, res.status, url)
      }
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.error(`[${label}] fetch failed`, e)
    }
    return null
  }
}

// ─── /api/menu/meta ─────────────────────────────────────────────────────────

export async function getMeta(force = false): Promise<MetaResponse | null> {
  if (force) resetMeta()
  if (metaCached) return metaCached
  if (metaInFlight) return metaInFlight

  metaInFlight = (async () => {
    const data = await getJson<MetaResponse>('/api/menu-meta', 'menu-meta')
    if (data) metaCached = data
    metaInFlight = null
    return data
  })()
  return metaInFlight
}

export function resetMeta() {
  metaCached = null
  metaInFlight = null
}

// ─── /api/menu/catalog ──────────────────────────────────────────────────────

export async function getCatalog(force = false): Promise<CatalogResponse | null> {
  if (force) resetCatalog()
  if (catalogCached) return catalogCached
  if (catalogInFlight) return catalogInFlight

  catalogInFlight = (async () => {
    const data = await getJson<CatalogResponse>('/api/menu-catalog', 'menu-catalog')
    if (data) catalogCached = data
    catalogInFlight = null
    return data
  })()
  return catalogInFlight
}

export function resetCatalog() {
  catalogCached = null
  catalogInFlight = null
}

// ─── /api/menu/week?menuId=... ──────────────────────────────────────────────

export async function getWeek(menuId: string, force = false): Promise<WeekResponse | null> {
  if (force) resetWeek(menuId)
  const cached = weekCache.get(menuId)
  if (cached) return cached
  const flying = weekInFlight.get(menuId)
  if (flying) return flying

  const p = (async () => {
    const data = await getJson<WeekResponse>(
      `/api/menu-week?menuId=${encodeURIComponent(menuId)}`,
      'menu-week',
    )
    if (data) weekCache.set(menuId, data)
    weekInFlight.delete(menuId)
    return data
  })()
  weekInFlight.set(menuId, p)
  return p
}

export function resetWeek(menuId: string) {
  weekCache.delete(menuId)
  weekInFlight.delete(menuId)
}

export function resetAllWeeks() {
  weekCache.clear()
  weekInFlight.clear()
}

/** Nuke every cached endpoint. Used by `useMenuStore.reload`. */
export function resetAll() {
  resetMeta()
  resetCatalog()
  resetAllWeeks()
}

// ─── Mappers: wire → domain types ───────────────────────────────────────────

const centsToEuros = (cents: number): number => +(cents / 100).toFixed(2)

const toMacros = (v: Pick<WireVariant, 'calories' | 'protein' | 'carbs' | 'fat'>): Macros => ({
  cal: v.calories ?? 0,
  pro: v.protein ?? 0,
  carb: v.carbs ?? 0,
  fat: v.fat ?? 0,
})

export function wireDishToDish(w: WireDish): Dish {
  return {
    id: w.id,
    emoji: w.emoji ?? '🍽️',
    img: w.imageUrl ?? undefined,
    nameEl: w.nameEl,
    nameEn: w.nameEn,
    descEl: w.descEl ?? undefined,
    descEn: w.descEn ?? undefined,
    catId: w.categoryId,
    tags: w.tagIds.length > 0 ? w.tagIds : undefined,
    discount: w.discountPct ?? undefined,
    variants: w.variants.map<Variant>((v) => ({
      id: v.id,
      labelEl: v.labelEl,
      labelEn: v.labelEn,
      isDefault: v.isDefault,
      price: centsToEuros(v.price),
      macros: toMacros(v),
    })),
    previewCal: w.previewCal ?? undefined,
    previewPro: w.previewPro ?? undefined,
    previewCarb: w.previewCarb ?? undefined,
    previewFat: w.previewFat ?? undefined,
    variantUxMode: w.variantUxMode,
  }
}

export function wireCategoryToCategory(w: WireCategory): CategoryDef {
  return { id: w.id, labelEl: w.labelEl, labelEn: w.labelEn }
}

export function wireTagToTag(w: WireTag): TagDef {
  return {
    id: w.id,
    labelEl: w.labelEl,
    labelEn: w.labelEn,
    bgColor: w.bgColor,
    fontColor: w.fontColor,
    placement: w.placement as TagPlacement,
  }
}

export function wireAllergyToAllergy(w: WireAllergy): AllergyDef {
  return {
    id: w.id,
    nameEl: w.nameEl,
    nameEn: w.nameEn,
    description: w.description,
  }
}

// ─── Diet catalog builders ──────────────────────────────────────────────────
//
// The diet catalog has two halves:
//   1. GLOBAL (from /api/menu/catalog): allergies list + ingredient→allergy.
//   2. PER-DISH (from /api/menu/week): dish→ingredient + derived dish→allergy.
//
// `buildInitialDietCatalog` builds half (1) — used right after catalog
//   loads, before any week dishes have arrived.
// `extendDietCatalog` returns a NEW catalog with half (2) extended for
//   the given week's dishes. Called by the store after each getWeek
//   resolves. Pure / immutable — creates fresh Map and Set instances so
//   Zustand triggers re-renders on state change.

export function buildInitialDietCatalog(catalog: CatalogResponse): DietCatalog {
  const allergies: AllergyDef[] = catalog.allergies.map(wireAllergyToAllergy)
  const ingredientAllergies = new Map<string, Set<string>>()
  for (const { ingredientId, allergyIds } of catalog.ingredientAllergies) {
    ingredientAllergies.set(ingredientId, new Set(allergyIds))
  }
  return {
    allergies,
    dishAllergies: new Map(),
    dishIngredients: new Map(),
    ingredientAllergies,
  }
}

export function extendDietCatalog(prev: DietCatalog, dishes: WireDish[]): DietCatalog {
  // Clone the dish-keyed maps so the resulting catalog is a new reference
  // (Zustand triggers re-renders on reference change). The
  // `ingredientAllergies` and `allergies` halves never change after the
  // initial catalog load, so we can pass them through by reference.
  const dishIngredients = new Map(prev.dishIngredients)
  const dishAllergies = new Map(prev.dishAllergies)

  for (const d of dishes) {
    const ingSet = new Set(d.ingredientIds)
    dishIngredients.set(d.id, ingSet)

    const aSet = new Set<string>()
    for (const ingId of d.ingredientIds) {
      const allergyIds = prev.ingredientAllergies.get(ingId)
      if (allergyIds) {
        for (const a of allergyIds) aSet.add(a)
      }
    }
    if (aSet.size > 0) dishAllergies.set(d.id, aSet)
  }

  return {
    allergies: prev.allergies,
    ingredientAllergies: prev.ingredientAllergies,
    dishIngredients,
    dishAllergies,
  }
}
