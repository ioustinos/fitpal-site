# State of play — 3 September 2026

Everything below is verified against Linear, the Netlify API and git today. Not from memory.

---

## The headline: production is two days behind dev

| | |
| --- | --- |
| **Live production deploy** | commit `c2baeef`, **1 Sept 13:48** — *"WEC-306: email links point at orders.fitpal.gr"* |
| **Current `dev` HEAD** | `b296a96`, **3 Sept** |
| **Gap** | 10 commits |

**Nothing fixed in the last two days is live.** That includes:

- **WEC-678** «Payment link: leftover equality guard blocks every partial/adjusted amount»
- **WEC-681** «Cancelling at Viva leaves a complete phantom order behind»
- **WEC-668** «Admin order drawer: inline editing» (first cut)
- **WEC-647** «Menu page: redesign the subscription promo banner» — Option 2 built
- **WEC-687** «Admin list filters reset on every navigation»
- **WEC-659** «Menu page: hide «Από…» on single-variant dishes» (part)
- **WEC-679** «Email CTA button renders outside the green pill on mobile»
- **WEC-691** «A first-time customer CANNOT buy a subscription» (template leg)
- **WEC-688** «Impersonation strip: Στόχοι / Πλάνο popup»
- **WEC-673** «Macro indicators: replace with proper SVG icons»
- **WEC-660 / WEC-671 / WEC-659** catalogue migrations *(these ran directly on the DB, so the data IS live — only the files were behind)*

The customer-facing site people are using right now still has the phantom-order bug and the broken payment links. **Promoting `dev` → `main` is the single highest-value action available.**

✅ Verified working on production: 36 functions deployed, `viva-reconcile` and `airtable-reconcile` both registered on `*/5 * * * *` cron, secret scan clean, SSL on `orders.fitpal.gr`.

---

## Where the board actually stands

| State | Count | What it means |
| --- | --- | --- |
| **In Review** | ~60 | Built and pushed. Needs a **tester**, not a developer. This is the bottleneck. |
| **In Progress** | 14 | Genuinely mid-flight |
| **Todo** | 13 | Specced, unstarted |
| **Backlog (go-live)** | 15 | The WEC-305 production epic — started, then stopped |

The board is not short of work that's *done*. It's short of work that's *verified*.

---

# 1 · Needs a decision from you — nothing can move without it

| Ticket | Decision |
| --- | --- |
| **WEC-669** «Questions from the Fitpal team — cash refunds, Mark Delivered, recording cash payments, Airtable gap» | Four operational answers. Not code. |
| **WEC-672** «Subscription renewal — decide the flow, then build it» | What *is* the renewal flow? Auto-renewal is separately blocked on Viva MIT, which we don't have. |
| **WEC-693** «Τιμολόγιο on a plan purchase is collected, validated — and then thrown away» | Which customers with completed plan purchases do we ask again? That data was never written anywhere. |
| **WEC-660** «Dish descriptions → Υλικά» | Screenshot (or dish + rough time) for the recipe-editor error Christos hit. |
| **WEC-647** «Menu page: redesign the subscription promo banner» | English strings for the new copy; approval of the 360px label abbreviations; confirm «Πληρωμή» really is step 4 of the wizard. |
| **WEC-661** «Minimum order becomes a WEEKLY total, not per delivery day» | Real model change — cart, checkout, `submit-order`, and per-zone overrides. Launch week or after? |
| **Checklist item 11** | Tracking on or off at launch? `VITE_TRACKING_ENABLED` is currently **off** in production. |

---

# 2 · Needs testing, not building

~60 tickets are In Review. These are the ones where a failure costs money:

