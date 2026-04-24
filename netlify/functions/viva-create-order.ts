// HTTP wrapper around createVivaOrder, guarded by a shared internal token
// AND a hard disable in production. Not intended for browser use —
// submit-order.ts imports createVivaOrder directly. This exists so we can
// curl-test the Viva flow in isolation against the sandbox.
//
// In production (VIVA_ENV=prod or Netlify CONTEXT=production) this
// endpoint always returns 404, regardless of env vars, so a leaked token
// can't be exploited.
//
// WEC-171: part of the Viva Payments integration epic (WEC-125).

import { createVivaOrder, CreateOrderArgs } from '../lib/viva/createOrder'

const INTERNAL_TOKEN = process.env.VIVA_INTERNAL_TOKEN ?? ''

function isProd(): boolean {
  const explicit = (process.env.VIVA_ENV ?? '').toLowerCase()
  if (explicit === 'prod') return true
  if (explicit === 'dev') return false
  return process.env.CONTEXT === 'production'
}

export default async (request: Request) => {
  // HARD DISABLE in production — pretend the endpoint doesn't exist.
  if (isProd()) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // Shared-secret guard — not user-facing auth.
  const auth = request.headers.get('x-internal-token') ?? ''
  if (!INTERNAL_TOKEN || auth !== INTERNAL_TOKEN) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: CreateOrderArgs
  try {
    body = (await request.json()) as CreateOrderArgs
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = await createVivaOrder(body)
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('viva-create-order failed:', msg)
    return Response.json({ error: msg }, { status: 400 })
  }
}
