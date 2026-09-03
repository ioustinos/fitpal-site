# State of play — 3 September 2026

> ## ⚠️ CORRECTION — first version of this doc was wrong in five places
>
> The production section below was copied out of `LAUNCH-CHECKLIST-2026-09.md` **without checking any of it.** Ioustinos had already done these and told me so, in some cases repeatedly:
>
> | I claimed | Reality |
> | --- | --- |
> | `SUPABASE_SERVICE_ROLE_KEY` missing on production | **Set.** Done when first asked. |
> | `NETLIFY_PURGE_API_TOKEN` missing | **Set.** Asked ~6 times, answered every time. |
> | `RATE_LIMIT_DISABLED=TRUE` is an oversight | **Deliberate.** Rate limiting stays off until the production load test has run. Turning it on first would block the test. |
> | Load/stress testing "done" | **Dev only, a month ago.** A production run has never happened. See §4. |
> | WEC-199 cart TTL still open | **Shipped months ago.** Verified in code; ticket closed today with evidence. |
>
> Lesson recorded: a checklist file is a record of what someone *intended* to do, not evidence of state. Verify or say "unverified".

Everything below is verified against Linear, the database, the Netlify API and git today — or explicitly marked unverified.

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

## Cache — done. Nothing to do.

**WEC-350** «Edge-cache menu data» and **WEC-387** «Edge-cache dish recipe» are Done. Public read endpoints run `s-maxage` + `stale-while-revalidate` + cache tags; the Viva OAuth token and wallet config are cached in-memory per container; the client memoises in-tab with in-flight dedupe.

**WEC-351** «Instant CDN invalidation via Netlify Cache Tags + admin save hooks»: the `purge-menu-cache` function is deployed to production (verified via the Netlify API) and **`NETLIFY_PURGE_API_TOKEN` is set** — Ioustinos did this a while ago. I have listed it as outstanding several times; that was me re-reading the checklist instead of asking once and recording the answer.

**Only thing worth doing:** confirm a real admin menu edit shows up instantly on `orders.fitpal.gr`, then close WEC-351. That is a five-minute check by whoever next edits the menu, not a dev task.

## Load testing — the DEV run is done. The PRODUCTION run has never happened.

I called this "done" and that was wrong. **WEC-535** «Stress & concurrency testing — k6 load suite» is closed because the *suite was built and run on dev, roughly a month ago*. Production has never been load-tested.

What the dev run bought us — two real bugs, both fixed:

- **WEC-536** «Optimize save-draft — stop rewriting the whole draft tree on every save» — was p95 2.89s at 6 VUs. Done.
- **WEC-542** «order_number collisions under load → submit-order 500 "Failed to promote draft"» — Done.

**A production run is still needed, and it is the reason `RATE_LIMIT_DISABLED` is TRUE.** Ioustinos's decision: rate limiting stays off until the prod load test has run, because turning it on first would throttle the test itself. So the order is fixed:

