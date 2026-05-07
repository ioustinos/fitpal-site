import { supabase } from '../supabase'

/**
 * Admin allergies CRUD (WEC-247).
 *
 * Direct Supabase calls — admin RLS already in place from the WEC-110 admin
 * policies. No service-role / Netlify Function needed.
 *
 * Allergy delete is gated on usage: if any ingredient or profile references
 * the allergy via the junctions, refuse with a friendly count rather than
 * cascade-deleting and silently breaking other admin's links.
 */

export interface AdminAllergy {
  id: string
  nameEl: string
  nameEn: string | null
  description: string | null
  /** Count of ingredients linked to this allergy. Computed at fetch time. */
  ingredientCount: number
  /** Count of profiles flagged with this allergy. Computed at fetch time. */
  profileCount: number
}

interface DbAllergy {
  id: string
  name_el: string
  name_en: string | null
  description: string | null
}

/**
 * Fetch all allergies + the number of ingredients/profiles linked to each.
 * Counts are aggregated client-side from two small junction queries — fine
 * at the scale we're at (allergies and ingredients are both bounded sets).
 */
export async function fetchAllergies(): Promise<{
  data: AdminAllergy[] | null
  error: string | null
}> {
  const [aRes, iaRes, paRes] = await Promise.all([
    supabase.from('allergies').select('*').order('name_el'),
    supabase.from('ingredient_allergies').select('allergy_id'),
    supabase.from('profile_allergies').select('allergy_id'),
  ])
  if (aRes.error) return { data: null, error: aRes.error.message }

  const ingByAllergy = new Map<string, number>()
  for (const r of (iaRes.data ?? []) as { allergy_id: string }[]) {
    ingByAllergy.set(r.allergy_id, (ingByAllergy.get(r.allergy_id) ?? 0) + 1)
  }
  const profByAllergy = new Map<string, number>()
  for (const r of (paRes.data ?? []) as { allergy_id: string }[]) {
    profByAllergy.set(r.allergy_id, (profByAllergy.get(r.allergy_id) ?? 0) + 1)
  }

  const allergies = (aRes.data as DbAllergy[]).map((row) => ({
    id: row.id,
    nameEl: row.name_el,
    nameEn: row.name_en,
    description: row.description,
    ingredientCount: ingByAllergy.get(row.id) ?? 0,
    profileCount: profByAllergy.get(row.id) ?? 0,
  }))
  return { data: allergies, error: null }
}

export interface SaveAllergyInput {
  id?: string  // omit to insert
  nameEl: string
  nameEn: string
  description: string
}

export async function saveAllergy(input: SaveAllergyInput): Promise<{
  data: { id: string } | null
  error: string | null
}> {
  if (!input.nameEl.trim()) return { data: null, error: 'Greek name is required' }

  const row = {
    name_el: input.nameEl.trim(),
    name_en: input.nameEn.trim() || null,
    description: input.description.trim() || null,
  }

  if (input.id) {
    const { error } = await supabase.from('allergies').update(row).eq('id', input.id)
    if (error) return { data: null, error: error.message }
    return { data: { id: input.id }, error: null }
  }
  const { data, error } = await supabase.from('allergies').insert(row).select('id').single()
  if (error || !data) return { data: null, error: error?.message ?? 'Insert failed' }
  return { data: { id: data.id as string }, error: null }
}

export async function deleteAllergy(id: string): Promise<{
  error: string | null
  blockedBy?: { ingredientCount: number; profileCount: number }
}> {
  // Check usage first — friendlier than a cascade DELETE that wipes admin work.
  const [iaRes, paRes] = await Promise.all([
    supabase.from('ingredient_allergies').select('ingredient_id', { count: 'exact', head: true }).eq('allergy_id', id),
    supabase.from('profile_allergies').select('profile_id', { count: 'exact', head: true }).eq('allergy_id', id),
  ])
  const ingredientCount = iaRes.count ?? 0
  const profileCount = paRes.count ?? 0
  if (ingredientCount > 0 || profileCount > 0) {
    return {
      error: `In use: ${ingredientCount} ingredients, ${profileCount} profiles. Unlink first.`,
      blockedBy: { ingredientCount, profileCount },
    }
  }
  const { error } = await supabase.from('allergies').delete().eq('id', id)
  return { error: error?.message ?? null }
}
