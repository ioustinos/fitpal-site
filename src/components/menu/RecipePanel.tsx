import { useEffect, useState } from 'react'
import { fetchDishRecipe, effectiveIngredients, type DishRecipe } from '../../lib/api/dishRecipe'

/**
 * Recipe panel on the dish modal (WEC-245).
 *
 * Shows the FULL ingredient list of the currently-selected variant — fixed
 * ingredients use their dish-level grams, variant-scoped ingredients use the
 * per-variant amount for the selected variant. Ingredients with grams=0 are
 * hidden (means "absent in this variant" — rare).
 *
 * Collapsed by default — the customer doesn't need to see the recipe to
 * order, but the option's there if they want to inspect what's inside.
 * Pill-chip layout so the recipe scans as a single visual block (vs. the
 * earlier full-row treatment which read as duplicate of the dropdowns).
 *
 * Lazy-loaded on modal open. If the dish has no recipe rows (legacy seed
 * dishes that haven't been migrated to the structured ingredient model),
 * the component renders nothing — fail-soft.
 */

interface Props {
  dishId: string
  variantId: string
  lang: 'el' | 'en'
}

export function RecipePanel({ dishId, variantId, lang }: Props) {
  const [recipe, setRecipe] = useState<DishRecipe | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchDishRecipe(dishId).then((res) => {
      if (cancelled) return
      setRecipe(res.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [dishId])

  if (loading) return null
  if (!recipe || recipe.ingredients.length === 0) return null // fail-soft

  const items = effectiveIngredients(recipe, variantId)
  if (items.length === 0) return null

  const fmtGrams = (g: number) => {
    const s = g.toString()
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s
  }

  const headerLabel = lang === 'el'
    ? `Συστατικά (${items.length})`
    : `Ingredients (${items.length})`

  return (
    <div className={`dm-recipe${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="dm-recipe-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span>{headerLabel}</span>
        <svg
          className="dm-recipe-chevron"
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <ul className="dm-recipe-pills" aria-label={lang === 'el' ? 'Συστατικά' : 'Ingredients'}>
          {items.map((it) => {
            const name = lang === 'en' ? (it.nameEn || it.nameEl) : it.nameEl
            return (
              <li key={it.ingredientId} className="dm-recipe-pill">
                <span className="dm-recipe-pill-name">{name}</span>
                <span className="dm-recipe-pill-grams">{fmtGrams(it.grams)}γρ</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
