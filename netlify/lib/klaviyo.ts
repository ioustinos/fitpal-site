/**
 * Klaviyo client — fire-and-forget transactional events.
 *
 * Server-side wrapper around Klaviyo's Events API. We don't call the
 * Email or Template APIs directly — Klaviyo is configured at the
 * dashboard level to listen for our event names and send the right
 * email per template/flow. This keeps the code minimal and lets the
 * non-developer (Ioustinos) tune messaging in Klaviyo without code
 * changes.
 *
 * ## Setup
 *
 * 1. Sign up at klaviyo.com (free tier covers up to ~250 contacts).
 * 2. Create a Private API Key: Settings → API Keys → Create. Grant
 *    "Events: write" + "Profiles: write" + "Catalogs: read" scopes.
 * 3. Set `KLAVIYO_API_KEY` in Netlify env vars (production + branch-deploys).
 *    Optionally `.env.local` for local dev.
 * 4. In Klaviyo dashboard → Flows: create a flow per event below,
 *    triggered by the event name, with email templates.
 *
 * ## Events emitted
 *
 *   - "Order Placed"
 *       fired from `netlify/functions/submit-order.ts` after the order
 *       row is committed. Carries: orderId, orderNumber, total, days,
 *       items, paymentMethod.
 *   - "Order Refunded"
 *       fired from `netlify/functions/viva-refund.ts` after a refund
 *       call to Viva succeeds. Carries: orderId, orderNumber, amount,
 *       partial vs full.
 *
 * Add new events as you go. Each event uses the same `track()` helper.
 *
 * ## Failure behaviour
 *
 * Klaviyo calls are best-effort. If KLAVIYO_API_KEY is unset, or the
 * request fails, the function logs and CONTINUES. Order placement is
 * never blocked on email delivery — the customer still gets a confirmed
 * order; the worst case is they don't get an email until you fix the
 * Klaviyo config or re-fire manually.
 *
 * ## What this does NOT do
 *
 *   - Supabase Auth emails (signup confirmation, password reset, magic
 *     links). Klaviyo doesn't offer SMTP — those need a real SMTP
 *     provider (Resend / Postmark / SendGrid) plugged into Supabase
 *     Auth → SMTP settings. WEC-190 covers that as a separate concern.
 *
 *   - Marketing automation flows (welcome series, abandoned cart, post-
 *     delivery review request). Those go in Klaviyo too but are
 *     configured as flows in the Klaviyo dashboard, not from this code.
 */

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY ?? ''
const KLAVIYO_API_BASE = 'https://a.klaviyo.com/api'
const KLAVIYO_REVISION = '2024-10-15'

export interface KlaviyoProfile {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  externalId?: string  // typically our user_id
}

/**
 * Track a custom event for a customer. The event name + properties are
 * what Klaviyo flows trigger off — keep names stable; rename ⇒ broken flows.
 *
 * @param eventName - "Order Placed", "Order Refunded", etc.
 * @param profile   - Customer identity (email is required by Klaviyo).
 * @param properties- Event-specific payload templates pull from.
 */
export async function track(
  eventName: string,
  profile: KlaviyoProfile,
  properties: Record<string, unknown> = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!KLAVIYO_API_KEY) {
    // Silent no-op when not configured. We don't want to fail orders
    // just because email isn't wired yet.
    return { ok: false, error: 'KLAVIYO_API_KEY not set' }
  }
  if (!profile.email) {
    return { ok: false, error: 'profile.email required' }
  }

  try {
    const body = {
      data: {
        type: 'event',
        attributes: {
          properties,
          metric: { data: { type: 'metric', attributes: { name: eventName } } },
          profile: {
            data: {
              type: 'profile',
              attributes: {
                email: profile.email,
                ...(profile.firstName ? { first_name: profile.firstName } : {}),
                ...(profile.lastName ? { last_name: profile.lastName } : {}),
                ...(profile.phone ? { phone_number: profile.phone } : {}),
                ...(profile.externalId ? { external_id: profile.externalId } : {}),
              },
            },
          },
        },
      },
    }

    const res = await fetch(`${KLAVIYO_API_BASE}/events/`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        revision: KLAVIYO_REVISION,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(`[klaviyo] ${eventName} failed:`, res.status, text.slice(0, 300))
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    console.warn(`[klaviyo] ${eventName} threw:`, err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/**
 * Convenience: fire-and-forget. Doesn't await, doesn't throw.
 * Use when the caller doesn't care about the result and just wants the
 * event in the queue.
 */
export function trackAsync(
  eventName: string,
  profile: KlaviyoProfile,
  properties: Record<string, unknown> = {},
): void {
  // Wrap in a microtask so any synchronous error in the call chain
  // doesn't bubble. The track() implementation already swallows errors,
  // but defence-in-depth.
  Promise.resolve().then(() => track(eventName, profile, properties)).catch(() => {})
}
