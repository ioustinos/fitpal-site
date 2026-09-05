// POST /api/wallet-plan-purchase
//
// Auth required (Bearer token from Supabase auth). Flow:
//   1. Re-run the calculator server-side (never trust client amounts)
//   2. Validate min amount + payment method allowed
//   3. Persist health profile to public.profiles (sex/birth_year/h/w/activity/goal)
//   4. Persist user_prefs.only_admin_orders if dietician-managed selected
//   5. Get-or-create the user's wallet row
//   6. Insert wallet_plans snapshot (payment_status='pending')
//   7. card/link → call createWalletPlanVivaOrder, return Viva URL
//      transfer  → return wallet_plan_id + bank instructions
//
// Body: WalletCalcInput plus { paymentMethod, voucherCode? }
// Response (card/link): { walletPlanId, paymentUrl, vivaOrderCode }
// Response (transfer): { walletPlanId, paymentMethod: 'transfer', bankInstructions: {...} }

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { calculateWalletPlan } from '../../src/lib/wallet/calculator'
import { lipometrisiFeeCents } from '../../src/lib/wallet/constants'
import { loadWalletConfig } from '../lib/wallet/loadSettings'
import { createWalletPlanVivaOrder } from '../lib/wallet/createWalletPlanOrder'
// 2026-06-24 incident fix: trackAsync was racing Netlify post-response kill.
// Use awaited track() so Subscription Purchased events actually reach Klaviyo.
import { track } from '../lib/klaviyo'
import { notifySubscriptionAdmins } from '../lib/notifySubscriptionAdmins'
import { corsHeaders } from '../lib/cors'
import type { WalletCalcInput, PaymentMethod } from '../../src/lib/wallet/types'
import { isValidGreekVat } from '../../src/lib/vat'
import { normVoucherEmail, normVoucherPhone } from '../../src/lib/voucherIdentity' // WEC-703

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

interface PurchaseBody extends WalletCalcInput {
  paymentMethod: PaymentMethod
  /** Customer display language — routes EL/EN Klaviyo template. */
  lang?: 'el' | 'en'
  voucherCode?: string
  /** WEC-658: present only when the customer chose Τιμολόγιο. When present,
   *  name + a valid 9-digit Greek VAT are mandatory (rejected otherwise). */
  invoice?: { name?: string; vat?: string } | null
}

interface PurchaseResultCard {
  walletPlanId: string
  vivaOrderCode: string
  paymentUrl: string
  paymentMethod: 'card' | 'link'
}

interface PurchaseResultTransfer {
  walletPlanId: string
  paymentMethod: 'transfer'
  bankInstructions: { iban: string; beneficiary: string; reference: string }
}

// WEC-554: cash (Αντικαταβολή) — plan stays pending, no bank instructions;
// the customer pays the courier on first delivery, admin marks paid then.
interface PurchaseResultCash {
  walletPlanId: string
  paymentMethod: 'cash'
  reference: string
}

