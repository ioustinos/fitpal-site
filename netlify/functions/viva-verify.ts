// HTTP wrapper around verifyVivaTransaction, hit by:
//  - The customer return-URL landing pages (/order/return/success).
//  - Ad-hoc curl tests.
//
// Public endpoint — but only effective input is a transactionId, which
// itself doesn't leak anything. The lookup goes through Viva (not our DB
// by orderId), so a guessed ID leads nowhere.
//
// WEC-172: part of the Viva Payments integration epic (WEC-125).

import { verifyVivaTransaction } from '../lib/viva/verify'
import { verifyWalletPlanTransaction } from '../lib/wallet/verifyWalletPlanTransaction'
import { corsHeaders } from '../lib/cors'

export default async (request: Request) => {
  const cors = corsHeaders(request, 'GET, POST, OPTIONS')
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  let transactionId: string | null = null
  const url = new URL(request.url)

  if (request.method === 'GET') {
    transactionId = url.searchParams.get('t') ?? url.searchParams.get('transactionId')
  } else if (request.method === 'POST') {
    try {
      const body = (await request.json()) as { t?: string; transactionId?: string }
      transactionId = body.t ?? body.transactionId ?? null
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors})
    }
  } else {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors})
  }

  if (!transactionId) {
    return Response.json({ error: 'transactionId is required' }, { status: 400, headers: cors})
  }

  try {
    let outcome: Record<string, unknown> = await verifyVivaTransaction(transactionId)
    // WEC-504: the meal verifier returns 'unknown' for wallet-plan (`wp:`)
    // payments — those live in `wallet_plans`, not `payment_links`. The
    // customer return-URL is the only confirmation layer working on dev
    // (webhook + reconcile are both down — WEC-497 / WEC-485 / WEC-413), so
    // fall back to the wallet verifier here. Without this, package purchases
    // could never be confirmed on return. Meal orders are untouched: the
    // fallback only runs when the meal verifier itself couldn't match.
    if (outcome.status === 'unknown') {
      const w = await verifyWalletPlanTransaction(transactionId)
      if (w.status !== 'unknown') {
        outcome = { ...w, kind: 'wallet' }
      }
    }
    return Response.json(outcome, { headers: cors})
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('viva-verify failed:', msg)
    return Response.json({ error: msg }, { status: 500, headers: cors})
  }
}
