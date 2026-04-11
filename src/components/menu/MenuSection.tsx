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

  // Group by category
  const grouped = new Map<string, Dish[]>()
  for (const dish of dishes) {
    const cat = dish.catId ?? 'other'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(dish)
  }

  // Show all categories in canonical order, skip 'all'
  const entries = CATS
    .filter((c) => c.id !== 'all')
    .map((c) => ({ cat: c, dishes: grouped.get(c.id) ?? [] }))
    .filter((e) => e.dishes.length > 0)

  if (entries.length === 0) {
    return (
      <div className="menu-empty">
        <div className="menu-empty-text">
          {lang === 'el' ? 'Δεν υπάρχουν πιάτα σήμερα' : 'No dishes today'}
        </div>
      </div>
    )
  }

  return (
    <div id="menu-grid">
      {entries.map(({ cat, dishes: catDishes }) => {
        const catLabel = lang === 'el' ? cat.labelEl : cat.labelEn
        const dishWord = lang === 'el' ? 'πιάτα' : 'dishes'

        return (
          <div key={cat.id} className="cat-section" id={`cat-sec-${cat.id}`}>
            <div className="cat-section-hdr">
              <span className="cat-section-name">{catLabel}</span>
              <span className="cat-section-count">{catDishes.length} {dishWord}</span>
            </div>
            <div className="cat-section-grid">
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