- **WEC-608** «Refund tab computes Total paid from orders.total, not from what was actually paid — customer money becomes unrefundable after an order edit» *(Urgent)*
- **WEC-594** «Admin can't see existing payment links — payment_links has NO admin RLS policy» *(Urgent)*
- **WEC-604** «Item REMOVALS are never logged to the timeline — FK violation, silently swallowed» *(Urgent)*
- **WEC-605** «Percentage voucher discount is frozen at order-time value when an admin edits the order»
- **WEC-645** «viva-reconcile audit rows insert into a non-existent `row_id` column»
- **WEC-678** and **WEC-681** — already with the admins under the dev's test script
- **WEC-691** «A first-time customer CANNOT buy a subscription» — template fixed; **the app leg is unverified** (does the confirmation link still drop the user on the menu with the plan lost?)
- **WEC-680** «Notifications land in Hotmail/Outlook Junk — Supabase Auth sender is noreply@fitpal.gr»
- **WEC-642** «Email redesign 2026-08: integrate agency template pack (11 templates, EL+EN)»
- **WEC-240** «OTP-everywhere auth (epic)» · **WEC-397** «Tracking Phase 1 — Meta Pixel + CAPI + Klaviyo (gated)»

---

# 3 · Needs building

### Unstarted and customer-facing

- **WEC-690** «Admin BCC order emails show the ADMIN's address under Στοιχεία χρέωσης» — ✅ **template leg shipped today** (`dcd70f5`): the billing block now uses `event.customer_email|default:person.email` across order confirmation, payment link, refunded and subscription. Verify the **server** actually puts `customer_email` in the Klaviyo payload — without that the template falls back to the recipient and the bug survives.
- **WEC-659** «Menu page: copy, banner, category order, styling consistency» — partially done
- **WEC-663** «Account: scroll-to-top, period filters, preferences wording, Συνδρομές tab slimming»
- **WEC-689** «Drop «extra σάλτσα» from the dish-comment placeholder + fade the checkout placeholders»
- **WEC-683** «Change-request modal: warn that changes after the cutoff may not be possible»
- **WEC-686** «Σνακ missing from the plan-meals list in 3 places» — 1 of 3 legs done
- **WEC-684** «Admin customer profile: show the diet plan the customer bought» — the panel exists, mount it
- **WEC-682** «Wallet plan purchase: backing out of Viva leaves a phantom Pending purchase»
- **WEC-670** «Delivery zone Θρακομακεδόνες · Φυλή is active but has ZERO time slots» — five-minute fix, silently kills every order from that postcode

### Deferred by decision

- **WEC-685** «Impersonation takes over every tab» — you said don't touch sessions. Workaround emailed to the team.
- **WEC-673** «Macro indicators» — ✅ done today

### Landing site (separate track, blocks nothing)

**WEC-651** images · **WEC-652** copy pass · **WEC-653** CTA routing + contact blocks · **WEC-654** newsletter 10% offer · **WEC-655** footer + FAQ · **WEC-656** B2B events form

---

# 4 · Your four questions

## Emails — yes, a lot, and it's the biggest single cluster

**Live and working:** order confirmation, order refunded, auth emails via Brevo SMTP, Klaviyo on a paid plan.

**Open:**

| Ticket | |
| --- | --- |
| **WEC-666** «Emails: global changes + per-template rewrites» | 8 templates. The big one. Copy rewrites shipped today (`3e6701a`); Blue-Dot items and the renewal email **not** touched. |
| **WEC-690** «Admin BCC emails show the wrong customer address» | Template leg shipped today (`dcd70f5`). **Server leg unverified** — the template falls back to the recipient if `customer_email` isn't in the payload, so the bug survives a template-only fix. |
| **WEC-667** «Two new emails: change-request confirmation + Saturday reminder» | |
| **WEC-216** «Admin notification emails: give admin copies their own subject/content» | Today admin copies are byte-identical to the customer's |
| **WEC-642** «Email redesign 2026-08: agency template pack (11 templates)» | In Review — needs verifying |
| **WEC-643** «Agency follow-ups: missing EN masters, 3 undesigned templates, optimised hero images» | |
| **WEC-531** «Emails: bump the logo across all remaining templates» | |
| **WEC-310** «Go-live: email infrastructure production check (Brevo SMTP + Klaviyo flows)» | Backlog |
| **WEC-613** «Transactional emails — Brevo SMTP + Klaviyo (24h DNS lead time)» | Backlog |

