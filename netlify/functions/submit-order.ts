import { createClient } from '@supabase/supabase-js'

// ─── Env ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderPayload {
  userId?: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  paymentMethod: 'cash' | 'card' | 'link' | 'transfer' | 'wallet'
  cutlery: boolean
  invoiceType?: string
  invoiceName?: string
  invoiceVat?: string
  notes?: string
  voucherCode?: string
  days: DayPayload[]
}

interface DayPayload {
  deliveryDate: string
  timeFrom: string
  timeTo: string
  addressStreet: string
  addressArea: string
  addressZip?: string
  addressFloor?: string
  items: ItemPayload[]
}

interface ItemPayload {
  dishId: string
  variantId: string
  quantity: number
  comment?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Errors = Record<string, string[]>

function addError(errors: Errors, key: string, msg: string) {
  errors[key] = [...(errors[key] ?? []), msg]
}

// ─── Cutoff helpers ─────────────────────────────────────────────────────────
// Duplicated from src/lib/helpers.ts so the function is self-contained.
// Keep in sync when the resolution logic changes.

interface WeekdayCutoff { dow: number; hour: number }
interface DateCutoff    { cutoffDate: string; hour: number }

interface CutoffSettings {
  cutoffHour: number
  weekdayOverrides: Record<number, WeekdayCutoff>
  dateOverrides: Record<string, DateCutoff>
}

const toIsoDow = (jsDay: number): number => (jsDay === 0 ? 7 : jsDay)

function getCutoffDate(isoDate: string, cfg: CutoffSettings): Date {
  // 1. Per-date override (holidays, long weekends)
  const dateOv = cfg.dateOverrides[isoDate]
  if (dateOv) {
    const cutoff = new Date(dateOv.cutoffDate + 'T00:00:00')
    cutoff.setHours(dateOv.hour, 0, 0, 0)
    return cutoff
  }

  const delivery = new Date(isoDate + 'T00:00:00')
  const deliveryIsoDow = toIsoDow(delivery.getDay())

  // 2. Weekday override (e.g. Monday → Saturday 18:00)
  const wdOv = cfg.weekdayOverrides[deliveryIsoDow]
  if (wdOv) {
    let diff = deliveryIsoDow - wdOv.dow
    if (diff <= 0) diff += 7
    const cutoff = new Date(delivery)
    cutoff.setDate(delivery.getDate() - diff)
    cutoff.setHours(wdOv.hour, 0, 0, 0)
    return cutoff
  }

  // 3. Default: previous calendar day at cutoffHour
  const cutoff = new Date(delivery)
  cutoff.setDate(cutoff.getDate() - 1)
  cutoff.setHours(cfg.cutoffHour, 0, 0, 0)
  return cutoff
}

const DEFAULT_CUTOFF: CutoffSettings = {
  cutoffHour: 18,
  weekdayOverrides: {},
  dateOverrides: {},
}

/** Parse DB settings rows into a CutoffSettings config. */
function parseCutoffSettings(rows: { key: string; value: unknown }[] | null): CutoffSettings {
  const cfg: CutoffSettings = { ...DEFAULT_CUTOFF }
  for (const row of rows ?? []) {
    if (row.key === 'cutoff_hour' && typeof row.value === 'number') {
      cfg.cutoffHour = row.value
    } else if (row.key === 'cutoff_weekday_overrides' && row.value && typeof row.value === 'object') {
      const wd: Record<number, WeekdayCutoff> = {}
      for (const [k, v] of Object.entries(row.value as Record<string, WeekdayCutoff>)) {
        const dow = Number(k)
        if (Number.isInteger(dow) && dow >= 1 && dow <= 7 && v && typeof v.dow === 'number' && typeof v.hour === 'number') {
          wd[dow] = { dow: v.dow, hour: v.hour }
        }
      }
      cfg.weekdayOverrides = wd
    } else if (row.key === 'cutoff_date_overrides' && row.value && typeof row.value === 'object') {
      const dt: Record<string, DateCutoff> = {}
      for (const [k, v] of Object.entries(row.value as Record<string, DateCutoff>)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v.cutoffDate === 'string' && typeof v.hour === 'number') {
          dt[k] = { cutoffDate: v.cutoffDate, hour: v.hour }
        }
      }
      cfg.dateOverrides = dt
    }
  }
  return cfg
}

