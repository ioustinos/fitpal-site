import { useEffect, useMemo, useState } from 'react'
import { fetchDishRecipe, type DishRecipe } from '../../lib/api/dishRecipe'
import { effPrice } from '../../lib/helpers'
import type { Dish } from '../../data/menu'
import { makeTr } from '../../lib/translations'

/**
 * Variant picker on the dish modal (WEC-246).
 *
 * Two modes:
 *   - Pills: classic variant rows (radio-pill UX, full label visible). Used
 *     when the dish has ≤4 variants OR admin set variant_ux_mode='pills'.
 *   - Dropdowns: one <select> per is_variant=true ingredient. Customer picks
 *     gram amounts; we match the resulting combination back to a variant.
 *     Used when the dish has 5+ variants OR admin set variant_ux_mode='dropdowns'.
 *
 * Pills is lossless and works for every dish. Dropdowns require the dish to
 * have structured recipe rows (dish_ingredients + dish_variant_ingredient_amounts);
 * if those are missing for a 5+ variant dish, we fall back to pills so the
 * customer can still order.
 */

interface Props {
  dish: Dish
  selectedVariantId: string
  onChange: (variantId: string) => void
  lang: 'el' | 'en'
}

const PILL_THRESHOLD = 4

export function VariantPicker({ dish, selectedVariantId, onChange, lang }: Props) {
  const t = makeTr(lang)
  const mode = dish.variantUxMode ?? 'auto'

  // Decide intended mode based on count + admin override
  const intendedMode: 'pills' | 'dropdowns' =
    mode === 'pills' ? 'pills'
    : mode === 'dropdowns' ? 'dropdowns'
    : (dish.variants.length > PILL_THRESHOLD ? 'dropdowns' : 'pills')

  if (intendedMode === 'dropdowns') {
    return (
      <DropdownsPicker dish={dish} selectedVariantId={selectedVariantId} onChange={onChange} lang={lang} />
    )
  }

  return (
    <PillsPicker dish={dish} selectedVariantId={selectedVariantId} onChange={onChange} lang={lang} t={t} />
  )
}

// ─── Pills (existing UX) ──────────────────────────────────────────────────

interface PillsProps extends Props { t: ReturnType<typeof makeTr> }