**Never built at all** — these emails simply do not exist: **WEC-289** Order Cancelled · **WEC-291** Wallet Topped Up · **WEC-292** Wallet Credit Granted · **WEC-293** Payment Link Sent · **WEC-294** Payment Reminder · **WEC-295** Order/Cutoff Reminder.

⚠️ **Klaviyo trap:** editing a flow message strips its transactional status, ~24h to re-approve. Every Klaviyo edit above must happen in **one sitting**.

## Cache — mostly done, one loose end

The hard part shipped: **WEC-350** «Edge-cache menu data» and **WEC-387** «Edge-cache dish recipe» are Done. Public read endpoints run `s-maxage` + `stale-while-revalidate` + cache tags; the Viva OAuth token and wallet config are cached in-memory per container; the client memoises in-tab with in-flight dedupe.

**Open: WEC-351** «Instant CDN invalidation via Netlify Cache Tags + admin save hooks» *(In Progress, Low)*. The `purge-menu-cache` function **is deployed to production** — I verified it. What's missing is `NETLIFY_PURGE_API_TOKEN` in the production env.

**Consequence if left:** Nena edits the menu and it takes up to 5 minutes to appear instead of being instant. Annoying, not broken. Worth 10 minutes.

## Grafana / load testing — done, and it found a real bug that got fixed

**WEC-535** «Stress & concurrency testing — k6 load suite (cutoff rush + money-path races)» is **Done**. The suite lives in `load-tests/` and runs from your Mac (the sandbox has no network).

It found two things, both since fixed:

- **WEC-536** «Optimize save-draft — stop rewriting the whole draft tree on every save» — was p95 2.89s at 6 VUs. **Done.**
- **WEC-542** «order_number collisions under load → submit-order 500 "Failed to promote draft"» — **Done.**

**Still open: WEC-388** «Pre-launch: scale Supabase + Netlify for launch traffic» *(Backlog, High)*. Nobody has sized the Supabase plan against expected launch traffic.

⚠️ Standing rule: test results that live only in a Grafana tab are invisible to every other chat. Every run's summary must land in the repo or on a ticket the same day.

## Zustand — nothing structural, one small ticket

No architectural work outstanding. Cart, UI and auth stores are all Zustand, working. Past bugs are closed: **WEC-424** «Zip code not persisted to Zustand cart store» Done, **WEC-409** «Multi-tab cart desync» Done.

**One open: WEC-199** «Cart persistence: 24h TTL + past-day pruning on hydrate» *(In Progress, Medium)*. Without it a stale cart can hydrate with days that have already passed. Worth closing before launch — a customer seeing yesterday's menu in their cart is a support call.

---

# 5 · The production checklist — what's actually left

The cutover **started on 1 Sept and stalled.** Already verified done:

