# Dev handoff — tickets raised 3–4 September 2026

Nine tickets. **Four are already built** (verified in code, not from ticket state) — listed first so nobody redoes them. **Five need work.**

Verified against `origin/dev` at commit `ec26050`.

---

## ✅ Already built — verify, don't rebuild

### WEC-701 «[EPIC] Subscription purchase: land on a real success PAGE» — ALL FOUR PARTS DONE

Shipped in `4faf50e` + `ec26050`, on top of the earlier §D work. Verified:

| Part | Evidence |
| --- | --- |
| **§A** real success page | `src/pages/SubscriptionSuccess.tsx` — route `/subscription/success/:reference`, re-fetches from the durable plan record so it survives refresh |
| **§A** card path wired correctly | `OrderReturn.tsx:387-402` — verifies first, then `navigate('/subscription/success/…', { replace: true })` on `kind === 'wallet'`. **Viva config untouched, exactly as specified.** |
| **§A** retrievable later | `AccountPage.tsx:1770` and `:1835` link to it, including past plans |
| **§B** bank details in the email | `4faf50e` |
| **§C** conversion event | `SubscriptionSuccess.tsx:128` — fires `subscribe`, guarded once-per-reference in `localStorage` **and** an in-tab `useRef` |
| **§D** Τιμολόγιο persisted | migration `wec693_wallet_plans_invoice_columns.sql`; written at `wallet-plan-purchase.ts:232-234`, `:295-297`; read by `adminWalletPlans.ts` |

**WEC-700** «bank-transfer success popup closes on click-outside + zero conversion tracking» — the two dismissible overlays are gone from `WalletPage.tsx`. The one remaining `wpv2-bank-overlay` at `:1472` is the **WEC-433 price-confirm modal**, which *should* stay dismissible. Correctly left alone.

**WEC-693** «Τιμολόγιο on a plan purchase is thrown away» — done, in In Review.

#### ⚠️ One decision was made that Ioustinos wanted to take with Michalis first

The event is **`subscribe`**, not `purchase`:

```ts
subscribe: { meta: 'Subscribe', ga4: 'subscribe', klaviyo: 'Subscribed Plan', server: true, always: true }
```

Sensible — `Subscribe` is a standard Meta event and it cleanly separates subscriptions from food orders. **But Michalis must be told the event name is `Subscribe`, not `Purchase`.** Any campaign optimising on Purchase will still not see subscriptions.

#### What to test before this leaves In Review

* Refresh the success page → the `subscribe` event must **not** fire twice (Meta test-events / GA4 DebugView).
* Cancel at Viva on a **plan** purchase → still reverts, no phantom (**WEC-682**).
* Cancel at Viva on a **food order** → unchanged (**WEC-681**).
* A card **food order** still lands on its own confirmation.
* Bank-transfer email actually renders IBAN / Δικαιούχος / Αιτιολογία, EL and EN.

### WEC-696 «The n8n reconcile workflow has NEVER worked — fixed with /reconcile-run»

**Proven working in production data.** `reconcile_runs` shows clean runs at `:01, :16, :31, :46` — every 15 minutes, `errors=0`, ~50 consecutive. That is n8n hitting `/reconcile-run`. Can go to Done once someone confirms the workflow is the one they expect.

---

## 🔴 Needs work — in priority order

### 1. WEC-697 «Removing a dish or a day in admin leaves the record ALIVE in Airtable» — URGENT

Kitchen operations depend on Airtable. Verified today, unchanged:

* **0** delete calls anywhere in `netlify/lib/airtable/`
* `cancelled_at` **not referenced at all** — so a cancelled day is actively re-pushed as a live day, with its items
* `invoice_name` still never sent

**Ioustinos has decided: hard delete** (a Cancelled flag would mean touching every kitchen view). Note Postgres is asymmetric — items are **hard-deleted**, days are **soft-cancelled** via `cancelled_at` — so the fix needs both mechanisms. Full detail on the ticket, including the mandatory guards (scope deletes to `Store Id = 9999`; never treat a failed read as an empty set; dry-run first).

