// WEC-432: Viva legacy order-state lookup. The OAuth Smart Checkout
// listing endpoint (`GET /checkout/v2/orders/{code}`) returns 404 for
// every orderCode we've tested — paid or fresh — so the original
// listVivaTransactions call is a no-op. The Basic-auth legacy endpoint
// at the *checkout* host returns rich order data including StateId,
// which is enough for verify-before-cancel ("is this paid?").
//
// We don't pull transactions[] from this endpoint, so we can't mark
// the order paid from a single response — that requires a follow-up
// fetch and is intentionally out of scope. The use case is purely
// "should reconcile cancel this row in Phase 2, or is Viva telling us
// it's paid and we should leave it alone for an admin to investigate?"
//
// Viva StateId values we care about (other values exist for various
// in-flight states; treat anything unknown as 'pending' to be safe):
//   0  = Created / awaiting payment
//   3  = Captured (paid)
// See https://developer.viva.com/apis-for-payments/payment-api/

import { getVivaCreds } from './env'

export type VivaOrderState = 'paid' | 'pending' | 'unknown'

export interface VivaOrderStateResult {
  state: VivaOrderState
  stateId: number | null
  orderCode: string
  /** Raw amount as reported by Viva (euros, decimal). */
  requestAmount: number | null
  merchantTrns: string | null
  customerTrns: string | null
}

/** Single Basic-auth GET against demo.vivapayments.com / www.vivapayments.com.
 *  Returns `{ state: 'unknown' }` on 404 OR network error — caller decides
 *  whether to fail-open (skip cancel) or fail-closed (proceed with cancel). */
export async function getVivaOrderState(orderCode: string): Promise<VivaOrderStateResult> {
  const creds = getVivaCreds()
  const basic = Buffer.from(`${creds.merchantId}:${creds.apiKey}`).toString('base64')
  const url = `https://${creds.checkoutHost}/api/orders/${encodeURIComponent(orderCode)}`

  const empty: VivaOrderStateResult = {
    state: 'unknown', stateId: null, orderCode,
    requestAmount: null, merchantTrns: null, customerTrns: null,
  }

  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } })
  } catch (err) {
    console.warn('[viva-order-state] network error for orderCode=%s:', orderCode, err)
    return empty
  }
  if (res.status === 404) return empty
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn('[viva-order-state] non-OK %d for orderCode=%s: %s', res.status, orderCode, body.slice(0, 200))
    return empty
  }

  // The orderCode echoed back by Viva exceeds MAX_SAFE_INTEGER for some
  // codes — read as string from raw text per WEC-430 precedent. Other
  // fields are safe to JSON.parse.
  const text = await res.text()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    return empty
  }
  const m = text.match(/"OrderCode"\s*:\s*(\d+)/)
  const echoedCode = m ? m[1] : (parsed.OrderCode != null ? String(parsed.OrderCode) : orderCode)
  const stateIdRaw = parsed.StateId
  const stateId = typeof stateIdRaw === 'number' ? stateIdRaw : null
  const state: VivaOrderState = stateId === 3 ? 'paid' : stateId === 0 ? 'pending' : 'unknown'

  return {
    state,
    stateId,
    orderCode: echoedCode,
    requestAmount: typeof parsed.RequestAmount === 'number' ? parsed.RequestAmount : null,
    merchantTrns: typeof parsed.MerchantTrns === 'string' ? parsed.MerchantTrns : null,
    customerTrns: typeof parsed.CustomerTrns === 'string' ? parsed.CustomerTrns : null,
  }
}
