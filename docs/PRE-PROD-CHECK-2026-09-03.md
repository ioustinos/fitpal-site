# Pre-production check — 3 September 2026

Every line below is either **verified today** against the live site / database / Netlify API, or explicitly marked **unverified — needs a human**. Nothing is copied from an older checklist. That mistake is what made the previous version of this document wrong in five places.

---

## ✅ Verified working on production

| Check | Evidence |
| --- | --- |
| Site serving, SSL, custom domain | `https://orders.fitpal.gr` → 200 |
| **`robots` = `index,follow`** | Meta tag read from the live page. The earlier noindex-on-production bug is gone. |
| **Terms + Privacy live with real content** | `/terms` renders «Όροι Χρήσης», last updated 11 May, and covers **cutoff, cancellations, refunds and payment methods** — the three things Viva's review looks for. |
| Public APIs healthy | `/api/menu-meta` → 200 (1.8 KB of week data), `/api/settings-public` → 200 |
| **`SUPABASE_SERVICE_ROLE_KEY` works on production** | `menu-meta` returning real data proves it. Closes that checklist line for good. |
| **Bank transfer details are real, not placeholders** | Alpha Bank `GR9001401190119002002034196` + Viva `GR93057…`, beneficiary «Fitpal Meals ΙΚΕ» |
| Delivery zones | 41 active |
| Admin users | 5 — `owner` ioustinos, `menu_order` cd / nena / maria / faidra |
| Scheduled functions registered | `viva-reconcile` + `airtable-reconcile`, both `*/5`, on the production deploy |
| **Airtable reconcile** | Clean since 20:01 today, after the `Cancellation Reason` field was added. 13 orders stuck since 23 July synced. |
| Contact + support details | support@fitpal.gr, +30 210 4253929, IG/FB/TikTok all populated |
| Cutoff model | 18:00 previous day, with a Monday override (cutoff falls Sunday 18:00) |

---

## ❌ Verified problems

### 1. Production is 35 commits behind `dev` — everything else follows from this

The live build is from **1 September**. Not live: WEC-691 (first-time subscription signup), WEC-658 (payment rules, cash cap, invoice fields), WEC-678 (payment link amounts), WEC-681 (Viva phantom orders), WEC-647 (banner), WEC-687, WEC-673, the customer-facing batch, and both reconcile fixes.

Confirmed independently: `GET /.netlify/functions/reconcile-run` on production returns the SPA shell, i.e. the function doesn't exist there yet.

**One merge fixes this and several items below.**

### 2. `viva-reconcile` still failing on production — 12 errors in the last hour

Production runs the old code, so the fixes in `10e49f9` aren't live. **WEC-695.** Resolves with the promotion.

### 3. «Θρακομακεδόνες - Φυλή» is active with ZERO time slots

**WEC-670.** Still true today. Any customer with that postcode reaches checkout and cannot complete an order — no slot to pick. Either add slots or deactivate the zone. Two minutes.

### 4. ⚠️ No weekly menu beyond **11 September**

| Menu | Dates | Dishes |
| --- | --- | --- |
| Week of 2026-08-24 | 24–28 Aug | 170 |
| Week of 2026-08-31 | 31 Aug – 4 Sep | 195 |
| Week of 2026-09-07 | **7–11 Sep** | 171 |
| *(nothing after)* | | |

The week of **14 September doesn't exist**. Because ordering opens ahead of the cutoff, customers will hit an empty menu before that week arrives. Whoever builds menus needs to be ahead, not level.

### 5. ⚠️ Wallet is `public: false` — subscribers may not be able to spend their own credit

`settings.payment_methods_enabled`:

```json
"wallet":   { "admin": true, "public": false },
"link":     { "admin": true, "public": false },
"card":     { "admin": true, "public": true },
"cash":     { "admin": true, "public": true },
"transfer": { "admin": true, "public": true }
```

A customer buys a subscription, gets wallet credit — and **wallet is not offered as a payment method on the customer-facing checkout.** Only an admin (or an admin impersonating them) can pay from it.

If the model is "the dietitian places every order for subscribers", this is correct and nothing needs doing. **If subscribers are meant to order for themselves, this blocks the core product on day one.** This has never been tested end-to-end self-serve. It needs an answer before launch, not a bug report after.

### 6. `min_order` is €10 — check what the banner says once promoted

`settings.min_order = 1000`. WEC-676 (banner reading hardcoded €15) is In Review on `dev`. Verify on production after the merge — telling a customer €15 and enforcing €10 is the kind of thing that generates support mail.

---

## ❓ Unverified — I cannot see these, someone has to look

| Item | Where |
| --- | --- |
| **Viva webhooks registered AND showing Active** | `www.vivapayments.com` → API Access → Webhooks. All three event types pointing at `https://orders.fitpal.gr/api/viva-webhook`. **Reload the page and confirm Active** — on the sandbox one sat Inactive for two months and payments resolved via the return URL alone (WEC-497). |
| **`VIVA_ENV`** | If it exists and reads `dev`, production is silently talking to the **demo** merchant. `resolveEnv()` lets it outrank the Netlify context. The new code warns loudly about this once deployed. |
| `RECONCILE_TRIGGER_TOKEN` scope | Currently Production-only; dev returns 503. Set to "all deploy contexts" if you want it working on dev too. |
| Google Maps / **Places API (New)** + billing | Without it the address field degrades to plain text — checkout still works. Also closes WEC-238, open since May. |
| Supabase Auth **Site URL + Redirect URLs** for `orders.fitpal.gr` (with `/**`) | If wrong, Google login / OTP / password reset fail on the live domain. Probably already right, since login works — confirm rather than assume. |
| `RATE_LIMIT_DISABLED` | Deliberately `TRUE` until the production load test (**WEC-694**). Flip to `FALSE` after. |

---

## The go-live epic nobody has started — WEC-305

All still in Backlog. Ranked by what I'd actually refuse to launch without:

1. **WEC-315** «Go-live: production E2E smoke — the full customer journey» *(Urgent)*. A real order, paid, confirmed, emailed, refunded, on production. Nothing else substitutes.
2. **WEC-312** «Go-live: production data seed — menu, zones, settings, pickup locations, allergies». Item 4 above is this ticket biting already.
3. **WEC-318** «Go-live: backup + restore drill before flip» *(High)*. A backup you have never restored is not a backup — and there is **one shared database** for dev and prod.
4. **WEC-314** «Go-live: monitoring, error tracking, on-call breadcrumbs». Today, if the site breaks at 02:00, nothing tells anyone. Both reconcilers failed silently for over a month — that is this ticket's business case.
5. **WEC-646** «Reconcile scheduler liveness alerting». Must assert **`errors = 0`**, not just that a row exists. A did-it-run check would have stayed green through both failures.
6. **WEC-319** «Go-live: customer support channel — what to do when something breaks».

Lower priority, genuinely deferrable: WEC-308 Lighthouse, WEC-307 OG previews, WEC-316/317 Search Console, WEC-320 visual polish, WEC-391 pen test.

---

## Shortest path to live

1. **Promote `dev` → `main`.** Clears problems 1, 2 and 6, and puts the reconcile fixes in place.
2. **Fix the Θρακομακεδόνες zone** (2 min).
3. **Answer the wallet question** — can subscribers order for themselves or not?
4. **Build the week of 14 September.**
5. **Confirm the Viva webhooks are Active**, then run WEC-315: one real order, paid, refunded, checked on the bank statement.
6. Then the load test (**WEC-694**) → rate limiting back on.

Steps 1–5 are the difference between "deployed" and "safe to send customers to".