/** Today's date in YYYY-MM-DD (server-local tz). */
function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ─── Basic payload validation ───────────────────────────────────────────────

const VALID_METHODS = ['cash', 'card', 'link', 'transfer', 'wallet']
const MIN_ORDER_CENTS = 1500 // €15 minimum per day

function validatePayload(body: OrderPayload): Errors {
  const errors: Errors = {}

  if (!body.customerName?.trim()) addError(errors, 'general', 'Customer name is required')
  if (!body.customerEmail?.trim()) addError(errors, 'general', 'Customer email is required')
  if (!VALID_METHODS.includes(body.paymentMethod)) addError(errors, 'general', `Invalid payment method: ${body.paymentMethod}`)
  if (!body.days || body.days.length === 0) addError(errors, 'general', 'Order must have at least one day')

  for (let i = 0; i < (body.days ?? []).length; i++) {
    const day = body.days[i]
    const k = `day_${i}`
    if (!day.deliveryDate) addError(errors, k, 'Delivery date is required')
    if (!day.timeFrom || !day.timeTo) addError(errors, k, 'Delivery time window is required')
    if (!day.addressStreet?.trim()) addError(errors, k, 'Address is required')
    if (!day.addressArea?.trim()) addError(errors, k, 'Area is required')
    if (!day.items || day.items.length === 0) addError(errors, k, 'Day must have at least one item')
  }

  return errors
}

// ─── Order number generation ────────────────────────────────────────────────

