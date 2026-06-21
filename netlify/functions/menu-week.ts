/**
 * WEC-350: single-week menu endpoint.
 *
 * Takes `?menuId=...` and returns the full dish content for that one
 * weekly menu — dishes, variants, tag assignments, ingredient assignments,
 * and the day→dishId mapping. ~25KB per week.
 *
 * Eager-fetched by the customer site for pivot ± 1 weeks (current + prev +
 * next). Lazy-fetched on click for any other week. Each menu gets its own
 * independent edge-cache entry, so the second visitor to historical week N
 * gets it sub-50ms even if only one prior visitor warmed that cache key.
 *
 * Read via Supabase anon key. Edge-cached: 5 min TTL + 24h SWR.
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

// ─── Wire types ─────────────────────────────────────────────────────────────

interface WireVariant {
  id: string
  labelEl: string
  labelEn: string
  /** Price in cents — same convention as DB; client converts to euros. */
  price: number
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  sortOrder: number
  isDefault: boolean
}

interface WireDish {
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
  /** Used client-side for the allergy join — crossed with ingredient_allergies
   *  from /api/menu/catalog. */
  ingredientIds: string[]
}

interface WireDay {
  date: string
  /** Dish IDs in admin's sort_order. */
  dishIds: string[]
}

interface WeekResponse {
  menuId: string
  days: WireDay[]
  dishes: WireDish[]
  /** Empty week (no assignments) returns dishes=[] days=[] — not an error. */
  generatedAt: string
}

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface DbMenuDayDish {
  menu_id: string
  date: string
  dish_id: string
  sort_order: number
}

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
  variant_ux_mode: 'auto' | 'pills' | 'dropdowns' | null
}

interface DbVariant {
  id: string
  dish_id: string
  label_el: string
  label_en: string
  price: number
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  sort_order: number
  is_default: boolean
}

// ─── Handler ────────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Supabase env vars missing' }),
    }
  }

  // Param parsing. menuId is required; reject early with 400 so cache
  // doesn't serve back a 503 for a malformed request.
  const menuId = (event.queryStringParameters?.menuId ?? '').trim()
  if (!menuId) {
    return {
      statusCode: 400,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ error: 'menuId query param required' }),
    }
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 1. Day→dish assignments for THIS menu, in admin's sort_order.
    const { data: assignRows, error: aErr } = await supabase
      .from('menu_day_dishes')
      .select('menu_id, date, dish_id, sort_order')
      .eq('menu_id', menuId)
      .order('date')
      .order('sort_order')

    if (aErr) throw new Error(`menu_day_dishes: ${aErr.message}`)
    const assignments = (assignRows ?? []) as DbMenuDayDish[]

    // Empty menu: return cleanly. Cached the same as a populated one —
    // five minutes from now any newly-added dishes will appear.
    if (assignments.length === 0) {
      const body: WeekResponse = {
        menuId,
        days: [],
        dishes: [],
        generatedAt: new Date().toISOString(),
      }
      return {
        statusCode: 200,
        headers: { ...CACHE_HEADERS },
        body: JSON.stringify(body),
      }
    }

    // 2. Dish IDs deduplicated across the week's days.
    const dishIds = Array.from(new Set(assignments.map((a) => a.dish_id)))

    // 3. Parallel fetch dishes + variants + dish_tags + dish_ingredients.
    //    Each is an indexed IN-list query against dishIds.
    const [dishesRes, variantsRes, dishTagsRes, dishIngsRes] = await Promise.all([
      supabase
        .from('dishes')
        .select(
          'id, category_id, name_el, name_en, desc_el, desc_en, image_url, emoji, discount_pct, active, preview_cal, preview_pro, preview_carb, preview_fat, variant_ux_mode',
        )
        .in('id', dishIds)
        .eq('active', true),
      supabase
        .from('dish_variants')
        .select('id, dish_id, label_el, label_en, price, calories, protein, carbs, fat, sort_order, is_default')
        .in('dish_id', dishIds),
      supabase.from('dish_tags').select('dish_id, tag_id').in('dish_id', dishIds),
      supabase.from('dish_ingredients').select('dish_id, ingredient_id').in('dish_id', dishIds),
    ])

    if (dishesRes.error) throw new Error(`dishes: ${dishesRes.error.message}`)
    if (variantsRes.error) throw new Error(`dish_variants: ${variantsRes.error.message}`)
    if (dishTagsRes.error) throw new Error(`dish_tags: ${dishTagsRes.error.message}`)
    if (dishIngsRes.error) throw new Error(`dish_ingredients: ${dishIngsRes.error.message}`)

    const dishes = (dishesRes.data ?? []) as DbDish[]
    const variants = (variantsRes.data ?? []) as DbVariant[]
    const dishTags = (dishTagsRes.data ?? []) as { dish_id: string; tag_id: string }[]
    const dishIngs = (dishIngsRes.data ?? []) as { dish_id: string; ingredient_id: string }[]

    // ─── Reshape into wire format ───────────────────────────────────────

    const tagsByDish = new Map<string, string[]>()
    for (const { dish_id, tag_id } of dishTags) {
      const arr = tagsByDish.get(dish_id) ?? []
      arr.push(tag_id)
      tagsByDish.set(dish_id, arr)
    }

    const ingredientsByDish = new Map<string, string[]>()
    for (const { dish_id, ingredient_id } of dishIngs) {
      const arr = ingredientsByDish.get(dish_id) ?? []
      arr.push(ingredient_id)
      ingredientsByDish.set(dish_id, arr)
    }

    const variantsByDish = new Map<string, DbVariant[]>()
    for (const v of variants) {
      const arr = variantsByDish.get(v.dish_id) ?? []
      arr.push(v)
      variantsByDish.set(v.dish_id, arr)
    }
    for (const [k, arr] of variantsByDish) {
      arr.sort((a, b) => a.sort_order - b.sort_order)
      variantsByDish.set(k, arr)
    }

    const wireDishes: WireDish[] = dishes.map((d) => ({
      id: d.id,
      categoryId: d.category_id,
      nameEl: d.name_el,
      nameEn: d.name_en,
      descEl: d.desc_el,
      descEn: d.desc_en,
      imageUrl: d.image_url,
      emoji: d.emoji,
      discountPct: d.discount_pct,
      previewCal: d.preview_cal,
      previewPro: d.preview_pro,
      previewCarb: d.preview_carb,
      previewFat: d.preview_fat,
      variantUxMode: d.variant_ux_mode ?? 'auto',
      variants: (variantsByDish.get(d.id) ?? []).map<WireVariant>((v) => ({
        id: v.id,
        labelEl: v.label_el,
        labelEn: v.label_en,
        price: v.price,
        calories: v.calories,
        protein: v.protein,
        carbs: v.carbs,
        fat: v.fat,
        sortOrder: v.sort_order,
        isDefault: v.is_default,
      })),
      tagIds: tagsByDish.get(d.id) ?? [],
      ingredientIds: ingredientsByDish.get(d.id) ?? [],
    }))

    // Days: group assignments by date, preserve sort_order from the query.
    const dishIdsByDate = new Map<string, string[]>()
    for (const a of assignments) {
      const arr = dishIdsByDate.get(a.date) ?? []
      arr.push(a.dish_id)
      dishIdsByDate.set(a.date, arr)
    }
    const wireDays: WireDay[] = [...dishIdsByDate.entries()].map(([date, ids]) => ({ date, dishIds: ids }))

    const body: WeekResponse = {
      menuId,
      days: wireDays,
      dishes: wireDishes,
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
      body: JSON.stringify({ error: `menu-week failed: ${message}` }),
    }
  }
}
