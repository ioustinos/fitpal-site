import { supabase } from '../supabase'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Recurring cutoff rule keyed by ISO weekday of the delivery day (1=Mon..7=Sun). */
export interface WeekdayCutoff {
  /** ISO weekday of the cutoff day (1=Mon..7=Sun, 6=Sat etc.) */
  dow: number
  /** Hour of day (0–23) */
  hour: number
}

/** Ad-hoc cutoff override for a specific delivery date. */
export interface DateCutoff {
  /** YYYY-MM-DD of the cutoff calendar day */
  cutoffDate: string
  /** Hour of day (0–23) */
  hour: number
}

export type PaymentMethodId = 'cash' | 'card' | 'link' | 'transfer' | 'wallet'

export interface ContactInfo {
  supportEmail?: string
  supportPhone?: string
  instagramUrl?: string
  facebookUrl?: string
}

export interface AppSettings {
  minOrder: number                                        // euros
  cutoffHour: number                                      // default cutoff hour on previous day
  cutoffWeekdayOverrides: Record<number, WeekdayCutoff>   // key = ISO weekday of delivery
  cutoffDateOverrides: Record<string, DateCutoff>         // key = YYYY-MM-DD of delivery
  /** Payment methods the customer checkout should offer. Empty = fall back to all. */
  paymentMethodsEnabled: PaymentMethodId[]
  /** Contact info shown to customers (footer, emails). */
  contact: ContactInfo
}

const ALL_METHODS: PaymentMethodId[] = ['cash', 'card', 'link', 'transfer', 'wallet']

const DEFAULTS: AppSettings = {
  minOrder: 15,
  cutoffHour: 18,
  cutoffWeekdayOverrides: {},
  cutoffDateOverrides: {},
  paymentMethodsEnabled: ALL_METHODS,
  contact: {},
}

// ─── Query ──────────────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<{ data: AppSettings; error: string | null }> {
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')

  if (error) return { data: DEFAULTS, error: error.message }

  const map: Record<string, unknown> = {}
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    map[row.key] = row.value
  }

  // Parse weekday overrides — keys are strings from JSONB but we coerce to numbers
  const rawWeekday = (map.cutoff_weekday_overrides as Record<string, WeekdayCutoff> | undefined) ?? {}
  const cutoffWeekdayOverrides: Record<number, WeekdayCutoff> = {}
  for (const [k, v] of Object.entries(rawWeekday)) {
    const dow = Number(k)
    if (Number.isInteger(dow) && dow >= 1 && dow <= 7 && v && typeof v.dow === 'number' && typeof v.hour === 'number') {
      cutoffWeekdayOverrides[dow] = { dow: v.dow, hour: v.hour }
    }
  }

  // Parse date overrides — passthrough with shape validation
  const rawDate = (map.cutoff_date_overrides as Record<string, DateCutoff> | undefined) ?? {}
  const cutoffDateOverrides: Record<string, DateCutoff> = {}
  for (const [k, v] of Object.entries(rawDate)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v.cutoffDate === 'string' && typeof v.hour === 'number') {
      cutoffDateOverrides[k] = { cutoffDate: v.cutoffDate, hour: v.hour }
    }
  }

  // payment_methods_enabled — array of strings; validate each against the known set
  const rawPayment = map.payment_methods_enabled
  const paymentMethodsEnabled: PaymentMethodId[] = Array.isArray(rawPayment)
    ? (rawPayment as unknown[]).filter((v): v is PaymentMethodId =>
        typeof v === 'string' && (ALL_METHODS as string[]).includes(v),
      )
    : ALL_METHODS
  const paymentMethodsFinal = paymentMethodsEnabled.length > 0 ? paymentMethodsEnabled : ALL_METHODS

  // contact — object with known string fields
  const rawContact = (map.contact as Record<string, unknown> | undefined) ?? {}
  const contact: ContactInfo = {}
  if (typeof rawContact.supportEmail === 'string') contact.supportEmail = rawContact.supportEmail
  if (typeof rawContact.supportPhone === 'string') contact.supportPhone = rawContact.supportPhone
  if (typeof rawContact.instagramUrl === 'string') contact.instagramUrl = rawContact.instagramUrl
  if (typeof rawContact.facebookUrl === 'string') contact.facebookUrl = rawContact.facebookUrl

  return {
    data: {
      minOrder: typeof map.min_order === 'number' ? map.min_order / 100 : DEFAULTS.minOrder,
      cutoffHour: typeof map.cutoff_hour === 'number' ? map.cutoff_hour : DEFAULTS.cutoffHour,
      cutoffWeekdayOverrides,
      cutoffDateOverrides,
      paymentMethodsEnabled: paymentMethodsFinal,
      contact,
    },
    error: null,
  }
}
