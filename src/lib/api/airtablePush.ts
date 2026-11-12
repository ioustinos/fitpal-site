// WEC-914: ask the server to mirror one order / subscription to Airtable NOW,
// right after an admin edit, instead of waiting for the 5-minute sweep.
//
// Fire-and-forget and debounced per record: an admin often makes several edits
// in a row (quantity, then comment, then time), and the push always reads the
// current database state, so one push ~1.5 s after the LAST edit is enough.
// If this call is lost the record is still flagged airtable_dirty and the sweep
// picks it up — nothing depends on it succeeding.

const DEBOUNCE_MS = 1500
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function schedule(key: string, body: Record<string, string>) {
  const prev = timers.get(key)
  if (prev) clearTimeout(prev)
  timers.set(key, setTimeout(() => {
    timers.delete(key)
    fetch('/.netlify/functions/airtable-push-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => { /* the sweep is the safety net */ })
  }, DEBOUNCE_MS))
}

export function pushOrderToAirtableSoon(orderId: string | null | undefined) {
  if (orderId) schedule(`o:${orderId}`, { orderId })
}

export function pushWalletPlanToAirtableSoon(walletPlanId: string | null | undefined) {
  if (walletPlanId) schedule(`p:${walletPlanId}`, { walletPlanId })
}
