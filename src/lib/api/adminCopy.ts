import { supabase } from '../supabase'
import { I18N_MODULES } from '../translations'

/**
 * WEC-735 — /admin/copy data layer.
 *
 * Defaults come from the compiled i18n modules (src/lib/i18n/*.ts); overrides
 * come from `public.ui_strings`. The module a key lives in IS its group on the
 * page — no key-prefix convention to invent, and a new module shows up as a new
 * group by itself.
 */

export interface CopyRow {
  key: string
  module: string
  defaultEl: string
  defaultEn: string
  overrideEl: string | null
  overrideEn: string | null
  updatedAt: string | null
  updatedBy: string | null
}

/** An override whose key no longer exists in any module — renamed or deleted by
 *  a later deploy. Harmless (never read) but it accumulates silently, so it gets
 *  its own section and a delete button. */
export interface OrphanRow {
  key: string
  valueEl: string | null
  valueEn: string | null
  updatedAt: string | null
  updatedBy: string | null
}

interface UiStringRow {
  key: string
  value_el: string | null
  value_en: string | null
  updated_at: string | null
  updated_by: string | null
}

function compiledDefaults(): { key: string; module: string; el: string; en: string }[] {
  const out: { key: string; module: string; el: string; en: string }[] = []
  for (const [moduleName, mod] of Object.entries(I18N_MODULES)) {
    const el = (mod as { el: Record<string, string> }).el
    const en = (mod as { en: Record<string, string> }).en
    for (const key of Object.keys(el)) {
      out.push({ key, module: moduleName, el: el[key], en: en[key] ?? '' })
    }
  }
  return out
}

export async function fetchCopyRows(): Promise<{ rows: CopyRow[]; orphans: OrphanRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('ui_strings')
    .select('key, value_el, value_en, updated_at, updated_by')
  if (error) return { rows: [], orphans: [], error: error.message }

  const overrides = new Map<string, UiStringRow>()
  for (const r of (data ?? []) as UiStringRow[]) overrides.set(r.key, r)

  const defaults = compiledDefaults()
  const known = new Set(defaults.map((d) => d.key))

  const rows: CopyRow[] = defaults.map((d) => {
    const o = overrides.get(d.key)
    return {
      key: d.key,
      module: d.module,
      defaultEl: d.el,
      defaultEn: d.en,
      overrideEl: o?.value_el ?? null,
      overrideEn: o?.value_en ?? null,
      updatedAt: o?.updated_at ?? null,
      updatedBy: o?.updated_by ?? null,
    }
  })

  const orphans: OrphanRow[] = [...overrides.values()]
    .filter((o) => !known.has(o.key))
    .map((o) => ({ key: o.key, valueEl: o.value_el, valueEn: o.value_en, updatedAt: o.updated_at, updatedBy: o.updated_by }))

  return { rows, orphans, error: null }
}

/**
 * Placeholders the string interpolates, e.g. `{min}`.
 *
 * If an editor drops one the customer reads a sentence with a hole in it —
 * «Ελάχιστη παραγγελία  €». A non-technical person cannot be expected to spot
 * that, so the save is refused rather than trusted.
 */
export function missingPlaceholders(def: string, override: string): string[] {
  const re = /\{[a-zA-Z0-9_]+\}/g
  const needed = new Set(def.match(re) ?? [])
  return [...needed].filter((p) => !override.includes(p))
}

/** Purge the edge cache so an edit is live in ~1s instead of up to 5 minutes.
 *  Same tag and endpoint the settings admin already uses — without it the team
 *  assumes the tool is broken and edits again. */
async function purgeSettingsCache(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/purge-menu-cache', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['settings'] }),
    })
  } catch {
    /* non-fatal — stale-while-revalidate backstops within 5 min */
  }
}

async function logCopyChange(key: string, oldValue: string, newValue: string, label: string): Promise<void> {
  try {
    const { data: session } = await supabase.auth.getSession()
    await supabase.from('admin_change_log').insert({
      table_name: 'ui_strings',
      field_name: key,
      old_value: oldValue.slice(0, 500),
      new_value: newValue.slice(0, 500),
      label,
      admin_user: session?.session?.user?.id ?? null,
    })
  } catch {
    /* audit is non-fatal; the copy edit already committed */
  }
}

/**
 * Save (or clear) the override for one key.
 *
 * An empty field clears that language rather than storing "". The runtime
 * already treats an empty override as no override, but storing null keeps the
 * table honest and makes "is this overridden?" a plain null check. When BOTH
 * languages end up empty the row is deleted — the same end state as pressing
 * "reset", reached by hand.
 */
export async function saveCopyOverride(row: CopyRow, nextEl: string, nextEn: string): Promise<{ error: string | null }> {
  const el = nextEl.trim()
  const en = nextEn.trim()

  const missing = [...new Set([
    ...(el ? missingPlaceholders(row.defaultEl, el) : []),
    ...(en ? missingPlaceholders(row.defaultEn, en) : []),
  ])]
  if (missing.length) {
    return {
      error:
        `Λείπει το ${missing.join(', ')} από το κείμενο — συμπληρώνεται αυτόματα (π.χ. το ποσό), ` +
        `χωρίς αυτό ο πελάτης βλέπει κενό. / Missing ${missing.join(', ')}, which is filled in automatically.`,
    }
  }

  const before = `EL: ${row.overrideEl ?? row.defaultEl} | EN: ${row.overrideEn ?? row.defaultEn}`

  if (!el && !en) {
    const { error } = await supabase.from('ui_strings').delete().eq('key', row.key)
    if (error) return { error: error.message }
    void logCopyChange(row.key, before, 'reset to default', `Copy reset: ${row.key}`)
    void purgeSettingsCache()
    return { error: null }
  }

  const { data: session } = await supabase.auth.getSession()
  const { error } = await supabase.from('ui_strings').upsert(
    {
      key: row.key,
      value_el: el || null,
      value_en: en || null,
      updated_at: new Date().toISOString(),
      updated_by: session?.session?.user?.email ?? session?.session?.user?.id ?? null,
    },
    { onConflict: 'key' },
  )
  if (error) return { error: error.message }

  void logCopyChange(row.key, before, `EL: ${el || '(default)'} | EN: ${en || '(default)'}`, `Copy edited: ${row.key}`)
  void purgeSettingsCache()
  return { error: null }
}

/** Reset to the shipped copy — deletes the override row entirely. */
export async function resetCopyOverride(row: CopyRow): Promise<{ error: string | null }> {
  const { error } = await supabase.from('ui_strings').delete().eq('key', row.key)
  if (error) return { error: error.message }
  void logCopyChange(row.key, `EL: ${row.overrideEl ?? ''} | EN: ${row.overrideEn ?? ''}`, 'reset to default', `Copy reset: ${row.key}`)
  void purgeSettingsCache()
  return { error: null }
}

/** Delete an orphaned override (its key no longer exists in any module). */
export async function deleteOrphanOverride(key: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('ui_strings').delete().eq('key', key)
  if (error) return { error: error.message }
  void logCopyChange(key, '(orphan)', 'deleted', `Orphaned copy override deleted: ${key}`)
  void purgeSettingsCache()
  return { error: null }
}
