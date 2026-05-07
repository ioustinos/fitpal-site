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
    // Trim trailing zeros: 60.0 → "60", 2.5 → "2.5"
    const s = g.toString()
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s
  }

  return (
    <div className="dm-recipe">
      <div className="dm-section-title">{lang === 'el' ? 'Συστατικά' : 'Ingredients'}</div>
      <ul className="dm-recipe-list">
        {items.map((it) => {
          const name = lang === 'en' ? (it.nameEn || it.nameEl) : it.nameEl
          return (
            <li key={it.ingredientId} className="dm-recipe-item">
              <span className="dm-recipe-name">{name}</span>
              <span className="dm-recipe-grams">{fmtGrams(it.grams)}γρ</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