type PurchaseResult = PurchaseResultCard | PurchaseResultTransfer | PurchaseResultCash

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'POST, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST')    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })

  // 1. Auth — read Bearer token, resolve to user
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return Response.json({ error: 'Auth required' }, { status: 401, headers: cors })

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: authErr } = await userClient.auth.getUser()
  if (authErr || !userData?.user) {
    return Response.json({ error: 'Invalid auth token' }, { status: 401, headers: cors })
  }
  const userId = userData.user.id
  const userEmail = userData.user.email ?? ''

  // 2. Parse + validate body
  let body: PurchaseBody
  try { body = await request.json() as PurchaseBody }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }

  const inputErr = validateInput(body)
  if (inputErr) return Response.json({ error: inputErr }, { status: 400, headers: cors })

  const supabase = serviceClient()

  try {
    // 3. Run calculator server-side
    const config = await loadWalletConfig()
    const result = calculateWalletPlan(body, config.settings)

    const planAmountCents = Math.round(result.amountToPay * 100)
    const subtotalCents = Math.round(result.periodPriceBeforeDiscount * 100)
    const discountCents = subtotalCents - planAmountCents
    const bonusCents = Math.round(result.bonusCredits * 100)
    const walletCreditCents = Math.round(result.walletCredit * 100)

    // WEC-553: λιπομέτρηση add-on is charged ON TOP of the plan and is NOT
    // wallet credit. Priced server-side (never trust the client). The customer
    // pays `chargeCents` (plan + fee); the wallet is still credited only
    // `walletCreditCents` (plan base + bonus). amount_to_pay_cents = chargeCents
    // so the Viva verify amount-match holds.
    const bodyFatSelected = !!body.services?.bodyFatMeasurement
    const lipoCents = bodyFatSelected ? lipometrisiFeeCents(body.planLength, true) : 0
    // WEC-703: `chargeCents` (what the customer PAYS) may be reduced by a
    // subscription voucher below. `walletCreditCents` + `bonusCents` are frozen
    // above and MUST NOT be touched — the voucher is a discount on the invoice,
    // never on the credits (Ioustinos decision 2a).
    let chargeCents = planAmountCents + lipoCents

    // 4. Validations — plan minimum applies to the plan price, not the add-on.
    if (planAmountCents < config.minAmountCents) {
      return Response.json({
        error: `Plan total below minimum (${(config.minAmountCents / 100).toFixed(2)} €)`,
      }, { status: 400, headers: cors })
    }
    if (!config.paymentMethods.includes(body.paymentMethod)) {
      return Response.json({
        error: `Payment method ${body.paymentMethod} not allowed for wallet purchases`,
      }, { status: 400, headers: cors })
    }

    // 4b. WEC-703: subscription voucher — validate + reduce the PAYMENT only.
    // Mirrors submit-order's eligibility checks; the authoritative atomic
    // re-check + voucher_uses insert happens via redeem_voucher_for_plan after
    // the plan row exists. The category scoping doesn't apply to plans.
    let voucherId: string | null = null
    let voucherCode: string | null = null
    let voucherDiscountCents = 0
    if (body.voucherCode?.trim()) {
      if (!config.voucherEnabled) {
        return Response.json({ error: 'Voucher codes are not available for subscriptions right now' }, { status: 400, headers: cors })
      }
      const vCode = body.voucherCode.trim().toUpperCase()
      const { data: voucher, error: vErr } = await supabase.from('vouchers').select('*').eq('code', vCode).single()
      if (vErr || !voucher) return Response.json({ error: `Invalid voucher code: ${vCode}` }, { status: 400, headers: cors })
      if (!voucher.active) return Response.json({ error: 'Voucher is no longer active' }, { status: 400, headers: cors })
      if (((voucher.applies_to as string | null) ?? 'orders') !== 'subscriptions') {
        return Response.json({ error: 'This code can only be used on food orders, not subscriptions' }, { status: 400, headers: cors })
      }
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) return Response.json({ error: 'Voucher has expired' }, { status: 400, headers: cors })
      if (voucher.max_uses != null && voucher.uses_count >= voucher.max_uses) return Response.json({ error: 'Voucher usage limit reached' }, { status: 400, headers: cors })
      if (voucher.registered_only && !userId) return Response.json({ error: 'Log in to use this code' }, { status: 400, headers: cors })
      if (voucher.min_order != null && chargeCents < voucher.min_order) return Response.json({ error: 'Plan does not meet the minimum for this voucher' }, { status: 400, headers: cors })
      if (voucher.type === 'credit' && (voucher.remaining ?? 0) <= 0) return Response.json({ error: "Voucher's credit balance is depleted" }, { status: 400, headers: cors })
      if (voucher.per_user_limit != null) {
        const { count } = await supabase.from('voucher_uses').select('id', { count: 'exact', head: true }).eq('voucher_id', voucher.id).eq('user_id', userId)
        if ((count ?? 0) >= voucher.per_user_limit) return Response.json({ error: 'This code has already been used' }, { status: 400, headers: cors })
      }
      // Discount on the PAYMENT (chargeCents), capped so it can't go negative.
      if (voucher.type === 'pct') voucherDiscountCents = Math.round(chargeCents * voucher.value / 100)
      else if (voucher.type === 'fixed') voucherDiscountCents = Math.min(voucher.value, chargeCents)
      else if (voucher.type === 'credit') voucherDiscountCents = Math.min(voucher.remaining ?? 0, chargeCents)
      voucherId = voucher.id
      voucherCode = vCode
      chargeCents = Math.max(0, chargeCents - voucherDiscountCents)
    }

    // WEC-658: cash-on-delivery capped — the courier can't carry unlimited cash.
    // Enforced here so a crafted request can't bypass the disabled UI button.
    // (Checked AFTER the voucher so the cap reflects the real amount paid.)
    if (body.paymentMethod === 'cash' && chargeCents > config.cashMaxCents) {
      return Response.json({
        error: `Cash on delivery is not available for amounts over ${(config.cashMaxCents / 100).toFixed(0)} €`,
      }, { status: 400, headers: cors })
    }

    // 5. Persist profile fields (sex/birth_year/h/w/activity/goal)
    const currentYear = new Date().getFullYear()
    const birthYear = currentYear - body.age
    const profilePatch = {
      sex: body.sex,
      birth_year: birthYear,
      height_cm: body.heightCm,
      weight_kg: body.weightKg,
      activity_level: body.activity,
      goal: body.goal,
    }
    const { error: profileErr } = await supabase
      .from('profiles')
      .update(profilePatch)
      .eq('id', userId)
    if (profileErr) console.error('[purchase] profile update failed:', profileErr)

    // 6. Persist services preference (only_admin_orders mirrors dieticianManaged)
    if (body.services.dieticianManaged) {
      const { error: prefErr } = await supabase
        .from('user_prefs')
        .update({ only_admin_orders: true })
        .eq('user_id', userId)
      if (prefErr) console.error('[purchase] user_prefs update failed:', prefErr)
    }

    // 7. Get-or-create wallet for user
    let walletId: string | null = null
    const { data: existingWallet } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()

    if (existingWallet) {
      walletId = existingWallet.id
    } else {
      const { data: newWallet, error: walletErr } = await supabase
        .from('wallets')
        .insert({ user_id: userId, balance: 0, base_balance: 0, bonus_balance: 0, active: false, admin_managed: false })
        .select('id')
        .single()
      if (walletErr || !newWallet) throw new Error(`wallet create failed: ${walletErr?.message}`)
      walletId = newWallet.id
    }

    // 8. Determine viva mode + insert plan snapshot
    const vivaMode: 'card' | 'link' = body.paymentMethod === 'link' ? 'link' : 'card'

    const { data: plan, error: planErr } = await supabase
      .from('wallet_plans')
      .insert({
        wallet_id: walletId,
        // Diet input
        goal: body.goal,
        profile_snapshot: profilePatch,
        // Diet output (frozen)
        daily_kcal: result.dailyKcal,
        macro_split: result.macroSplitPct,
        meal_breakfast: body.meals.breakfast,
        meal_lunch:     body.meals.lunch,
        meal_dinner:    body.meals.dinner,
        meal_snack:     body.meals.snack,
        plan_length: body.planLength,
        plan_length_weeks: result.planLengthWeeks,
        days_per_week: body.daysPerWeek,
        // Pricing snapshot
        pricing_matrix_snapshot:  config.settings.pricingMatrix,
        discount_matrix_snapshot: config.settings.discountMatrix,
        pricing_breakdown:        result.perMeal,
        // Amounts
        subtotal_cents:      subtotalCents,
        discount_cents:      discountCents,
        discount_pct:        result.discountPct,
        amount_to_pay_cents: chargeCents, // WEC-553 plan + fee, WEC-703 minus voucher
        bonus_credits_cents: bonusCents,
        wallet_credit_cents: walletCreditCents,
        // WEC-703: voucher discount on the PAYMENT only (credits above unchanged).
        voucher_id: voucherId,
        voucher_amount_cents: voucherDiscountCents || null,
        // Services — WEC-553: snapshot the λιπομέτρηση add-on + its fee.
        services: {
          dieticianManaged: body.services.dieticianManaged,
          bodyFatMeasurement: bodyFatSelected,
          bodyFatFeeCents: lipoCents,
        },
        // Payment
        payment_method: body.paymentMethod,
        payment_status: 'pending',
        // WEC-693: persist the invoice request (was validated then discarded).
        // invoice present → τιμολόγιο; absent → plain απόδειξη (receipt).
        invoice_type: body.invoice ? 'invoice' : 'receipt',
        invoice_name: body.invoice?.name?.trim() || null,
        invoice_vat:  body.invoice?.vat?.trim()  || null,
        // Legacy mirror columns (kept for back-compat with admin UI)
        cost: chargeCents,
        credits: walletCreditCents,
        bonus_pct: Math.round(result.discountPct * 100),
        bonus_amount: bonusCents,
        // consumer_type / frequency are now nullable; we don't write them
      })
      .select('id')
      .single()

    if (planErr || !plan) {
      console.error('[purchase] wallet_plans insert failed:', planErr)
      throw new Error(`wallet_plans insert failed: ${planErr?.message}`)
    }
    const walletPlanId = plan.id as string

    // 8b. WEC-703: atomically redeem the voucher against THIS plan. Same
    // SECURITY DEFINER guarantee as orders (redeem_voucher_for_plan re-checks
    // scope/expiry/max_uses/per_user/credit under a row lock and inserts
    // voucher_uses in one txn). On failure, roll the plan row back so we never
    // leave a plan whose amount was discounted but whose voucher wasn't recorded.
    if (voucherId) {
      const { error: redeemErr } = await supabase.rpc('redeem_voucher_for_plan', {
        p_voucher_id: voucherId,
        p_user_id: userId,
        p_wallet_plan_id: walletPlanId,
        p_amount_cents: voucherDiscountCents,
        p_email: normVoucherEmail(userEmail),
        p_phone: normVoucherPhone((userData.user.user_metadata?.phone as string | undefined) ?? undefined),
      })
      if (redeemErr) {
        console.error('[wallet-plan-purchase] redeem_voucher_for_plan failed for plan=%s:', walletPlanId, redeemErr)
        await supabase.from('wallet_plans').delete().eq('id', walletPlanId)
        const m = redeemErr.message ?? ''
        let userMsg = 'Voucher redemption failed'
        if (m.includes('voucher_wrong_scope'))                userMsg = 'This code can only be used on food orders, not subscriptions'
        else if (m.includes('voucher_not_found'))             userMsg = 'Voucher not found'
        else if (m.includes('voucher_inactive'))              userMsg = 'Voucher is no longer active'
        else if (m.includes('voucher_expired'))               userMsg = 'Voucher has expired'
        else if (m.includes('voucher_max_uses_reached'))      userMsg = 'Voucher usage limit reached'
        else if (m.includes('voucher_per_user_limit_reached')) userMsg = 'This code has already been used'
        else if (m.includes('voucher_registered_only'))       userMsg = 'Log in to use this code'
        else if (m.includes('voucher_insufficient_credit'))   userMsg = 'Voucher does not have enough credit'
        return Response.json({ error: userMsg }, { status: 400, headers: cors })
      }
    }

    // 9. Branch by payment method
    // WEC-554: transfer AND cash both stay 'pending' until an admin marks paid
    // (transfer = when the wire lands; cash = when the courier collects on
    // first delivery). Both fire the same pending Subscription Purchased event.
    if (body.paymentMethod === 'transfer' || body.paymentMethod === 'cash') {
      // Plan stays pending until admin marks paid.
      // WEC-emails: fire Subscription Purchased event in 'pending payment'
      // mode (the email shows bank-transfer instructions). Klaviyo flow
      // routes EL/EN templates via event.lang. Fail-soft.
      const subLang = (body.lang === 'en' || body.lang === 'el') ? body.lang : 'el'
      const subIsEl = subLang === 'el'
      const subFirstName = (userData.user.user_metadata?.name ?? '').split(' ')[0]
      const subMealsLabel = [
        body.meals.breakfast && (subIsEl ? 'Πρωινό' : 'Breakfast'),
        body.meals.lunch && (subIsEl ? 'Μεσημεριανό' : 'Lunch'),
        body.meals.dinner && (subIsEl ? 'Βραδινό' : 'Dinner'),
        body.meals.snack && (subIsEl ? 'Σνακ' : 'Snack'),
      ].filter(Boolean).join(', ') || null
      const subGoalMap: Record<string, string> = subIsEl
        ? { lose: 'Απώλεια βάρους', maintain: 'Διατήρηση', gain: 'Αύξηση μυϊκής μάζας' }
        : { lose: 'Weight loss', maintain: 'Maintain', gain: 'Muscle gain' }
      const subGoalLabel = body.goal ? (subGoalMap[body.goal] ?? body.goal) : null
      const subDieticianManaged = !!body.services?.dieticianManaged
      const reference = `WP-${walletPlanId.slice(0, 8).toUpperCase()}`

      // WEC-701 §B: the confirmation email must carry the bank details for a
      // transfer purchase (it was firing without IBAN/beneficiary/reference, so
      // a customer who dismissed the popup had no way to pay). Read from
      // settings.bank_transfer_info — same source + array shape the order flow
      // uses (orderConfirmationEmail.ts) — never hardcode.
      let bankTransferInfos: Array<{ iban: string; beneficiary: string; bank_name: string | null; bankName: string | null }> = []
      {
        const { data: bankRow } = await supabase.from('settings').select('value').eq('key', 'bank_transfer_info').maybeSingle()
        const raw = (bankRow as { value?: unknown } | null)?.value
        const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : [])
        bankTransferInfos = (list as unknown[])
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .map((o) => {
            const name = typeof o.bankName === 'string' ? o.bankName : null
            return { iban: typeof o.iban === 'string' ? o.iban : '', beneficiary: typeof o.beneficiary === 'string' ? o.beneficiary : '', bank_name: name, bankName: name }
          })
          .filter((e) => e.iban.length > 0)
      }

      const subFire = await track('Subscription Purchased', {
        email: userEmail,
        firstName: subFirstName,
        externalId: userData.user.id,
      }, {
        lang: subLang,
        // snake_case (template-expected)
        first_name: subFirstName,
        plan_length_label: body.planLength,
        meals_per_week: body.daysPerWeek,
        goal_label: subGoalLabel,
        meals_label: subMealsLabel,
        daily_kcal: result.dailyKcal ?? null,
        dietician_managed: subDieticianManaged,
        body_fat_measurement: bodyFatSelected, // WEC-553
        body_fat_fee: lipoCents / 100,          // WEC-553
        amount_paid: chargeCents / 100,
        bonus_credits: bonusCents / 100,
        new_balance: walletCreditCents / 100,
        // WEC-703: voucher code + amount off, so the email can show the discount.
        voucher_code: voucherCode,
        voucher_discount: voucherDiscountCents / 100,
        payment_status: 'pending',
        // WEC-701 §B: payment method gates the bank block; transfer shows IBAN,
        // cash never does. Reference + bank list drive the «Στοιχεία τραπεζικής
        // μεταφοράς» block (same shape as the order confirmation email).
        payment_method: body.paymentMethod,
        bank_transfer_infos: bankTransferInfos,
        bank_reference: reference,
        // WEC-693: tell the customer their receipt vs invoice choice was registered.
        invoice_type: body.invoice ? 'invoice' : 'receipt',
        invoice_name: body.invoice?.name?.trim() || null,
        invoice_vat:  body.invoice?.vat?.trim()  || null,
        // camelCase (legacy / downstream)
        walletPlanId,
        planLengthLabel: body.planLength,
        mealsPerWeek: body.daysPerWeek,
        amountPaid: chargeCents / 100,
        bonusCredits: bonusCents / 100,
        newBalance: walletCreditCents / 100,
        paymentStatus: 'pending',
      })
      if (!subFire.ok) console.warn('[wallet-plan-purchase] klaviyo:', subFire.error)

      // WEC-664: the admin notification list also receives subscription
      // purchases (same mechanism as order confirmations — fire the event to
      // each admin email so Klaviyo delivers a copy). Fail-soft.
      await notifySubscriptionAdmins(supabase, {
        subLang, userEmail, firstName: subFirstName,
        planLengthLabel: body.planLength, mealsPerWeek: body.daysPerWeek,
        goalLabel: subGoalLabel, mealsLabel: subMealsLabel,
        amountPaid: chargeCents / 100, walletPlanId,
        voucherCode, voucherDiscount: voucherDiscountCents / 100, // WEC-703
      })

      // WEC-554: cash (Αντικαταβολή) — no bank details; pay courier on delivery.
      if (body.paymentMethod === 'cash') {
        const cashResponse: PurchaseResultCash = {
          walletPlanId,
          paymentMethod: 'cash',
          reference,
        }
        return Response.json(cashResponse, { status: 200, headers: cors })
      }

      const response: PurchaseResultTransfer = {
        walletPlanId,
        paymentMethod: 'transfer',
        bankInstructions: {
          iban: config.bankTransferInfo.iban || 'IBAN not configured — contact support',
          beneficiary: config.bankTransferInfo.beneficiary || 'Fitpal',
          reference,
        },
      }
      return Response.json(response, { status: 200, headers: cors })
    }

    // card / link → Viva
    const fullName = userData.user.user_metadata?.name ?? userEmail
    const viva = await createWalletPlanVivaOrder({
      walletPlanId,
      amountCents: chargeCents, // WEC-553: plan + λιπομέτρηση fee
      customerEmail: userEmail,
      customerFullName: fullName,
      mode: vivaMode,
    })

    const response: PurchaseResultCard = {
      walletPlanId,
      vivaOrderCode: viva.orderCode,
      paymentUrl: viva.paymentUrl,
      paymentMethod: vivaMode,
    }
    return Response.json(response, { status: 200, headers: cors })
  } catch (err) {
    console.error('[wallet-plan-purchase] failed', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500, headers: cors })
  }
}

