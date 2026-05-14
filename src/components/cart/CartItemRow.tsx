import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useToast } from '../ui/Toast'
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
  // WEC-340: click → open DishModal in edit mode for this line.
  const openDishModalForEdit = useUIStore((s) => s.openDishModalForEdit)
  const dishMap = useMenuStore((s) => s.dishMap)
  const toast = useToast((s) => s.show)
  // WEC-262: scoped voucher → show per-item discount allocation.
  const catLookup = (id: string) => dishMap[id]?.catId
  const perItemDisc = voucher.applied && (voucher.applicableCategoryIds?.length ?? 0) > 0
    ? itemVoucherDiscount(item, cart, voucher, catLookup)
    : 0

  const name = lang === 'el' ? item.nameEl : item.nameEn
  const variant = lang === 'el' ? item.variantLabelEl : item.variantLabelEn

  // WEC-340: open the dish modal in edit mode. Defensive: if the dish has
  // been removed from the menu since the item was added (e.g. admin
  // disabled it), we can't render the modal — surface a toast instead.
  function handleOpenEdit() {
    const dish = dishMap[item.dishId]
    if (!dish) {
      toast(
        lang === 'el'
          ? 'Αυτό το πιάτο δεν είναι πλέον διαθέσιμο'
          : 'This dish is no longer available',
      )
      return
    }
    openDishModalForEdit(dish, { dayDate, itemIndex })
  }

  return (
    <div
      className="cart-item cart-item-clickable"
      onClick={handleOpenEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleOpenEdit()
        }
      }}
      aria-label={
        lang === 'el'
          ? `Επεξεργασία: ${name}${variant ? ', ' + variant : ''}`
          : `Edit: ${name}${variant ? ', ' + variant : ''}`
      }
    >
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
        {/* WEC-340: stop propagation so +/- don't bubble up to the
            row-click → edit-modal handler. Customers expect qty controls
            to stay inline. */}
        <div className="qty-ctrl" onClick={(e) => e.stopPropagation()}>
          <button
            className="qty-btn"
            onClick={(e) => {
              e.stopPropagation()
              item.qty <= 1
                ? removeItem(dayDate, itemIndex)
                : updateItem(dayDate, itemIndex, { qty: item.qty - 1 })
            }}
          >−</button>
          <span className="qty-n">{item.qty}</span>
          <button
            className="qty-btn"
            onClick={(e) => {
              e.stopPropagation()
              updateItem(dayDate, itemIndex, { qty: item.qty + 1 })
            }}
          >+</button>
        </div>
      </div>
    </div>
  )
}
