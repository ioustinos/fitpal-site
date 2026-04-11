import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useAuthStore } from '../../store/useAuthStore'
import { effPrice } from '../../lib/helpers'
import { MacroDotsRow } from '../ui/MacroDots'
import { makeTr } from '../../lib/translations'
import type { Dish } from '../../data/menu'

interface DishCardProps {
  dish: Dish
  dayIndex: number
}

export function DishCard({ dish, dayIndex }: DishCardProps) {
  const lang = useUIStore((s) => s.lang)
  const openDishModal = useUIStore((s) => s.openDishModal)
  const cart = useCartStore((s) => s.cart)
  const addItem = useCartStore((s) => s.addItem)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  const dayItems = cart[dayIndex] ?? []
  const inCart = dayItems.filter((ci) => ci.dishId === dish.id).reduce((s, ci) => s + ci.qty, 0)

  const defaultVariant = dish.variants[0]
  const price = effPrice(defaultVariant.price, dish.discount)

  const walletDiscount = user?.wallet?.active ? user.wallet.discountPct ?? 0 : 0
  const finalPrice = walletDiscount > 0 ? effPrice(price, walletDiscount) : price

  const macros = defaultVariant.macros

  const name = lang === 'el' ? dish.nameEl : dish.nameEn
  const desc = lang === 'el' ? dish.descEl : dish.descEn

  function handleQuickAdd(e: React.MouseEvent) {
    e.stopPropagation()
    if (dish.variants.length > 1) {
      openDishModal(dish, dayIndex)
      return
    }
    addItem(dayIndex, {
      dishId: dish.id,
      variantId: defaultVariant.id,
      nameEl: dish.nameEl,
      nameEn: dish.nameEn,
      variantLabelEl: defaultVariant.labelEl,
      variantLabelEn: defaultVariant.labelEn,
      price: finalPrice,
      qty: 1,
      macros: defaultVariant.macros,
    })
  }

  return (
    <div
      className={`dish-card${inCart > 0 ? ' in-cart' : ''}`}
      onClick={() => openDishModal(dish, dayIndex)}
    >
      {/* Tags */}
      <div className="dish-tags">
        {dish.tags?.map((tag) => (
          <span key={tag} className={`dish-tag tag-${tag}`}>
            {tagLabel(tag, lang)}
          </span>
        ))}
        {dish.discount && (
          <span className="dish-tag tag-sale">-{dish.discount}%</span>
        )}
      </div>

      {/* Content */}
      <div className="dish-card-body">
        <div className="dish-info">
          <div className="dish-name">{name}</div>
          {desc && <div className="dish-desc">{desc}</div>}

          {/* Macros row */}
          {macros && (
            <MacroDotsRow
              cal={macros.cal}
              pro={macros.pro}
              carb={macros.carb}
              fat={macros.fat}
              labels={{
                kcal: `${macros.cal} kcal`,
                pro: `${macros.pro}g ${t('protein')}`,
                carb: `${macros.carb}g ${t('carbs')}`,
                fat: `${macros.fat}g ${t('fat')}`,
              }}
            />
          )}
        </div>

        {/* Price + add */}
        <div className="dish-card-right">
          <div className="dish-price-wrap">
            {dish.discount && (
              <div className="dish-price-orig">€{defaultVariant.price.toFixed(2)}</div>
            )}
            <div className="dish-price">€{finalPrice.toFixed(2)}</div>
          </div>

          {inCart > 0 ? (
            <button className="dish-add-btn in-cart" onClick={handleQuickAdd}>
              <span className="cart-count">{inCart}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          ) : (
            <button className="dish-add-btn" onClick={handleQuickAdd}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function tagLabel(tag: string, lang: 'el' | 'en') {
  const map: Record<string, { el: string; en: string }> = {
    hot:  { el: 'Νέο', en: 'New' },
    veg:  { el: 'Vegan', en: 'Vegan' },
    lc:   { el: 'Low Carb', en: 'Low Carb' },
    hp:   { el: 'High Pro', en: 'High Pro' },
    sale: { el: 'Έκπτωση', en: 'Sale' },
  }
  return (map[tag]?.[lang]) ?? tag
}
