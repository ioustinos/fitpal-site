import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/useUIStore'

/**
 * WEC-869 — «a new version is out, reload». A tab left open across a deploy
 * keeps running the old code (11.1 of the dietitian test ran the old
 * session-swap after client tabs had shipped). Every few minutes, and when
 * the tab comes back into view, compare the entry script the server now
 * serves with the one this page booted from; if they differ, offer a reload.
 */
const CHECK_MS = 5 * 60_000

function currentEntry(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return el ? new URL(el.src, location.origin).pathname : null
}

export function UpdateNotice() {
  const [stale, setStale] = useState(false)
  const lang = useUIStore((s) => s.lang)
  useEffect(() => {
    const mine = currentEntry()
    if (!mine) return // dev server: no hashed entry
    let stop = false
    async function check() {
      if (stop || document.visibilityState !== 'visible') return
      try {
        const html = await (await fetch('/?v=' + Date.now(), { cache: 'no-store' })).text()
        const m = html.match(/\/assets\/index-[^"']+\.js/)
        if (m && m[0] !== mine) setStale(true)
      } catch { /* offline: try later */ }
    }
    const t = window.setInterval(check, CHECK_MS)
    const onVis = () => { void check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop = true; window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  if (!stale) return null
  const el = lang === 'el'
  return (
    <div role="status" style={{
      position: 'fixed', left: 16, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', zIndex: 2000,
      background: '#111827', color: '#fff', borderRadius: 10, padding: '10px 12px',
      display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 8px 24px rgba(0,0,0,.25)', fontSize: 14, maxWidth: 'calc(100vw - 32px)',
    }}>
      <span>{el ? 'Υπάρχει νέα έκδοση της σελίδας.' : 'A new version of this page is available.'}</span>
      <button onClick={() => location.reload()} style={{
        background: '#f59e0b', color: '#111827', border: 0, borderRadius: 6, padding: '6px 10px', fontWeight: 700, cursor: 'pointer',
      }}>{el ? 'Ανανέωση' : 'Reload'}</button>
    </div>
  )
}
