// DEV-ONLY debug endpoint (rev 2). Returns raw Viva responses for OAuth and
// create-order so we can pinpoint failures quickly. Never enabled in prod.
// Also probes the Supabase service-role client.
//
// Hit: https://dev--fitpal-order.netlify.app/api/viva-debug
// (No auth — safe because prod returns 404 and the dev sandbox isn't sensitive.)

import { createClient } from '@supabase/supabase-js'
import { getVivaCreds } from '../lib/viva/env'

function isProd(): boolean {
  const explicit = (process.env.VIVA_ENV ?? '').toLowerCase()
  if (explicit === 'prod') return true
  if (explicit === 'dev') return false
  return process.env.CONTEXT === 'production'
}

interface Step {
  step: string
  ok: boolean
  [key: string]: unknown
}

export default async (request: Request) => {
  if (isProd()) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const probeOrderCode = url.searchParams.get('orderCode')

  const steps: Step[] = []

  // ── Step 0: Supabase service-role client probe ─────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? ''
  const supabaseSvcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supabaseSvcKey) {
    steps.push({
      step: 'supabaseServiceClient',
      ok: false,
      error: 'SUPABASE_SERVICE_ROLE_KEY env var is not set',
    })
  } else {
    try {
      const svc = createClient(supabaseUrl, supabaseSvcKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { count, error } = await svc.from('orders').select('id', { count: 'exact', head: true })
      if (error) throw error
      steps.push({
        step: 'supabaseServiceClient',
        ok: true,
        url: supabaseUrl,
        keyLen: supabaseSvcKey.length,
        ordersCount: count,
      })
    } catch (err) {
      steps.push({
        step: 'supabaseServiceClient',
        ok: false,
        error: String(err),
      })
    }
  }

  let creds
  try {
    creds = getVivaCreds()
    steps.push({
      step: 'getVivaCreds',
      ok: true,
      env: creds.env,
      hosts: {
        accounts: creds.accountsHost,
        api: creds.apiHost,
        checkout: creds.checkoutHost,
      },
      sourceCode: creds.sourceCode,
      clientIdSuffix: '...' + creds.clientId.slice(-30),
      clientSecretLen: creds.clientSecret.length,
      merchantId: creds.merchantId,
      apiKeyLen: creds.apiKey.length,
    })
  } catch (err) {
    steps.push({ step: 'getVivaCreds', ok: false, error: String(err) })
    return Response.json({ steps }, { status: 500 })
  }

  // ── Step 1: OAuth token ────────────────────────────────────────────────
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
  const oauthUrl = `https://${creds.accountsHost}/connect/token`
  let token: string | null = null
  try {
    const res = await fetch(oauthUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'urn:viva:payments:core:api:redirectcheckout',
      }).toString(),
    })
    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }
    if (parsed && typeof parsed === 'object' && 'access_token' in parsed) {
      const obj = parsed as { access_token: string; [k: string]: unknown }
      token = obj.access_token
      steps.push({
        step: 'OAuth',
        ok: res.ok,
        status: res.status,
        url: oauthUrl,
        response: { ...obj, access_token: `<token len=${token.length}>` },
      })
    } else {
      steps.push({
        step: 'OAuth',
        ok: res.ok,
        status: res.status,
        url: oauthUrl,
        response: typeof parsed === 'string' ? parsed.slice(0, 800) : parsed,
      })
    }
  } catch (err) {
    steps.push({ step: 'OAuth', ok: false, url: oauthUrl, error: String(err) })
    return Response.json({ steps }, { status: 500 })
  }

  if (!token) return Response.json({ steps })

  // ── Step 2: Create a test order ────────────────────────────────────────
  const orderUrl = `https://${creds.apiHost}/checkout/v2/orders`
  const body = {
    amount: 1000,
    customerTrns: 'DEBUG-' + Date.now(),
    merchantTrns: 'DEBUG-' + Date.now(),
    sourceCode: creds.sourceCode,
    customer: {
      email: 'debug@fitpal.gr',
      fullName: 'Debug Test',
      countryCode: 'GR',
    },
    paymentTimeOut: 1800,
    preauth: false,
    allowRecurring: false,
    maxInstallments: 0,
  }

  try {
    const res = await fetch(orderUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }
    steps.push({
      step: 'CreateOrder',
      ok: res.ok,
      status: res.status,
      url: orderUrl,
      requestBody: body,
      response: typeof parsed === 'string' ? parsed.slice(0, 800) : parsed,
    })
  } catch (err) {
    steps.push({ step: 'CreateOrder', ok: false, url: orderUrl, error: String(err) })
  }

  // ── Step 3 (optional): probe the listing endpoint for a real orderCode ─
  if (probeOrderCode && token) {
    const probeUrl = `https://${creds.apiHost}/checkout/v2/orders/${encodeURIComponent(probeOrderCode)}`
    try {
      const res = await fetch(probeUrl, { headers: { Authorization: `Bearer ${token}` } })
      const text = await res.text()
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { parsed = text }
      steps.push({
        step: 'ListTransactionsForOrderCode',
        ok: res.ok,
        status: res.status,
        url: probeUrl,
        response: typeof parsed === 'string' ? parsed.slice(0, 1500) : parsed,
      })
    } catch (err) {
      steps.push({ step: 'ListTransactionsForOrderCode', ok: false, error: String(err) })
    }
  }

  return Response.json({ steps })
}
