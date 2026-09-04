# Dev prompt — WEC-701: subscription purchase completion flow

**Work these in the order below.** Each step is shippable on its own; later steps depend on earlier ones.

Read **WEC-701** «[EPIC] Subscription purchase: land on a real success PAGE» in full, plus its two children: **WEC-700** «bank-transfer success popup closes on click-outside + zero conversion tracking» and **WEC-693** «Τιμολόγιο on a plan purchase is collected, validated — and then thrown away».

**Protocol (CLAUDE.md):** ticket → In Progress before you start · "code-complete" means *pushed to dev* · post the per-leg checklist comment before moving to In Review · any DB change made via MCP also lands as a migration file in `supabase/migrations/` the same session.

⚠️ **dev and prod share one Supabase project.** Every migration is live for customers the moment it runs.

---

## ✅ Answered before you ask: nothing changes in Viva

**Do not touch the Viva dashboard. Do not change the Success/Failure URLs.**

Verified in the code today:

* Viva's Success/Failure URLs are configured **per payment source** in the Viva dashboard and point at `/order/pending/success` and `/order/pending/failure`.
* **Both** food orders and plan purchases already redirect through those same URLs — see the comment at `src/pages/OrderReturn.tsx:99-100`: *"The wallet flow redirects to the SAME Viva return URLs."*
* `OrderReturn.tsx` already distinguishes the two. `Outcome` is a discriminated union (`:26-28`) with `kind: 'order'` and `kind: 'wallet'`, and it branches on `data.kind` returned by `viva-verify` at `:140`.

So the card path is already correctly wired. **The new success page must sit behind `OrderReturn`, never in front of it.**

### The rule for step 3

```
Viva  →  /order/pending/success   (UNCHANGED, configured in Viva)
             ↓  OrderReturn verifies the transaction  ← layer 1 of 3, must not be bypassed
             ↓  reads `kind` from viva-verify
      kind === 'wallet'  →  redirect to /subscription/success/:reference
      kind === 'order'   →  existing order confirmation, unchanged
```

**Why not point Viva straight at the new page** — three reasons, all of which have bitten this project already:

1. It would need a manual dashboard change **per environment**, and manual Viva config is exactly how WEC-497 left a webhook Inactive for two months without anyone noticing.
2. You would have to duplicate the transaction verification. `OrderReturn` → `viva-verify` is **layer 1 of the three-layer payment confirmation**. Bypassing it means a paid customer can sit `pending` until the webhook or the reconcile catches them.
3. The **cancel path** lives in `OrderReturn` — `fitpal_pending_viva_wallet_plan` in sessionStorage plus `/api/revert-wallet-plan` (`:98-116`). That is the WEC-682 phantom-purchase fix. Redirect Viva elsewhere and you silently re-break it.

---

# Step 1 — WEC-693: stop throwing away the Τιμολόγιο

Do this first. It is independent of everything else and it stops losing data today.

**The problem:** `netlify/functions/wallet-plan-purchase.ts` collects the invoice choice, **VAT-validates it** at `:360-364`, includes it in the Klaviyo payload — and never writes it to the database. `wallet_plans` has **zero** invoice columns. `orders` has three.

1. **Migration** — mirror the `orders` shape exactly, so the two tables stay readable side by side:

```sql
alter table wallet_plans
  add column invoice_type text,   -- 'receipt' | 'invoice'
  add column invoice_name text,
  add column invoice_vat  text;
```

Land it as a file in `supabase/migrations/`.

2. **Persist** in `wallet-plan-purchase.ts`. `b.invoice` is already in scope at the validation step (`:360`); write it in the `wallet_plans` insert.

3. **Display** in the admin. `src/admin/pages/WalletPurchases.tsx:204-208` **already renders** type / Επωνυμία / ΑΦΜ — it is reading nulls today and will start showing real values with no UI work. Add a small «ΤΙΜΟΛΟΓΙΟ» pill in the list view so nobody has to open every row to find the ones needing a document.

4. **Verify by placing a real transfer purchase on dev with Τιμολόγιο selected**, then reading the row back. Not by reading the code.

⚠️ Historical purchases are unrecoverable — the data never landed anywhere durable. Don't attempt a backfill; Ioustinos will decide who to re-ask.

---

# Step 2 — WEC-701 §B: the confirmation email is missing the bank details

**The problem:** `wallet-plan-purchase.ts:274` fires `Subscription Purchased` to Klaviyo for `transfer` and `cash`. The payload has amounts, plan details and `payment_status: 'pending'` — but **no `iban`, no `beneficiary`, no `reference`**. And `email_templates/out/05_subscription_purchased_el.html` contains **zero** occurrences of IBAN / Δικαιούχος / Αιτιολογία.

**The food flow already does this correctly** — copy it, don't invent:

* `netlify/functions/submit-order.ts:549` reads `bank_transfer_info` from `settings`
* `email_templates/out/01_order_confirmation_el.html` renders IBAN / Δικαιούχος / Αιτιολογία from `bank_*` variables