1. Run the k6 suite against `orders.fitpal.gr` (from Ioustinos's Mac — the sandbox has no network)
2. Read the results, fix whatever it surfaces
3. **Then** set `RATE_LIMIT_DISABLED=FALSE` and redeploy

⚠️ Until step 3, the public site has no rate limiting. That is a known, accepted, temporary position — not an oversight. It should not sit there for weeks.

⚠️ Results must land in the repo or on a ticket the same day. A Grafana tab is invisible to every other chat.

**Also still open: WEC-388** «Pre-launch: scale Supabase + Netlify for launch traffic» *(Backlog, High)* — nobody has sized the Supabase plan against expected launch traffic. The prod load test is what tells you whether it needs sizing up.

## Zustand — nothing open

Cart, UI and auth stores are all Zustand and working. Everything is closed: **WEC-424** «Zip code not persisted to Zustand cart store», **WEC-409** «Multi-tab cart desync», and **WEC-199** «Cart persistence: 24h TTL + past-day pruning» — which I wrongly listed as open. It shipped months ago; closed today with code evidence:

- `TTL_MS = 24h` and `reconcileCartAgeAndDates()` in `src/store/useCartStore.ts:493-575`
- Called from `src/pages/MenuPage.tsx:79` on hydrate, before the menu reconcile
- Past-day pruning uses a **local**-date compare, deliberately not UTC (off-by-one near midnight for every Greek customer)
- Has since absorbed **WEC-591** — a persisted voucher is dropped when reconciliation empties the cart, so an old code can't silently discount a fresh order

---

# 5 · The production checklist — what's actually left

The cutover **started on 1 Sept and stalled.** Already verified done:

- Cloudflare DNS: `orders` → `fitpal-order.netlify.app`, grey cloud
- Netlify custom domain + SSL (Let's Encrypt, HSTS)
- `main` promoted from 5-month-old scaffolding to the real app
- Domain sweep — CORS allowlist, `PROD_HOST` (production was shipping **noindex**), Terms + Privacy copy
- Email links repointed from the dev site to `orders.fitpal.gr`
- Both scheduled functions registered on production cron

## ✅ Already done — do not ask again

| Item | |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` on production | Set. Checkout works. |
| `NETLIFY_PURGE_API_TOKEN` | Set. |
| `RATE_LIMIT_DISABLED = TRUE` | **Deliberate**, pending the production load test. Not an oversight. |
| Both reconcile crons registered on production | Verified via the Netlify API AND against `reconcile_runs` — firing on a clean 5-minute cadence right now |

## 🔴 Actually blocking

1. **Promote `dev` → `main`.** Production is behind. See the headline.
2. **Viva webhooks registered AND Active** on `www.vivapayments.com`, pointing at `https://orders.fitpal.gr/api/viva-webhook`, all three event types. **Reload the page and confirm each shows Active** — on the sandbox one sat Inactive for two months and payments resolved via the return URL alone (WEC-497). *Unverified from here — I cannot see the Viva dashboard.*
3. **Real-money smoke test** — order ≥ €10 on your own account, cancel at Viva first, then pay, confirm a `webhook_events` row appears, refund it, check the bank statement tomorrow. **Never** `demo@fitpal.gr`.
4. **Production load test**, then rate limiting on. See §4.

## 🟠 Unverified from here — someone has to look

5. **Google Maps / Places** — Maps JavaScript API + **Places API (New)** enabled, billing attached, referrer restrictions. Not a blocker (the address field degrades to plain text). Also closes **WEC-238**, open since May.
6. **Supabase Auth URL configuration** — Site URL + Redirect URLs for `orders.fitpal.gr` with the mandatory `/**`. If this were wrong, Google login and OTP would be failing on the live domain — so it is probably already right. Confirm rather than assume.
7. **Legal pages** — **WEC-313** «Go-live: legal pages — Terms, Privacy, Refund policy, Cookie consent». They exist and the domain was fixed. Read them once; Viva's review checks delivery, cancellations and refunds.
8. **Bank transfer info** — check the `bank_transfer_info` setting holds a real IBAN, not the `GR00 0000…` placeholder.

## 🟡 Genuinely open decisions

9. **Tracking on or off** — `VITE_TRACKING_ENABLED` is off in production. **WEC-397** «Tracking Phase 1 — Meta Pixel + CAPI + Klaviyo (gated)» is In Review and unverified, and GDPR wants the consent banner first.
10. **Google OAuth consent screen branding** — reads *"to continue to rhwetztxwjxfstffalwl.supabase.co"*. Works, looks unprofessional. ⚠️ The complete fix is Supabase's paid Custom Domain add-on, which **changes the auth callback** — not this week.

## The go-live epic nobody has touched

**WEC-305** «[EPIC] Pre-launch go-live checklist — production cutover», all children still in **Backlog**:

**WEC-309** Viva production cutover *(Urgent)* · **WEC-315** production E2E smoke *(Urgent)* · **WEC-311** env var sweep + secret rotation · **WEC-312** production data seed *(menu, zones, settings, pickup locations, allergies)* · **WEC-318** backup + restore drill · **WEC-534** reconcile scheduler cutover · **WEC-314** monitoring + error tracking · **WEC-319** support runbook · **WEC-320** visual polish sweep · **WEC-308** Lighthouse SEO · **WEC-307** OG/Twitter previews · **WEC-316/317** Search Console · **WEC-357** OAuth URL swap · **WEC-391** pen test · **WEC-388** scale for launch traffic

Of these, the ones I would not launch without: **WEC-315** (a real end-to-end run on production), **WEC-312** (is the production menu data actually right?), **WEC-318** (a backup you have never restored is not a backup), **WEC-314** (right now, if the site breaks at 2am, nothing tells anyone).

---

# 6 · Reconcile: n8n or Netlify cron? — Netlify is working, keep n8n as the net

**Measured today, not assumed.** `reconcile_runs` over the last 48h, `provider='viva'`:

| | |
| --- | --- |
| Runs in 24h | 215 (viva) + 353 (airtable) |
| Latest run | 1m38s before I checked |
| Cadence | clean 5-minute, on the boundary — `:35:10`, `:30:20`, `:25:10`, `:20:13`… |
| Intervals in 48h | 494 |
| Normal (250–350s) | 418 |
| **Gaps over 6.5 min** | **70** |
| **Worst gap** | **25.1 minutes** (ended 2 Sept 16:50) |

Two conclusions:

1. **Netlify's scheduler IS firing on production.** The 5-minute boundary cadence is Netlify's `*/5`, not n8n's 15-minute interval. The **WEC-485** failure (scheduler stopped firing on this site around 23 June, never root-caused) is not currently happening.
2. **But it skips.** 70 misses in 48h, worst 25 minutes. That is ~85% reliable. For the *third* gate of payment reconciliation — the thing that catches a customer who paid but whose order still says pending — 85% is not something to lean on alone.

### So: don't choose. Keep both.

**Recommendation — point the n8n workflow at production and leave it running.**

- It costs nothing. `viva-reconcile` is idempotent — `markPaid` is a guarded `UPDATE ... WHERE payment_status = 'pending'`, so concurrent runs from two triggers produce exactly one row change. Overlapping triggers are noisy in `reconcile_runs`, never harmful.
- It covers Netlify's 25-minute holes.
- It survives the WEC-485 failure mode recurring, which nobody ever explained and therefore nobody can rule out.

**What to change in n8n:** the workflow currently hits the **dev** URLs. Both HTTP nodes in `Fitpal DEV — Reconcile (every 15 min) FIXED.json` point at:

```
https://dev--fitpal-order.netlify.app/.netlify/functions/airtable-reconcile
https://dev--fitpal-order.netlify.app/.netlify/functions/viva-reconcile
```

Either duplicate the workflow as **"Fitpal PROD — Reconcile"** with `https://orders.fitpal.gr/api/...`, or edit the two URLs in place. **Duplicating is safer** — history lesson from WEC-532: a manual edit of that workflow left `viva-reconcile` untriggered for **17 days** (23 June – 10 July) and nobody noticed.

**Then the real gap: nothing alerts if BOTH stop.** That is **WEC-646** «Reconcile scheduler idle on dev since 2026-07-29 — add liveness alerting before go-live» and **WEC-534** «Go-live: reconcile scheduler cutover». A liveness check is one query — *"no `reconcile_runs` row in the last 20 minutes → shout"*. Without it, the safety net can fail silently for weeks, which has already happened twice.

---

# 7 · What I'd do, in order

1. **Promote `dev` → `main`.** Days of fixes sitting unused, including the phantom-order and payment-link fixes.
2. **Duplicate the n8n workflow to a PROD version** and leave both triggers running.
3. **Verify the Viva webhooks are Active,** then the real-money smoke test.
4. **Run the k6 suite against production** → fix what it finds → then turn rate limiting on.
5. **Clear the In-Review queue,** money tickets first — WEC-608, WEC-594, WEC-604, WEC-691.
6. **Answer the decisions in §1.** Several block a developer today.
7. **WEC-646 liveness alerting**, **WEC-314** monitoring, **WEC-318** backup drill — before you rely on any of this.
