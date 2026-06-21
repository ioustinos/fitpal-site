import { supabase } from '../supabase'

/**
 * WEC-351: purge the customer-facing `settings` cache (cutoff rules, time
 * slots, min order, payment methods, contact) after an admin save. Fire-and-
 * forget; if it no-ops, stale-while-revalidate refreshes within ~5 min.
 */
async function purgeSettingsCache(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/purge-menu-cache', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['settings'] }),
    })
  } catch {
    /* non-fatal — SWR backstops */
  }
}

export interface SettingRow {
  key: string
  value: unknown
  description: string | null
}

export interface CutoffWeekdayOverride {
  dow: number          // 1..7, ISO weekday of CUTOFF
  hour: number         // 0..23
}

export interface CutoffDateOverride {
  cutoffDate: string   // 'YYYY-MM-DD'
  hour: number         // 0..23
}

export async function fetchAllSettings(): Promise<{ data: SettingRow[] | null; error: string | null }> {
  const { data, error } = await supabase.from('settings').select('*').order('key')
  if (error) return { data: null, error: error.message }
  return {
    data: (data ?? []).map((r) => {
      const row = r as { key: string; value: unknown; description: string | null }
      return { key: row.key, value: row.value, description: row.description }
    }),
    error: null,
  }
}

export async function setSetting(key: string, value: unknown): Promise<{ error: string | null }> {
  const { error } = await supabase.from('settings').update({ value }).eq('key', key)
  if (!error) void purgeSettingsCache()
  return { error: error?.message ?? null }
}

// ─── Allergies ────────────────────────────────────────────────────────────

export interface AdminAllergy {
  id: string
  nameEl: string
  nameEn: string
  description: string | null
}

export async function fetchAllergies(): Promise<{ data: AdminAllergy[] | null; error: string | null }> {
  const { data, error } = await supabase.from('allergies').select('*').order('name_el')
  if (error) return { data: null, error: error.message }
  return {
    data: (data ?? []).map((r) => {
      const row = r as { id: string; name_el: string; name_en: string | null; description: string | null }
      return { id: row.id, nameEl: row.name_el, nameEn: row.name_en ?? '', description: row.description }
    }),
    error: null,
  }
}

export async function saveAllergy(a: { id?: string; nameEl: string; nameEn: string; description?: string | null }): Promise<{ error: string | null }> {
  const row = { name_el: a.nameEl, name_en: a.nameEn, description: a.description ?? null }
  if (a.id) {
    const { error } = await supabase.from('allergies').update(row).eq('id', a.id)
    return { error: error?.message ?? null }
  }
  const { error } = await supabase.from('allergies').insert(row)
  return { error: error?.message ?? null }
}

export async function deleteAllergy(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('allergies').delete().eq('id', id)
  return { error: error?.message ?? null }
}
