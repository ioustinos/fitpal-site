import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Admin → Dish images.
 *
 * One pane for managing the dish image pipeline: see which dishes are still
 * pointing at external URLs (typically a Google Drive share link from the
 * data-entry sheet), pull them into Supabase Storage in bulk or one-by-one,
 * and re-import any dish whose photo got updated upstream.
 *
 * The Import button calls /api/admin-import-dish-image (Netlify Function) —
 * that's where the actual download + upload happens, server-side, because
 * the dev sandbox can't reach drive.google.com directly.
 *
 * Uses relative URLs (`/api/...`) so the page behaves identically on
 * localhost (netlify dev), dev--fitpal-order, and production.
 */

type DishRow = {
  id: string
  name_el: string
  category_id: string
  image_url: string | null
}

type DishStatus =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'ok'; publicUrl: string; size: number }
  | { state: 'skipped'; reason: string }
  | { state: 'error'; message: string }

const DRIVE_PREFIX = 'https://drive.google.com/'

function isDriveUrl(u: string | null): u is string {
  return !!u && u.startsWith(DRIVE_PREFIX)
}

async function getAdminJWT(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function importOne(
  dishId: string,
  sourceUrl: string,
  force: boolean,
): Promise<DishStatus> {
  const jwt = await getAdminJWT()
  if (!jwt) return { state: 'error', message: 'No admin session' }

  try {
    const res = await fetch('/api/admin-import-dish-image', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dishId, sourceUrl, force }),
    })
    const body = await res.json()
    if (!res.ok || !body.ok) {
      return { state: 'error', message: body.error ?? `HTTP ${res.status}` }
    }
    if (body.skipped) {
      return { state: 'skipped', reason: body.reason ?? 'already imported' }
    }
    return { state: 'ok', publicUrl: body.publicUrl, size: body.size }
  } catch (err) {
    return {
      state: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export function ImportImages() {
  const [dishes, setDishes] = useState<DishRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [showAll, setShowAll] = useState(false)

  const [statuses, setStatuses] = useState<Record<string, DishStatus>>({})
  const [running, setRunning] = useState(false)
  const cancelRef = useRef(false)

  // Live-fetch dishes — we want to pick up newly-imported ones as their
  // image_url flips to a Supabase URL and they drop out of the pending list.
  async function refresh() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('dishes')
      .select('id, name_el, category_id, image_url')
      .order('category_id')
      .order('id')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setDishes((data ?? []) as DishRow[])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const filtered = useMemo(() => {
    let list = dishes
    if (!showAll) list = list.filter((d) => isDriveUrl(d.image_url))
    if (filterCategory !== 'all') list = list.filter((d) => d.category_id === filterCategory)
    return list
  }, [dishes, showAll, filterCategory])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const d of dishes) set.add(d.category_id)
    return [...set].sort()
  }, [dishes])

  // Bulk import: serial (concurrency=1) to be polite to Drive's rate limits.
  // Aborts mid-loop if the user clicks Cancel.
  async function importAll(force: boolean) {
    cancelRef.current = false
    setRunning(true)
    const queue = filtered.filter((d) => isDriveUrl(d.image_url))
    for (const d of queue) {
      if (cancelRef.current) break
      setStatuses((s) => ({ ...s, [d.id]: { state: 'pending' } }))
      const result = await importOne(d.id, d.image_url!, force)
      setStatuses((s) => ({ ...s, [d.id]: result }))
      if (result.state === 'ok' || result.state === 'skipped') {
        // Optimistically update the row's image_url so it drops out of the
        // pending filter without a full refresh round-trip.
        setDishes((all) => all.map((row) =>
          row.id === d.id && result.state === 'ok'
            ? { ...row, image_url: result.publicUrl }
            : row
        ))
      }
    }
    setRunning(false)
  }

  async function importDish(d: DishRow, force: boolean) {
    if (!d.image_url) return
    setStatuses((s) => ({ ...s, [d.id]: { state: 'pending' } }))
    const result = await importOne(d.id, d.image_url, force)
    setStatuses((s) => ({ ...s, [d.id]: result }))
    if (result.state === 'ok') {
      setDishes((all) => all.map((row) =>
        row.id === d.id ? { ...row, image_url: result.publicUrl } : row
      ))
    }
  }

  function cancel() {
    cancelRef.current = true
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const pendingCount = dishes.filter((d) => isDriveUrl(d.image_url)).length

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Dish images</h1>
          <p className="admin-page-sub">
            {pendingCount === 0
              ? 'No pending imports — every dish image is on Supabase Storage.'
              : `${pendingCount} dish${pendingCount === 1 ? '' : 'es'} still pointing at external URLs (e.g. Drive). Import to copy them into Storage.`}
          </p>
        </div>
        <div className="admin-page-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="admin-btn admin-btn-ghost" onClick={refresh} disabled={loading || running}>
            ↻ Reload
          </button>
          {!running ? (
            <button
              className="admin-btn admin-btn-primary"
              onClick={() => importAll(false)}
              disabled={pendingCount === 0}
            >
              Import all pending ({pendingCount})
            </button>
          ) : (
            <button className="admin-btn admin-btn-danger" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="admin-error" style={{ marginBottom: 12 }}>{error}</div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <select
          className="admin-input"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Show all dishes (incl. already imported)
        </label>
      </div>

      {/* Table */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Category</th>
              <th>Name</th>
              <th>Current image</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="admin-table-empty">Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="admin-table-empty">
                {showAll ? 'No dishes match the filter.' : 'No pending images.'}
              </td></tr>
            )}
            {!loading && filtered.map((d) => {
              const st = statuses[d.id] ?? { state: 'idle' as const }
              const pending = isDriveUrl(d.image_url)
              return (
                <tr key={d.id}>
                  <td><code>{d.id}</code></td>
                  <td>{d.category_id}</td>
                  <td>{d.name_el}</td>
                  <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.image_url ? (
                      <a href={d.image_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, opacity: 0.7 }}>
                        {d.image_url.length > 50 ? d.image_url.slice(0, 50) + '…' : d.image_url}
                      </a>
                    ) : <em>—</em>}
                  </td>
                  <td>
                    {st.state === 'idle' && (pending ? <span className="admin-badge">pending</span> : <span className="admin-badge admin-badge-ok">imported</span>)}
                    {st.state === 'pending' && <span className="admin-badge">…working</span>}
                    {st.state === 'ok' && <span className="admin-badge admin-badge-ok">ok · {(st.size / 1024).toFixed(0)} KB</span>}
                    {st.state === 'skipped' && <span className="admin-badge">skipped</span>}
                    {st.state === 'error' && <span className="admin-badge admin-badge-err" title={st.message}>error</span>}
                  </td>
                  <td>
                    {pending && (
                      <button
                        className="admin-btn admin-btn-ghost admin-btn-sm"
                        disabled={st.state === 'pending' || running}
                        onClick={() => importDish(d, false)}
                      >
                        Import
                      </button>
                    )}
                    {!pending && (
                      <button
                        className="admin-btn admin-btn-ghost admin-btn-sm"
                        disabled={st.state === 'pending' || running}
                        onClick={() => importDish(d, true)}
                        title="Re-download and overwrite"
                      >
                        Re-import
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Per-row error details (so failures don't stay hidden behind a tooltip) */}
      {Object.entries(statuses).filter(([, s]) => s.state === 'error').length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, marginBottom: 6 }}>Errors</h3>
          <ul style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {Object.entries(statuses)
              .filter(([, s]) => s.state === 'error')
              .map(([id, s]) => (
                <li key={id}><code>{id}</code> — {(s as { state: 'error'; message: string }).message}</li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}