function PillsPicker({ dish, selectedVariantId, onChange, lang, t }: PillsProps) {
  if (dish.variants.length <= 1) return null
  return (
    <div className="dm-variants">
      <div className="dm-section-title">{t('selectSize')}</div>
      <div className="dm-variant-list">
        {dish.variants.map((v) => {
          const vBase = effPrice(v.price, dish.discount)
          const isActive = selectedVariantId === v.id
          return (
            <div
              key={v.id}
              className={`variant-row${isActive ? ' sel' : ''}`}
              onClick={() => onChange(v.id)}
            >
              <div className="vr-radio" />
              <div className="vr-info">
                <div className="vr-label">{lang === 'el' ? v.labelEl : v.labelEn}</div>
                {v.macros && (
                  <div className="vr-macros">
                    {v.macros.cal} kcal · {v.macros.pro}g {t('pro')} · {v.macros.carb}g {t('carb')} · {v.macros.fat}g {t('fat')}
                  </div>
                )}
              </div>
              <div className="vr-price">€{vBase.toFixed(2)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Dropdowns (5+ variants) ─────────────────────────────────────────────

function DropdownsPicker({ dish, selectedVariantId, onChange, lang }: Props) {
  const t = makeTr(lang)
  const [recipe, setRecipe] = useState<DishRecipe | null>(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchDishRecipe(dish.id).then((res) => {
      if (cancelled) return
      if (!res.data || res.data.ingredients.length === 0) {
        // No structured recipe — fall back to pills
        setFallback(true)
      } else {
        setRecipe(res.data)
      }
    })
    return () => { cancelled = true }
  }, [dish.id])

  // Build list of variable ingredients + their distinct grams across variants
  const choiceGroups = useMemo(() => {
    if (!recipe) return null
    const variantIds = new Set(dish.variants.map((v) => v.id))
    const variableIngs = recipe.ingredients.filter((i) => i.isVariant)
    return variableIngs.map((ing) => {
      // Map: variantId → grams (only for this ingredient)
      const byVariant = new Map<string, number>()
      for (const a of recipe.variantAmounts) {
        if (a.ingredientId !== ing.ingredientId) continue
        if (!variantIds.has(a.variantId)) continue
        byVariant.set(a.variantId, a.grams)
      }
      const distinctGrams = Array.from(new Set(byVariant.values())).sort((a, b) => a - b)
      return { ing, byVariant, distinctGrams }
    })
  }, [recipe, dish.variants])

  // Current grams selection per ingredient — derived from selected variant
  const currentSelection = useMemo(() => {
    if (!choiceGroups) return new Map<string, number>()
    const out = new Map<string, number>()
    for (const g of choiceGroups) {
      const grams = g.byVariant.get(selectedVariantId)
      if (grams !== undefined) out.set(g.ing.ingredientId, grams)
    }
    return out
  }, [choiceGroups, selectedVariantId])

  if (fallback) {
    return <PillsPicker dish={dish} selectedVariantId={selectedVariantId} onChange={onChange} lang={lang} t={t} />
  }
  if (!recipe || !choiceGroups) {
    return <div className="dm-variants"><div style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>Loading options…</div></div>
  }

  function handleChange(ingId: string, grams: number) {
    if (!choiceGroups) return
    // Build target selection
    const target = new Map(currentSelection)
    target.set(ingId, grams)
    // Find variant whose amounts match all dropdowns
    const match = dish.variants.find((v) => {
      for (const g of choiceGroups) {
        const want = target.get(g.ing.ingredientId)
        const got = g.byVariant.get(v.id)
        if (want !== got) return false
      }
      return true
    })
    if (match) {
      onChange(match.id)
    }
    // If no match (shouldn't happen with clean data), do nothing — keeps the
    // dropdown showing the requested value but variant unchanged.
  }

  const fmtGrams = (g: number) => {
    const s = g.toString()
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s
  }

  // Match the current selection back to a real variant so we can show its
  // label / macros / price on the result pill.
  const selectedVariant = dish.variants.find((v) => v.id === selectedVariantId) ?? dish.variants[0]
  const selectedPriceCents = effPrice(selectedVariant.price, dish.discount)

  /**
   * Decide whether picking `option` for `targetIngId` would land on a real
   * variant given the user's current selections for the OTHER dropdowns.
   *
   * Used to grey out impossible combinations — e.g. if you pick chicken=210γ
   * and there's no variant with chicken=210γ + rice=240γ, the rice=240γ
   * option becomes disabled until you change chicken.
   */
  function isOptionAvailable(targetIngId: string, option: number): boolean {
    if (!choiceGroups) return true
    return dish.variants.some((v) => {
      for (const g of choiceGroups) {
        const grams = g.byVariant.get(v.id)
        const want = g.ing.ingredientId === targetIngId
          ? option
          : currentSelection.get(g.ing.ingredientId)
        if (want !== grams) return false
      }
      return true
    })
  }

  return (
    <div className="dm-variants">
      <div className="dm-section-title">{t('selectSize')}</div>

      {/* Result pill above dropdowns — visually anchors the chosen variant in
          the same slot pills-mode dishes use. Same .variant-row.sel styling so
          customers see the same affordance whether they picked via tap or
          dropdown. The dropdowns below act as the size mechanic. */}
      <div className="dm-variant-list">
        <div className="variant-row sel">
          <div className="vr-radio" />
          <div className="vr-info">
            <div className="vr-label">{lang === 'el' ? selectedVariant.labelEl : selectedVariant.labelEn}</div>
            {selectedVariant.macros && (
              <div className="vr-macros">
                {selectedVariant.macros.cal} kcal · {selectedVariant.macros.pro}g {t('pro')} · {selectedVariant.macros.carb}g {t('carb')} · {selectedVariant.macros.fat}g {t('fat')}
              </div>
            )}
          </div>
          <div className="vr-price">€{selectedPriceCents.toFixed(2)}</div>
        </div>
      </div>

      <div className="dm-variant-dropdowns" style={{ marginTop: 10 }}>
        {choiceGroups.map((g) => {
          const ingName = lang === 'en' ? (g.ing.nameEn || g.ing.nameEl) : g.ing.nameEl
          const selected = currentSelection.get(g.ing.ingredientId)
          return (
            <div key={g.ing.ingredientId} className="dm-variant-dropdown">
              <label className="dm-variant-dropdown-label">{ingName}</label>
              <select
                className="dm-variant-dropdown-select"
                value={selected ?? g.distinctGrams[0] ?? 0}
                onChange={(e) => handleChange(g.ing.ingredientId, parseFloat(e.target.value))}
              >
                {g.distinctGrams.map((grams) => {
                  const available = isOptionAvailable(g.ing.ingredientId, grams)
                  return (
                    <option
                      key={grams}
                      value={grams}
                      disabled={!available}
                      style={!available ? { color: '#bbb' } : undefined}
                    >
                      {fmtGrams(grams)}γρ{available ? '' : ' — μη διαθέσιμο'}
                    </option>
                  )
                })}
              </select>
            </div>
          )
        })}
      </div>
    </div>
  )
}
