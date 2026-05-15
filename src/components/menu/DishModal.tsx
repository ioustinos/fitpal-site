import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { MacroBoxes } from '../ui/MacroDots'
import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useToast } from '../ui/Toast'
import { effPrice, isDayOrderable } from '../../lib/helpers'
import { dishDietFlags } from '../../lib/api/diet'
import { makeTr } from '../../lib/translations'
import { RecipePanel } from './RecipePanel'
import { VariantPicker } from './VariantPicker'

export function DishModal() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const openModal = useUIStore((s) => s.openModal)
  const selectedDish = useUIStore((s) => s.selectedDish)
  const selectedDayIndex = useUIStore((s) => s.selectedDayIndex)
  const editingCartItem = useUIStore((s) => s.editingCartItem)
  const closeModal = useUIStore((s) => s.closeModal)
  const addItem = useCartStore((s) => s.addItem)
  const updateItem = useCartStore((s) => s.updateItem)
  const removeItem = useCartStore((s) => s.removeItem)
  const cart = useCartStore((s) => s.cart)
  const weeksMeta = useMenuStore((s) => s.weeksMeta)
  const settings = useMenuStore((s) => s.settings)
  const tagsCatalog = useMenuStore((s) => s.tags)
  // WEC-250: diet-flag inputs read at the top so the hook order is stable
  // (the early `if (!dish) return null` below disallows hooks after it).
  const dietCatalog = useMenuStore((s) => s.dietCatalog)
  const user = useAuthStore((s) => s.user)
  const toast = useToast((s) => s.show)
  const t = makeTr(lang)

  const [variantId, setVariantId] = useState<string>('')
  const [qty, setQty] = useState(1)
  const [comment, setComment] = useState('')
  const [imgError, setImgError] = useState(false)

  const dish = selectedDish
  const isOpen = openModal === 'dish' && dish != null
  // WEC-340: edit mode is signalled by `editingCartItem`. Both ADD and
  // EDIT use the same modal — only the prefill, the day-date resolution,
  // and the primary action differ.
  const isEdit = editingCartItem != null

  // Pre-fill state on open. For ADD mode the defaults match how dishes
  // were always added (admin default variant, qty 1, no comment). For
  // EDIT mode we hydrate from the existing cart item so the customer
  // sees their current selection.
  useEffect(() => {
    if (!dish) return
    if (isEdit && editingCartItem) {
      const items = useCartStore.getState().cart[editingCartItem.dayDate] ?? []
      const row = items[editingCartItem.itemIndex]
      if (row) {
        setVariantId(row.variantId)
        setQty(row.qty)
        setComment(row.comment ?? '')
        setImgError(false)
        return
      }
      // Cart row vanished (concurrent delete?) — fall through to defaults.
    }
    const defaultV = dish.variants.find((v) => v.isDefault)
    setVariantId(defaultV?.id ?? dish.variants[0]?.id ?? '')
    setQty(1)
    setComment('')
    setImgError(false)
  }, [dish, isEdit, editingCartItem])

  if (!dish) return null

  const variant = dish.variants.find((v) => v.id === variantId) ?? dish.variants[0]

  const basePrice = effPrice(variant.price, dish.discount)
  const finalPrice = basePrice

  const name = lang === 'el' ? dish.nameEl : dish.nameEn
  const desc = lang === 'el' ? dish.descEl : dish.descEn
  const macros = variant.macros

  // Is the day this modal was opened in still orderable?
  // WEC-340: in edit mode, the day-date comes straight from editingCartItem
  // (which is anchored to the cart's own date key). In add mode, resolve
  // from selectedDayIndex + activeWeek as before.
  const dayDate = isEdit
    ? editingCartItem!.dayDate
    : (selectedDayIndex != null ? weeksMeta[activeWeek]?.days[selectedDayIndex]?.date : undefined)
  const unavailable = dayDate ? !isDayOrderable(dayDate, settings) : false

  // WEC-132 dynamic CTA: if this dish+variant combo is already in the cart
  // for the selected day, show the current qty so the user knows they're
  // adding ON TOP of an existing entry (addItem stacks on the matching
  // dishId+variantId in useCartStore).
  //
  // WEC-340: in edit mode we skip the "existing" count — the row we're
  // editing IS the existing entry, so there's no "another one on top"
  // semantic to convey.
  const existingInCart = (() => {
    if (isEdit) return 0
    if (!dayDate) return 0
    const items = cart[dayDate] ?? []
    const row = items.find(
      (i) => i.dishId === dish.id && i.variantId === variant.id,
    )
    return row?.qty ?? 0
  })()

  function handleAdd() {
    if (unavailable) return
    // WEC-336: defensive — without a resolvable date we can't safely add.
    if (!dayDate) return
    addItem(dayDate, {
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

  // WEC-340: save changes from edit mode. updateItem patches the existing
  // row by index — variant, qty, comment, and the macros/price/label
  // fields that depend on the variant choice. Doesn't merge with sibling
  // rows of the same (dishId, variantId) — keeps the customer's mental
  // model "I'm editing THIS line" intact.
  function handleSaveEdit() {
    if (!isEdit || !editingCartItem) return
    if (qty < 1) {
      // Treat zero qty as remove — matches the row's "−" button semantics.
      removeItem(editingCartItem.dayDate, editingCartItem.itemIndex)
      toast(lang === 'el' ? `${name} αφαιρέθηκε` : `${name} removed`)
      closeModal()
      return
    }
    updateItem(editingCartItem.dayDate, editingCartItem.itemIndex, {
      variantId: variant.id,
      variantLabelEl: variant.labelEl,
      variantLabelEn: variant.labelEn,
      price: finalPrice,
      qty,
      macros: variant.macros,
      comment: comment.trim() || undefined,
    })
    toast(lang === 'el' ? 'Αποθηκεύτηκε!' : 'Saved!')
    closeModal()
  }

  function handleRemoveFromCart() {
    if (!isEdit || !editingCartItem) return
    removeItem(editingCartItem.dayDate, editingCartItem.itemIndex)
    toast(lang === 'el' ? `${name} αφαιρέθηκε` : `${name} removed`)
    closeModal()
  }

  // WEC-250: derive diet flags from the hooks read at the top. Plain
  // computations only — no hook calls, safe after the early return.
  const userAllergyIds = new Set(user?.diet?.allergyIds ?? [])
  const userAvoidedIngredientIds = new Set(user?.diet?.avoidedIngredientIds ?? [])
  const dietFlags = dishDietFlags(dish.id, dietCatalog, userAllergyIds, userAvoidedIngredientIds)

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
        {/* WEC-250: diet warning banner — visible only when the signed-in
            user has flagged allergies / avoided ingredients that this dish
            contains. Spells out exactly which ones so the customer knows
            WHY they're being warned. */}
        {dietFlags.any && (
          <div className="dm-diet-warn" role="alert">
            <span className="dm-diet-warn-ico" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </span>
            <div className="dm-diet-warn-body">
              <div className="dm-diet-warn-head">
                {lang === 'el' ? 'Με βάση τη διατροφή σου:' : 'Based on your diet:'}
              </div>
              {dietFlags.matchedAllergies.length > 0 && (
                <div className="dm-diet-warn-line">
                  {lang === 'el' ? 'Αλλεργιογόνα: ' : 'Allergens: '}
                  <strong>
                    {dietFlags.matchedAllergies
                      .map((a) => (lang === 'el' ? a.nameEl : (a.nameEn ?? a.nameEl)))
                      .join(', ')}
                  </strong>
                </div>
              )}
              {dietFlags.matchedAvoidedIngredientIds.length > 0 && (
                <div className="dm-diet-warn-line">
                  {lang === 'el' ? 'Συστατικά προς αποφυγή: ' : 'Ingredients you avoid: '}
                  <strong>{dietFlags.matchedAvoidedIngredientIds.length}</strong>
                  {' '}
                  <span className="dm-diet-warn-hint">
                    {lang === 'el' ? '(δες τη συνταγή πιο κάτω)' : '(see the recipe below)'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Tags — WEC-256 dynamic placement. The modal flattens all tags into
            a single under-title chip row regardless of placement, since the
            modal already has its own image area with corner overlays. */}
        {(dish.tags?.length || dish.discount) ? (
          <div className="dm-tags">
            {(dish.tags ?? []).map((tagId) => {
              const t = tagsCatalog.find((x) => x.id === tagId)
              const labelEl = t?.labelEl ?? tagLabel(tagId, 'el')
              const labelEn = t?.labelEn ?? tagLabel(tagId, 'en')
              const bg = t?.bgColor
              const fg = t?.fontColor
              return (
                <span
                  key={tagId}
                  className={`tag tag-${tagId}`}
                  style={bg ? { background: bg, color: fg } : undefined}
                >
                  {lang === 'el' ? labelEl : labelEn}
                </span>
              )
            })}
            {!!dish.discount && (
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

        {/* Recipe panel — full ingredient list for the selected variant (WEC-245).
            Renders nothing when the dish has no structured recipe rows yet. */}
        <RecipePanel dishId={dish.id} variantId={variant.id} lang={lang} />

        {/* Variant picker — pills for ≤4 variants, ingredient dropdowns for 5+,
            with admin override via dishes.variant_ux_mode (WEC-246). */}
        <VariantPicker
          dish={dish}
          selectedVariantId={variantId}
          onChange={setVariantId}
          lang={lang}
        />

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

        {/* Sticky footer (WEC-353) — qty stepper + primary CTA + optional
            edit-mode remove link. Anchored to the bottom of the modal's
            scroll container so customers never have to scroll to find
            the Add / Save button on tall dishes.
            WEC-340: ADD mode shows the original add-to-cart CTA;
            EDIT mode shows "Save changes" as the primary action and a
            secondary "Remove from cart" link underneath. */}
        <div className="dm-footer">
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
          {isEdit ? (
            <button
              className={`btn-dm-add${unavailable ? ' closed' : ''}`}
              onClick={handleSaveEdit}
              disabled={unavailable}
            >
              {unavailable
                ? (lang === 'el' ? 'Οι παραγγελίες έχουν κλείσει' : 'Orders closed')
                : (lang === 'el'
                    ? `Αποθήκευση αλλαγών • €${(finalPrice * qty).toFixed(2)}`
                    : `Save changes • €${(finalPrice * qty).toFixed(2)}`)}
            </button>
          ) : (
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
          )}
        </div>

        {/* WEC-340: secondary remove-from-cart action — only in edit mode.
            Sits below the main actions row so it doesn't compete with the
            primary CTA. Plain-text link styling, danger-red on hover. */}
        {isEdit && (
          <button
            type="button"
            className="btn-dm-remove"
            onClick={handleRemoveFromCart}
          >
            {lang === 'el' ? 'Αφαίρεση από το καλάθι' : 'Remove from cart'}
          </button>
        )}
        </div>{/* /.dm-footer (WEC-353) */}
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
