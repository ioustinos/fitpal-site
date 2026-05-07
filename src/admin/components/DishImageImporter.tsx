import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Shared bulk-image-import button (WEC-244).
 *
 * Single source of truth for the "Import all pending Drive images → Storage"
 * flow. Used on:
 *   - /admin/dish-images — main page
 *   - /admin/import-menu — after a successful CSV import, so the operator can
 *     finish the data + image pipeline without leaving the page.
 *
 * Behaviour:
 *   - Loads the list of dishes still pointing at drive.google.com.
 *   - On click, calls /api/admin-import-dish-image once per dish, serially.
 *   - Reports progress via the optional onProgress callback.
 *   - Cancellable mid-loop.
 *
 * Auth: pulls the admin's JWT from the Supabase session and forwards it.
 */

const DRIVE_PREFIX = 'https://drive.google.com/'

interface Pending {
  id: string
  imageUrl: string
}

type ImportStatus =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'ok'; size: number }
  | { state: 'skipped' }
  | { state: 'error'; message: string }

interface ImportProgress {
  ok: number
  skipped: number
  failed: number
  total: number
  current?: string
}

interface Props {
  /** Optional. If omitted, fetches all dishes currently pointing at Drive URLs. */
  dishIds?: string[]
  /** Called whenever progress advances. */
  onProgress?: (p: ImportProgress) => void
  /** Called when the bulk run finishes. */
  onComplete?: (p: ImportProgress) => void
  /** Reload trigger — bump to refetch pending list. */
  reloadKey?: number
}

export function DishImageImporter({ dishIds, onProgress, onComplete, reloadKey }: Props) {
  const [pending, setPending] = useState<Pending[]>([])
  const [running, setRunning] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, ImportStatus>>({})
  const cancelRef = useRef(false)

  async function refreshPending() {
    let q = supabase
      .from('dishes')
      .select('id, image_url')
      .like('image_url', `${DRIVE_PREFIX}%`)
    if (dishIds && dishIds.length > 0) {
      q = supabase
        .from('dishes')
        .select('id, image_url')
        .in('id', dishIds)
        .like('image_url', `${DRIVE_PREFIX}%`)
    }
    const { data, error } = await q
    if (error || !data) {
      setPending([])
      return
    }
    setPending(data.map((r) => ({ id: r.id, imageUrl: r.image_url ?? '' })))
  }

  useEffect(() => { refreshPending() }, [reloadKey, dishIds?.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  async function importAll() {
    cancelRef.current = false
    setRunning(true)
    let ok = 0, skipped = 0, failed = 0
    const total = pending.length

    const { data: { session } } = await supabase.auth.getSession()
    const jwt = session?.access_token
    if (!jwt) {
      setRunning(false)
      return
    }

    for (const p of pending) {
      if (cancelRef.current) break
      setStatuses((s) => ({ ...s, [p.id]: { state: 'pending' } }))
      onProgress?.({ ok, skipped, failed, total, current: p.id })
      try {
        const res = await fetch('/api/admin-import-dish-image', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dishId: p.id, sourceUrl: p.imageUrl }),
        })
        const body = await res.json()
        if (!res.ok || !body.ok) {
          failed += 1
          setStatuses((s) => ({ ...s, [p.id]: { state: 'error', message: body.error ?? `HTTP ${res.status}` } }))
        } else if (body.skipped) {
          skipped += 1
          setStatuses((s) => ({ ...s, [p.id]: { state: 'skipped' } }))
        } else {
          ok += 1
          setStatuses((s) => ({ ...s, [p.id]: { state: 'ok', size: body.size ?? 0 } }))
        }
      } catch (err) {
        failed += 1
        setStatuses((s) => ({
          ...s,
          [p.id]: { state: 'error', message: err instanceof Error ? err.message : String(err) },
        }))
      }
      onProgress?.({ ok, skipped, failed, total, current: p.id })
    }

    setRunning(false)
    onComplete?.({ ok, skipped, failed, total })
    await refreshPending()
  }

  function cancel() {
    cancelRef.current = true
  }

  return (
    <div className="dish-image-importer">
      {!running && pending.length > 0 && (
        <button className="admin-btn admin-btn-primary" onClick={importAll}>
          Import all pending images ({pending.length})
        </button>
      )}
      {!running && pending.length === 0 && (
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          ✓ No pending images
        </span>
      )}
      {running && (
        <button className="admin-btn admin-btn-danger" onClick={cancel}>
          Cancel
        </button>
      )}

      {running && (
        <ProgressLine pending={pending} statuses={statuses} />
      )}
    </div>
  )
}

function ProgressLine({ pending, statuses }: { pending: Pending[]; statuses: Record<string, ImportStatus> }) {
  const ok = Object.values(statuses).filter((s) => s.state === 'ok').length
  const skip = Object.values(statuses).filter((s) => s.state === 'skipped').length
  const err = Object.values(statuses).filter((s) => s.state === 'error').length
  const done = ok + skip + err
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
      {done} / {pending.length} · ok={ok} · skipped={skip} · failed={err}
    </div>
  )
}
