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
      <div className="cart-item-info">
        <div className="cart-item-name">{name}</div>
        {variant && <div className="cart-item-variant">{variant}</div>}
      </div>

      <div className="cart-item-right">
        <div className="cart-item-price">€{(item.price * item.qty).toFixed(2)}</div>
        <div className="cart-qty-ctrl">
          <button
            className="qty-btn sm"
            onClick={() =>
              item.qty <= 1
                ? removeItem(dayIndex, itemIndex)
                : updateItem(dayIndex, itemIndex, { qty: item.qty - 1 })
            }
          >−</button>
          <span className="qty-val sm">{item.qty}</span>
          <button
            className="qty-btn sm"
            onClick={() => updateItem(dayIndex, itemIndex, { qty: item.qty + 1 })}
          >+</button>
        </div>
      </div>
    </div>
  )
}
