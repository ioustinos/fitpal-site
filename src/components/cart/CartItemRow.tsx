import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { itemVoucherDiscount } from '../../lib/helpers'
import type { CartItem } from '../../store/useCartStore'

interface CartItemRowProps {
  item: CartItem
  /** WEC-336: delivery date (YYYY-MM-DD) the item belongs to. Replaces the
   *  old dayIndex prop — cart is keyed by date now. */
  dayDate: string
  itemIndex: number
}

export function CartItemRow({ item, dayDate, itemIndex }: CartItemRowProps) {
  const lang = useUIStore((s) => s.lang)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const updateItem = useCartStore((s) => s.updateItem)
  const removeItem = useCartStore((s) => s.removeItem)
  // WEC-262: scoped voucher → show per-item discount allocation.
  const dishMap = useMenuStore((s) => s.dishMap)
  const catLookup = (id: string) => dishMap[id]?.catId
  const perItemDisc = voucher.applied && (voucher.applicableCategoryIds?.length ?? 0) > 0
    ? itemVoucherDiscount(item, cart, voucher, catLookup)
    : 0

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
        {item.comment && <div className="ci-comment">"{item.comment}"</div>}
      </div>

      {/* Right — price + qty controls */}
      <div className="ci-right">
        {item.originalPrice && item.originalPrice > item.price && (
          <div className="ci-price-was">€{(item.originalPrice * item.qty).toFixed(2)}</div>
        )}
        <div className="ci-price">€{(item.price * item.qty).toFixed(2)}</div>
        {perItemDisc > 0 && (
          <div className="ci-price-disc" title="Voucher discount on this item">
            −€{perItemDisc.toFixed(2)}
          </div>
        )}
        <div className="qty-ctrl">
          <button
            className="qty-btn"
            onClick={() =>
              item.qty <= 1
                ? removeItem(dayDate, itemIndex)
                : updateItem(dayDate, itemIndex, { qty: item.qty - 1 })
            }
          >−</button>
          <span className="qty-n">{item.qty}</span>
          <button
            className="qty-btn"
            onClick={() => updateItem(dayDate, itemIndex, { qty: item.qty + 1 })}
          >+</button>
        </div>
      </div>
    </div>
  )
}
