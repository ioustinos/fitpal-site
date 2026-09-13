// ─────────────────────────────────────────────────────────────────────────────
//  WEC-734 · runtime copy overrides
//
//  The i18n modules are the DEFAULT and the FALLBACK. This module holds the
//  handful of strings the team has actually edited in /admin/copy, delivered
//  inside the existing (edge-cached) /api/settings-public payload — so they
//  cost zero extra network requests and zero extra DB round-trips.
//
//  ⚠️ THIS LAYER MUST ONLY EVER BE ABLE TO IMPROVE ON THE FILE.
//  If the fetch fails, returns nothing, or returns garbage, every lookup falls
//  through to the compiled default. It must not be possible for this to render
//  a blank string or a raw key name to a customer. Everything below is written
//  with that as the single constraint.
// ─────────────────────────────────────────────────────────────────────────────

import type { Lang } from '../translations'

export interface UiStringOverrideRow {
  key: string
  value_el: string | null
  value_en: string | null
}

/** key → lang → value. Module-level on purpose: `tr()` is a plain synchronous
 *  function called from render, so this cannot be React state. */
let overrides: Record<string, Partial<Record<Lang, string>>> = {}

/** Bumped on every successful apply. `App` subscribes to the mirror of this in
 *  useUIStore so the tree re-renders once when overrides land after first
 *  paint — see applyUiStringOverrides' caller. */
let version = 0

/** Subscribers, so the tree can re-render ONCE when overrides land.
 *  A plain Set rather than a Zustand store deliberately: useUIStore already
 *  imports translations, and having overrides import the store back would
 *  close an import cycle through the boot path. */
const listeners = new Set<() => void>()
function emit(): void {
  for (const l of listeners) {
    try { l() } catch { /* a bad subscriber must not break copy rendering */ }
  }
}

/** For useSyncExternalStore at the app root. */
export function subscribeUiStrings(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function getUiStringOverride(lang: Lang, key: string): string | undefined {
  const v = overrides[key]?.[lang]
  // An empty string is treated as "no override", not as "render nothing".
  // Otherwise clearing a field in the admin UI would blank the label on the
  // live site instead of restoring the default, which is a trap a non-technical
  // editor would fall into on day one.
  return v && v.length > 0 ? v : undefined
}

export function uiStringOverrideVersion(): number {
  return version
}

/** How many keys currently carry an override — for the admin page and for
 *  sanity-checking that the payload actually arrived. */
export function uiStringOverrideCount(): number {
  return Object.keys(overrides).length
}

/**
 * Replace the override map. Called once per settings fetch.
 *
 * Defensive by design: anything that is not a usable row is skipped rather
 * than throwing, because this runs inside the boot path. A malformed payload
 * must degrade to "no overrides", never to a broken app.
 *
 * Note we do NOT validate the key against TKey here. An override for a key
 * that no longer exists (renamed or deleted in a later deploy) is simply never
 * read — it sits in the map, costs nothing, and the admin page surfaces it as
 * orphaned so it can be cleaned up. Dropping it silently here would hide the
 * fact that someone's edit stopped applying.
 */
export function applyUiStringOverrides(rows: unknown): void {
  const next: Record<string, Partial<Record<Lang, string>>> = {}
  if (Array.isArray(rows)) {
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Partial<UiStringOverrideRow>
      if (typeof r.key !== 'string' || !r.key) continue
      const entry: Partial<Record<Lang, string>> = {}
      if (typeof r.value_el === 'string' && r.value_el.length > 0) entry.el = r.value_el
      if (typeof r.value_en === 'string' && r.value_en.length > 0) entry.en = r.value_en
      if (entry.el || entry.en) next[r.key] = entry
    }
  }
  overrides = next
  version++
  emit()
}

/** Test/escape hatch — drops every override and falls back to the files. */
export function clearUiStringOverrides(): void {
  overrides = {}
  version++
  emit()
}
