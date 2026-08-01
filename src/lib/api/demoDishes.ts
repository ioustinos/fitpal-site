// WEC-582: customer-facing "demo dishes" showcase for the subscription wizard.
//
// The wizard link «Δες μερικά πιάτα από το μενού μας» opens a popup of a small,
// admin-curated set of dishes. The curation is stored as a plain id list in
// `settings.demo_dish_ids` (jsonb array of dish ids) — no per-dish column, no
// extra table. `settings` is publicly readable, so the customer reads it
// directly; the admin page writes it via the existing admin RLS.
//
// Independent of the weekly menu — it's a taste of the catalogue, not an
// orderable menu, so it does NOT go through the edge-cached weekly menu API.
// Grouped by category in the global category sort order; within a category the
// admin's chosen id order is preserved. Categories with zero picked dishes are
// omitted. kcal + macros come from each dish's base variant (lowest sort_order).

import { supabase } from '../supabase'

/** Settings key holding the curated dish-id list (jsonb array of strings). */
export const DEMO_DISH_IDS_KEY = 'demo_dish_ids'

export interface DemoDish {
  id: string
  nameEl: string
  nameEn: string
  imageUrl: string | null
  /** From the dish's base (lowest sort_order) variant. Null if no variants. */
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

export interface DemoCategory {
  id: string
  nameEl: string
  nameEn: string
  dishes: DemoDish[]
}

/** Read + normalise the curated id list from settings. Shared by customer + admin. */
export async function fetchDemoDishIds(): Promise<{ data: string[] | null; error: string | null }> {
  const res = await supabase.from('settings').select('value').eq('key', DEMO_DISH_IDS_KEY).maybeSingle()
  if (res.error) return { data: null, error: res.error.message }
  const raw = (res.data as { value?: unknown } | null)?.value
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  return { data: ids, error: null }
}

export async function fetchDemoDishes(): Promise<{ data: DemoCategory[] | null; error: string | null }> {
  // 1) The curated id list.
  const idsRes = await fetchDemoDishIds()
  if (idsRes.error) return { data: null, error: idsRes.error }
  const ids = idsRes.data ?? []
  if (ids.length === 0) return { data: [], error: null }
  const orderIndex = new Map(ids.map((id, i) => [id, i]))

  // 2) The dishes themselves (active only).
  const dishesRes = await supabase
    .from('dishes')
    .select('id, name_el, name_en, image_url, category_id')
    .in('id', ids)
    .eq('active', true)
  if (dishesRes.error) return { data: null, error: dishesRes.error.message }
  const dishRows = (dishesRes.data ?? []) as {
    id: string; name_el: string | null; name_en: string | null
    image_url: string | null; category_id: string | null
  }[]
  if (dishRows.length === 0) return { data: [], error: null }

  // 3) Base variant per dish (lowest sort_order) → kcal + macros.
  const varRes = await supabase
    .from('dish_variants')
    .select('dish_id, calories, protein, carbs, fat, sort_order')
    .in('dish_id', dishRows.map((d) => d.id))
    .order('sort_order', { ascending: true })
  if (varRes.error) return { data: null, error: varRes.error.message }
  const baseVariant = new Map<string, { calories: number | null; protein: number | null; carbs: number | null; fat: number | null }>()
  for (const v of (varRes.data ?? []) as {
    dish_id: string; calories: number | null; protein: number | null; carbs: number | null; fat: number | null; sort_order: number | null
  }[]) {
    if (!baseVariant.has(v.dish_id)) {
      baseVariant.set(v.dish_id, { calories: v.calories, protein: v.protein, carbs: v.carbs, fat: v.fat })
    }
  }

  // 4) Categories for names + global sort order.
  const catRes = await supabase
    .from('categories')
    .select('id, name_el, name_en, sort_order, active')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (catRes.error) return { data: null, error: catRes.error.message }
  const catRows = (catRes.data ?? []) as {
    id: string; name_el: string | null; name_en: string | null; sort_order: number | null; active: boolean | null
  }[]

  // 5) Group dishes under their category; within a category preserve the
  //    admin's chosen order (the id-list order).
  const byCat = new Map<string, DemoDish[]>()
  for (const d of dishRows) {
    const cid = d.category_id ?? '__uncat__'
    const bv = baseVariant.get(d.id)
    const arr = byCat.get(cid) ?? []
    arr.push({
      id: d.id,
      nameEl: d.name_el ?? '',
      nameEn: d.name_en ?? '',
      imageUrl: d.image_url,
      calories: bv?.calories ?? null,
      protein: bv?.protein ?? null,
      carbs: bv?.carbs ?? null,
      fat: bv?.fat ?? null,
    })
    byCat.set(cid, arr)
  }
  for (const arr of byCat.values()) {
    arr.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0))
  }

  const out: DemoCategory[] = []
  for (const c of catRows) {
    const dishes = byCat.get(c.id)
    if (!dishes || dishes.length === 0) continue // omit empty categories
    out.push({ id: c.id, nameEl: c.name_el ?? '', nameEn: c.name_en ?? '', dishes })
  }
  return { data: out, error: null }
}
