/**
 * WEC-845 / WEC-842 — the logged-in customer's dietitian link, as the
 * customer side needs it: the dietitian's name, the client DISCOUNT (never
 * the commission — 🟢 «ο πελάτης δεν βλέπει τα οικονομικά του διαιτολόγου»),
 * and whether the client still has to confirm the link / give consent.
 *
 * Source: the `my_partner_link()` RPC, which reads auth.uid() — so under
 * session-swap impersonation it naturally returns the IMPERSONATED client's
 * link, which is exactly what the cart must show.
 *
 * The server (submit-order.ts) is authoritative for the money; this is only
 * the preview, using the same formula: round(itemsSubtotalCents × bps / 10000).
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '../supabase'

export interface PartnerLink {
  id: string
  partnerName: string
  status: 'active' | 'pending'
  discountBps: number
  needsConfirm: boolean
  needsConsent: boolean
  awaitingFitpal: boolean
}

interface PartnerLinkState {
  userId: string | null
  link: PartnerLink | null
  loaded: boolean
  load: (force?: boolean) => Promise<void>
  respond: (accept: boolean, consent: boolean) => Promise<{ error: string | null }>
}

let inflight: Promise<void> | null = null

export const usePartnerLinkStore = create<PartnerLinkState>()((set, get) => ({
  userId: null,
  link: null,
  loaded: false,
  load: async (force = false) => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    if (!uid) { set({ userId: null, link: null, loaded: true }); return }
    if (!force && get().loaded && get().userId === uid) return
    if (inflight && !force) return inflight
    inflight = (async () => {
      const { data, error } = await supabase.rpc('my_partner_link')
      if (error) {
        // Fail quiet: no discount preview. The server still prices correctly.
        console.warn('[partner] my_partner_link failed:', error.message)
        set({ userId: uid, link: null, loaded: true })
      } else {
        set({ userId: uid, link: (data as PartnerLink | null) ?? null, loaded: true })
      }
    })()
    try { await inflight } finally { inflight = null }
  },
  respond: async (accept, consent) => {
    const link = get().link
    if (!link) return { error: 'no link' }
    const { data, error } = await supabase.rpc('client_respond_partner_link', {
      p_link: link.id, p_accept: accept, p_consent: consent,
    })
    if (error) return { error: error.message }
    set({ link: (data as PartnerLink | null) ?? null })
    return { error: null }
  },
}))

// Reload whenever the signed-in user changes (login, logout, impersonation swap).
let subscribed = false
function ensureSubscribed() {
  if (subscribed) return
  subscribed = true
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null
    if (uid !== usePartnerLinkStore.getState().userId) {
      usePartnerLinkStore.setState({ loaded: false })
      void usePartnerLinkStore.getState().load(true)
    }
  })
}

export function usePartnerLink(): PartnerLink | null {
  ensureSubscribed()
  const link = usePartnerLinkStore((s) => s.link)
  const loaded = usePartnerLinkStore((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void usePartnerLinkStore.getState().load()
  }, [loaded])
  return link
}

/**
 * The dietitian discount for a cart whose items subtotal (before vouchers)
 * is `rawTotalEuros`. Returns euros, rounded to the cent like the server.
 */
export function usePartnerDiscount(rawTotalEuros: number): { active: boolean; pct: number; amount: number; partnerName: string } {
  const link = usePartnerLink()
  const bps = link && link.status === 'active' ? link.discountBps : 0
  if (!bps || rawTotalEuros <= 0) return { active: false, pct: 0, amount: 0, partnerName: link?.partnerName ?? '' }
  const cents = Math.round(Math.round(rawTotalEuros * 100) * bps / 10000)
  return { active: true, pct: bps / 100, amount: cents / 100, partnerName: link?.partnerName ?? '' }
}
