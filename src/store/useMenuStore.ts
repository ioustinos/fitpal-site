import { create } from 'zustand'
import {
  fetchActiveWeeksMeta,
  fetchWeekDishes,
  fetchCategories,
  type WeekMeta,
} from '../lib/api/menu'
import { fetchZones, type DeliveryZone, type TimeSlot } from '../lib/api/zones'
import { fetchSettings, type AppSettings } from '../lib/api/settings'
import { findLandingDay } from '../lib/helpers'
import { useUIStore } from './useUIStore'
import type { Dish, WeekDef, CategoryDef } from '../data/menu'

// ─── Store interface ───────────────────────────────────────────────────────────

interface MenuStore {
  /** Lightweight metadata for ALL active weeks. Source of truth for week count + dates. */
  weeksMeta: WeekMeta[]

  /**
   * Fully-loaded WeekDef[] parallel to `weeksMeta` (same length, same order).
   * Entries start with empty `dishIds[]` arrays; `dishIds` gets populated once the week is loaded.
   * Use `loadedWeekIds.has(weeks[i].id)` to check if a specific week has dish content.
   */
  weeks: WeekDef[]

  /** IDs of weeks whose dish content has been loaded. */
  loadedWeekIds: Set<string>

  /** Per-week loading flag — keyed by menu id. */
  weekLoading: Record<string, boolean>

  dishMap: Record<string, Dish>      // dish id → Dish (accumulates across loaded weeks)
  categories: CategoryDef[]
  zones: DeliveryZone[]
  timeSlots: TimeSlot[]
  settings: AppSettings

  /** Initial-load flag — true while meta + first eager weeks are loading. */
  isLoading: boolean
  error: string | null
  hasFetched: boolean

  /** Fetch meta + categories + zones + settings + eager weeks. Idempotent. */
  load: () => Promise<void>

  /** Force re-fetch. */
  reload: () => Promise<void>

  /** Lazy-load dish content for a single week. Guarded — no-op if already loaded/loading. */
  loadWeek: (menuId: string) => Promise<void>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a placeholder WeekDef[] from meta — same length, empty dishIds. */
function buildPlaceholderWeeks(meta: WeekMeta[]): WeekDef[] {
  return meta.map((m) => ({
    id: m.id,
    labelEl: m.labelEl,
    labelEn: m.labelEn,
    days: m.days.map((d) => ({ date: d.date, dishIds: [] })),
  }))
}

/** Eager-load window: pivot + prev + next (bounds-clamped, deduped). */
function eagerIndexes(pivot: number, total: number): number[] {
  const out = new Set<number>()
  for (const i of [pivot - 1, pivot, pivot + 1]) {
    if (i >= 0 && i < total) out.add(i)
  }
  return [...out]
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useMenuStore = create<MenuStore>((set, get) => ({
  weeksMeta: [],
  weeks: [],
  loadedWeekIds: new Set<string>(),
  weekLoading: {},
  dishMap: {},
  categories: [],
  zones: [],
  timeSlots: [],
  settings: {
    minOrder: 15,
    cutoffHour: 18,
    cutoffWeekdayOverrides: {},
    cutoffDateOverrides: {},
    paymentMethodsEnabled: ['cash', 'card', 'link', 'transfer', 'wallet'],
    contact: {},
  },
  isLoading: false,
  error: null,
  hasFetched: false,

  load: async () => {
    if (get().hasFetched || get().isLoading) return
    await get().reload()
  },

  reload: async () => {
    set({ isLoading: true, error: null })

    // Phase 1: parallel fetch for meta + categories + zones + settings
    const [metaRes, catsRes, zonesRes, settingsRes] = await Promise.all([
      fetchActiveWeeksMeta(),
      fetchCategories(),
      fetchZones(),
      fetchSettings(),
    ])

    if (metaRes.error || !metaRes.data) {
      set({
        isLoading: false,
        error: metaRes.error ?? 'Failed to load menu',
        hasFetched: true,
      })
      return
    }

    const weeksMeta = metaRes.data
    const weeks = buildPlaceholderWeeks(weeksMeta)
    const settings = settingsRes.data

    // Phase 2: compute landing day using meta + full settings (cutoff rules)
    const landing = findLandingDay(weeksMeta, settings)

    // Phase 3: eager-fetch pivot + prev + next in parallel
    const indexesToLoad = eagerIndexes(landing.weekIndex, weeksMeta.length)
    const menuIdsToLoad = indexesToLoad.map((i) => weeksMeta[i].id)

    const eagerLoading: Record<string, boolean> = {}
    for (const id of menuIdsToLoad) eagerLoading[id] = true

    // Commit placeholder state + loading flags first so components can render the skeleton.
    set({
      weeksMeta,
      weeks,
      loadedWeekIds: new Set(),
      weekLoading: eagerLoading,
      dishMap: {},
      categories: catsRes.data ?? [],
      zones: zonesRes.data?.zones ?? [],
      timeSlots: zonesRes.data?.slots ?? [],
      settings,
      isLoading: false, // meta loaded — the UI can now paint
      error: null,
      hasFetched: true,
    })

    // Land IMMEDIATELY using meta (don't wait for dish content)
    useUIStore.setState({
      activeWeek: landing.weekIndex,
      activeDay: landing.dayIndex,
      activeCat: null,
    })

    // Kick off the eager dish fetches
    const results = await Promise.all(
      menuIdsToLoad.map((id) => fetchWeekDishes(id)),
    )

    // Merge results into weeks + dishMap atomically
    const cur = get()
    const mergedWeeks = [...cur.weeks]
    const mergedDishMap = { ...cur.dishMap }
    const mergedLoaded = new Set(cur.loadedWeekIds)
    const mergedLoading = { ...cur.weekLoading }

    for (let k = 0; k < results.length; k++) {
      const res = results[k]
      const id = menuIdsToLoad[k]
      mergedLoading[id] = false
      if (res.error || !res.data) continue

      // Find the week index by id and overwrite its days
      const wi = mergedWeeks.findIndex((w) => w.id === id)
      if (wi >= 0) {
        // Preserve the week's order from meta; overwrite days with real dishIds
        mergedWeeks[wi] = {
          ...mergedWeeks[wi],
          days: res.data.days,
        }
      }
      for (const dish of res.data.dishes) mergedDishMap[dish.id] = dish
      mergedLoaded.add(id)
    }

    set({
      weeks: mergedWeeks,
      dishMap: mergedDishMap,
      loadedWeekIds: mergedLoaded,
      weekLoading: mergedLoading,
    })
  },

  loadWeek: async (menuId: string) => {
    const state = get()
    if (state.loadedWeekIds.has(menuId)) return
    if (state.weekLoading[menuId]) return

    set({ weekLoading: { ...state.weekLoading, [menuId]: true } })

    const res = await fetchWeekDishes(menuId)

    const cur = get()
    const nextLoading = { ...cur.weekLoading, [menuId]: false }

    if (res.error || !res.data) {
      set({ weekLoading: nextLoading })
      return
    }

    const nextWeeks = [...cur.weeks]
    const wi = nextWeeks.findIndex((w) => w.id === menuId)
    if (wi >= 0) {
      nextWeeks[wi] = { ...nextWeeks[wi], days: res.data.days }
    }

    const nextDishMap = { ...cur.dishMap }
    for (const dish of res.data.dishes) nextDishMap[dish.id] = dish

    const nextLoaded = new Set(cur.loadedWeekIds)
    nextLoaded.add(menuId)

    set({
      weeks: nextWeeks,
      dishMap: nextDishMap,
      loadedWeekIds: nextLoaded,
      weekLoading: nextLoading,
    })
  },
}))
