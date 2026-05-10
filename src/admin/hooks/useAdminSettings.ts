import { useEffect, useMemo, useState } from 'react'
import { fetchAllSettings, setSetting, type SettingRow } from '../../lib/api/adminSettings'

/**
 * Shared state/data hook for every per-domain Settings page (WEC-274 split).
 *
 * Each split page (Site Details, Cutoff & Schedules, Payments, Menu Options,
 * Advanced) runs its own copy of this hook. They each fetch the full settings
 * table (cheap — ~10 rows) then render only the slice they care about. That
 * keeps each page self-contained: no shared state in a context, no prop
 * drilling, and changing one page can't accidentally re-render another.
 *
 * Returns the same shape the legacy `Settings.tsx` component used internally:
 *   - `byKey`: Map<key, value> for typed lookups in render
 *   - `save(key, value)`: writes through `setSetting` and refetches
 *   - `loading` / `err` / `savingMsg`: standard UI flags
 *   - `refresh()`: explicit re-fetch (rare; sections call it after raw-json edits)
 *   - `all`: the raw rows (only the AdvancedPage / RawJsonSection needs this)
 */
export function useAdminSettings() {
  const [all, setAll] = useState<SettingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [savingMsg, setSavingMsg] = useState<string | null>(null)

  async function refresh() {
    setLoading(true); setErr(null)
    const s = await fetchAllSettings()
    if (s.error) setErr(s.error)
    setAll(s.data ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const byKey = useMemo(() => new Map(all.map((r) => [r.key, r.value])), [all])

  async function save(key: string, value: unknown) {
    setSavingMsg(null)
    const { error } = await setSetting(key, value)
    if (error) { setErr(error); return }
    setSavingMsg('Saved.')
    setTimeout(() => setSavingMsg(null), 1500)
    refresh()
  }

  return { all, byKey, loading, err, savingMsg, save, refresh }
}