function generateOrderNumber(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `FP-${yy}${mm}${dd}-${rand}`
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async (request: Request) => {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const body: OrderPayload = await request.json()

    // ─── Phase 1: Basic payload validation ──────────────────────────────
    const payloadErrors = validatePayload(body)
    if (Object.keys(payloadErrors).length > 0) {
      return Response.json({ error: 'Validation failed', validationErrors: payloadErrors }, { status: 400 })
    }

    // ─── Create Supabase client ─────────────────────────────────────────
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    let supabase
    if (token) {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    } else if (SUPABASE_SERVICE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    } else {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    }

    // Resolve userId from JWT if not provided
    let userId = body.userId ?? null
    if (token && !userId) {
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id ?? null
    }

    // ─── Phase 2: Fetch all reference data in parallel ──────────────────

    const allVariantIds = [...new Set(body.days.flatMap((d) => d.items.map((it) => it.variantId)))]
    const allDishIds = [...new Set(body.days.flatMap((d) => d.items.map((it) => it.dishId)))]
    const allDates = [...new Set(body.days.map((d) => d.deliveryDate))]
    const allAreas = [...new Set(body.days.map((d) => d.addressArea))]

    const [variantsRes, dishesRes, menuDaysRes, zonesRes, settingsRes] = await Promise.all([
      // Variant prices + macros
      supabase
        .from('dish_variants')
        .select('id, dish_id, price, calories, protein, carbs, fat, label_el, label_en')
        .in('id', allVariantIds),

      // Dish names + active status
      supabase
        .from('dishes')
        .select('id, name_el, name_en, active')
        .in('id', allDishIds),

      // Menu-day assignments (which dishes are on which dates)
      supabase
        .from('menu_day_dishes')
        .select('date, dish_id, menu_id, weekly_menus!inner(active)')
        .in('date', allDates)
        .eq('weekly_menus.active', true),

      // Delivery zones with postcodes + time slots
      supabase
        .from('delivery_zones')
        .select('id, name_el, name_en, postcodes, active, zone_time_slots(time_from, time_to, active)')
        .eq('active', true),

      // Cutoff settings (cutoff_hour + weekday/date overrides)
      supabase
        .from('settings')
        .select('key, value')
        .in('key', ['cutoff_hour', 'cutoff_weekday_overrides', 'cutoff_date_overrides']),
    ])

    if (variantsRes.error) return Response.json({ error: 'Failed to look up item prices' }, { status: 500 })
    if (dishesRes.error) return Response.json({ error: 'Failed to look up dish info' }, { status: 500 })
    if (menuDaysRes.error) return Response.json({ error: 'Failed to verify menu availability' }, { status: 500 })
    if (zonesRes.error) return Response.json({ error: 'Failed to look up delivery zones' }, { status: 500 })
    // settings lookup failure is non-fatal — fall back to defaults

    const cutoffCfg = parseCutoffSettings(
      settingsRes.error ? null : (settingsRes.data as { key: string; value: unknown }[] | null),
    )
    const today = todayIso()
    const nowMs = Date.now()

    // Build lookup maps
    const variantMap = new Map((variantsRes.data ?? []).map((v: any) => [v.id, v]))
    const dishMap = new Map((dishesRes.data ?? []).map((d: any) => [d.id, d]))

    // Menu availability: set of "date|dishId" pairs that are valid
    const menuAvailability = new Set<string>()
    for (const row of (menuDaysRes.data ?? []) as any[]) {
      menuAvailability.add(`${row.date}|${row.dish_id}`)
    }

    // Zone lookup: area name → zone (with time slots)
    // Zones have a `postcodes` array; we also match by area name for flexibility
    const zones = (zonesRes.data ?? []) as any[]

    // ─── Phase 3: Deep validation ───────────────────────────────────────

    const errors: Errors = {}
    let orderSubtotal = 0
    const dayTotals: number[] = []

    for (let i = 0; i < body.days.length; i++) {
      const day = body.days[i]
      const k = `day_${i}`
      let dayTotal = 0

      // 3a-pre. Delivery date must be today or later, and cutoff must not have passed.
      if (day.deliveryDate < today) {
        addError(errors, k, `Delivery date ${day.deliveryDate} is in the past`)
      } else {
        const cutoffAt = getCutoffDate(day.deliveryDate, cutoffCfg)
        if (nowMs >= cutoffAt.getTime()) {
          addError(errors, k, `Ordering cutoff for ${day.deliveryDate} has passed`)
        }
      }

      // 3a. Validate each item: dish active, variant exists, on menu for this date
      for (const item of day.items) {
        const dish = dishMap.get(item.dishId)
        const variant = variantMap.get(item.variantId)

        if (!dish) {
          addError(errors, k, `Dish "${item.dishId}" not found`)
          continue
        }
        if (!dish.active) {
          addError(errors, k, `"${dish.name_en}" is no longer available`)
          continue
        }
        if (!variant) {
          addError(errors, k, `Variant "${item.variantId}" not found for "${dish.name_en}"`)
          continue
        }
        if (variant.dish_id !== item.dishId) {
          addError(errors, k, `Variant "${item.variantId}" does not belong to dish "${dish.name_en}"`)
          continue
        }

        // Check dish is on the menu for this specific date
        if (!menuAvailability.has(`${day.deliveryDate}|${item.dishId}`)) {
          addError(errors, k, `"${dish.name_en}" is not on the menu for ${day.deliveryDate}`)
          continue
        }

        dayTotal += variant.price * item.quantity
      }

      // 3b. Minimum order per day
      if (dayTotal > 0 && dayTotal < MIN_ORDER_CENTS) {
        addError(errors, k, `Minimum order is €${(MIN_ORDER_CENTS / 100).toFixed(2)} (current: €${(dayTotal / 100).toFixed(2)})`)
      }

      // 3c. Delivery zone validation
      // Find a zone that covers the area (check postcodes array or name match)
      const zip = day.addressZip?.trim()
      const area = day.addressArea.trim().toLowerCase()
      const matchedZone = zones.find((z: any) => {
        // Match by postcode if available
        if (zip && z.postcodes?.length) {
          return z.postcodes.includes(zip)
        }
        // Match by area name (case-insensitive)
        return z.name_el?.toLowerCase() === area || z.name_en?.toLowerCase() === area
      })

      if (!matchedZone) {
        addError(errors, k, `Area "${day.addressArea}" is not in a valid delivery zone`)
      }

      // 3d. Time slot validation
      if (matchedZone && day.timeFrom && day.timeTo) {
        const zoneSlots = (matchedZone.zone_time_slots ?? []).filter((s: any) => s.active)

        // Normalize time format: ensure HH:MM format for comparison
        const normalizeTime = (t: string) => {
          const parts = t.split(':')
          return `${parts[0].padStart(2, '0')}:${parts[1] ?? '00'}`
        }

        const reqFrom = normalizeTime(day.timeFrom)
        const reqTo = normalizeTime(day.timeTo)

        const slotMatch = zoneSlots.some((s: any) => {
          const slotFrom = normalizeTime(s.time_from)
          const slotTo = normalizeTime(s.time_to)
          return slotFrom === reqFrom && slotTo === reqTo
        })

        if (!slotMatch) {
          addError(errors, k, `Time slot ${day.timeFrom}–${day.timeTo} is not available for this zone`)
        }
      }

      dayTotals.push(dayTotal)
      orderSubtotal += dayTotal
    }

    // Return all validation errors at once
    if (Object.keys(errors).length > 0) {
      return Response.json({ error: 'Order validation failed', validationErrors: errors }, { status: 400 })
    }

    // ─── Phase 4: Voucher validation + discount calculation ──────────────

    let discountAmount = 0
    let voucherId: string | null = null

    if (body.voucherCode) {
      const vCode = body.voucherCode.trim().toUpperCase()

      const { data: voucher, error: vcErr } = await supabase
        .from('vouchers')
        .select('*')
        .eq('code', vCode)
        .single()

      if (vcErr || !voucher) {
        return Response.json({ error: `Invalid voucher code: ${vCode}`, validationErrors: { voucher: ['Invalid voucher code'] } }, { status: 400 })
      }

      // Validate voucher
      if (!voucher.active) {
        return Response.json({ error: 'Voucher is no longer active', validationErrors: { voucher: ['Voucher is no longer active'] } }, { status: 400 })
      }
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return Response.json({ error: 'Voucher has expired', validationErrors: { voucher: ['Voucher has expired'] } }, { status: 400 })
      }
      if (voucher.max_uses != null && voucher.uses_count >= voucher.max_uses) {
        return Response.json({ error: 'Voucher usage limit reached', validationErrors: { voucher: ['Voucher usage limit reached'] } }, { status: 400 })
      }
      if (voucher.min_order != null && orderSubtotal < voucher.min_order) {
        return Response.json({ error: 'Order does not meet minimum for this voucher', validationErrors: { voucher: ['Minimum order not met'] } }, { status: 400 })
      }
      if (userId && voucher.per_user_limit != null) {
        const { count } = await supabase
          .from('voucher_uses')
          .select('id', { count: 'exact', head: true })
          .eq('voucher_id', voucher.id)
          .eq('user_id', userId)
        if ((count ?? 0) >= voucher.per_user_limit) {
          return Response.json({ error: 'You have already used this voucher', validationErrors: { voucher: ['Already used'] } }, { status: 400 })
        }
      }

      // Calculate discount (all values in cents)
      if (voucher.type === 'pct') {
        discountAmount = Math.round(orderSubtotal * voucher.value / 100)
      } else if (voucher.type === 'fixed') {
        discountAmount = Math.min(voucher.value, orderSubtotal)
      } else if (voucher.type === 'credit') {
        discountAmount = Math.min(voucher.remaining ?? 0, orderSubtotal)
      }

      voucherId = voucher.id
    }

    const orderTotal = orderSubtotal - discountAmount

    // ─── Phase 5: Insert order ──────────────────────────────────────────

    const orderNumber = generateOrderNumber()

    const { data: orderRow, error: oErr } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: userId,
        customer_name: body.customerName,
        customer_email: body.customerEmail,
        customer_phone: body.customerPhone ?? null,
        subtotal: orderSubtotal,
        discount_amount: discountAmount,
        total: orderTotal,
        payment_method: body.paymentMethod,
        payment_status: 'pending',
        status: 'pending',
        cutlery: body.cutlery,
        invoice_type: body.invoiceType ?? null,
        invoice_name: body.invoiceName ?? null,
        invoice_vat: body.invoiceVat ?? null,
        notes: body.notes ?? null,
      })
      .select('id')
      .single()

    if (oErr || !orderRow) {
      console.error('Order insert error:', oErr)
      return Response.json({ error: 'Failed to create order' }, { status: 500 })
    }

    const orderId = orderRow.id

    // ─── Insert child orders + items ────────────────────────────────────

    for (let i = 0; i < body.days.length; i++) {
      const day = body.days[i]

      // Normalize time to HH:MM:SS for DB
      const fmtTime = (t: string) => {
        const parts = t.split(':')
        return `${parts[0].padStart(2, '0')}:${(parts[1] ?? '00').padStart(2, '0')}:00`
      }

      const { data: childRow, error: cErr } = await supabase
        .from('child_orders')
        .insert({
          order_id: orderId,
          delivery_date: day.deliveryDate,
          time_from: fmtTime(day.timeFrom),
          time_to: fmtTime(day.timeTo),
          address_street: day.addressStreet,
          address_area: day.addressArea,
          address_zip: day.addressZip ?? null,
          address_floor: day.addressFloor ?? null,
        })
        .select('id')
        .single()

      if (cErr || !childRow) {
        console.error('Child order insert error:', cErr)
        return Response.json({ error: `Failed to create child order for ${day.deliveryDate}` }, { status: 500 })
      }

      const itemRows = day.items.map((item) => {
        const variant = variantMap.get(item.variantId)!
        const dish = dishMap.get(item.dishId)

        return {
          child_order_id: childRow.id,
          dish_id: item.dishId,
          variant_id: item.variantId,
          name_el: dish?.name_el ?? '',
          name_en: dish?.name_en ?? '',
          variant_label_el: variant.label_el ?? null,
          variant_label_en: variant.label_en ?? null,
          quantity: item.quantity,
          unit_price: variant.price,
          total_price: variant.price * item.quantity,
          calories: variant.calories ?? null,
          protein: variant.protein ?? null,
          carbs: variant.carbs ?? null,
          fat: variant.fat ?? null,
          comment: item.comment ?? null,
        }
      })

      const { error: iErr } = await supabase
        .from('order_items')
        .insert(itemRows)

      if (iErr) {
        console.error('Items insert error:', iErr)
        return Response.json({ error: `Failed to insert items for ${day.deliveryDate}` }, { status: 500 })
      }
    }

    // ─── Record voucher usage ─────────────────────────────────────────

    if (voucherId && discountAmount > 0) {
      // Record voucher usage
      await supabase.from('voucher_uses').insert({
        voucher_id: voucherId,
        user_id: userId,
        order_id: orderId,
        amount: discountAmount,
      })

      // Fetch current voucher state for atomic updates
      const { data: vCurrent } = await supabase
        .from('vouchers')
        .select('uses_count, type, remaining')
        .eq('id', voucherId)
        .single()

      if (vCurrent) {
        const updates: Record<string, any> = {
          uses_count: (vCurrent.uses_count ?? 0) + 1,
        }
        // For credit vouchers, decrement remaining balance
        if (vCurrent.type === 'credit' && vCurrent.remaining != null) {
          updates.remaining = Math.max(0, vCurrent.remaining - discountAmount)
        }
        await supabase.from('vouchers').update(updates).eq('id', voucherId)
      }
    }

    // ─── Success ────────────────────────────────────────────────────────

    return Response.json({
      orderNumber,
      orderId,
      total: orderTotal / 100,
    })
  } catch (err) {
    console.error('Order submission error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
