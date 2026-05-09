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

/**
 * Per-method visibility flags (WEC-255).
 *  - public: shown to public customers at checkout
 *  - admin:  shown to an admin who's impersonating a customer
 *
 * Common patterns:
 *   { public: true,  admin: true }  — fully enabled (most methods)
 *   { public: false, admin: true }  — admin-only (e.g. wallet, when customers
 *                                     shouldn't manage it but admins fund/spend
 *                                     it on their behalf)
 *   { public: true,  admin: false } — rare, but valid (admin can't accidentally
 *                                     pick this method while impersonating)
 *   { public: false, admin: false } — fully disabled
 */
export interface PaymentMethodVisibility {
  public: boolean
  admin: boolean
}

export type PaymentMethodVisibilityMap = Record<PaymentMethodId, PaymentMethodVisibility>

export interface ContactInfo {
  supportEmail?: string
  supportPhone?: string
  instagramUrl?: string
  facebookUrl?: string
}

export interface BankTransferInfo {
  iban: string
  beneficiary: string
  bankName?: string
}

/** Hard cap on how many IBANs the admin can configure (WEC-260). */
export const MAX_BANK_IBANS = 5

/**
 * Pickup location entry (WEC-259). Stored as an array in
 * `settings.pickup_locations`. V1 ships with one entry; the array shape
 * leaves room to expand without another schema change.
 */
export interface PickupLocation {
  id: string
  nameEl: string
  nameEn: string
  address: string
  /** ISO weekday numbers (1=Mon..7=Sun) where pickup is offered. Empty = none. */
  availableWeekdays: number[]
  hoursNoteEl?: string
  hoursNoteEn?: string
}

/**
 * How the customer dish-card macros render. WEC-254.
 *  - 'numbers' (default): real values for the preselected variant
 *      (kcal / 37g Πρωτ. / 27g Υδ/κες / 17g Λίπη)
 *  - 'dots': legacy 1-5 dot scale based on admin-set previewCal/Pro/Carb/Fat
 *
 * Both renderers ship in the bundle. Flip via /admin/settings or:
 *   update settings set value = '"dots"'::jsonb where key = 'macros_display';
 */
export type MacrosDisplay = 'numbers' | 'dots'

export interface AppSettings {
  minOrder: number                                        // euros
  cutoffHour: number                                      // default cutoff hour on previous day
  cutoffWeekdayOverrides: Record<number, WeekdayCutoff>   // key = ISO weekday of delivery
  cutoffDateOverrides: Record<string, DateCutoff>         // key = YYYY-MM-DD of delivery
  /**
   * Per-method visibility (WEC-255). Canonical source for what the customer
   * checkout offers. The legacy `paymentMethodsEnabled` array below is
   * derived from this (public-visible methods only) for back-compat.
   */
  paymentMethodVisibility: PaymentMethodVisibilityMap
  /**
   * @deprecated since WEC-255 — derived from `paymentMethodVisibility` (the
   * subset of methods with `public: true`). New code should consume the
   * visibility map directly so it can branch on impersonation context.
   */
  paymentMethodsEnabled: PaymentMethodId[]
  /** Contact info shown to customers (footer, emails). */
  contact: ContactInfo
  /**
   * Bank wire details shown when the customer picks bank-transfer (WEC-260).
   * Always an array of up to 5 entries. Empty array = no IBAN configured;
   * the customer-facing UI shows a "contact support" placeholder.
   */
  bankTransferInfos: BankTransferInfo[]
  /** Customer dish-card macros: 'numbers' (default) or 'dots' (legacy). WEC-254. */
  macrosDisplay: MacrosDisplay
  /** Pickup locations array (WEC-259). V1: 1 entry. */
  pickupLocations: PickupLocation[]
}

const ALL_METHODS: PaymentMethodId[] = ['cash', 'card', 'link', 'transfer', 'wallet']

/** Defensive default — everything visible to everyone. Used when settings row is missing. */
const DEFAULT_VISIBILITY: PaymentMethodVisibilityMap = {
  cash:     { public: true, admin: true },
  card:     { public: true, admin: true },
  link:     { public: true, admin: true },
  transfer: { public: true, admin: true },
  wallet:   { public: true, admin: true },
}

