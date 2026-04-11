import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { MacroBoxes } from '../ui/MacroDots'
import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useToast } from '../ui/Toast'
import { effPrice } from '../../lib/helpers'
import { makeTr } from '../../lib/translations'

export function DishModal() {
  const lang = useUIStore((s) => s.lang)
  const openModal = useUIStore((s) => s.openModal)
  const selectedDish = useUIStore((s) => s.selectedDish)
  const selectedDayIndex = useUIStore((s) => s.selectedDayIndex)
  const closeModal = useUIStore((s) => s.closeModal)
  const addItem = useCartStore((s) => s.addItem)
  const user = useAuthStore((s) => s.user)
  const toast = useToast((s) => s.show)
  const t = makeTr(lang)

  const [variantId, setVariantId] = useState<string>('')
  const [qty, setQty] = useState(1)
  const [imgError, setImgError] = useState(false)

  const dish = selectedDish
  const isOpen = openModal === 'dish' && dish != null

  useEffect(() => {
    if (dish) {
      setVariantId(dish.variants[0]?.id ?? '')
      setQty(1)
      setImgError(false)
    }
  }, [dish])

  if (!dish) return null

  const variant = dish.variants.find((v) => v.id === variantId) ?? dish.variants[0]

  const walletDiscount = user?.wallet?.active ? user.wallet.discountPct ?? 0 : 0
  const basePrice = effPrice(variant.price, dish.discount)
  const finalPrice = walletDiscount > 0 ? effPrice(basePrice, walletDiscount) : basePrice

  const name = lang === 'el' ? dish.nameEl : dish.nameEn
  const desc = lang === 'el' ? dish.descEl : dish.descEn
  const macros = variant.macros

  function handleAdd() {
    addItem(selectedDayIndex!, {
      dishId: dish!.id,
      variantId: variant.id,
      nameEl: dish!.nameEl,
      nameEn: dish!.nameEn,
      variantLabelEl: variant.labelEl,
      variantLabelEn: variant.labelEn,
      price: finalPrice,
      qty,
      macros: variant.macros,
    })
    toast(lang === 'el' ? `${name} προστέθηκε!` : `${name} added!`)
    closeModal()
  }

  return (
    <Modal open={isOpen} onClose={closeModal} innerClass="dish-modal">
      {/* Close button */}
      <button className="dm-close" onClick={closeModal} aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* Image — matches demo.html dm-img-wrap */}
      <div className="dm-img-wrap">
        {dish.img && !imgError ? (
          <img
            className="dm-img"
            src={dish.img}
            alt={name}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="dm-img-fallback">{dish.emoji}</div>
        )}
      </div>

      {/* Body */}
      <div className="dm-body">
        {/* Tags */}
        <div className="dm-tags">
          {dish.tags?.map((tag) => (
            <span key={tag} className={`tag tag-${tag}`}>{tagLabel(tag, lang)}</span>
          ))}
          {dish.discount && (
            <span className="tag tag-sale">-{dish.discount}%</span>
          )}
        </div>

        <h2 className="dm-name">{name}</h2>
        {desc && <p className="dm-desc">{desc}</p>}

        {/* Macros */}
        {macros && (
          <MacroBoxes
            cal={macros.cal}
            pro={macros.pro}
            carb={macros.carb}
            fat={macros.fat}
            labels={{
              kcal: t('kcal'),
              pro: t('protein'),
              carb: t('carbs'),
              fat: t('fat'),
            }}
          />
        )}

        {/* Variant selector */}
        {dish.variants.length > 1 && (
          <div className="dm-variants">
            <div className="dm-section-label">{t('selectVariant')}</div>
            <div className="dm-variant-list">
              {dish.variants.map((v) => {
                const vBase = effPrice(v.price, dish.discount)
                const vFinal = walletDiscount > 0 ? effPrice(vBase, walletDiscount) : vBase
                return (
                  <button
                    key={v.id}
                    className={`dm-variant-btn${variantId === v.id ? ' active' : ''}`}
                    onClick={() => setVariantId(v.id)}
                  >
                    <span className="dm-variant-label">
                      {lang === 'el' ? v.labelEl : v.labelEn}
                    </span>
                    <span className="dm-variant-macros">
                      {v.macros ? `${v.macros.cal} kcal • ${v.macros.pro}g ${t('protein')}` : ''}
                    </span>
                    <span className="dm-variant-price">€{vFinal.toFixed(2)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Qty + Add */}
        <div className="dm-footer">
          <div className="dm-qty">
            <button
              className="qty-btn"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
            >−</button>
            <span className="qty-val">{qty}</span>
            <button
              className="qty-btn"
              onClick={() => setQty((q) => q + 1)}
            >+</button>
          </div>
          <button className="btn-add-to-cart" onClick={handleAdd}>
            {t('addToCart')} • €{(finalPrice * qty).toFixed(2)}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function tagLabel(tag: string, lang: 'el' | 'en') {
  const map: Record<string, { el: string; en: string }> = {
    hot:  { el: 'Νέο', en: 'New' },
    veg:  { el: 'Vegan', en: 'Vegan' },
    lc:   { el: 'Low Carb', en: 'Low Carb' },
    hp:   { el: 'High Pro', en: 'High Pro' },
  }
  return (map[tag]?.[lang]) ?? tag
}
