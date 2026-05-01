# Overnight build #2 — review when you wake up

**Session date:** 2026-04-30 → 2026-05-01 overnight
**Branch:** `dev` — everything pushed. Run `git log dev --oneline -8` to see the commit chain.

---

## TL;DR

Six features shipped end-to-end, all on dev branch, all typecheck-clean. One features needs your input (Klaviyo API key) to actually send mail; everything else works as soon as the dev deploy builds.

| Asked for | Status |
|---|---|
| WEC-197 — Wallet credit grant (admin) | ✅ Built |
| WEC-194 — Hide wallet payment when balance=0 | ✅ Built |
| WEC-148 — Generic voucher errors (anti-enumeration) | ✅ Built |
| Hide goal tracking from menu page + redesign DayMacrosBlock | ✅ Built |
| WEC-180 — Cart persistence (V1) | ✅ Built |
| WEC-190 — Klaviyo integration | ✅ Code shipped, needs your API key |
| Push uncommitted work | ✅ Done |
| RLS fix for "Save notes" in Users admin | ✅ Done (yesterday's pre-existing bug) |

Commits on dev (in order):

```
f493663 feat(email): Klaviyo integration for transactional events (WEC-190)
8d782a8 feat(cart): persist cart across refresh + Viva redirect (WEC-180 V1)
64751e2 feat(macros): hide goal tracking from menu page, redesign DayMacrosBlock
3eccc16 feat: hide wallet on 0 balance + generic voucher errors (WEC-194, WEC-148)
b0f41b7 feat(admin): wallet credit grant — WEC-197
f3397c0 fix(impersonation+netlify-dev): patches accumulated during testing
```

---

## What got built — the per-feature notes

### 1. Wallet credit grant (WEC-197)

**Files added:**
- `netlify/functions/admin-grant-wallet-credit.ts` — admin-only endpoint
- (UI) `src/admin/pages/Users.tsx` → new `GrantCreditModal` component
- `src/lib/api/adminUsers.ts` → `grantWalletCredit()` helper
- (DB) `wallet_admin_credit()` RPC + new enum value `gift` + `wallet_transactions.performed_by_admin` column

**How to use it:**
1. `/admin/users` → pick a customer
2. Wallet block now shows "+ Grant credit" button (renders even if user has no wallet — granting creates one)
3. Click → modal with amount, type (refund/gift/adjustment), description in EL + EN
4. Submit → balance increments, transaction shows in customer's wallet history with admin attribution

**Caps:** €500 per grant (configurable via `GRANT_AMOUNT_CAP_CENTS` in the function). Atomic: locks the wallet row, increments balance + bonus_balance, inserts wallet_transactions, writes admin_change_log — all in one Postgres transaction.

**Test path:** Sign in as admin → /admin/users → demo user → +5€ gift → check Account → Wallet on demo's side, transaction visible.

### 2. Wallet hide on balance=0 (WEC-194)

**File:** `src/components/checkout/PaymentSection.tsx`

Wallet payment option is now hidden entirely when the customer has no wallet OR balance is 0 (and you're not impersonating). Replaces the previous "Insufficient" disabled chip which was confusing.

Exception: during admin impersonation, the wallet option stays visible even if the customer's balance is 0 — so the admin can SEE the customer's actual €0 state rather than wondering where the option went.

### 3. Generic voucher errors (WEC-148)

**File:** `netlify/functions/validate-voucher.ts`

Previously leaked WHY a voucher was unavailable: distinct strings for "doesn't exist", "expired", "max_uses reached", "already used by you", "user mismatch". Attacker could enumerate valid codes by diffing error responses.

Now every "invalid for this caller" rejection returns the same generic message: **"This voucher is invalid or unavailable."** Server logs the real reason for ops debugging.

The one exception: `min_order` not met still returns the actionable "Minimum order €X required" because that's information the legit customer can act on (add €Y more), not a code-existence leak.

### 4. Goal tracking visibility + DayMacrosBlock redesign

**Files:**
- `src/pages/MenuPage.tsx` — removed `<DayIntakePanel />` from the menu page
- `src/components/shared/DayMacrosBlock.tsx` — full rewrite using polished `order-macro-card` styling
- `src/index.css` — tighter padding/sizing rules for the cart-narrow context

**What you'll see:**
- Menu page no longer shows the per-day macros strip under the category nav. It's focused on browsing only.
- The moment a customer adds an item to the cart, the macros appear in the cart sidebar. On checkout, same macros in the order summary. Same exact component (`DayMacrosBlock`) — no drift between surfaces.
- New look: 4 colored cells (cal=peach, protein=green, carbs=cream, fat=peach) with the existing MacroIcon, big number, label, and a coloured progress bar at the bottom when goal tracking is enabled. Status colors green/yellow/red based on goal completion.

The old `DayIntakePanel.tsx` stays in the file tree (dead code, unimported) in case you want it back; nothing references it now.

### 5. Cart persistence (WEC-180 V1)

**Files:**
- `src/store/useCartStore.ts` — added `persist` middleware
- `src/pages/MenuPage.tsx` — added `reconcileCartAgainstMenu()` call

**What persists:**
- Cart items per day
- Per-day delivery addresses + time slots
- Payment method + cutlery/invoice flags

**What doesn't persist:** voucher state, voucherLoading. Vouchers re-validate every checkout — codes can expire, get exhausted, or fail min_order between sessions.

**Hydration safety:** when MenuPage loads the active week's menu, it prunes any persisted cart items whose `dishId` is no longer available (week rolled over, admin disabled the dish). Drops happen silently — no toast — because surprise "your cart was modified" alerts are worse than a slightly smaller cart.

**Schema versioning:** persist `version: 1`. Future breaking changes bump version + clean-slate migrate.

**Out of scope for V1** (sub-issues of WEC-180 epic, separate tickets): server-side draft cart for logged-in users, abandoned-cart event emission. The Klaviyo integration in WEC-190 makes the latter a one-event-emit when ready.

### 6. Klaviyo integration (WEC-190)

**Files:**
- `netlify/lib/klaviyo.ts` — server-side wrapper. Two exports: `track()` (full async) and `trackAsync()` (fire-and-forget).
- `netlify/functions/submit-order.ts` — emits `Order Placed` event on successful order commit.
- `netlify/functions/viva-refund.ts` — emits `Order Refunded` event after a refund call to Viva succeeds.

**Events carry full payload** so Klaviyo templates can iterate days/items/etc.:
- `Order Placed`: orderId, orderNumber, total, subtotal, discount, payment method/status, placedByAdmin flag, day-by-day breakdown
- `Order Refunded`: orderId, orderNumber, refundAmount, orderTotal, cumulativeRefundAmount, isFullRefund, reason

**Failure mode:** if `KLAVIYO_API_KEY` isn't set OR the Klaviyo API errors, the call is a silent no-op. Order placement and refunds are NEVER blocked on email infrastructure. Server logs warn for ops visibility.

**This is the part that needs you** — see action items below.

---

## ⚠️ ACTION ITEMS — what you need to do

### 1. Klaviyo setup (~10 minutes, blocks email delivery)

1. Sign up at [klaviyo.com](https://klaviyo.com). Free tier covers ~250 contacts.
2. **Settings → API Keys → Create Private API Key.** Scopes needed: `Events: write`, `Profiles: write`, `Catalogs: read`.
3. Copy the key. **Add to Netlify env vars** (Production + Branch deploys contexts):
   ```
   KLAVIYO_API_KEY=pk_xxx...
   ```
   Site → Site settings → Environment variables → Add. Trigger a redeploy.
4. **Configure flows in Klaviyo dashboard:**
    - Flows → New flow → Trigger: Metric → "Order Placed"
    - Add an email step. Template can use `{{ event.orderNumber }}`, `{{ event.total }}`, `{{ event.days }}`, etc.
    - Repeat for "Order Refunded" trigger with refund-receipt template.
5. **Test:** place an order on dev with your real email → wait ~30s → check that Klaviyo's "Profiles" tab shows you and the metric fired.

### 2. Supabase Auth email — pick one path (blocks signup confirmation)

**Path A — quick & free (5 min, fine for demo):**
Supabase Dashboard → Authentication → Providers → Email → uncheck "Confirm email". Signups complete immediately, no email needed. Switch back to confirmation-required before production.

**Path B — proper (15 min, needed before prod):**
1. Sign up at [resend.com](https://resend.com). Free tier covers V1 signup volume.
2. Create an API key. Verify a sending domain (or use `onboarding@resend.dev` for dev only).
3. Supabase Dashboard → Project Settings → Auth → SMTP Settings → enable.
   - Server: `smtp.resend.com:465`
   - Username: `resend`
   - Password: `<your Resend API key>`
   - Sender email: `noreply@fitpal.gr` (or your domain's email)
4. Test: sign up with a fresh email → confirmation arrives within a minute.

### 3. Set `VITE_GOOGLE_MAPS_API_KEY` on Netlify (if not already)

Already set as confirmed earlier — but verify in Netlify env vars. Without it, address autocomplete on dev/prod degrades to a plain text input.

### 4. Tonight's commits to test on dev once Netlify deploys

- Wallet credit grant: `/admin/users` → demo user → +5€ gift → check that demo's wallet shows the increase + transaction in their wallet history.
- Wallet hide: log in as a user with €0 balance → checkout → wallet option should NOT appear.
- Voucher errors: try an invalid code → should say "This voucher is invalid or unavailable." Try a real one with cart < min_order → should say "Minimum order €X required" (the one allowed leak).
- Macros: add items to cart → cart sidebar shows the new colorful macro cards with progress bars. Same cards in checkout's order summary.
- Cart persistence: add items, refresh the page → cart still there. Pay with card → after Viva redirect → cart still there.

---

## Linear ticket status

Worth closing after you've verified:
- **WEC-148** — Generic voucher errors (shipped)
- **WEC-194** — Wallet hide on balance=0 (shipped)
- **WEC-197** — Wallet credit grant (shipped)
- **WEC-180** (V1 only — leave the parent epic open for the abandoned-cart sub-issues)

Worth keeping open:
- **WEC-190** — Klaviyo integration. Code is shipped, but acceptance criteria (real emails delivered) needs the dashboard config above.
- **WEC-188** — Cart UI duplication. Tonight's DayMacrosBlock + DayOrderGroup work moves us closer; account-orders + goals-history surfaces still have their own copies. Track separately.
- All the urgent ones from yesterday (WEC-143/144 security holes, WEC-179 Viva production launch).

---

## What I deliberately didn't touch

- **WEC-143 / WEC-144** — security holes. Riskier, want your eyes.
- **Viva production setup** — needs your KYC + real card.
- **Marketing flows in Klaviyo** — that's dashboard config, not code.
- **DayIntakePanel.tsx** — left in the file tree as dead code in case you want to revert. Not imported anywhere.

---

## Stuff to know that wasn't in the asks

- The RLS policy migration `admin_update_profiles_policy` was applied to the live Supabase project earlier. Without it, "Save notes" in `/admin/users` was silently failing because the only UPDATE policy on `profiles` was `auth.uid() = id` (admin's id never matches the customer's). Fixed.
- All commits are on `dev`. Nothing on `main`. When you're ready to ship to production, merge dev → main.
- Klaviyo is a server-side concern (events emitted from Netlify Functions). The customer site bundle hasn't grown — the wrapper lives in `netlify/lib/`.

Sleep over. ☕

— Claude, 2026-05-01 ~01:00 UTC
