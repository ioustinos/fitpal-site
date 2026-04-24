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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
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
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
    }
  } else {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS })
  }

  if (!transactionId) {
    return Response.json({ error: 'transactionId is required' }, { status: 400, headers: CORS_HEADERS })
  }

  try {
    const outcome = await verifyVivaTransaction(transactionId)
    return Response.json(outcome, { headers: CORS_HEADERS })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('viva-verify failed:', msg)
    return Response.json({ error: msg }, { status: 500, headers: CORS_HEADERS })
  }
}
