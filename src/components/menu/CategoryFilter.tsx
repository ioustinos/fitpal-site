import { useState } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import type { Dish } from '../../data/menu'

interface CategoryFilterProps {
  dishes: Dish[]
}

export function CategoryFilter({ dishes }: CategoryFilterProps) {
  const lang = useUIStore((s) => s.lang)
  const categories = useMenuStore((s) => s.categories)
  const [activeCat, setActiveCat] = useState<string | null>(null)

  // Count dishes per category (only categories that exist in current day)
  const countByCat = new Map<string, number>()
  for (const dish of dishes) {
    const cat = dish.catId ?? 'other'
    countByCat.set(cat, (countByCat.get(cat) ?? 0) + 1)
  }

  // Only show cats that have dishes today, skip 'all'
  const visibleCats = categories.filter((c) => c.id !== 'all' && (countByCat.get(c.id) ?? 0) > 0)

  function handlePillClick(catId: string) {
    setActiveCat(catId)
    // Scroll to section
    const sec = document.getElementById(`cat-sec-${catId}`)
    if (sec) {
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (visibleCats.length === 0) return null

  return (
    <nav className="cat-nav">
      {visibleCats.map((cat) => {
        const count = countByCat.get(cat.id) ?? 0
        const label = lang === 'el' ? cat.labelEl : cat.labelEn
        return (
          <div
            key={cat.id}
            className={`cat-pill${activeCat === cat.id ? ' active' : ''}`}
            onClick={() => handlePillClick(cat.id)}
          >
            {label}
            <span className="cat-count">{count}</span>
          </div>
        )
      })}
    </nav>
  )
}