1. Read `settings.bank_transfer_info` in `wallet-plan-purchase.ts` — **same source, never hardcode**. Note it is an **array** (Alpha Bank + Viva); the order template already handles multiple accounts, so match its behaviour.
2. Add `iban`, `beneficiary`, `bank_name`, `reference`, `amount` to the `Subscription Purchased` payload.
3. Render the bank block in `05_subscription_purchased_el.html` **and** `_en.html`, conditional on `payment_status == 'pending'` **AND** `payment_method == 'transfer'`. A cash-on-delivery customer must never be told to make a transfer.
4. Reuse the markup from `01_order_confirmation` so the two cannot drift.

⚠️ **Klaviyo: editing a flow message strips its transactional status for ~24h.** Batch every Klaviyo edit into **one sitting** — coordinate with **WEC-666** «Emails: global changes + per-template rewrites» before touching anything in the Klaviyo UI.

**Verify** by sending yourself a real transfer purchase confirmation and checking the IBAN, beneficiary, reference and amount all render — in EL and EN.

---

# Step 3 — WEC-701 §A + WEC-700: the real success page

**The problem:** the confirmation is a modal (`src/pages/WalletPage.tsx`, `bankInfo` at `:1477`, `cashInfo` at `:1510`) whose backdrop has `onClick={() => setBankInfo(null)}`. The **button** does `window.location.href = LANDING_URL`; the **backdrop** silently dumps the customer back on the wizard. That modal is the only place the IBAN, the reference and the amount are ever shown — dismiss it and the customer cannot pay.

**Build** `/subscription/success/:reference`.

* **Re-fetch the details from the plan record.** Do not carry them in React state or rely on navigation state — the whole point is that it survives a refresh and can be revisited.
* Cover every payment path: **transfer** (full IBAN block), **cash** (reference only, no bank details), **card** (arrives via the redirect above), **wallet**.
* Link it from **Account → Συνδρομές** so the details are recoverable later. Losing them must become impossible, not merely unlikely.
* Wire the card path exactly as specified in the box at the top — `OrderReturn` verifies, then redirects on `kind === 'wallet'`.
* Delete the two overlays from `WalletPage.tsx` once the page replaces them. **Don't leave them behind as dead code** — a second success surface will drift.
* The page is **read-only**. The plan is already created server-side before the redirect. Nothing here mutates state.

**Regression checks that matter more than the feature:**

* Cancel at Viva on a **plan** purchase → still reverts the plan and creates no phantom (**WEC-682**).
* Cancel at Viva on a **food order** → unchanged (**WEC-681**).
* A card **food order** still lands on its existing confirmation, untouched.

---

# Step 4 — WEC-701 §C: fire the purchase conversion

**The problem:** the tracking library is complete. `src/lib/tracking/events.ts:23`:

```ts
purchase: { meta: 'Purchase', ga4: 'purchase', klaviyo: 'Placed Order', server: true, always: true }
```

Its call sites are `App.tsx`, `ConsentBanner.tsx`, `DishModal.tsx`, **`CheckoutPage.tsx`**, `useCartStore.ts`. **`WalletPage.tsx` is not among them.** A €30 food order fires `Purchase`; a €405 subscription fires nothing.

1. Fire `purchase` from the new success page with `value`, `currency: 'EUR'`, the plan reference as the order id, and the plan as the line item.
2. **Fire exactly once.** Guard on the reference — a page can be refreshed, and duplicate Purchase events corrupt ROAS. This risk did not exist with the modal; the page introduces it.
3. Server-side CAPI as well — the event config already sets `server: true`.

⏸️ **Wait for Ioustinos before choosing the event shape.** He is speaking to Michalis (Meta ads) and needs to agree whether subscriptions use a distinct event name or a `content_type` discriminator, so they can be separated from food orders in Ads Manager. Build the plumbing; leave that one decision open until he confirms.

⚠️ `VITE_TRACKING_ENABLED` is **off in production** and WEC-397 «Tracking Phase 1 — Meta Pixel + CAPI + Klaviyo (gated)» is unverified. **Wire it anyway** — inert while the flag is off, counting from the moment it's on. Don't block on WEC-397.

**Verify in the Meta test-events tool and GA4 DebugView** — refresh the success page and confirm the event does *not* fire twice. Reading the code is not verification here.

---

## Definition of done for the epic

* A subscription purchase lands on a URL that survives refresh and is reachable again from the account page.
* IBAN + Δικαιούχος + Αιτιολογία + amount visible **on that page and in the email** — transfer only.
* Exactly one `purchase` event per purchase, correct value, confirmed in Meta test-events.
* Τιμολόγιο + ΑΦΜ persisted and visible in the admin purchase drawer.
* WEC-682 and WEC-681 cancel paths re-tested and still clean.
* Viva dashboard **unchanged** — if you found yourself editing it, stop and re-read the box at the top.
