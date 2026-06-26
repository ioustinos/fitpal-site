import { createClient } from '@supabase/supabase-js'
// 2026-06-26: switched to awaited track() + subscribeProfileToMarketing
// (Netlify was killing the fire-and-forget mid-flight, see submit-order.ts).
import { track, subscribeProfileToMarketing, EVT } from '../lib/klaviyo'

/**
 * Admin grants a wallet credit to a customer (refund, gift, or adjustment).
 *
 * WEC-197.
 *
 * Flow:
 *   1. Verify caller is admin via is_admin() RPC on their JWT.
 *   2. Validate inputs (positive amount, ≤ cap, description present, type valid).
 *   3. Call public.wallet_admin_credit(...) RPC with service-role client.
 *      The RPC is atomic: locks/creates the wallet, increments balance +
 *      bonus_balance, inserts wallet_transactions row, returns tx id.
 *   4. Returns { transactionId, newBalanceCents } to the caller for UI refresh.
 *
 * Security:
 *   - Caller MUST present an admin JWT. Non-admin = 403.
 *   - Amount is capped at €500 to limit blast radius of fat-finger errors.
 *     Adjust GRANT_AMOUNT_CAP_CENTS if you need to go higher; for one-off
 *     larger refunds, do via direct SQL with audit.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const GRANT_AMOUNT_CAP_CENTS = 50_000 // €500
const VALID_TYPES = ['refund', 'gift', 'adjustment'] as const
type GrantType = typeof VALID_TYPES[number]

interface RequestBody {
  targetUserId: string
  amountCents: number
  type: GrantType
  descriptionEl: string
  descriptionEn: string
}

export default async (request: Request) => {
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
    const body: RequestBody = await request.json()

    // ── Validate inputs ──────────────────────────────────────────────────
    if (!body.targetUserId) {
      return Response.json({ error: 'targetUserId required' }, { status: 400 })
    }
    if (typeof body.amountCents !== 'number' || !Number.isInteger(body.amountCents) || body.amountCents <= 0) {
      return Response.json({ error: 'amountCents must be a positive integer' }, { status: 400 })
    }
    if (body.amountCents > GRANT_AMOUNT_CAP_CENTS) {
      return Response.json({
        error: `Amount exceeds the cap of €${(GRANT_AMOUNT_CAP_CENTS / 100).toFixed(2)}`,
      }, { status: 400 })
    }
    if (!VALID_TYPES.includes(body.type)) {
      return Response.json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 })
    }
    if (!body.descriptionEl?.trim() || !body.descriptionEn?.trim()) {
      return Response.json({ error: 'descriptionEl and descriptionEn are required' }, { status: 400 })
    }

    // ── Verify caller is admin ──────────────────────────────────────────
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) {
      return Response.json({ error: 'Invalid session' }, { status: 401 })
    }
    const { data: isAdmin } = await callerClient.rpc('is_admin')
    if (!isAdmin) {
      return Response.json({ error: 'Not authorised' }, { status: 403 })
    }

    if (!SUPABASE_SERVICE_KEY) {
      return Response.json({ error: 'Server not configured for wallet grants' }, { status: 500 })
    }
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ── Verify target user exists (avoid creating orphan wallets) ───────
    const { data: targetProfile } = await svc
      .from('profiles')
      .select('id')
      .eq('id', body.targetUserId)
      .maybeSingle()
    if (!targetProfile) {
      return Response.json({ error: 'Target user not found' }, { status: 404 })
    }

    // ── Call the atomic RPC ─────────────────────────────────────────────
    const { data: txId, error: rpcErr } = await svc.rpc('wallet_admin_credit', {
      p_user_id: body.targetUserId,
      p_amount_cents: body.amountCents,
      p_type: body.type,
      p_description_el: body.descriptionEl.trim(),
      p_description_en: body.descriptionEn.trim(),
      p_admin_user_id: caller.id,
    })
    if (rpcErr) {
      console.error('[admin-grant-wallet-credit] RPC failed:', rpcErr)
      return Response.json({
        error: 'Failed to grant credit',
        detail: rpcErr.message,
      }, { status: 500 })
    }

    // ── Read the new wallet balance for UI feedback ────────────────────
    const { data: walletRow } = await svc
      .from('wallets')
      .select('balance, base_balance, bonus_balance')
      .eq('user_id', body.targetUserId)
      .maybeSingle()

    // ── Audit log ──────────────────────────────────────────────────────
    await svc.from('admin_change_log').insert({
      table_name: 'wallets',
      field_name: 'balance',
      old_value: null,
      new_value: `+${body.amountCents}`,
      label: `Granted ${body.type} of €${(body.amountCents / 100).toFixed(2)} — ${body.descriptionEn}`,
      admin_user: caller.id,
    })

    // ── Fire Klaviyo "Wallet Credit Granted" event ─────────────────────
    // Fail-soft. Lang routes EL/EN Klaviyo template via flow's conditional
    // split on event.lang. Admin-initiated → look up customer lang server-side.
    try {
      let custLang: 'el' | 'en' = 'el'
      const { data: pref } = await svc
        .from('user_prefs')
        .select('lang')
        .eq('user_id', body.targetUserId)
        .maybeSingle()
      const l = (pref as { lang?: string } | null)?.lang
      if (l === 'el' || l === 'en') custLang = l

      // Profile name + auth email for the Klaviyo profile match.
      const { data: prof } = await svc
        .from('profiles')
        .select('name')
        .eq('id', body.targetUserId)
        .maybeSingle()
      const { data: au } = await svc.auth.admin.getUserById(body.targetUserId)
      const email = au?.user?.email ?? ''
      const firstName = ((prof as { name?: string } | null)?.name ?? '').split(' ')[0]

      if (email) {
        // 2026-06-26: template Vz2QB5/XezdAc uses snake_case
        // (event.amount, event.new_balance, event.reason,
        // event.bonus_expires_at). Emit BOTH.
        const newBalEuro = (walletRow as { balance: number } | null)?.balance != null
          ? ((walletRow as { balance: number }).balance) / 100
          : null
        const creditProps = {
          lang: custLang,
          // snake_case (template-expected)
          first_name: firstName,
          amount: body.amountCents / 100,
          new_balance: newBalEuro,
          reason: custLang === 'el' ? body.descriptionEl : body.descriptionEn,
          type: body.type,
          // camelCase (legacy / downstream)
          newBalance: newBalEuro,
        }
        const creditFires = await Promise.all([
          subscribeProfileToMarketing(email, 'Fitpal wallet credit (auto-subscribe)'),
          track(EVT.WalletCreditGranted, {
            email,
            firstName,
            externalId: body.targetUserId,
          }, creditProps),
        ])
        const creditFailed = creditFires.filter((r) => !r.ok)
        if (creditFailed.length > 0) {
          console.warn('[admin-grant-wallet-credit] klaviyo: %d/%d failed: %s',
            creditFailed.length, creditFires.length,
            creditFailed.map((r) => r.error).join(' | '))
        }
      }
    } catch (e) { console.warn('[admin-grant-wallet-credit] klaviyo:', e) }

    return Response.json({
      transactionId: txId,
      newBalanceCents: (walletRow as { balance: number } | null)?.balance ?? null,
      newBaseBalanceCents: (walletRow as { base_balance: number } | null)?.base_balance ?? null,
      newBonusBalanceCents: (walletRow as { bonus_balance: number } | null)?.bonus_balance ?? null,
    }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('[admin-grant-wallet-credit] failed:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
