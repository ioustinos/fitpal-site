// WEC-425: admin-only read-only probe — given one or more Viva orderCodes,
// returns the transactions Viva has on file for each, including statusId.
//
// Built primarily so the WEC-425 audit (4 auto-cancelled orders on dev) can
// be completed without anyone fetching VIVA_CLIENT_ID/SECRET from Netlify by
// hand — the function already has them at runtime.
//
// Auth: shared-secret bearer header. Uses VIVA_INTERNAL_TOKEN (same env var
// the dev-only viva-create-order wrapper uses). NEVER set this in prod.
//
// Usage:
//   curl -H "Authorization: Bearer $VIVA_INTERNAL_TOKEN" \
//     "https://dev--fitpal-order.netlify.app/api/viva-probe?codes=A,B,C"
//
// Returns:
//   { results: [ { orderCode, transactions: [{transactionId, statusId, amount}] }, ... ] }
//
// Side effects: NONE. No DB writes, no Viva mutations. Strictly a GET-read.

import { getVivaAccessToken } from '../lib/viva/auth'
import { getVivaCreds } from '../lib/viva/env'
import { corsHeaders } from '../lib/cors'

const INTERNAL_TOKEN = process.env.VIVA_INTERNAL_TOKEN ?? ''

interface VivaTx {
  transactionId?: string
  statusId?: string
  amount?: number
}
interface VivaOrderShape {
  transactions?: VivaTx[]
}

export default async (request: Request) => {
  const cors = corsHeaders(request, 'GET, OPTIONS')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  // Dev-only switch: same pattern as viva-create-order. CONTEXT is set by
  // Netlify automatically — 'production' for the main branch deploy.
  const isProd = process.env.VIVA_ENV === 'prod' || process.env.CONTEXT === 'production'
  if (isProd) return new Response('Not found', { status: 404 })

  if (!INTERNAL_TOKEN) {
    return Response.json(
      { error: 'VIVA_INTERNAL_TOKEN env var not configured' },
      { status: 500, headers: cors },
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : ''
  if (provided !== INTERNAL_TOKEN) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
  }

  let codes: string[] = []
  try {
    const u = new URL(request.url)
    const raw = u.searchParams.get('codes') ?? ''
    codes = raw.split(',').map((s) => s.trim()).filter(Boolean)
  } catch {
    /* fall through to empty-list error */
  }
  if (codes.length === 0 || codes.length > 20) {
    return Response.json(
      { error: 'Pass ?codes=A,B,C (1-20 order codes)' },
      { status: 400, headers: cors },
    )
  }

  let token: string
  let creds: ReturnType<typeof getVivaCreds>
  try {
    token = await getVivaAccessToken()
    creds = getVivaCreds()
  } catch (err) {
    return Response.json(
      { error: 'OAuth token fetch failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502, headers: cors },
    )
  }

  const results: Array<{
    orderCode: string
    status: 'ok' | 'not_found' | 'error'
    transactions: Array<{ transactionId: string; statusId: string | null; amount: number | null }>
    error?: string
  }> = []

  for (const orderCode of codes) {
    try {
      const res = await fetch(
        `https://${creds.apiHost}/checkout/v2/orders/${encodeURIComponent(orderCode)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.status === 404) {
        results.push({ orderCode, status: 'not_found', transactions: [] })
        continue
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        results.push({
          orderCode, status: 'error', transactions: [],
          error: `Viva ${res.status} ${body.slice(0, 200)}`,
        })
        continue
      }
      const data = (await res.json()) as VivaOrderShape
      const txs = (data.transactions ?? [])
        .filter((t): t is { transactionId: string; statusId?: string; amount?: number } =>
          typeof t.transactionId === 'string')
        .map((t) => ({
          transactionId: t.transactionId,
          statusId: t.statusId ?? null,
          amount: typeof t.amount === 'number' ? t.amount : null,
        }))
      results.push({ orderCode, status: 'ok', transactions: txs })
    } catch (err) {
      results.push({
        orderCode, status: 'error', transactions: [],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // statusId='F' = Finalized (paid). Surface it at the top of the response so
  // a quick visual scan tells you whether any of the probed codes paid.
  const anyPaid = results.some((r) =>
    r.transactions.some((t) => t.statusId === 'F'),
  )
  return Response.json({ anyPaid, results }, { status: 200, headers: cors })
}