const DEFAULTS: AppSettings = {
  minOrder: 15,
  cutoffHour: 18,
  cutoffWeekdayOverrides: {},
  cutoffDateOverrides: {},
  paymentMethodVisibility: DEFAULT_VISIBILITY,
  paymentMethodsEnabled: ALL_METHODS,
  contact: {},
  bankTransferInfos: [],
  macrosDisplay: 'numbers',
  pickupLocations: [],
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

  // payment_methods_enabled — accepts two shapes for back-compat (WEC-255):
  //   1. Legacy array: ['cash','card',...] → public=true for those, admin=true
  //      for everything (admins shouldn't get more locked out by accident).
  //   2. Object map: { method: { public, admin } } → canonical post-WEC-255.
  // Anything else falls back to the default-everything-on map. Each known
  // method is shape-validated independently so a typo doesn't blank checkout.
  const rawPayment = map.payment_methods_enabled
  const paymentMethodVisibility: PaymentMethodVisibilityMap = { ...DEFAULT_VISIBILITY }
  if (Array.isArray(rawPayment)) {
    // Legacy: array of public-visible method strings.
    const allowed = new Set(
      (rawPayment as unknown[]).filter((v): v is PaymentMethodId =>
        typeof v === 'string' && (ALL_METHODS as string[]).includes(v),
      ),
    )
    for (const m of ALL_METHODS) {
      paymentMethodVisibility[m] = { public: allowed.has(m), admin: true }
    }
  } else if (rawPayment && typeof rawPayment === 'object') {
    // New object map. Validate each entry — defensive against partial writes.
    const obj = rawPayment as Record<string, unknown>
    for (const m of ALL_METHODS) {
      const entry = obj[m]
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        paymentMethodVisibility[m] = {
          public: e.public === true,
          admin:  e.admin  === true,
        }
      }
      // else leave the default for this method
    }
  }
  // Derive the legacy public-only array from the canonical map.
  const paymentMethodsEnabled: PaymentMethodId[] = ALL_METHODS.filter((m) => paymentMethodVisibility[m].public)
  const paymentMethodsFinal = paymentMethodsEnabled.length > 0 ? paymentMethodsEnabled : ALL_METHODS

  // contact — object with known string fields
  const rawContact = (map.contact as Record<string, unknown> | undefined) ?? {}
  const contact: ContactInfo = {}
  if (typeof rawContact.supportEmail === 'string') contact.supportEmail = rawContact.supportEmail
  if (typeof rawContact.supportPhone === 'string') contact.supportPhone = rawContact.supportPhone
  if (typeof rawContact.instagramUrl === 'string') contact.instagramUrl = rawContact.instagramUrl
  if (typeof rawContact.facebookUrl === 'string') contact.facebookUrl = rawContact.facebookUrl

  // bank_transfer_info — accepts two shapes (WEC-260):
  //   1. Legacy single object {iban, beneficiary, bankName?}
  //      → wrapped in [obj] if iban is non-empty, else empty array
  //   2. Array of up to MAX_BANK_IBANS entries (canonical post-WEC-260)
  // Each entry is shape-validated; entries with no iban are dropped to keep
  // the customer-facing list clean (empty placeholder rows from the admin
  // editor get filtered out at read time).
  const rawBankInfos = map.bank_transfer_info
  const bankTransferInfos: BankTransferInfo[] = []
  const rawBankList = Array.isArray(rawBankInfos)
    ? (rawBankInfos as unknown[])
    : (rawBankInfos && typeof rawBankInfos === 'object' ? [rawBankInfos] : [])
  for (const entry of rawBankList) {
    if (bankTransferInfos.length >= MAX_BANK_IBANS) break
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const iban = typeof o.iban === 'string' ? o.iban.trim() : ''
    if (!iban) continue
    bankTransferInfos.push({
      iban,
      beneficiary: typeof o.beneficiary === 'string' ? o.beneficiary : '',
      bankName: typeof o.bankName === 'string' ? o.bankName : undefined,
    })
  }

  // macros_display — string enum, defensively defaults to 'numbers' for any
  // unexpected DB value so a typo doesn't leave the menu page blank.
  const rawMacros = map.macros_display
  const macrosDisplay: MacrosDisplay = rawMacros === 'dots' ? 'dots' : 'numbers'

  // pickup_locations — array of PickupLocation entries (WEC-259). Defensive
  // shape validation per entry; bad entries are dropped silently.
  const rawPickup = map.pickup_locations
  const pickupLocations: PickupLocation[] = []
  if (Array.isArray(rawPickup)) {
    for (const e of rawPickup as unknown[]) {
      if (!e || typeof e !== 'object') continue
      const o = e as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : ''
      if (!id) continue
      const weekdays = Array.isArray(o.available_weekdays)
        ? (o.available_weekdays as unknown[]).filter((v): v is number => typeof v === 'number' && v >= 1 && v <= 7)
        : []
      pickupLocations.push({
        id,
        nameEl: typeof o.name_el === 'string' ? o.name_el : id,
        nameEn: typeof o.name_en === 'string' ? o.name_en : id,
        address: typeof o.address === 'string' ? o.address : '',
        availableWeekdays: weekdays,
        hoursNoteEl: typeof o.hours_note_el === 'string' ? o.hours_note_el : undefined,
        hoursNoteEn: typeof o.hours_note_en === 'string' ? o.hours_note_en : undefined,
      })
    }
  }

  return {
    data: {
      minOrder: typeof map.min_order === 'number' ? map.min_order / 100 : DEFAULTS.minOrder,
      cutoffHour: typeof map.cutoff_hour === 'number' ? map.cutoff_hour : DEFAULTS.cutoffHour,
      cutoffWeekdayOverrides,
      cutoffDateOverrides,
      paymentMethodVisibility,
      paymentMethodsEnabled: paymentMethodsFinal,
      contact,
      bankTransferInfos,
      macrosDisplay,
      pickupLocations,
    },
    error: null,
  }
}
