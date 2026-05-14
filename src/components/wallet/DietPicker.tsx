// WEC-338 — Allergies + disliked-ingredients picker for the subscription page.
//
// One input that searches BOTH allergies and ingredients via a debounced
// server-side ilike query. Selected items render as removable pills below
// the input. The kind ("allergy" vs "ingredient") is visually distinct via
// a small badge in the dropdown and a coloured dot on the pill.
//
// State model: the picker is fully controlled — the parent owns the two
// arrays of selected ids (allergyIds, ingredientIds). The picker only
// notifies on change; persistence is the parent's call.

import { useCallback, useEffect, useRef, useState } from 'react'
import { searchDietTerms, type DietSearchHit } from '../../lib/api/diet'

/* ─── Types ─────────────────────────────────────────────────────────────── */

export interface DietSelection {
  /** Allergy id → display label for the pill (cached so we don't re-fetch on unmount/remount). */
  allergies: Record<string, { nameEl: string; nameEn: string | null }>
  /** Ingredient id → display label for the pill. */
  ingredients: Record<string, { nameEl: string; nameEn: string | null }>
}

interface DietPickerProps {
  lang: 'el' | 'en'
  value: DietSelection
  onChange: (next: DietSelection) => void
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export function DietPicker({ lang, value, onChange }: DietPickerProps) {
  const isEl = lang === 'el'
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<DietSearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  /* Debounced search — 150ms is short enough to feel live but long enough
     to coalesce typing bursts. Each keystroke cancels the prior pending
     timer and starts a new one. */
  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const handle = window.setTimeout(async () => {
      const { data } = await searchDietTerms(trimmed, 12)
      // Drop hits the user has already picked — no point showing them.
      const filtered = data.filter((h) =>
        h.kind === 'allergy'
          ? !value.allergies[h.id]
          : !value.ingredients[h.id],
      )
      setHits(filtered)
      setLoading(false)
    }, 150)
    return () => window.clearTimeout(handle)
  }, [q, value.allergies, value.ingredients])

  /* Close the dropdown when the user clicks outside. */
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  /* ─── Add / remove ─────────────────────────────────────────────────── */

  const pick = useCallback(
    (hit: DietSearchHit) => {
      if (hit.kind === 'allergy') {
        if (value.allergies[hit.id]) return
        onChange({
          ...value,
          allergies: {
            ...value.allergies,
            [hit.id]: { nameEl: hit.nameEl, nameEn: hit.nameEn },
          },
        })
      } else {
        if (value.ingredients[hit.id]) return
        onChange({
          ...value,
          ingredients: {
            ...value.ingredients,
            [hit.id]: { nameEl: hit.nameEl, nameEn: hit.nameEn },
          },
        })
      }
      setQ('')
      setHits([])
      inputRef.current?.focus()
    },
    [value, onChange],
  )

  const remove = useCallback(
    (kind: 'allergy' | 'ingredient', id: string) => {
      if (kind === 'allergy') {
        const next = { ...value.allergies }
        delete next[id]
        onChange({ ...value, allergies: next })
      } else {
        const next = { ...value.ingredients }
        delete next[id]
        onChange({ ...value, ingredients: next })
      }
    },
    [value, onChange],
  )

  /* ─── Render ─────────────────────────────────────────────────────────── */

  const totalSelected =
    Object.keys(value.allergies).length + Object.keys(value.ingredients).length
  const showDropdown = open && q.trim().length > 0

  return (
    <div className="wpv2-diet" ref={wrapRef}>
      <div className="wpv2-diet-search">
        <svg
          className="wpv2-diet-search-icon"
          width="16" height="16"
          viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="wpv2-diet-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            isEl
              ? 'Ψάξε αλλεργία ή συστατικό (π.χ. μανιτάρια, γλουτένη)…'
              : 'Search allergy or ingredient (e.g. mushrooms, gluten)…'
          }
          aria-label={isEl ? 'Αναζήτηση αλλεργιών και συστατικών' : 'Search allergies and ingredients'}
        />
        {loading && <span className="wpv2-diet-spin" aria-hidden="true" />}
      </div>

      {showDropdown && (
        <div className="wpv2-diet-dropdown" role="listbox">
          {hits.length === 0 && !loading && (
            <div className="wpv2-diet-empty">
              {isEl ? 'Καμία αντιστοιχία.' : 'No matches.'}
            </div>
          )}
          {hits.map((h) => (
            <button
              key={`${h.kind}-${h.id}`}
              type="button"
              className="wpv2-diet-hit"
              onClick={() => pick(h)}
              role="option"
              aria-selected="false"
            >
              <span className={`wpv2-diet-dot ${h.kind}`} />
              <span className="wpv2-diet-hit-name">
                {isEl ? h.nameEl : (h.nameEn ?? h.nameEl)}
              </span>
              <span className={`wpv2-diet-hit-badge ${h.kind}`}>
                {h.kind === 'allergy'
                  ? (isEl ? 'Αλλεργία' : 'Allergy')
                  : (isEl ? 'Συστατικό' : 'Ingredient')}
              </span>
            </button>
          ))}
        </div>
      )}

      {totalSelected > 0 && (
        <div className="wpv2-diet-pills">
          {Object.entries(value.allergies).map(([id, lbl]) => (
            <span key={`a-${id}`} className="wpv2-diet-pill allergy">
              <span className="wpv2-diet-dot allergy" />
              {isEl ? lbl.nameEl : (lbl.nameEn ?? lbl.nameEl)}
              <button
                type="button"
                className="wpv2-diet-pill-x"
                onClick={() => remove('allergy', id)}
                aria-label={isEl ? 'Αφαίρεση' : 'Remove'}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
          {Object.entries(value.ingredients).map(([id, lbl]) => (
            <span key={`i-${id}`} className="wpv2-diet-pill ingredient">
              <span className="wpv2-diet-dot ingredient" />
              {isEl ? lbl.nameEl : (lbl.nameEn ?? lbl.nameEl)}
              <button
                type="button"
                className="wpv2-diet-pill-x"
                onClick={() => remove('ingredient', id)}
                aria-label={isEl ? 'Αφαίρεση' : 'Remove'}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {totalSelected === 0 && (
        <div className="wpv2-diet-hint">
          {isEl
            ? 'Πληκτρολόγησε για να ψάξεις. Δεν υπάρχει λίστα — εμείς βρίσκουμε από τη βάση μας καθώς γράφεις.'
            : "Type to search. There's no preloaded list — we look it up live as you type."}
        </div>
      )}
    </div>
  )
}
