// POST /api/wallet-plan-quote
//
// Public endpoint. Takes a WalletCalcInput, runs the calculator server-side
// using settings loaded from Supabase, returns the full WalletCalcResult plus
// some checkout-relevant config (allowed payment methods, services catalog,
// minimum amount, voucher enabled).
//
// The frontend uses this for live preview INSTEAD of running the calculator
// in the browser — that way the price the user sees is the price the server
// will charge (no client tampering possible).

import { calculateWalletPlan } from '../../src/lib/wallet/calculator'
import { loadWalletConfig } from '../lib/wallet/loadSettings'
import type { WalletCalcInput } from '../../src/lib/wallet/types'

const ALLOWED_ORIGINS = '*'

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders() })
  }

  let body: WalletCalcInput
  try {
    body = await request.json() as WalletCalcInput
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders() })
  }

  const validation = validateInput(body)
  if (validation) {
    return Response.json({ error: validation }, { status: 400, headers: corsHeaders() })
  }

  try {
    const config = await loadWalletConfig()
    const result = calculateWalletPlan(body, config.settings)

    return Response.json({
      result,
      config: {
        paymentMethods:  config.paymentMethods,
        voucherEnabled:  config.voucherEnabled,
        servicesCatalog: config.servicesCatalog,
        minAmountCents:  config.minAmountCents,
      },
    }, { status: 200, headers: corsHeaders() })
  } catch (err) {
    console.error('[wallet-plan-quote] failed', err)
    return Response.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders() })
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function validateInput(b: WalletCalcInput): string | null {
  if (!b) return 'Body required'
  if (!['female','male','other'].includes(b.sex)) return 'sex invalid'
  if (typeof b.age !== 'number' || b.age < 14 || b.age > 100) return 'age out of range'
  if (typeof b.heightCm !== 'number' || b.heightCm < 100 || b.heightCm > 250) return 'heightCm out of range'
  if (typeof b.weightKg !== 'number' || b.weightKg < 30 || b.weightKg > 300) return 'weightKg out of range'
  if (!['sedentary','light','moderate','active','very_active'].includes(b.activity)) return 'activity invalid'
  if (!['lose','maintain','gain'].includes(b.goal)) return 'goal invalid'
  if (!b.meals || typeof b.meals !== 'object') return 'meals invalid'
  if (!['2w','1mo','3mo'].includes(b.planLength)) return 'planLength invalid'
  if (![5,6,7].includes(b.daysPerWeek)) return 'daysPerWeek invalid'
  if (!b.services || typeof b.services !== 'object') return 'services invalid'
  return null
}
