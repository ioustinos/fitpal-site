import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useMenuStore } from '../../store/useMenuStore'
import { effPrice, isDayOrderable } from '../../lib/helpers'
import { MacroDotsRow } from '../ui/MacroDots'
import { makeTr } from '../../lib/translations'
import type { Dish } from '../../data/menu'

interface DishCardProps {
  dish: Dish
  dayIndex: number
}

export function DishCard({ dish, dayIndex }: DishCardProps) {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const openDishModal = useUIStore((s) => s.openDishModal)
  const cart = useCartStore((s) => s.cart)
  const addItem = useCartStore((s) => s.addItem)
  const user = useAuthStore((s) => s.user)
  const weeksMeta = useMenuStore((s) => s.weeksMeta)
  const settings = useMenuStore((s) => s.settings)
  const t = makeTr(lang)

  // Is this day still orderable?
  const dayDate = weeksMeta[activeWeek]?.days[dayIndex]?.date
  const unavailable = dayDate ? !isDayOrderable(dayDate, settings) : false

  const dayItems = cart[dayIndex] ?? []
  const inCart = dayItems.filter((ci) => ci.dishId === dish.id).reduce((s, ci) => s + ci.qty, 0)

  const defaultVariant = dish.variants[0]
  const minPrice = defaultVariant.price
  const discPrice = effPrice(defaultVariant.price, dish.discount)
  const finalPrice = discPrice

  const macros = defaultVariant.macros
  const name = lang === 'el' ? dish.nameEl : dish.nameEn
  const desc = lang === 'el' ? dish.descEl : dish.descEn

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation()
    // Closed day — open modal so user can still view details, but don't add.
    if (unavailable) {
      openDishModal(dish, dayIndex)
      return
    }
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
      img: dish.img,
      emoji: dish.emoji,
    })
  }

  return (
    <div
      className={`dish-card${inCart > 0 ? ' in-cart' : ''}`}
      onClick={() => openDishModal(dish, dayIndex)}
    >
      {/* Image area — 3:2 ratio */}
      <div className="dish-img-wrap">
        {dish.img ? (
          <img
            className="dish-img"
            src={dish.img}
            alt={name}
            loading="lazy"
            onError={(e) => {
              const wrap = e.currentTarget.parentElement
              if (wrap) {
                e.currentTarget.style.display = 'none'
                const fb = wrap.querySelector('.dish-img-fallback') as HTMLElement
                if (fb) fb.style.display = 'flex'
              }
            }}
          />
        ) : null}
        <div className="dish-img-fallback" style={{ display: dish.img ? 'none' : 'flex' }}>
          {dish.emoji}
        </div>

        {/* Tags — absolute top-left */}
        {dish.tags && dish.tags.length > 0 && (
          <div className="dish-tags">
            {dish.tags.map((tag) => (
              <span key={tag} className={`tag tag-${tag}`}>
                {tagLabel(tag, lang)}
              </span>
            ))}
          </div>
        )}

        {/* Discount ribbon — top right */}
        {dish.discount && (
          <div className="disc-ribbon">−{dish.discount}%</div>
        )}

        {/* Price badge — bottom right */}
        {dish.discount ? (
          <div className="price-badge has-disc">
            <span className="price-badge-was">{lang === 'el' ? 'από' : 'from'} €{minPrice.toFixed(2)}</span>
            <span className="price-badge-now">€{finalPrice.toFixed(2)}</span>
          </div>
        ) : (
          <div className="price-badge">
            <span className="from">{lang === 'el' ? 'από ' : 'from '}</span>
            €{finalPrice.toFixed(2)}
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="dish-body">
        <div className="dish-name">{name}</div>

        {/* Discount line in body */}
        {dish.discount && (
          <div className="disc-card-line">
            <span className="disc-card-pct">−{dish.discount}%</span>
            <span className="disc-card-was">€{minPrice.toFixed(2)}</span>
            <span className="disc-card-arr">→</span>
            <span className="disc-card-now">€{effPrice(minPrice, dish.discount).toFixed(2)}</span>
          </div>
        )}

        {desc && <div className="dish-desc">{desc}</div>}

        {/* Macros — 4-column cream grid with admin-set dot levels */}
        {macros && (
          <MacroDotsRow
            cal={macros.cal}
            pro={macros.pro}
            carb={macros.carb}
            fat={macros.fat}
            labels={{
              kcal: 'kcal',
              pro: t('pro'),
              carb: t('carb'),
              fat: t('fat'),
            }}
            levels={dish.previewCal ? {
              cal: dish.previewCal,
              pro: dish.previewPro,
              carb: dish.previewCarb,
              fat: dish.previewFat,
            } : undefined}
          />
        )}

        {/* Full-width add button */}
        <button
          className={`btn-add${inCart > 0 ? ' in-cart' : ''}${unavailable ? ' closed' : ''}`}
          onClick={handleAdd}
          title={unavailable ? (lang === 'el' ? 'Οι παραγγελίες για αυτή την ημέρα έχουν κλείσει' : 'Orders for this day are closed') : undefined}
        >
          {unavailable
            ? (lang === 'el' ? 'Κλειστό' : 'Closed')
            : inCart > 0
              ? `${inCart > 1 ? `${inCart}× ` : ''}+ ${t('addCart')}`
              : `+ ${t('addCart')}`}
        </button>
      </div>
    </div>
  )
}

function tagLabel(tag: string, lang: 'el' | 'en') {
  const map: Record<string, { el: string; en: string }> = {
    hot:      { el: 'Δημοφιλές', en: 'Popular'  },
    popular:  { el: 'Δημοφιλές', en: 'Popular'  },
    veg:      { el: 'Veg',       en: 'Veg'      },
    lc:       { el: 'Low Carb',  en: 'Low Carb' },
    hp:       { el: 'High Pro',  en: 'High Pro' },
    sale:     { el: 'Έκπτωση',  en: 'Sale'      },
  }
  return (map[tag]?.[lang]) ?? tag
}
