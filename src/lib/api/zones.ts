import { supabase } from '../supabase'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeliveryZone {
  id: string
  nameEl: string
  nameEn: string
  postcodes: string[]
}

export interface TimeSlot {
  zoneId: string
  timeFrom: string   // "HH:MM"
  timeTo: string     // "HH:MM"
}

export interface ZonesData {
  zones: DeliveryZone[]
  slots: TimeSlot[]
}

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface DbZone {
  id: string
  name_el: string
  name_en: string
  postcodes: string[]
  active: boolean
}

interface DbSlot {
  zone_id: string
  time_from: string   // "HH:MM:SS"
  time_to: string
  active: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** "09:00:00" → "9:00" */
const fmtTime = (t: string): string => {
  const [h, m] = t.split(':')
  return `${parseInt(h)}:${m}`
}

// ─── Query ──────────────────────────────────────────────────────────────────

export async function fetchZones(): Promise<{ data: ZonesData | null; error: string | null }> {
  const [zonesRes, slotsRes] = await Promise.all([
    supabase
      .from('delivery_zones')
      .select('id, name_el, name_en, postcodes, active')
      .eq('active', true)
      .order('name_el'),
    supabase
      .from('zone_time_slots')
      .select('zone_id, time_from, time_to, active')
      .eq('active', true)
      .order('time_from'),
  ])

  if (zonesRes.error) return { data: null, error: zonesRes.error.message }
  if (slotsRes.error) return { data: null, error: slotsRes.error.message }

  const zones: DeliveryZone[] = (zonesRes.data as DbZone[]).map((z) => ({
    id: z.id,
    nameEl: z.name_el,
    nameEn: z.name_en,
    postcodes: z.postcodes ?? [],
  }))

  const slots: TimeSlot[] = (slotsRes.data as DbSlot[]).map((s) => ({
    zoneId: s.zone_id,
    timeFrom: fmtTime(s.time_from),
    timeTo: fmtTime(s.time_to),
  }))

  return { data: { zones, slots }, error: null }
}

// ─── Validation helpers (replace hardcoded ZONES / SLOTS in helpers.ts) ────

/** Check if a postcode matches any active zone */
export function findZoneByPostcode(zones: DeliveryZone[], postcode: string): DeliveryZone | undefined {
  const clean = postcode.trim().replace(/\s/g, '')
  return zones.find((z) => z.postcodes.includes(clean))
}

/** Check if a zone name matches (fuzzy — for backward compat) */
export function findZoneByName(zones: DeliveryZone[], area: string): DeliveryZone | undefined {
  const lower = area.toLowerCase()
  return zones.find((z) =>
    lower.includes(z.nameEl.toLowerCase()) || lower.includes(z.nameEn.toLowerCase()),
  )
}

/** Get available time slots for a zone */
export function slotsForZone(slots: TimeSlot[], zoneId: string): string[] {
  return slots
    .filter((s) => s.zoneId === zoneId)
    .map((s) => `${s.timeFrom}–${s.timeTo}`)
}
