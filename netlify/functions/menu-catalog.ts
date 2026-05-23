/**
 * WEC-350: menu catalog endpoint.
 *
 * Tiny response (~5KB) containing every piece of GLOBAL reference data
 * the customer menu needs to render:
 *   - tags (chip styling)
 *   - categories (section grouping)
 *   - allergies (badge label + description)
 *   - ingredient_allergies (which ingredient carries which allergy)
 *
 * NO dish content here — that's per-week, via /api/menu/week. The
 * dish→allergy join is computed client-side using each dish's
 * ingredientIds (returned by /api/menu/week) crossed with the
 * ingredient→allergies map from this endpoint.
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
  'Content-Type': 'application/json; charset=utf-8',
} as const

// ─── Wire types ─────────────────────────────────────────────────────────────

interface WireCategory {
  id: string
  labelEl: string
  labelEn: string
  sortOrder: number
}

interface WireTag {
  id: string
  labelEl: string
  labelEn: string
  bgColor: string
  fontColor: string
  placement: 'top_left' | 'top_right' | 'bottom_left' | 'under_title'
}

interface WireAllergy {
  id: string
  nameEl: string
  nameEn: string | null
  description: string | null
}

interface WireIngredientAllergyMapping {
  ingredientId: string
  allergyIds: string[]
}

interface CatalogResponse {
  categories: WireCategory[]
  tags: WireTag[]
  allergies: WireAllergy[]
  ingredientAllergies: WireIngredientAllergyMapping[]
  generatedAt: string
}

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface DbCategory {
  id: string
  name_el: string
  name_en: string
  sort_order: number
}

interface DbTag {
  id: string
  label_el: string
  label_en: string
  bg_color: string | null
  font_color: string | null
  placement: string | null
}

interface DbAllergy {
  id: string
  name_el: string
  name_en: string | null
  description: string | null
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
    // Four small parallel queries. All tables are public-read.
    const [catsRes, tagsRes, allergiesRes, ingAllergiesRes] = await Promise.all([
      supabase.from('categories').select('id, name_el, name_en, sort_order').eq('active', true).order('sort_order'),
      supabase.from('tags').select('id, label_el, label_en, bg_color, font_color, placement').order('sort_order'),
      supabase.from('allergies').select('id, name_el, name_en, description').order('name_el'),
      supabase.from('ingredient_allergies').select('ingredient_id, allergy_id'),
    ])

    if (catsRes.error) throw new Error(`categories: ${catsRes.error.message}`)
    if (tagsRes.error) throw new Error(`tags: ${tagsRes.error.message}`)
    if (allergiesRes.error) throw new Error(`allergies: ${allergiesRes.error.message}`)
    if (ingAllergiesRes.error) throw new Error(`ingredient_allergies: ${ingAllergiesRes.error.message}`)

    const categories = (catsRes.data ?? []) as DbCategory[]
    const tags = (tagsRes.data ?? []) as DbTag[]
    const allergies = (allergiesRes.data ?? []) as DbAllergy[]
    const ingAllergies = (ingAllergiesRes.data ?? []) as { ingredient_id: string; allergy_id: string }[]

    // ─── Reshape ────────────────────────────────────────────────────────

    const wireCategories: WireCategory[] = categories.map((c) => ({
      id: c.id,
      labelEl: c.name_el,
      labelEn: c.name_en,
      sortOrder: c.sort_order,
    }))

    const wireTags: WireTag[] = tags.map((t) => {
      const p = t.placement
      const placement: WireTag['placement'] =
        p === 'top_right' || p === 'bottom_left' || p === 'under_title' ? p : 'top_left'
      return {
        id: t.id,
        labelEl: t.label_el,
        labelEn: t.label_en ?? t.label_el,
        bgColor: t.bg_color ?? '#e0e0e0',
        fontColor: t.font_color ?? '#333333',
        placement,
      }
    })

    const wireAllergies: WireAllergy[] = allergies.map((a) => ({
      id: a.id,
      nameEl: a.name_el,
      nameEn: a.name_en,
      description: a.description,
    }))

    // ingredient_id → allergy_id[] (pivot from junction rows)
    const ingAllergyMap = new Map<string, string[]>()
    for (const { ingredient_id, allergy_id } of ingAllergies) {
      const arr = ingAllergyMap.get(ingredient_id) ?? []
      arr.push(allergy_id)
      ingAllergyMap.set(ingredient_id, arr)
    }
    const wireIngredientAllergies: WireIngredientAllergyMapping[] = []
    for (const [ingredientId, allergyIds] of ingAllergyMap) {
      wireIngredientAllergies.push({ ingredientId, allergyIds })
    }

    const body: CatalogResponse = {
      categories: wireCategories,
      tags: wireTags,
      allergies: wireAllergies,
      ingredientAllergies: wireIngredientAllergies,
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
      body: JSON.stringify({ error: `menu-catalog failed: ${message}` }),
    }
  }
}
