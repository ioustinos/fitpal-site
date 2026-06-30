import { DishCard } from './DishCard'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { makeTr } from '../../lib/translations'
import type { Dish, CategoryDef } from '../../data/menu'

interface MenuSectionProps {
  dishes: Dish[]
  dayIndex: number
}

export function MenuSection({ dishes, dayIndex }: MenuSectionProps) {
  const lang = useUIStore((s) => s.lang)
  const t = makeTr(lang)
  const categories = useMenuStore((s) => s.categories)
  // WEC-253: per-menu category ordering. Read from the active week.
  const activeWeek = useUIStore((s) => s.activeWeek)
  const weekCategoryOrder = useMenuStore(
    (s) => s.weeks[activeWeek]?.categoryOrder ?? [],
  )

  // Group by category
  const grouped = new Map<string, Dish[]>()
  for (const dish of dishes) {
    const cat = dish.catId ?? 'other'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(dish)
  }

  // Build a label-lookup. Then use the active week's `categoryOrder`
  // to sequence categories. Falls back to the global categories array
  // ordering if categoryOrder is empty (defensive — backfill should
  // mean it's always populated).
  const catById = new Map(categories.filter((c) => c.id !== 'all').map((c) => [c.id, c]))
  const orderedCatIds =
    weekCategoryOrder.length > 0
      ? weekCategoryOrder
      : categories.filter((c) => c.id !== 'all').map((c) => c.id)
  const entries: { cat: CategoryDef; dishes: Dish[] }[] = []
  for (const id of orderedCatIds) {
    const cat = catById.get(id)
    if (!cat) continue
    const catDishes = grouped.get(id) ?? []
    if (catDishes.length === 0) continue
    entries.push({ cat, dishes: catDishes })
  }

  if (entries.length === 0) {
    return (
      <div className="menu-empty">
        <div className="menu-empty-text">
          {t('mnNoDishesToday')}
        </div>
      </div>
    )
  }

  return (
    <div id="menu-grid">
      {entries.map(({ cat, dishes: catDishes }) => {
        const catLabel = lang === 'el' ? cat.labelEl : cat.labelEn
        const dishWord = t('mnDishesWord')

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
