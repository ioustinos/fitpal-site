// WEC-896 — nightly renewal invitation (scheduled). The work lives in the
// shared runner so the manual dev trigger (subscription-renewal-invite-run.ts)
// uses the exact same code path.
//
// Netlify runs scheduled functions on the PRODUCTION deploy only — on dev this
// never fires by itself; use the «run» endpoint to test.

import { runRenewalInvites, serviceClient } from '../lib/subscriptionRenewalInvites'

export default async (): Promise<Response> => {
  try {
    const supabase = serviceClient()
    const result = await runRenewalInvites(supabase, { days: 3, limit: 50, deadlineMs: 10_000 })
    console.log('[subscription-renewal-invite]', JSON.stringify(result))
    return Response.json(result)
  } catch (e) {
    console.error('[subscription-renewal-invite] failed:', e)
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}

// 05:30 UTC = ~07:30/08:30 Athens — a morning send, outside the 15:00–18:00
// window and well after the night's DB edits.
export const config = {
  schedule: '30 5 * * *',
}
