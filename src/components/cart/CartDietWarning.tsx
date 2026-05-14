import { useMemo } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useUIStore } from '../../store/useUIStore'
import { cartDietSummary } from '../../lib/api/diet'

/**
 * WEC-345 — diet warning banner.
 *
 * Renders an amber banner above the checkout CTA whenever the signed-in
 * customer's allergies or avoided ingredients are triggered by ANY item
 * in their cart. Cheap defence against the "skim past the menu warning,
 * then hit Place Order" failure mode.
 *
 * Renders nothing when:
 *   - The customer isn't signed in
 *   - They have no diet prefs configured
 *   - No cart item triggers a flag
 *   - The diet catalog hasn't finished loading
 *
 * The banner is bilingual (Greek-first per Fitpal convention) and includes
 * the allergy names so the customer knows exactly why we're warning them.
 * Per-item ⚠ badges (rendered in CartItemRow) point to which lines to
 * inspect — tapping a flagged row opens the dish modal with the full
 * allergen + avoided-ingredient breakdown from WEC-250.
 */
export function CartDietWarning() {
  const lang = useUIStore((s) => s.lang)
  const isEl = lang === 'el'
  const cart = useCartStore((s) => s.cart)
  const user = useAuthStore((s) => s.user)
  const dietCatalog = useMenuStore((s) => s.dietCatalog)

  const summary = useMemo(() => {
    const allergyIds = new Set(user?.diet?.allergyIds ?? [])
    const avoidedIds = new Set(user?.diet?.avoidedIngredientIds ?? [])
    return cartDietSummary(cart, dietCatalog, allergyIds, avoidedIds)
  }, [cart, dietCatalog, user?.diet?.allergyIds, user?.diet?.avoidedIngredientIds])

  if (summary.flaggedCount === 0) return null

  // Build the human-readable allergen list (Greek-first).
  const allergyNames = summary.matchedAllergies
    .map((a) => (isEl ? a.nameEl : (a.nameEn ?? a.nameEl)))
    .join(', ')

  const ingPart = summary.matchedIngredientCount > 0
    ? (isEl
        ? ` και ${summary.matchedIngredientCount} συστατικά προς αποφυγή`
        : ` and ${summary.matchedIngredientCount} avoided ingredient${summary.matchedIngredientCount === 1 ? '' : 's'}`)
    : ''

  const dishWord =
    summary.flaggedCount === 1
      ? (isEl ? 'πιάτο' : 'dish')
      : (isEl ? 'πιάτα' : 'dishes')

  return (
    <div className="cart-diet-warn" role="alert">
      <span className="cart-diet-warn-ico" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </span>
      <div className="cart-diet-warn-body">
        <div className="cart-diet-warn-head">
          {isEl ? 'Προσοχή στις αλλεργίες σου' : 'Heads up: your diet flags'}
        </div>
        <div className="cart-diet-warn-text">
          {isEl
            ? <>
                <strong>{summary.flaggedCount}</strong> {dishWord} στο καλάθι σου περιέχουν
                {allergyNames ? <> αλλεργιογόνα που έχεις δηλώσει (<strong>{allergyNames}</strong>)</> : null}
                {ingPart}.
              </>
            : <>
                <strong>{summary.flaggedCount}</strong> {dishWord} in your cart contain
                {allergyNames ? <> allergens you've flagged (<strong>{allergyNames}</strong>)</> : null}
                {ingPart}.
              </>
          }
          {' '}
          <span className="cart-diet-warn-hint">
            {isEl
              ? 'Πάτα ένα σημειωμένο πιάτο για να δεις τις λεπτομέρειες.'
              : 'Tap a flagged item to see the details.'}
          </span>
        </div>
      </div>
    </div>
  )
}
