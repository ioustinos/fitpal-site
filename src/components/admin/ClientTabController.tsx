import { useEffect, useState } from 'react'
import { useImpersonationStore, type LockReason } from '../../store/useImpersonationStore'
import { useUIStore } from '../../store/useUIStore'
import { supabase } from '../../lib/supabase'
import {
  IS_CLIENT_TAB, CLIENT_TAB_READY, CLIENT_TAB_HANDOFF, closeClientTab, type ClientTabHandoff,
} from '../../lib/clientTab'

/**
 * WEC-868 — the life of a client-mode tab. Renders nothing in normal tabs.
 *
 *  • Boot: announce READY to the operator's tab (window.opener) and take the
 *    handoff (token + customer + server session id) from it, only from that
 *    exact window and our own origin.
 *  • Live: heartbeat every 60s (and whenever the tab becomes visible). The
 *    server answers whether the session may still act; if not — a newer
 *    client tab replaced it, it expired, it was closed — the tab locks.
 *  • Title: «Ως πελάτης: Όνομα» so the tab is unmistakable in the tab bar.
 *  • Lock screen: covers everything; the only action is closing the tab.
 */
const HEARTBEAT_MS = 60_000

export function ClientTabController() {
  if (!IS_CLIENT_TAB) return null
  return <ClientTabControllerInner />
}

function ClientTabControllerInner() {
  const active = useImpersonationStore((s) => s.active)
  const target = useImpersonationStore((s) => s.target)
  const locked = useImpersonationStore((s) => s.locked)
  const lockMessage = useImpersonationStore((s) => s.lockMessage)
  const sessionId = useImpersonationStore((s) => s.clientSessionId)
  const expiresAt = useImpersonationStore((s) => s.expiresAt)
  const lang = useUIStore((s) => s.lang)
  const el = lang === 'el'
  const [waiting, setWaiting] = useState(!active && !locked)

  // ── Boot: handshake with the operator's tab ────────────────────────────
  useEffect(() => {
    const st = useImpersonationStore.getState()
    if (st.active || st.locked) { setWaiting(false); return }
    const opener = window.opener as Window | null
    if (!opener) {
      st.lock('missing', null)
      setWaiting(false)
      return
    }
    let done = false
    const announce = () => { try { opener.postMessage({ type: CLIENT_TAB_READY }, window.location.origin) } catch { /* ignore */ } }
    async function onMsg(ev: MessageEvent) {
      if (ev.source !== opener || ev.origin !== window.location.origin) return
      if (ev.data?.type === 'fitpal-client-tab-ping') { announce(); return }
      if (ev.data?.type !== CLIENT_TAB_HANDOFF || done) return
      done = true
      const h = ev.data as ClientTabHandoff
      const res = await useImpersonationStore.getState().acceptHandoff(h)
      setWaiting(false)
      if (!res.ok) return
      // Clean URL, then land where the operator asked.
      window.history.replaceState(null, '', '/')
      if (h.where === 'account') useUIStore.getState().goToAccount('profile')
      else if (h.where === 'plan') useUIStore.getState().goToWalletPage()
    }
    window.addEventListener('message', onMsg)
    announce()
    const again = window.setInterval(announce, 1000)
    const giveUp = window.setTimeout(() => {
      if (done) return
      useImpersonationStore.getState().lock('failed', null)
      setWaiting(false)
    }, 35_000)
    return () => {
      window.removeEventListener('message', onMsg)
      window.clearInterval(again); window.clearTimeout(giveUp)
    }
  }, [])

  // ── Heartbeat ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || locked || !sessionId) return
    let stopped = false
    async function beat() {
      if (stopped) return
      if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
        useImpersonationStore.getState().lock('expired', null); return
      }
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) { useImpersonationStore.getState().lock('ended', null); return }
        const res = await fetch('/.netlify/functions/client-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessionId, action: 'status' }),
        })
        if (!res.ok) return // network / server hiccup: try again next beat
        const json = await res.json() as { active?: boolean; reason?: LockReason; message?: string }
        if (json.active === false) {
          useImpersonationStore.getState().lock(json.reason ?? 'ended', json.message ?? null)
        }
      } catch { /* offline: next beat */ }
    }
    void beat()
    const t = window.setInterval(beat, HEARTBEAT_MS)
    const onVis = () => { if (document.visibilityState === 'visible') void beat() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stopped = true; window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [active, locked, sessionId, expiresAt])

  // ── Once locked, drop this tab's copy of the customer's session ────────
  useEffect(() => {
    if (!locked) return
    void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }, [locked])

  // ── Tab title ──────────────────────────────────────────────────────────
  useEffect(() => {
    const name = target?.name || target?.email
    const prefix = locked
      ? (el ? '🔒 Έκλεισε · ' : '🔒 Closed · ')
      : name ? (el ? `Ως πελάτης: ${name} · ` : `As client: ${name} · `) : ''
    const apply = () => {
      const base = document.title.replace(/^(🔒 (Έκλεισε|Closed) · |(Ως πελάτης|As client): .*? · )/, '')
      if (!document.title.startsWith(prefix)) document.title = prefix + base
    }
    apply()
    const t = window.setInterval(apply, 1500) // pages set their own titles
    return () => window.clearInterval(t)
  }, [target?.name, target?.email, locked, el])

  if (waiting && !locked) {
    return (
      <Overlay>
        <h2>{el ? 'Ανοίγει η λειτουργία πελάτη…' : 'Opening client mode…'}</h2>
      </Overlay>
    )
  }

  if (!locked) return null
  const title: Record<string, [string, string]> = {
    replaced: ['Άνοιξε νεότερη καρτέλα πελάτη', 'A newer client tab was opened'],
    expired: ['Η λειτουργία πελάτη έληξε', 'Client mode expired'],
    stale: ['Η καρτέλα έμεινε ανενεργή', 'This tab was inactive too long'],
    closed: ['Η καρτέλα πελάτη έκλεισε', 'Client tab closed'],
    missing: ['Αυτή η καρτέλα δεν είναι ενεργή', 'This client tab is not active'],
    failed: ['Η λειτουργία πελάτη δεν ξεκίνησε', 'Client mode did not start'],
  }
  const [tEl, tEn] = title[locked] ?? ['Η λειτουργία πελάτη έκλεισε', 'Client mode has ended']
  return (
    <Overlay>
      <div style={{ fontSize: 34 }}>🔒</div>
      <h2>{el ? tEl : tEn}</h2>
      <p>
        {el
          ? 'Από αυτή την καρτέλα δεν γίνεται πλέον καμία παραγγελία. Για να συνεχίσετε για έναν πελάτη, ανοίξτε ξανά «Παραγγελία ως πελάτης» από το admin ή το portal.'
          : 'Nothing can be ordered from this tab any more. To keep working for a customer, open «Order as client» again from admin or the portal.'}
      </p>
      {lockMessage && <p style={{ fontSize: 13, opacity: 0.8 }}>{lockMessage}</p>}
      <button className="btn-primary" onClick={() => void closeClientTab('ended')}>
        {el ? 'Κλείσιμο καρτέλας' : 'Close tab'}
      </button>
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
        {el ? 'Αν η καρτέλα δεν κλείσει, κλείστε την με ⌘W / Ctrl+W.' : "If the tab doesn't close, close it with ⌘W / Ctrl+W."}
      </p>
    </Overlay>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(15,23,42,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: '#fff', color: '#0f172a', borderRadius: 14, padding: '28px 24px',
        maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>
        {children}
      </div>
    </div>
  )
}
