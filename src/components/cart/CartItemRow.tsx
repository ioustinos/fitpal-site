import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import type { CartItem } from '../../store/useCartStore'

interface CartItemRowProps {
  item: CartItem
  dayIndex: number
  itemIndex: number
}

export function CartItemRow({ item, dayIndex, itemIndex }: CartItemRowProps) {
  const lang = useUIStore((s) => s.lang)
  const updateItem = useCartStore((s) => s.updateItem)
  const removeItem = useCartStore((s) => s.removeItem)

  const name = lang === 'el' ? item.nameEl : item.nameEn
  const variant = lang === 'el' ? item.variantLabelEl : item.variantLabelEn

  return (
    <div className="cart-item">
      {/* Thumbnail */}
      <div className="ci-thumb">
        {item.img ? (
          <>
            <img
              src={item.img}
              alt={name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const next = e.currentTarget.nextSibling as HTMLElement
                if (next) next.style.display = 'flex'
              }}
            />
            <div className="ci-thumb-emoji" style={{ display: 'none' }}>
              {item.emoji ?? '🍽️'}
            </div>
          </>
        ) : (
          <div className="ci-thumb-emoji">
            {item.emoji ?? '🍽️'}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="ci-info">
        <div className="ci-name">{name}</div>
        {variant && <div className="ci-var">{variant}</div>}
      </div>

      {/* Right — price + qty controls */}
      <div className="ci-right">
        <div className="ci-price">€{(item.price * item.qty).toFixed(2)}</div>
        <div className="qty-ctrl">
          <button
            className="qty-btn"
            onClick={() =>
              item.qty <= 1
                ? removeItem(dayIndex, itemIndex)
                : updateItem(dayIndex, itemIndex, { qty: item.qty - 1 })
            }
          >−</button>
          <span className="qty-n">{item.qty}</span>
          <button
            className="qty-btn"
            onClick={() => updateItem(dayIndex, itemIndex, { qty: item.qty + 1 })}
          >+</button>
        </div>
      </div>
    </div>
  )
}
