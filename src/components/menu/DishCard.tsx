import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useAuthStore } from '../../store/useAuthStore'
import { effPrice, isDayOrderable } from '../../lib/helpers'
import { MacroDotsRow, MacroValuesRow } from '../ui/MacroDots'
import { dishDietFlags } from '../../lib/api/diet'
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
  const weeksMeta = useMenuStore((s) => s.weeksMeta)
  const settings = useMenuStore((s) => s.settings)
  const t = makeTr(lang)

  // Is this day still orderable?
  // WEC-336: resolve dayIndex → date once here; the cart is keyed by date.
  const dayDate = weeksMeta[activeWeek]?.days[dayIndex]?.date
  const unavailable = dayDate ? !isDayOrderable(dayDate, settings) : false

  const dayItems = dayDate ? (cart[dayDate] ?? []) : []
  const inCart = dayItems.filter((ci) => ci.dishId === dish.id).reduce((s, ci) => s + ci.qty, 0)

  // WEC-250: diet flags for the signed-in user. We compute lazily — the
  // catalog is loaded with the menu so this is just a Map+Set lookup.
  // For guests (no user) the flags are all-empty and no badge renders.
  const user = useAuthStore((s) => s.user)
  const dietCatalog = useMenuStore((s) => s.dietCatalog)
  const userAllergyIds = new Set(user?.diet?.allergyIds ?? [])
  const userAvoidedIngredientIds = new Set(user?.diet?.avoidedIngredientIds ?? [])
  const dietFlags = dishDietFlags(dish.id, dietCatalog, userAllergyIds, userAvoidedIngredientIds)
  const dietWarningLabel = dietFlags.any
    ? (lang === 'el'
        ? `Προσοχή: ${dietFlags.matchedAllergies.length > 0 ? 'περιέχει αλλεργιογόνα' : 'περιέχει συστατικό προς αποφυγή'}`
        : `Heads up: ${dietFlags.matchedAllergies.length > 0 ? 'contains an allergen' : 'contains an ingredient you avoid'}`)
    : ''

  // WEC-256: tag catalog from the store, look up each dish.tag id to render
  // it in the correct slot (top_left / top_right / bottom_left / under_title).
  // Falls back to the hardcoded TAG_META + isOverlayTag map for any tag id
  // not yet in the store (defensive — first paint can race with the fetch).
  const tagsCatalog = useMenuStore((s) => s.tags)
  const resolvedTags = (dish.tags ?? [])
    .map((id) => {
      const t = tagsCatalog.find((x) => x.id === id)
      if (t) return { id, labelEl: t.labelEl, labelEn: t.labelEn, bgColor: t.bgColor, fontColor: t.fontColor, placement: t.placement }
      // Fallback for unknown tag ids (legacy seeds, race conditions)
      return {
        id,
        labelEl: tagLabel(id, 'el'),
        labelEn: tagLabel(id, 'en'),
        bgColor: undefined as string | undefined,
        fontColor: undefined as string | undefined,
        placement: (isOverlayTag(id) ? 'top_left' : 'under_title') as 'top_left' | 'under_title',
      }
    })
  const tagsBy = {
    top_left:    resolvedTags.filter((t) => t.placement === 'top_left'),
    top_right:   resolvedTags.filter((t) => t.placement === 'top_right'),
    bottom_left: resolvedTags.filter((t) => t.placement === 'bottom_left'),
    under_title: resolvedTags.filter((t) => t.placement === 'under_title'),
  }

  // First variant by sort_order — used for the "από €X.XX" pricing badge so it
  // always reflects the cheapest option, regardless of admin's preselection.
  const cheapestVariant = dish.variants[0]
  const minPrice = cheapestVariant.price
  const discPrice = effPrice(cheapestVariant.price, dish.discount)
  const finalPrice = discPrice

  // WEC-254: macros come from the admin-marked default variant (the one the
  // dish modal will preselect). For dishes with no marked default we fall back
  // to the first variant — matches old behaviour.
  const preselectedVariant = dish.variants.find((v) => v.isDefault) ?? cheapestVariant
  const macros = preselectedVariant.macros
  const macrosDisplay = settings.macrosDisplay
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
    // Only reached for single-variant dishes (the if above sends >1 to the
    // modal). For 1-variant dishes the preselected variant IS the only one.
    // WEC-336: defensive guard — if we somehow can't resolve a date for
    // this dayIndex (week not yet loaded?), open the modal instead of
    // silently dropping the click.
    if (!dayDate) {
      openDishModal(dish, dayIndex)
      return
    }
    addItem(dayDate, {
      dishId: dish.id,
      variantId: preselectedVariant.id,
      nameEl: dish.nameEl,
      nameEn: dish.nameEn,
      variantLabelEl: preselectedVariant.labelEl,
      variantLabelEn: preselectedVariant.labelEn,
      price: finalPrice,
      qty: 1,
      macros: preselectedVariant.macros,
      img: dish.img,
      emoji: dish.emoji,
    })
  }

  return (
    <div
      className={`dish-card${inCart > 0 ? ' in-cart' : ''}${dietFlags.any ? ' diet-flag' : ''}`}
      onClick={() => openDishModal(dish, dayIndex)}
    >
      {/* WEC-250: subtle ⚠ badge anchored top-left when the dish triggers
          the customer's allergy/avoidance prefs. Doesn't fight with the
          existing top_left admin tag — admin tags layer above. */}
      {dietFlags.any && (
        <span
          className="dish-diet-warn"
          title={dietWarningLabel}
          aria-label={dietWarningLabel}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </span>
      )}
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

        {/* WEC-256: image-overlay tags grouped by placement.
            top-left and top-right corners stack with the existing discount
            ribbon — discount stays anchored top-right so admin tags placed
            top_right slot under it. bottom_left is a new slot. */}
        {tagsBy.top_left.length > 0 && (
          <div className="dish-tags dish-tags-tl">
            {tagsBy.top_left.map((t) => (
              <span
                key={t.id}
                className={`tag tag-${t.id}`}
                style={t.bgColor ? { background: t.bgColor, color: t.fontColor } : undefined}
              >
                {lang === 'el' ? t.labelEl : t.labelEn}
              </span>
            ))}
          </div>
        )}
        {tagsBy.top_right.length > 0 && (
          <div className="dish-tags dish-tags-tr">
            {tagsBy.top_right.map((t) => (
              <span
                key={t.id}
                className={`tag tag-${t.id}`}
                style={t.bgColor ? { background: t.bgColor, color: t.fontColor } : undefined}
              >
                {lang === 'el' ? t.labelEl : t.labelEn}
              </span>
            ))}
          </div>
        )}
        {tagsBy.bottom_left.length > 0 && (
          <div className="dish-tags dish-tags-bl">
            {tagsBy.bottom_left.map((t) => (
              <span
                key={t.id}
                className={`tag tag-${t.id}`}
                style={t.bgColor ? { background: t.bgColor, color: t.fontColor } : undefined}
              >
                {lang === 'el' ? t.labelEl : t.labelEn}
              </span>
            ))}
          </div>
        )}

        {/* Discount ribbon — top right (rendered AFTER tags-tr so it stays
            visually on top if both exist; CSS pins them to different spots
            on the same edge). */}
        {!!dish.discount && (
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

        {/* Inline 'under the title' tags — chips below the dish name. */}
        {tagsBy.under_title.length > 0 && (
          <div className="dish-inline-tags">
            {tagsBy.under_title.map((t) => (
              <span
                key={t.id}
                className={`tag tag-inline tag-${t.id}`}
                style={t.bgColor ? { background: t.bgColor, color: t.fontColor } : undefined}
              >
                {lang === 'el' ? t.labelEl : t.labelEn}
              </span>
            ))}
          </div>
        )}

        {/* Discount line in body */}
        {!!dish.discount && (
          <div className="disc-card-line">
            <span className="disc-card-pct">−{dish.discount}%</span>
            <span className="disc-card-was">€{minPrice.toFixed(2)}</span>
            <span className="disc-card-arr">→</span>
            <span className="disc-card-now">€{effPrice(minPrice, dish.discount).toFixed(2)}</span>
          </div>
        )}

        {desc && <div className="dish-desc">{desc}</div>}

        {/* Macros — WEC-254: numeric values for the preselected variant by default,
            with the legacy 1-5 dot scale available as a fallback the admin can
            flip to from /admin/settings (settings.macros_display = 'dots'). */}
        {macros && (macrosDisplay === 'numbers' ? (
          <MacroValuesRow
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
          />
        ) : (
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
        ))}

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

/**
 * Tag metadata — keyed by tag slug.
 *
 * `overlay: true`  → renders absolute-positioned on the dish image (e.g. the
 *                    attention-grabbing "Popular" / "Sale" pills).
 * `overlay: false` → renders inline under the dish name as a chip (quieter
 *                    classifiers like "Vegan" / "Low Carb" that the user
 *                    scans while comparing dishes).
 *
 * WEC-133: this map is the local source of truth until the `tags.overlay`
 * column lands in Supabase (migration drafted but waiting on Ioustinos's
 * approval per the "Show Before Execute" rule). Once the column exists,
 * replace these constants with server data via the admin Tags editor.
 */
const TAG_META: Record<string, { el: string; en: string; overlay: boolean }> = {
  hot:      { el: 'Δημοφιλές', en: 'Popular',  overlay: true  },
  popular:  { el: 'Δημοφιλές', en: 'Popular',  overlay: true  },
  sale:     { el: 'Έκπτωση',  en: 'Sale',     overlay: true  },
  veg:      { el: 'Veg',       en: 'Veg',      overlay: false },
  lc:       { el: 'Low Carb',  en: 'Low Carb', overlay: false },
  hp:       { el: 'High Pro',  en: 'High Pro', overlay: false },
}

export function tagLabel(tag: string, lang: 'el' | 'en') {
  return TAG_META[tag]?.[lang] ?? tag
}

export function isOverlayTag(tag: string): boolean {
  // Default to overlay for unknown tags — safer to draw attention than hide
  // them below the fold when we don't know what they are.
  return TAG_META[tag]?.overlay ?? true
}