### 2. WEC-695 «viva-reconcile has failed OAuth on EVERY run since 29 July» — URGENT, and it's now bigger

⚠️ **The diagnosis changed today. Read the latest comment, not the description.**

Evidence now shows it is the **production** credentials failing, not the demo ones:

* n8n → dev deploy → demo credentials → **clean, every run**
* Netlify cron → production → prod credentials → **`invalid_client`, every run**

Since `getVivaAccessToken()` is shared with `createVivaOrder`, **production probably cannot create a card payment at all**. Last paid card order was 10 August; five card orders `failed` between 28 Aug and 1 Sept.

**This is on Ioustinos, not the dev** — checking `VIVA_CLIENT_ID_PROD` / `VIVA_CLIENT_SECRET_PROD` against the live merchant. The code fix (`10e49f9`, OAuth preflight + foreign-environment partitioning) is already on dev and ships with the next promotion.

### 3. WEC-699 «Αγορά Πακέτου (mobile): ΤΚ error invisible + 6/7-day cards promise weekend delivery» — High

Unchanged in code: `WalletPage.tsx:156-157` still reads `Δευ–Σαβ` / `Όλη την εβδομάδα`, and the «ενότητα 9» hint is still there.

**Confirmed by Ioustinos:** weekend meals *are* sold; they're delivered on Friday; the first delivery must be a weekday. The start-date picker already enforces that (`StartDatePicker.tsx:88-89`) — **nothing to do there.** ⚠️ **Do not delete the 6/7-day cards** — they're the two highest-discount tiers. This is a copy change plus mobile validation feedback.

⚠️ Overlaps **WEC-657** on the same lines of the same file — sequence them.

### 4. WEC-698 «Admin can flip an order to Τιμολόγιο but cannot enter the company name or ΑΦΜ» — High

`adminOrders.ts:980` still updates `invoice_type` only. Flipping an order to invoice produces a legally unusable record — invoice flag, no name, no ΑΦΜ. Also: invoice details are shown **nowhere** to the customer (not the confirmation screen, not the account page, not the email).

Reuse the checkout validation at `submit-order.ts:327-329` rather than writing a second one.

### 5. WEC-702 «Account → Συνδρομή & Πορτοφόλι: drop the green balance box, show plan characteristics, fix footer wording» — Medium

⚠️ **The first bullet of that PDF page is already done** — WEC-663 (5/5), commit `b2360b1`, built the eight-field «Στοιχεία συνδρομής» card. Only the three highlighted items remain.

Reuse the **shared** `PlanDetailsPanel` (WEC-688) — it exists for exactly this. It needs a `lang` prop first; it's currently Greek-only and staff-facing.

⚠️ **Do not delete the balance card before confirming with Ioustinos** where a customer can otherwise see their credit — the header badge is gated on `payment_methods_enabled`, where wallet is `public: false`.

---

## Not for the dev

**WEC-694** «Run the k6 load suite against PRODUCTION — then turn rate limiting back on». Ioustinos runs this from his Mac. It gates flipping `RATE_LIMIT_DISABLED` back to `FALSE`.

---

## Two things found while checking, not yet ticketed

1. **Three active delivery zones have no bookable slots** — Θρακομακεδόνες - Φυλή (0 slots), **Άνω Λιόσια** and **Αχαρνές (Μενίδι)** (5 slots each, *all deactivated*). Customers in those postcodes reach checkout and cannot finish. Admin fix, ~30 seconds. Θρακομακεδόνες is **WEC-670**; the other two are new since 3 Sept.
2. **No weekly menu exists after 11 September.** The week of the 14th hasn't been built.

---

## ⚠️ Standing: `main` is 42 commits behind `dev`

Everything above ships to customers only on promotion. Production is still serving the **1 September** build — no WEC-678, no WEC-681, no banner, and none of today's subscription work.
