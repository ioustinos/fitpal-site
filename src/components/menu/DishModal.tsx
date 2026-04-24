import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { MacroBoxes } from '../ui/MacroDots'
import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useToast } from '../ui/Toast'
import { effPrice, isDayOrderable } from '../../lib/helpers'
import { makeTr } from '../../lib/translations'

export function DishModal() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const openModal = useUIStore((s) => s.openModal)
  const selectedDish = useUIStore((s) => s.selectedDish)
  const selectedDayIndex = useUIStore((s) => s.selectedDayIndex)
  const closeModal = useUIStore((s) => s.closeModal)
  const addItem = useCartStore((s) => s.addItem)
  const cart = useCartStore((s) => s.cart)
  const weeksMeta = useMenuStore((s) => s.weeksMeta)
  const settings = useMenuStore((s) => s.settings)
  const toast = useToast((s) => s.show)
  const t = makeTr(lang)

  const [variantId, setVariantId] = useState<string>('')
  const [qty, setQty] = useState(1)
  const [comment, setComment] = useState('')
  const [imgError, setImgError] = useState(false)

  const dish = selectedDish
  const isOpen = openModal === 'dish' && dish != null

  useEffect(() => {
    if (dish) {
      setVariantId(dish.variants[0]?.id ?? '')
      setQty(1)
      setComment('')
      setImgError(false)
    }
  }, [dish])

  if (!dish) return null

  const variant = dish.variants.find((v) => v.id === variantId) ?? dish.variants[0]

  const basePrice = effPrice(variant.price, dish.discount)
  const finalPrice = basePrice

  const name = lang === 'el' ? dish.nameEl : dish.nameEn
  const desc = lang === 'el' ? dish.descEl : dish.descEn
  const macros = variant.macros

  // Is the day this modal was opened in still orderable?
  const dayDate = selectedDayIndex != null
    ? weeksMeta[activeWeek]?.days[selectedDayIndex]?.date
    : undefined
  const unavailable = dayDate ? !isDayOrderable(dayDate, settings) : false

  // WEC-132 dynamic CTA: if this dish+variant combo is already in the cart
  // for the selected day, show the current qty so the user knows they're
  // adding ON TOP of an existing entry (addItem stacks on the matching
  // dishId+variantId in useCartStore).
  const existingInCart = (() => {
    if (selectedDayIndex == null) return 0
    const items = cart[selectedDayIndex] ?? []
    const row = items.find(
      (i) => i.dishId === dish.id && i.variantId === variant.id,
    )
    return row?.qty ?? 0
  })()

  function handleAdd() {
    if (unavailable) return
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
      img: dish!.img,
      emoji: dish!.emoji,
      comment: comment.trim() || undefined,
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

      {/* Image */}
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
        {(dish.tags?.length || dish.discount) ? (
          <div className="dm-tags">
            {dish.tags?.map((tag) => (
              <span key={tag} className={`tag tag-${tag}`}>{tagLabel(tag, lang)}</span>
            ))}
            {dish.discount && (
              <span className="tag tag-sale">-{dish.discount}%</span>
            )}
          </div>
        ) : null}

        <div className="dm-name">{name}</div>
        {desc && <div className="dm-desc">{desc}</div>}

        {/* Macros */}
        {macros && (
          <MacroBoxes
            cal={macros.cal}
            pro={macros.pro}
            carb={macros.carb}
            fat={macros.fat}
            labels={{
              kcal: t('kcal'),
              pro: t('pro'),
              carb: t('carb'),
              fat: t('fat'),
            }}
          />
        )}

        {/* Variant selector — matches demo .variant-row layout */}
        {dish.variants.length > 1 && (
          <div className="dm-variants">
            <div className="dm-section-title">{t('selectSize')}</div>
            <div className="dm-variant-list">
              {dish.variants.map((v) => {
                const vBase = effPrice(v.price, dish.discount)
                const vFinal = vBase
                const isActive = variantId === v.id
                return (
                  <div
                    key={v.id}
                    className={`variant-row${isActive ? ' sel' : ''}`}
                    onClick={() => setVariantId(v.id)}
                  >
                    <div className="vr-radio" />
                    <div className="vr-info">
                      <div className="vr-label">{lang === 'el' ? v.labelEl : v.labelEn}</div>
                      {v.macros && (
                        <div className="vr-macros">
                          {v.macros.cal} kcal · {v.macros.pro}g {t('pro')} · {v.macros.carb}g {t('carb')} · {v.macros.fat}g {t('fat')}
                        </div>
                      )}
                    </div>
                    <div className="vr-price">€{vFinal.toFixed(2)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Dish comment */}
        <div className="dm-comment-wrap">
          <div className="dm-comment-lbl">{t('dishComment')}</div>
          <textarea
            className="dm-comment"
            rows={1}
            placeholder={t('dishCommentPh')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        {/* Actions — matches demo .dm-actions layout */}
        <div className="dm-actions">
          <div className="dm-qty">
            <button
              className="dm-qty-btn"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
            >−</button>
            <span className="dm-qty-n">{qty}</span>
            <button
              className="dm-qty-btn"
              onClick={() => setQty((q) => q + 1)}
            >+</button>
          </div>
          <button
            className={`btn-dm-add${unavailable ? ' closed' : ''}`}
            onClick={handleAdd}
            disabled={unavailable}
          >
            {unavailable
              ? (lang === 'el' ? 'Οι παραγγελίες έχουν κλείσει' : 'Orders closed')
              : existingInCart > 0
                // WEC-141: when the dish is already in the cart for this day,
                // framing matters — the user is knowingly adding *another one
                // with a different setup* (different variant / comment). The
                // price still trails behind a bullet so it's scannable.
                ? (lang === 'el'
                    ? `Προσθήκη με διαφορετική επιλογή • €${(finalPrice * qty).toFixed(2)}`
                    : `Add another with a different setup • €${(finalPrice * qty).toFixed(2)}`)
                : `${t('addToCart')} • €${(finalPrice * qty).toFixed(2)}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function tagLabel(tag: string, lang: 'el' | 'en') {
  const map: Record<string, { el: string; en: string }> = {
    hot:  { el: 'Δημοφιλές', en: 'Popular' },
    veg:  { el: 'Vegan', en: 'Vegan' },
    lc:   { el: 'Low Carb', en: 'Low Carb' },
    hp:   { el: 'High Pro', en: 'High Pro' },
  }
  return (map[tag]?.[lang]) ?? tag
}
