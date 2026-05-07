import { supabase } from '../supabase'

/**
 * Admin ingredients catalog CRUD (WEC-248).
 *
 * Direct Supabase client; admin RLS already covers the writes via the
 * `ingredients_admin_all` policy from the wec_ingredients_schema migration.
 *
 * Delete is gated on dish usage — the FK on dish_ingredients.ingredient_id
 * is ON DELETE RESTRICT specifically so a deleted ingredient doesn't silently
 * break recipes. We surface the friendly count instead of cascade-fixing it.
 */

export interface AdminIngredient {
  id: string
  nameEl: string
  nameEn: string | null
  searchKey: string
  defaultGrams: number | null
  active: boolean
  /** Linked allergy ids (resolved via ingredient_allergies). */
  allergyIds: string[]
  /** Number of dishes that reference this ingredient. */
  dishCount: number
}

interface DbIngredient {
  id: string
  name_el: string
  name_en: string | null
  search_key: string
  default_grams: number | string | null
  active: boolean
  sort_order: number
}

/**
 * Canonical search-key form. MUST match scripts/ingest-menu-csv.py and
 * src/lib/menu-csv/parse.ts so the catalog dedupes consistently regardless
 * of which path created the row.
 */
export function searchKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchIngredients(): Promise<{
  data: AdminIngredient[] | null
  error: string | null
}> {
  const [iRes, iaRes, diRes] = await Promise.all([
    supabase.from('ingredients').select('*').order('name_el'),
    supabase.from('ingredient_allergies').select('ingredient_id, allergy_id'),
    supabase.from('dish_ingredients').select('ingredient_id'),
  ])
  if (iRes.error) return { data: null, error: iRes.error.message }

  const allergiesByIng = new Map<string, string[]>()
  for (const r of (iaRes.data ?? []) as { ingredient_id: string; allergy_id: string }[]) {
    const arr = allergiesByIng.get(r.ingredient_id) ?? []
    arr.push(r.allergy_id)
    allergiesByIng.set(r.ingredient_id, arr)
  }
  const dishCountByIng = new Map<string, number>()
  for (const r of (diRes.data ?? []) as { ingredient_id: string }[]) {
    dishCountByIng.set(r.ingredient_id, (dishCountByIng.get(r.ingredient_id) ?? 0) + 1)
  }

  const out = (iRes.data as DbIngredient[]).map((row) => ({
    id: row.id,
    nameEl: row.name_el,
    nameEn: row.name_en,
    searchKey: row.search_key,
    defaultGrams: row.default_grams != null ? Number(row.default_grams) : null,
    active: row.active,
    allergyIds: allergiesByIng.get(row.id) ?? [],
    dishCount: dishCountByIng.get(row.id) ?? 0,
  }))
  return { data: out, error: null }
}

export interface SaveIngredientInput {
  id?: string
  nameEl: string
  nameEn: string
  defaultGrams: number | null
  active: boolean
  allergyIds: string[]
}

export async function saveIngredient(input: SaveIngredientInput): Promise<{
  data: { id: string } | null
  error: string | null
}> {
  if (!input.nameEl.trim()) return { data: null, error: 'Greek name is required' }

  const sk = searchKey(input.nameEl)
  const row = {
    name_el: input.nameEl.trim(),
    name_en: input.nameEn.trim() || null,
    search_key: sk,
    default_grams: input.defaultGrams,
    active: input.active,
  }

  let id: string
  if (input.id) {
    const { error } = await supabase.from('ingredients').update(row).eq('id', input.id)
    if (error) return { data: null, error: error.message }
    id = input.id
  } else {
    const { data, error } = await supabase.from('ingredients').insert(row).select('id').single()
    if (error || !data) return { data: null, error: error?.message ?? 'Insert failed' }
    id = data.id as string
  }

  // Sync allergy junctions: delete-all then insert-current. Fine at the
  // small N per ingredient (typically 0-3 allergies).
  const { error: delErr } = await supabase.from('ingredient_allergies').delete().eq('ingredient_id', id)
  if (delErr) return { data: null, error: delErr.message }

  if (input.allergyIds.length > 0) {
    const rows = input.allergyIds.map((aid) => ({ ingredient_id: id, allergy_id: aid }))
    const { error: insErr } = await supabase.from('ingredient_allergies').insert(rows)
    if (insErr) return { data: null, error: insErr.message }
  }

  return { data: { id }, error: null }
}

export async function deleteIngredient(id: string): Promise<{
  error: string | null
  blockedBy?: { dishCount: number }
}> {
  const { count } = await supabase
    .from('dish_ingredients')
    .select('dish_id', { count: 'exact', head: true })
    .eq('ingredient_id', id)
  const dishCount = count ?? 0
  if (dishCount > 0) {
    return {
      error: `In use by ${dishCount} dish${dishCount === 1 ? '' : 'es'}. Remove from those dishes first.`,
      blockedBy: { dishCount },
    }
  }
  // Junction rows on ingredient_allergies cascade-delete automatically.
  const { error } = await supabase.from('ingredients').delete().eq('id', id)
  return { error: error?.message ?? null }
}