function validateInput(b: PurchaseBody): string | null {
  if (!b) return 'Body required'
  if (!['female','male','other'].includes(b.sex)) return 'sex invalid'
  if (typeof b.age !== 'number' || b.age < 14 || b.age > 100) return 'age out of range'
  if (typeof b.heightCm !== 'number' || b.heightCm < 100 || b.heightCm > 250) return 'heightCm out of range'
  if (typeof b.weightKg !== 'number' || b.weightKg < 30 || b.weightKg > 300) return 'weightKg out of range'
  if (!['sedentary','light','moderate','active','very_active'].includes(b.activity)) return 'activity invalid'
  if (!['lose','maintain','gain'].includes(b.goal)) return 'goal invalid'
  if (!b.meals || typeof b.meals !== 'object') return 'meals invalid'
  if (!['2w','1mo','3mo'].includes(b.planLength)) return 'planLength invalid'
  if (![4,5,6,7].includes(b.daysPerWeek)) return 'daysPerWeek invalid'
  if (!b.services || typeof b.services !== 'object') return 'services invalid'
  // WEC-554: cash (Αντικαταβολή) is now a valid subscription payment method.
  if (!['card','link','transfer','cash'].includes(b.paymentMethod)) return 'paymentMethod invalid (must be card|link|transfer|cash)'
  // WEC-658: if an invoice was requested, name + valid Greek VAT are mandatory.
  // A crafted request can't bypass the disabled UI submit button.
  if (b.invoice) {
    if (!b.invoice.name || !b.invoice.name.trim()) return 'invoice requires a company name (επωνυμία)'
    if (!b.invoice.vat || !isValidGreekVat(b.invoice.vat)) return 'invoice requires a valid 9-digit Greek VAT (ΑΦΜ)'
  }
  return null
}
