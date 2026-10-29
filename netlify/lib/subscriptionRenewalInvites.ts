// WEC-896 — shared runner for the subscription renewal invitation.
//
// Fires ONE Klaviyo email per plan 3 days before it expires, with a button
// that reopens the wizard pre-filled with the previous package
// (`?view=subscription&renew=<planId>` — handled client-side in WalletPage).
//
// Decisions (Ioustinos, locked):
//  • 3 days before only — no expiry-day reminder.
//  • Skip plans the customer has already renewed (a newer active+paid plan).
//    Enforced in the subscription_renewal_candidates() RPC.
//  • No admin copy of the renewal email.
//
// Idempotency: two layers. (1) renewal_invite_sent_at stamped on the row after
// a successful send, and the RPC filters it out — so tomorrow's run skips it.
// (2) Klaviyo unique_id = `renewal:<planId>` dedupes at their end too.
//
// Time budget: scheduled functions are killed ~15s (see airtable-reconcile).
// We cap the batch and stop early with a deadline so a backlog never times out
// — leftovers are picked up on the next night's run.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { track, subscribeProfileToMarketing, EVT } from './klaviyo'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// The ordering site the wizard lives on, per environment (same model as Viva
// env resolution in CLAUDE.md). Production cron runs with CONTEXT=production.
function siteBase(): string {
  const isProd = process.env.CONTEXT === 'production' || process.env.VIVA_ENV === 'prod'
  return isProd ? 'https://orders.fitpal.gr' : 'https://dev--fitpal-order.netlify.app'
}

export function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

interface Candidate {
  id: string
  wallet_id: string
  user_id: string
  plan_length: string | null
  days_per_week: number | null
  goal: string | null
  meal_breakfast: boolean | null
  meal_lunch: boolean | null
  meal_dinner: boolean | null
  meal_snack: boolean | null
  daily_kcal: number | null
  active_until: string | null
}

export interface RenewalRunResult {
  candidates: number
  sent: number
  skipped: number
  failed: number
  details: Array<{ planId: string; status: 'sent' | 'skipped' | 'failed'; reason?: string }>
}

export async function runRenewalInvites(
  supabase: SupabaseClient,
  opts: { days?: number; limit?: number; deadlineMs?: number } = {},
): Promise<RenewalRunResult> {
  const days = opts.days ?? 3
  const limit = opts.limit ?? 50
  const deadlineMs = opts.deadlineMs ?? 10_000
  const startedAt = Date.now()
  const result: RenewalRunResult = { candidates: 0, sent: 0, skipped: 0, failed: 0, details: [] }

  const { data, error } = await supabase.rpc('subscription_renewal_candidates', { p_days: days, p_limit: limit })
  if (error) throw new Error(`subscription_renewal_candidates failed: ${error.message}`)
  const candidates = (data ?? []) as Candidate[]
  result.candidates = candidates.length

  for (const plan of candidates) {
    if (Date.now() - startedAt > deadlineMs) break // leave the rest for tomorrow
    try {
      const { data: au } = await supabase.auth.admin.getUserById(plan.user_id)
      const email = au?.user?.email ?? ''
      const userMeta = (au?.user?.user_metadata ?? {}) as { name?: string }
      const firstName = (userMeta.name ?? '').split(' ')[0]
      if (!email) {
        result.skipped++; result.details.push({ planId: plan.id, status: 'skipped', reason: 'no email' })
        continue
      }

      let lang: 'el' | 'en' = 'el'
      const { data: pref } = await supabase.from('user_prefs').select('lang').eq('user_id', plan.user_id).maybeSingle()
      const l = (pref as { lang?: string } | null)?.lang
      if (l === 'el' || l === 'en') lang = l
      const isEl = lang === 'el'

      const mealsLabel = [
        plan.meal_breakfast && (isEl ? 'Πρωινό' : 'Breakfast'),
        plan.meal_lunch && (isEl ? 'Μεσημεριανό' : 'Lunch'),
        plan.meal_dinner && (isEl ? 'Βραδινό' : 'Dinner'),
        plan.meal_snack && (isEl ? 'Σνακ' : 'Snack'),
      ].filter(Boolean).join(', ') || null
      const goalMap: Record<string, string> = isEl
        ? { lose: 'Απώλεια βάρους', maintain: 'Διατήρηση', gain: 'Αύξηση μυϊκής μάζας' }
        : { lose: 'Weight loss', maintain: 'Maintain', gain: 'Muscle gain' }
      const goalLabel = plan.goal ? (goalMap[plan.goal] ?? plan.goal) : null
      const renewUrl = `${siteBase()}/?view=subscription&renew=${plan.id}`
      const expiryFormatted = plan.active_until ? plan.active_until.split('-').reverse().join('/') : null

      // snake_case (template-expected) + camelCase (downstream), same as the
      // Subscription Purchased email.
      const props = {
        lang,
        first_name: firstName,
        renewal_url: renewUrl,
        expiry_date: plan.active_until,
        expiry_date_formatted: expiryFormatted,
        days_before: days,
        plan_length_label: plan.plan_length ?? null,
        meals_per_week: plan.days_per_week ?? null,
        goal_label: goalLabel,
        meals_label: mealsLabel,
        daily_kcal: plan.daily_kcal ?? null,
        // camelCase
        walletPlanId: plan.id,
        renewalUrl: renewUrl,
        expiryDate: plan.active_until,
        planLengthLabel: plan.plan_length ?? null,
        mealsPerWeek: plan.days_per_week ?? null,
      }

      const fires = await Promise.all([
        subscribeProfileToMarketing(email, 'Fitpal renewal invitation (auto-subscribe)'),
        track(EVT.SubscriptionRenewalInvite, { email, firstName, externalId: plan.user_id }, props, `renewal:${plan.id}`),
      ])
      const trackOk = fires[1]?.ok
      if (!trackOk) {
        result.failed++
        result.details.push({ planId: plan.id, status: 'failed', reason: fires[1]?.error ?? 'track failed' })
        continue // do NOT stamp — retry tomorrow
      }

      // Stamp only after a successful send → the RPC won't return it again.
      const { error: upErr } = await supabase
        .from('wallet_plans')
        .update({ renewal_invite_sent_at: new Date().toISOString() })
        .eq('id', plan.id)
        .is('renewal_invite_sent_at', null)
      if (upErr) {
        // Email went out; the stamp failed. Klaviyo unique_id still dedupes a
        // resend tomorrow, so this is a warning, not a double-send.
        console.warn('[renewal-invite] stamp failed for %s: %s', plan.id, upErr.message)
      }
      result.sent++
      result.details.push({ planId: plan.id, status: 'sent' })
    } catch (e) {
      result.failed++
      result.details.push({ planId: plan.id, status: 'failed', reason: e instanceof Error ? e.message : 'unknown' })
    }
  }

  return result
}
