/**
 * WEC-350: menu meta endpoint.
 *
 * Tiny response (~5KB) containing every active weekly menu's NAVIGATION
 * data — id, label, categoryOrder, inactive_dates, and the list of dates
 * that have any dish assigned. No dish content, no variants, no tags.
 *
 * The customer site uses this to render the week-toggle nav and the day
 * strip skeleton before any dish data arrives. Dish content for each
 * week is loaded separately via /api/menu/week?menuId=... — eager for
 * pivot ± 1, lazy for everything else.
 *
 * Read via the Supabase anon key (public-read RLS already covers these
 * tables). Edge-cached: 5 min TTL + 24h stale-while-revalidate.
 */

import type { Handler } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
  // WEC-351: tag so admin menu edits can purge this instantly (else up to 5 min).
  'Netlify-Cache-Tag': 'menu',
  'Content-Type': 'application/json; charset=utf-8',
} as const

// ─── Wire types (kept in sync with src/lib/api/bootstrap.ts) ───────────────

interface WireWeekDayMeta {
  date: string
  inactive: boolean
}

interface WireWeekMeta {
  id: string
  labelEl: string
  labelEn: string
  categoryOrder: string[]
  days: WireWeekDayMeta[]
}

interface MetaResponse {
  weeks: WireWeekMeta[]
  generatedAt: string
}

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface DbWeeklyMenu {
  id: string
  name: string
  from_date: string
  to_date: string
  active: boolean
  inactive_dates: string[] | null
  category_order: string[] | null
}

// ─── Handler ────────────────────────────────────────────────────────────────

export const handler: Handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Supabase env vars missing' }),
    }
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 1. Active weekly menus, chronological. Only the recent past (for the
    //    nav "← prev week" toggle) + current + future — NOT all history. The
    //    customer can't order weeks that ended weeks ago (cutoffs long passed),
    //    and pulling every week back to launch is what blew past the 1000-row
    //    cap and truncated the newest week. 14-day lookback keeps a prev-week
    //    context while bounding the payload.
    const lookback = new Date()
    lookback.setUTCDate(lookback.getUTCDate() - 14)
    const cutoffIso = lookback.toISOString().slice(0, 10)
    const { data: menuRows, error: menuErr } = await supabase
      .from('weekly_menus')
      .select('id, name, from_date, to_date, active, inactive_dates, category_order')
      .eq('active', true)
      .gte('to_date', cutoffIso)
      .order('from_date')

    if (menuErr) throw new Error(`weekly_menus: ${menuErr.message}`)
    const menus = (menuRows ?? []) as DbWeeklyMenu[]

    // 2. Distinct (menu_id, date) pairs for those menus. We DON'T pull
    //    dish_id here — that's what /api/menu/week is for. Just the dates.
    const menuIds = menus.map((m) => m.id)
    let dayRows: { menu_id: string; date: string }[] = []
    if (menuIds.length > 0) {
      // Paginate: PostgREST caps a single response at ~1000 rows. Once enough
      // weeks accumulate (>1000 total day-assignments) an un-paged query
      // silently truncates the LATEST dates — dropping the newest week's days
      // from the customer nav. Page through in 1000-row windows until drained.
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('menu_day_dishes')
          .select('menu_id, date')
          .in('menu_id', menuIds)
          .order('date')
          .range(from, from + PAGE - 1)
        if (error) throw new Error(`menu_day_dishes: ${error.message}`)
        const batch = (data ?? []) as { menu_id: string; date: string }[]
        dayRows.push(...batch)
        if (batch.length < PAGE) break
      }
    }

    // 3. Group dates by menu_id (deduplicated).
    const datesByMenu = new Map<string, Set<string>>()
    for (const r of dayRows) {
      const set = datesByMenu.get(r.menu_id) ?? new Set<string>()
      set.add(r.date)
      datesByMenu.set(r.menu_id, set)
    }

    // 4. Build wire weeks. Each week's `days` is the union of dates that
    //    have assignments + inactive_dates from the menu row, sorted.
    //    Inactive flag set per date. Matches WEC-273 behaviour: closed
    //    days appear in the strip greyed out instead of silently missing.
    const wireWeeks: WireWeekMeta[] = menus.map((m) => {
      const inactiveSet = new Set(m.inactive_dates ?? [])
      const assignmentDates = datesByMenu.get(m.id) ?? new Set<string>()
      const allDates = new Set<string>([...assignmentDates, ...inactiveSet])
      const sortedDates = [...allDates].sort()

      return {
        id: m.id,
        labelEl: m.name,
        labelEn: m.name,
        categoryOrder: m.category_order ?? [],
        days: sortedDates.map<WireWeekDayMeta>((date) => ({
          date,
          inactive: inactiveSet.has(date),
        })),
      }
    })

    const body: MetaResponse = {
      weeks: wireWeeks,
      generatedAt: new Date().toISOString(),
    }

    return {
      statusCode: 200,
      headers: { ...CACHE_HEADERS },
      body: JSON.stringify(body),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return {
      statusCode: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ error: `menu-meta failed: ${message}` }),
    }
  }
}
