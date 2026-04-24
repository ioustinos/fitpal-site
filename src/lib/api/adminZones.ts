import { supabase } from '../supabase'

export interface AdminTimeSlot {
  id: string
  zoneId: string
  timeFrom: string   // 'HH:MM' or 'HH:MM:SS'
  timeTo: string
  active: boolean
}

export interface AdminZone {
  id: string
  nameEl: string
  nameEn: string
  postcodes: string[]
  active: boolean
  minOrderAmount: number | null   // cents; null = fall back to global
  timeSlots: AdminTimeSlot[]
}

export async function fetchAdminZones(): Promise<{ data: AdminZone[] | null; error: string | null }> {
  const [zonesRes, slotsRes] = await Promise.all([
    supabase.from('delivery_zones').select('*').order('name_el'),
    supabase.from('zone_time_slots').select('*').order('time_from'),
  ])
  if (zonesRes.error) return { data: null, error: zonesRes.error.message }
  if (slotsRes.error) return { data: null, error: slotsRes.error.message }

  const slotsByZone = new Map<string, AdminTimeSlot[]>()
  for (const s of slotsRes.data ?? []) {
    const row = s as { id: string; zone_id: string; time_from: string; time_to: string; active: boolean | null }
    const arr = slotsByZone.get(row.zone_id) ?? []
    arr.push({
      id: row.id, zoneId: row.zone_id,
      timeFrom: row.time_from.slice(0, 5), timeTo: row.time_to.slice(0, 5),
      active: row.active ?? true,
    })
    slotsByZone.set(row.zone_id, arr)
  }

  const zones: AdminZone[] = (zonesRes.data ?? []).map((z) => {
    const row = z as {
      id: string; name_el: string; name_en: string | null;
      postcodes: string[] | null; active: boolean | null;
      min_order_amount: number | null;
    }
    return {
      id: row.id, nameEl: row.name_el, nameEn: row.name_en ?? '',
      postcodes: row.postcodes ?? [],
      active: row.active ?? true,
      minOrderAmount: row.min_order_amount,
      timeSlots: slotsByZone.get(row.id) ?? [],
    }
  })
  return { data: zones, error: null }
}

export async function createZone(input: { nameEl: string; nameEn: string }): Promise<{ data: AdminZone | null; error: string | null }> {
  const { data, error } = await supabase
    .from('delivery_zones')
    .insert({ name_el: input.nameEl, name_en: input.nameEn, postcodes: [], active: true })
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  const row = data as { id: string; name_el: string; name_en: string | null; postcodes: string[] | null; active: boolean | null; min_order_amount: number | null }
  return {
    data: {
      id: row.id, nameEl: row.name_el, nameEn: row.name_en ?? '',
      postcodes: row.postcodes ?? [], active: row.active ?? true,
      minOrderAmount: row.min_order_amount, timeSlots: [],
    },
    error: null,
  }
}

export async function saveZone(z: AdminZone): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('delivery_zones')
    .update({
      name_el: z.nameEl,
      name_en: z.nameEn || null,
      postcodes: z.postcodes,
      active: z.active,
      min_order_amount: z.minOrderAmount,
    })
    .eq('id', z.id)
  return { error: error?.message ?? null }
}

export async function deleteZone(id: string): Promise<{ error: string | null }> {
  // Cascade: child_orders retains its own address_zip snapshot, so no ref check needed
  await supabase.from('zone_time_slots').delete().eq('zone_id', id)
  const { error } = await supabase.from('delivery_zones').delete().eq('id', id)
  return { error: error?.message ?? null }
}

// ─── Time slots ──────────────────────────────────────────────────────────

function normalizeTime(s: string): string {
  return s.length <= 5 ? `${s}:00` : s
}

export async function createTimeSlot(zoneId: string, timeFrom: string, timeTo: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('zone_time_slots').insert({
    zone_id: zoneId,
    time_from: normalizeTime(timeFrom),
    time_to: normalizeTime(timeTo),
    active: true,
  })
  return { error: error?.message ?? null }
}

export async function saveTimeSlot(s: AdminTimeSlot): Promise<{ error: string | null }> {
  const { error } = await supabase.from('zone_time_slots').update({
    time_from: normalizeTime(s.timeFrom),
    time_to: normalizeTime(s.timeTo),
    active: s.active,
  }).eq('id', s.id)
  return { error: error?.message ?? null }
}

export async function deleteTimeSlot(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('zone_time_slots').delete().eq('id', id)
  return { error: error?.message ?? null }
}
