# Dev prompt — WEC-703: vouchers for subscription purchases

Read **WEC-703** «Vouchers for subscription purchases + an admin scope selector (orders OR subscriptions — never both)» in full first. This is the implementation route, not a replacement for the ticket.

**Protocol (CLAUDE.md):** ticket → In Progress before you start · "code-complete" means *pushed to dev* · post the per-leg checklist comment before moving to In Review · any DB change made via MCP also lands as a migration file in `supabase/migrations/` the same session.

⚠️ **dev and prod share one Supabase project.** The migration below is live for customers the moment it runs.

---

## Two rules that are not up for interpretation

### 1. There is no `both`

```sql
alter table vouchers
  add column applies_to text not null default 'orders'
    check (applies_to in ('orders', 'subscriptions'));
```

A voucher is for orders **or** for packages. Ioustinos: *"both definitely does not exist cause its dangerous for a slip that might grand someone a 200 euro discount."*

The `check` constraint is the point — a two-way radio in the admin form is not protection if the column accepts anything. Put it in the DB.

`default 'orders'` protects the **126 existing vouchers**, 118 of which are the GonnaOrder codes imported in WEC-527. Verify by count after the migration:

```sql
select applies_to, count(*) from vouchers group by applies_to;
-- expect: orders | 126, and nothing else
```

### 2. The voucher reduces the PAYMENT, never the credits

Ioustinos: *"the voucher is about how much they pay, not how much credits they get. all the other bonuses have to do with credits."*

€400 plan, 20% subscription voucher → customer **pays €320**, receives **€400** of wallet credit. Bonus credits unchanged.

**This is a deliberate margin cost.** Do not "fix" it by reducing the credit.

---

## The good news: the separation you need already exists

`netlify/functions/wallet-plan-purchase.ts:113-123`:

```ts
const bonusCents        = Math.round(result.bonusCredits * 100)
const walletCreditCents = Math.round(result.walletCredit * 100)
// pays `chargeCents` (plan + fee); the wallet is still credited only
// `walletCreditCents` (plan base + bonus).
const chargeCents = planAmountCents + lipoCents
```

The codebase **already** distinguishes "what you pay" from "what you're credited" — that split was introduced for the λιπομέτρηση fee (WEC-553). Your voucher slots into exactly that seam:

* apply the discount to **`chargeCents` only**, after line 123
* leave `walletCreditCents` and `bonusCents` completely untouched
* the plan's `cost` / `credits` / `bonus` are computed **before** the voucher — don't move that calculation

### Where the discount is recorded — no new column needed

`voucher_uses.amount` already stores the discount applied, and `voucher_uses.wallet_plan_id` **already exists** (uuid, nullable). So the redemption record carries the discount and points at the plan. Nothing new on `wallet_plans`.

⚠️ Be deliberate about `wallet_plans.amount_to_pay_cents` (`:218`) and `cost` (`:236`): both currently take `chargeCents`. They must hold the **post-voucher** figure, since that's what Viva is asked for and what the bank transfer expects. The pre-voucher amount stays recoverable as `amount_to_pay_cents + voucher_uses.amount`.

---

## Step 1 — migration + admin UI

* Migration as above, file in `supabase/migrations/`.
* `src/admin/pages/Vouchers.tsx` — two-way selector beside the existing `registeredOnly` toggle (`:309`). **Required, no blank default** — a voucher created without a conscious scope choice is the slip this design exists to prevent.
* When scope is `subscriptions`, **hide the category picker** (`:345`). `applicable_category_ids` (WEC-262) is meaningless for a plan — it has no dish categories.
* Help text on `min_order`: for a subscription voucher it means the **plan cost**. A €15 minimum written for food orders would otherwise pass silently against a €400 plan.

🚫 **Do NOT add** a max-discount column, a threshold confirmation, a euro preview, or special `max_uses` defaults. All proposed, all declined — *"keep it simple and they should be careful."* If you think a cap is needed, raise a separate ticket; do not add it here.

## Step 2 — validation

`netlify/functions/validate-voucher.ts` is order-shaped: `ValidateRequest` takes `cartTotal` and an optional `items[]` for category scoping.

Add a subscription path — a branch or a sibling endpoint, your call — but **do not fork the eligibility rules**. Expiry, `active`, `max_uses`, `uses_count`, `per_user_limit`, `registered_only` (WEC-546) and the email/phone identity matching must stay in **one** place. Two copies will drift, and the drift will be in your favour exactly once and against you thereafter.

New rejection cases, both needing clear bilingual messages:

* a `subscriptions` voucher used at à-la-carte checkout
* an `orders` voucher used in the wizard

Reuse the existing rejection-reason map (`:135`) rather than inventing a parallel one.

## Step 3 — redemption, and it must be atomic

Orders use a SECURITY DEFINER RPC. Live signatures:

```
redeem_voucher_for_order(p_voucher_id uuid, p_user_id uuid, p_order_id uuid,
                         p_amount_cents integer, p_email text, p_phone text) → void
unredeem_voucher_for_order(p_order_id uuid) → void
```

It decrements `remaining`, closes the redemption race and inserts `voucher_uses` in one transaction. **WEC-211 exists because that race was once lost** — a discount was applied with no `voucher_uses` row, making every limit bypassable.

Add the plan equivalent — generalise these or add siblings — writing `wallet_plan_id` instead of `order_id`. **Do not hand-roll a non-atomic version in TypeScript.**

Also add the un-redeem path: `wallet_plan_refund` must release the voucher use, or a refunded plan permanently burns the customer's redemption.

## Step 4 — wizard UI

`src/pages/WalletPage.tsx` has two comment blocks (`:380-384`, `:1211-1213`) left by WEC-508 warning against restoring the coupon input without the money path. **Delete those comments when you restore it properly** — they've done their job.

`wallet-plan-purchase.ts:38` already declares `voucherCode?: string` in its request type and never reads it. Wire that dead parameter up rather than adding a second one.

`settings.wallet_voucher_enabled` exists, is admin-editable, is returned by `wallet-plan-quote` as `voucherEnabled`, and currently gates **nothing**. Make it gate the wizard's coupon field.

## Step 5 — surface the discount

The code and the amount taken off must appear on:

* the subscription success page — `src/pages/SubscriptionSuccess.tsx` (WEC-701, just shipped)
* the `Subscription Purchased` Klaviyo email

exactly as order confirmations already do.

⚠️ **Klaviyo: editing a flow message strips its transactional status for ~24h.** Batch with WEC-666 «Emails: global changes + per-template rewrites».

---

## Test before In Review

* `select applies_to, count(*) from vouchers group by applies_to;` → `orders | 126`, nothing else.
* The DB **rejects** `update vouchers set applies_to = 'both'`.
* **The one that matters:** buy the same plan twice on dev, once with a subscription voucher and once without. `wallet_credit_cents` and `bonus_credits_cents` must be **identical**; only `amount_to_pay_cents` differs. That is the whole of decision 2a.
* An `orders` voucher is refused in the wizard; a `subscriptions` voucher is refused at checkout — both with a readable message, in EL and EN.
* Double-submit the purchase → `uses_count` increments **once**, one `voucher_uses` row with `wallet_plan_id` set.
* Refund the plan → the voucher use is released and the code is usable again.
* Existing à-la-carte voucher flow still works — regression check, since you'll have touched shared validation.
