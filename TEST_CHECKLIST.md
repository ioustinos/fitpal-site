# Fitpal — Post-Polish Test Checklist

Covers WEC-131 through WEC-140. Run through on `localhost:8888` before we push to `dev`. Break into browser sizes: desktop (≥1024), tablet (768), mobile (375). Test in both EL and EN.

## 1. Cart sidebar — WEC-131
- [ ] Add 3–4 items with long names to the same day. Names should wrap, never truncate with "…".
- [ ] Qty +/– controls are 32×32 on mobile (iPhone width 375). Easy to tap.
- [ ] Delete (✕) button visible, distinct from qty controls.
- [ ] Sidebar stays scrollable when items exceed height.

## 2. Dish modal density — WEC-132
- [ ] Open a dish with 4 variants. Variants fit on one screen without scrolling (on a 1024 laptop). If not, only the variant list should scroll — header stays pinned.
- [ ] Open a dish you already have in the cart. The CTA reads `Add +1 (2 in cart) • €X.XX`. Quantity updates reflect the selector, not just "Add to Cart".
- [ ] Macro pills are tight but readable. Icons visible, numbers legible.

## 3. Dish cards — WEC-133
- [ ] A dish tagged both `hot` and `veg` renders `Popular` on the image (overlay, red) and `Veg` below the name (inline chip, neutral).
- [ ] Confirm: `hot`/`sale` → overlay. `veg`/`lc`/`hp` → inline.
- [ ] Unknown/future tag slugs fall back to overlay (safest default).

## 4. Address editing — WEC-134
- [ ] Account → Addresses → "Edit" on a saved address → change the label, save. Verify change persists on reload.
- [ ] Try editing with an invalid street (blank). Verify a `Save failed: …` alert appears (should not silently fail).
- [ ] Label input is a title-sized (18px, bold) input, not a small text field. Placeholder reads "Home, Office, Grandma".

## 5. Confirmation screen — WEC-135
- [ ] Place an order. Confirmation shows order number in a hero box under the tick, not buried in body text.
- [ ] Copy says "We'll try to email you" and "If it doesn't arrive, don't worry" — softer than V1.
- [ ] PDF button is GONE (stub was removed).
- [ ] Cart clears when confirmation renders, but order summary DISPLAYS (not empty). Hit refresh — you land back on the menu.
- [ ] Go to Account → Orders → the new order appears at the top with correct date.

## 6. Menu page density — WEC-136
- [ ] Banner + wallet promo sit side-by-side on desktop, stack on mobile, and total combined vertical < 200px.
- [ ] Mobile cart FAB is tappable — it must open CheckoutPage (this was dead previously).

## 7. Weekday labels — WEC-137
- [ ] Navigate through all 5 days — labels (`Mon`, `Tue`…/`Δευ`, `Τρί`…) match the actual weekday of each date. No off-by-one.
- [ ] Jump to next week, day labels still line up with dates.
- [ ] Open Checkout with orders on 2+ days. Day headings match the day-nav labels.

## 8. Checkout minor polish — WEC-138
- [ ] Click Submit with invoice toggle ON and empty VAT/Company → red hints appear below both fields. Hints disappear as you type.
- [ ] VAT of `123` (too short) → red hint "at least 5 digits". VAT of `12345678` accepts.
- [ ] Enter a postcode that doesn't match any zone → time-slot grid shows "No delivery windows available" empty state (not a blank grid).
- [ ] Clear postcode → time grid shows "Enter your postcode first…".

## 9. Account — order detail + lang — WEC-139
- [ ] Order card header date renders correctly (e.g. "20 Apr 2026"). The previous bug produced "Invalid Date" for DB-format timestamps.
- [ ] Open an order, expand a day — variant detail shows in the correct language (EL vs EN).
- [ ] Switch language toggle while logged in. Refresh the page. Language persists (was saved to `user_prefs.lang`).
- [ ] Log out and back in — language matches what you last set while logged in.
- [ ] Toggle language while logged out. That works but does NOT write to Supabase.

## 10. Mobile UX — WEC-140
- [ ] At 375px width, dish cards are not clipped on the right. 2-column grid shows both cards fully.
- [ ] At 320px width (very small phones), cards go single-column with comfortable padding.
- [ ] Day nav scrolls horizontally on narrow phones; last day tab can be scrolled into view.
- [ ] FAB sits above the iOS home indicator (safe-area respected).
- [ ] Long checkout doesn't have content sitting directly under the submit button.

## 11. End-to-end smoke
- [ ] Place a full order as a guest. Confirm admin panel shows it at `/admin/orders`.
- [ ] Place a full order as the demo user (`demo@fitpal.gr`). Confirm it lands under `user_id`.
- [ ] Apply a voucher at checkout. Total drops by the expected amount.
- [ ] Try cutoff-blocked day (Monday after Saturday 18:00, if that weekday override is live) — submitting should fail cleanly with the red error stack, not a generic toast.
