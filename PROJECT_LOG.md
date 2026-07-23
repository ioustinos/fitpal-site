# Fitpal Ordering Platform — Project Log

CTO journal — most recent at the top. Linear is the authoritative source for ticket state; this log is the narrative of how the project evolved.

---

## 2026-06-21 — Airtable retail-order mirror (WEC-473) — backend shipped to dev

Autonomous overnight build (full dev autonomy granted by Ioustinos). The new platform now mirrors **retail** orders into the existing Airtable base **directly** (no n8n) — "just another store source" (Store Id 9999). B2B stays on GonnaOrder→n8n→Airtable; Admin Dev ops suite unchanged. Decision trail in `docs/airtable-ops-decision.md`, `docs/airtable-ops-deep-dive.md`, `docs/admin-dev-inventory.md`, mapping in `docs/airtable-push-design.md`.

Commit `7c0d3ff` on `dev`. Migrations `wec474_dish_external_id` + `wec478_airtable_sync_flags` applied to dev DB (additive). Built `netlify/lib/airtable/*` + `airtable-push-background` + `airtable-reconcile` (cron */5), wired into `submit-order` (decoupled, eligible-only) + `markPaid` (flag card on pay). All new/modified server files typecheck clean.

Key calls: `external_id` decoupled from PK (backfilled = id, all 350 dishes); links resolved by record id (no typecast → no junk Menu Reference/Customer rows); Customer find-or-create by `Phone Number` replaces the race-prone Airtable automation; push never blocks checkout; reconcile is the backstop. `Paid`/`Payment Method`/invoice mapped to exact single-select options pulled from live `getSchema`.

**Remaining:** WEC-474 admin `external_id` field (existing menu works now); WEC-481 E2E on dev (place a cash order on a real dish, eyeball Airtable); WEC-480 divergence flag (v2). Confirm Μenu Reference `Κωδικός` is variant-level.

## 2026-05-13 — URGENT cross-week cart leakage fix

Real customer report came in: cart items added for week 1 (Thu 14/5 + Fri 15/5) were being submitted against week 2 dates (Thu 21/5 + Fri 22/5), and the server correctly rejected them with "X is not on the menu for 2026-05-21". Pre-launch testers were blocked from placing orders.

**Root cause:** the cart store keyed everything (`cart`, `delivery`, `fulfillment`) by `dayIndex: number` (0..4 for Mon..Fri). Every weekly menu has the same Mon..Fri shape, so `cart[3]` was shared between week-1 Thursday and week-2 Thursday. When a customer's `activeWeek` drifted between adding items and submitting (via DayNav next-week, or `findLandingDay` rolling forward as cutoffs passed), the same cart entries got re-interpreted against a different week's dates at submit time. Exactly the "day index vs delivery date mismatch" edge case called out in WEC-199's description that we punted on at the time.

**Fix:** re-keyed the entire cart store from `Record<number, ...>` to `Record<string /* YYYY-MM-DD */, ...>`. Cross-week sharing is impossible by construction now. Persist version bumped 2 → 3 with a blank migrate (old carts in customer browsers wipe on first hydrate, which beats the alternative of guessing which week they were building for).

**Bonus fix — WEC-122 family bug**: the rejection screen labelled 2026-05-21 as "Δευτέρα" (Monday) and 2026-05-22 as "Τρίτη" (Tuesday) when those dates are actually Thursday and Friday. The wrong label came from CheckoutPage's server-error mapper passing the payload-position index through `dayLabelFor(i)`, which used the currently-active week's day strip. Now resolved via `dayPayloads[idx].deliveryDate` + `getDay()` — date-correct regardless of activeWeek.

**Also fixed during reproduction**: DayNav per-day count badge silently disappeared after the refactor because `totalCount(cart, i)` was passing the integer day index. Now passes `day.date`. The badge reappeared as expected.

**Filed and closed:**

- **WEC-336** — Urgent. Cross-week cart leakage. Fix implemented + tested locally.
- **WEC-337** — Medium. Χαϊδάρι postcode 12461 → DB-verified not in any zone. Decision needed: add zone or improve out-of-area copy.

**17 files touched:**

```
src/store/useCartStore.ts            cart shape → date-keyed, version 2→3
src/lib/helpers.ts                   dayAmt/activeDays/totalCount take date strings
src/components/cart/CartSidebar.tsx        iterate cart dates, not active week's days
src/components/cart/MobileCartSheet.tsx    same
src/components/cart/CartItemRow.tsx        prop dayIndex → dayDate
src/components/shared/DayOrderGroup.tsx    prop dayIndex dropped, use day.date
src/components/shared/DayMacrosBlock.tsx   prop dayIndex → dayDate
src/components/menu/DayNav.tsx             badge count by date
src/components/menu/DishCard.tsx     addItem(dayDate, ...) — resolve date once
src/components/menu/DishModal.tsx    addItem(dayDate, ...) — resolve from selectedDayIndex
src/components/menu/DayIntakePanel.tsx     resolve activeDay → date
src/components/checkout/AddressSection.tsx prop dayIndex → dayDate
src/components/checkout/TimeSlotPicker.tsx prop dayIndex → dayDate
src/components/checkout/OrderSummary.tsx   iterate cart dates
src/components/checkout/ConfirmationScreen.tsx snapshot keys by date
src/pages/MenuPage.tsx              reconcile no longer needs weeksMeta arg
src/pages/CheckoutPage.tsx          activeDates throughout; dayLabelForDate
```

