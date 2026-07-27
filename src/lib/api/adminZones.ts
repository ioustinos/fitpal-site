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

/**
 * Normalize a postcode entry for storage: strip ALL whitespace + trim.
 * Greek postcodes are commonly typed as "116 36" by humans, but the lookup
 * pipeline (resolveZone client-side, submit-order server-side) compares
 * against a no-whitespace canonical form. If admin enters "116 36" raw,
 * the entry is silently un-findable. Normalizing on save closes the gap.
 *
 * Also drops empty entries so admins can paste a comma-separated list with
 * trailing commas without polluting the array.
 */
function normalizePostcodes(input: string[]): string[] {
  return input
    .map((p) => (p ?? '').replace(/\s/g, ''))
    .filter((p) => p.length > 0)
}

export async function saveZone(z: AdminZone): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('delivery_zones')
    .update({
      name_el: z.nameEl,
      name_en: z.nameEn || null,
      postcodes: normalizePostcodes(z.postcodes),
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

// ─── WEC-568: canonical delivery windows ────────────────────────────────────

export interface SlotWindow { from: string; to: string; label: string }

/**
 * WEC-568: the canonical delivery windows from `settings.time_slots`
 * ("HH:MM-HH:MM" strings). Zone slots must be PICKED from these — the old free
 * `<input type=time>` rendered 12-hour AM/PM per OS locale, so "12:00" (noon)
 * got recorded as 12:00 AM = 00:00 and the `zone_time_slots_check` (from < to)
 * constraint rejected it. A dropdown of these windows kills the whole class.
 * Falls back to the 5 standard windows if the setting is missing.
 */
export async function fetchTimeSlotCatalog(): Promise<{ windows: SlotWindow[]; error: string | null }> {
  const parse = (arr: string[]): SlotWindow[] =>
    arr
      .map((s) => {
        const [from, to] = s.split('-').map((x) => x.trim().slice(0, 5))
        return from && to ? { from, to, label: `${from}–${to}` } : null
      })
      .filter((w): w is SlotWindow => w !== null)
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'time_slots').maybeSingle()
  if (error) return { windows: [], error: error.message }
  const raw = (data?.value as string[] | null) ?? []
  const windows = raw.length
    ? parse(raw)
    : parse(['09:00-11:00', '10:00-12:00', '11:00-13:00', '12:00-14:00', '13:00-15:00'])
  return { windows, error: null }
}

/**
 * WEC-568 / WEC-396: turn the raw Postgres `zone_time_slots_check` error into a
 * clear bilingual message instead of leaking SQL to the admin.
 */
export function friendlyTimeSlotError(msg: string): string {
  if (/zone_time_slots_check/i.test(msg) || /violates check constraint/i.test(msg)) {
    return 'Η ώρα λήξης πρέπει να είναι μετά την ώρα έναρξης / End time must be after start time'
  }
  return msg
}