- Cloudflare DNS: `orders` → `fitpal-order.netlify.app`, grey cloud
- Netlify custom domain + SSL (Let's Encrypt, HSTS)
- `main` promoted from 5-month-old scaffolding to the real app
- Domain sweep — CORS allowlist, `PROD_HOST` (production was shipping **noindex**), Terms + Privacy copy
- Email links repointed from the dev site to `orders.fitpal.gr`
- Both scheduled functions registered on production cron

## 🔴 Blocking

1. **`SUPABASE_SERVICE_ROLE_KEY` on the production context.** Set on branch-deploy only. Without it `save-draft`, `menu-quote` and the payment leg of `submit-order` all 502. Same key — dev and prod share the Supabase project. *(I can't verify env vars through the API; confirm in the Netlify UI.)*
2. **Redeploy** — env changes never apply to an existing build. Batch every env change below into this one deploy.
3. **Promote `dev` → `main`** — see the headline.
4. **Viva webhooks registered AND Active** on `www.vivapayments.com`, pointing at `https://orders.fitpal.gr/api/viva-webhook`, all three event types. **Reload the page and confirm each shows Active** — on the sandbox one sat Inactive for two months and payments resolved via the return URL alone (WEC-497).
5. **Real-money smoke test** — order ≥ €10 on your own account, cancel at Viva first, then pay, confirm a `webhook_events` row appears, refund it, check the bank statement tomorrow. **Never** `demo@fitpal.gr`.

## 🟠 Before you let customers in

6. **`RATE_LIMIT_DISABLED` is TRUE on all contexts** — rate limiting is switched off on a public site.
7. **Google Maps / Places** — key is in Netlify; still needs Maps JavaScript API + **Places API (New)** enabled, billing attached, and the referrer restrictions. Not a blocker (address degrades to a text box), and it also closes **WEC-238**, open since May.
8. **Supabase Auth URL configuration** — Site URL + Redirect URLs for `orders.fitpal.gr` with the mandatory `/**`. Without it Google login, OTP and password reset all fail on the new domain.
9. **Legal pages** — **WEC-313** «Go-live: legal pages — Terms, Privacy, Refund policy, Cookie consent». They exist; read them once. Viva's review checks delivery, cancellations and refunds.
10. **Bank transfer info** — the `bank_transfer_info` setting still has a `GR00 0000…` placeholder in some environments. Check it holds the real IBAN.

## 🟡 Decide

11. **Tracking on or off** — `VITE_TRACKING_ENABLED` is off in production. WEC-397 is unverified and GDPR wants a consent banner first.
12. **`NETLIFY_PURGE_API_TOKEN`** — see the cache section.
13. **Google OAuth consent screen branding** — currently reads *"to continue to rhwetztxwjxfstffalwl.supabase.co"*. Works, looks unprofessional. ⚠️ The complete fix is Supabase's paid Custom Domain add-on, which **changes the auth callback** — do not do that this week.

## The go-live epic nobody has touched

**WEC-305** «[EPIC] Pre-launch go-live checklist — production cutover», all children still in **Backlog**:

**WEC-309** Viva production cutover *(Urgent)* · **WEC-315** production E2E smoke *(Urgent)* · **WEC-311** env var sweep + secret rotation · **WEC-312** production data seed *(menu, zones, settings, pickup locations, allergies)* · **WEC-318** backup + restore drill · **WEC-534** reconcile scheduler cutover · **WEC-314** monitoring + error tracking · **WEC-319** support runbook · **WEC-320** visual polish sweep · **WEC-308** Lighthouse SEO · **WEC-307** OG/Twitter previews · **WEC-316/317** Search Console · **WEC-357** OAuth URL swap · **WEC-391** pen test · **WEC-388** scale for launch traffic

Of these, the ones I would not launch without: **WEC-315** (a real end-to-end run on production), **WEC-312** (is the production menu data actually right?), **WEC-318** (a backup you have never restored is not a backup), **WEC-314** (right now, if the site breaks at 2am, nothing tells anyone).

---

# 6 · What I'd do, in order

1. **Promote `dev` → `main`.** Two days of fixes are sitting unused.
2. **Service role key + redeploy.** One deploy carries the promotion, the key, the rate-limit fix and the Maps key.
3. **Verify the Viva webhooks are Active,** then the real-money smoke test.
4. **Clear the In-Review queue,** money tickets first — WEC-608, WEC-594, WEC-604, WEC-691.
5. **WEC-690** (wrong customer address in emails) → then the WEC-666 email rewrite, one Klaviyo sitting.
6. **Answer the seven decisions in §1.** Several of them block a developer today.
7. **WEC-314** monitoring and **WEC-318** backup drill, before you rely on the thing.