**Pre-flight checks:** `npx vite build --outDir /tmp/fitpal-dist2` → ✓ 336 modules, ~6.7s, no errors. Grep audit confirms no remaining `cart[someIndex]`, `delivery[someIndex]`, `addItem(idx, ...)` etc. Manual repro on localhost confirms the cross-week ghost is gone and the day badges are back. tsc is too slow in the dev sandbox to complete a full check; vite's parse + grep audit is the gating signal.

---

## 2026-05-11 — Auth hardening + cart TTL session

Pure-code night while waiting on Google Cloud + Facebook Developer dashboard setup. No git push this session — code is staged locally on disk, will go to `dev` once the OAuth provider configs land.

**Closed in this session:**

- **WEC-186** — Split-tender (wallet + card) → ticket updated with a complete V1 design recommendation. Decision: **Option B** (schema-light), wallet + card only, parent-order-level split, proportional refunds. Spec'd but not yet implemented — picks up when wallet work is next prioritized. Still in Backlog.
- **WEC-199** — Cart 24h TTL + past-day pruning → **implemented**. `useCartStore.ts` gains `lastTouchedAt` (bumped in every mutating action), persist version 2, and a new `reconcileCartAgeAndDates(weeksMeta, activeWeek)` exported helper. `MenuPage.tsx` calls it in a useEffect that runs after `weeksMeta` loads and BEFORE the existing `reconcileCartAgainstMenu`. Move WEC-199 to Done after the next push lands on dev and a manual smoke test passes.

**Opened in this session:**

- **WEC-322** — Implement Google Login (Supabase OAuth). Full spec including Google Cloud Console + Supabase + frontend wiring + auto-link policy.
- **WEC-323** — Implement Facebook Login (Supabase OAuth). Full spec including Facebook Developer Portal + Live mode + scope notes + Facebook-no-email edge case.

**Code added (not yet pushed):**

```
src/store/useCartStore.ts          # WEC-199: lastTouchedAt + reconcileCartAgeAndDates
src/pages/MenuPage.tsx             # WEC-199: wire reconcile useEffect

src/lib/api/auth.ts                # WEC-322/323: signInWithOAuth helper
src/components/layout/AuthModal.tsx # WEC-322/323: Google + Facebook button row + handler
src/pages/AuthCallback.tsx         # WEC-322/323: /auth/callback handler (NEW)
src/pages/PrivacyPage.tsx          # WEC-322/323: /privacy bilingual page (NEW)
src/pages/TermsPage.tsx            # WEC-322/323: /terms bilingual page (NEW)
src/App.tsx                        # WEC-322/323: routes for /auth/callback, /privacy, /terms
src/index.css                      # WEC-322/323: .btn-oauth + .auth-divider + .legal-page

skills/setup-auth/SKILL.md         # NEW reusable auth playbook
```

**Pending external setup** (Ioustinos to do in dashboards before this code is live):

1. Google Cloud Console: OAuth consent screen + OAuth 2.0 Client ID. Redirect URI must be `https://rhwetztxwjxfstffalwl.supabase.co/auth/v1/callback`. Origins must include `http://localhost:8888`, `https://dev--fitpal-order.netlify.app`, `https://fitpal-order.netlify.app`.
2. Facebook Developer Portal: app + Facebook Login product + Live mode. Privacy + Terms URLs point at the new `/privacy` and `/terms` routes. Default scopes (`public_profile` + `email`) need no App Review.
3. Supabase Dashboard → Authentication → Providers: enable Google + Facebook, paste credentials.
4. Supabase Dashboard → Authentication → URL Configuration → Redirect URLs: add `http://localhost:8888/**`, `https://dev--fitpal-order.netlify.app/**`, `https://fitpal-order.netlify.app/**` (with the `/**` wildcards — critical).
5. Verify Manual Linking is OFF (default) — we auto-link by verified email.

**Pre-flight checks done:**

- `npx vite build --outDir /tmp/fitpal-dist` → ✓ 336 modules transformed, ~3.1s, no errors.
- TypeScript surfaces 4 pre-existing errors (carried over from before this session) — none introduced by tonight's changes. CLAUDE.md flags `tsc -b` as non-gating since WEC-141.

**Memory updates:** added `project_session_2026_05_11.md`, `reference_setup_auth_skill.md`. Existing OTP-pitfalls memory remains accurate.

**Next session:**

1. Ioustinos completes external dashboard setup → confirms.
2. Push staged code to `dev` branch.
3. Smoke test on `https://dev--fitpal-order.netlify.app`: cart TTL (return after 24h+), OAuth (Google + Facebook).
4. Move WEC-199, WEC-322, WEC-323 to Done.
5. Refine Privacy + Terms copy with proper legal review.

## 2026-07-23 — Catalogue migration July 2026 (EXECUTED)
Full catalogue refresh from Maria's corrected sheets (menu v5 + ingredients v2), matched on external id. 316 dishes / 1,364 variants (743 price changes, 139 renames, 20 new dishes incl. Smoothies + Ατομικές Σαλάτες categories), ingredients switched to column-D source (268 active, allergies rebuilt, 2,301 allergen-overlay rows with fixed_grams=0 — constraint relaxed by migration), grams recipes rebuilt from Κρυμμένο Πεδίο (smart dropdowns intact, 207 dishes). All orders + weekly menus + test dishes wiped (backup: schema backup_20260717). Variant checksums vs CSV: exact match. 315/316 images (289 has a Drive-folder link in the sheet — pending fix). EN fields auto-generated for 159 renamed/new dishes. Full report: docs/catalogue-migration-2026-07/MIGRATION_REPORT.md. Linear ticket pending (MCP was disconnected) — file on reconnect.
