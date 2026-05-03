// Refund a wallet plan via Viva, then book the wallet-side state change
// atomically through wallet_plan_refund() SQL function.
//
// Mirrors netlify/lib/viva/refund.ts in shape; differences:
//   - Looks up viva_transaction_id from wallet_plans (not payment_links)
//   - Calls wallet_plan_refund SQL fn (atomic plan update + balance deduct + tx insert + audit)
//
// Same Viva refund endpoint shape (DELETE on /api/transactions/{id}/ via
// checkout host, Basic auth, MerchantId:ApiKey).

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getVivaCreds } from '../viva/env'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export interface RefundWalletPlanArgs {
  walletPlanId: string
  /** Omit for full refund of remaining unpaid balance. */
  amountCents?: number
  reason: string
  adminUserId: string
}

export interface RefundWalletPlanResult {
  refundedCents: number
  newRefundTotal: number
  planFullyRefunded: boolean
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function refundWalletPlan(args: RefundWalletPlanArgs): Promise<RefundWalletPlanResult> {
  if (!args.walletPlanId) throw new Error('walletPlanId required')
  if (!args.reason?.trim()) throw new Error('reason required')

  const supabase = serviceClient()

  const { data: plan } = await supabase
    .from('wallet_plans')
    .select('id, amount_to_pay_cents, refund_amount_cents, payment_status, viva_transaction_id')
    .eq('id', args.walletPlanId)
    .single()

  if (!plan) throw new Error(`wallet_plan ${args.walletPlanId} not found`)
  if (plan.payment_status !== 'paid') {
    throw new Error(`wallet_plan ${args.walletPlanId} is not in 'paid' status (current=${plan.payment_status})`)
  }
  if (!plan.viva_transaction_id) {
    throw new Error('No Viva transaction recorded — handle this refund manually')
  }

  const totalCents = plan.amount_to_pay_cents as number
  const currentRefund = (plan.refund_amount_cents ?? 0) as number
  const remaining = totalCents - currentRefund
  if (remaining <= 0) throw new Error('Plan has no refundable balance remaining')

  const refundCents = args.amountCents ?? remaining
  if (!Number.isInteger(refundCents) || refundCents <= 0) {
    throw new Error('Refund amount must be a positive integer (cents)')
  }
  if (refundCents > remaining) {
    throw new Error(`Refund €${(refundCents / 100).toFixed(2)} exceeds remaining €${(remaining / 100).toFixed(2)}`)
  }

  // Call Viva refund (legacy DELETE endpoint, Basic auth)
  const creds = getVivaCreds()
  const basic = Buffer.from(`${creds.merchantId}:${creds.apiKey}`).toString('base64')
  const url = new URL(
    `https://${creds.checkoutHost}/api/transactions/${encodeURIComponent(plan.viva_transaction_id as string)}/`,
  )
  url.searchParams.set('amount', String(refundCents))
  url.searchParams.set('sourceCode', creds.sourceCode)

  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Basic ${basic}` },
  })

  const responseText = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`Viva refund failed: ${res.status} ${responseText}`)

  let parsed: { StatusId?: string; ErrorCode?: number; ErrorText?: string } = {}
  try { parsed = JSON.parse(responseText) } catch { /* leave empty */ }
  if (parsed.StatusId && parsed.StatusId !== 'F') {
    throw new Error(`Viva refund declined: ${parsed.ErrorCode ?? '?'} ${parsed.ErrorText ?? 'unknown'}`)
  }

  // Atomic DB updates via SQL function
  const { error: rpcErr } = await supabase.rpc('wallet_plan_refund', {
    p_plan_id: args.walletPlanId,
    p_amount_cents: refundCents,
    p_admin_user_id: args.adminUserId,
    p_reason: args.reason,
  })
  if (rpcErr) {
    console.error(
      '[refundWalletPlan] CRITICAL: Viva refund succeeded but DB write failed planId=%s amount=%d',
      args.walletPlanId, refundCents, rpcErr,
    )
    throw new Error(`Viva refund succeeded but local update failed: ${rpcErr.message}`)
  }

  return {
    refundedCents: refundCents,
    newRefundTotal: currentRefund + refundCents,
    planFullyRefunded: (currentRefund + refundCents) >= totalCents,
  }
}
