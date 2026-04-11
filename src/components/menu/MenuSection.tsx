import { DishCard } from './DishCard'
import { useUIStore } from '../../store/useUIStore'
import type { Dish } from '../../data/menu'
import { CATS } from '../../data/menu'

interface MenuSectionProps {
  dishes: Dish[]
  dayIndex: number
}

export function MenuSection({ dishes, dayIndex }: MenuSectionProps) {
  const lang = useUIStore((s) => s.lang)
  const activeCat = useUIStore((s) => s.activeCat)

  // Group by category
  const grouped = new Map<string, Dish[]>()
  for (const dish of dishes) {
    const cat = dish.catId ?? 'other'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(dish)
  }

  // Filter categories
  const entries = activeCat
    ? [...grouped.entries()].filter(([catId]) => catId === activeCat)
    : [...grouped.entries()]

  if (entries.length === 0) {
    return (
      <div className="menu-empty">
        {lang === 'el' ? 'Δεν βρέθηκαν πιάτα.' : 'No dishes found.'}
      </div>
    )
  }

  return (
    <div className="menu-sections">
      {entries.map(([catId, catDishes]) => {
        const catInfo = CATS.find((c) => c.id === catId)
        const catLabel = catInfo
          ? (lang === 'el' ? catInfo.labelEl : catInfo.labelEn)
          : catId

        return (
          <div key={catId} className="menu-section" id={`cat-${catId}`}>
            <h3 className="menu-section-title">{catLabel}</h3>
            <div className="dish-grid">
              {catDishes.map((dish) => (
                <DishCard key={dish.id} dish={dish} dayIndex={dayIndex} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
