# B2B build brief — Company Portals & Reseller Portals

**Paste this into a fresh dev chat on the Fitpal New Site project.**

*Written 2026-09-06. Replaces `AGENT-PROMPT-B2B-substores.md`, which sent the reader to a parked May–July design package.*

---

You are building **Company Portals and Reseller Portals** for the Fitpal ordering platform: corporate storefronts running alongside the live retail store.

**This document and the Linear epic are the whole specification.** You do not need any other document. In particular:

> ⚠️ `docs/enterprise-stores/` (files `00`–`16`) and `docs/b2b-*.md` are an **archive of a superseded design round**. Ioustinos has explicitly voided them. Do not read them, do not cite them, and if something in this brief seems to contradict them, this brief is right. They describe an inherit-and-override menu model that was deliberately deleted from the design.

---

## 1. What it is

Corporate deals get a dedicated storefront with the deal baked in: fixed delivery address, fixed time window, fixed cutoff, its own minimum order, its own menu, and a company-funded per-day benefit. Resellers get the same engine with wholesale pricing and gated access.

**One store engine, two profiles.** A reseller store differs from a company store in exactly three ways:

| | Company | Reseller |
| --- | --- | --- |
| Price source | retail + category discounts | `dish_variants.reseller_price` |
| Access | open — anyone with the URL | admin-selected users only |
| Company Benefit | yes | no |

Everything else — locked address, fixed window, fixed cutoff, own menu, `store_id` on orders, per-store minimum and payment methods — is identical. **Reuse, do not fork.**

## 2. The decisions

An earlier version of this spec recorded several of the assistant's own recommendations as Ioustinos's decisions, and one was materially wrong. Everything was re-audited against his own messages, and the open items were put to him on 6 September.

**As of 2026-09-06 every item below is his. Nothing here is unconfirmed.** If you disagree with something, say so before building it — but do not treat any of it as a guess.

### Decided

* **Routing is path-based** — `orders.fitpal.gr/acme`. Decided 2026-09-06. Not subdomains: each subdomain would need its own Supabase Auth redirect entry and its own Viva payment source with its own return URLs, both by hand, both failing silently. Write the resolver to accept **hostname or path** so a branded subdomain stays cheap later.
* **Menus never inherit.** Each store owns its weekly menus outright; cloning is a manual one-time action. *"whatever happens to the main menu...nothing. clone is a manual action and never automatically inherit from main menu from overides… a tree of inherits and overides (like gonnaOrder does) is dangerous."* No resolver, no precedence rules, no propagation job. The agreed mitigation for the weekly effort is **multi-target cloning**, built from day one.
* ⚠️ **"Its own menu" means availability, not a separate catalogue.** *"their own menu = same dishes just other availability."* The dish catalogue stays **global** — same `dishes`, same `dish_variants`, same names, macros and base prices. What differs per store is only **which dishes appear on which days**, i.e. its own `weekly_menus` + `menu_day_dishes` rows. **There are no store-scoped dishes, no per-store dish overrides, no `store_dish_overrides` or `store_variant_overrides` tables.** If you find yourself designing a resolver for which dish record wins, stop — that is exactly the model that was rejected.
* **Exactly ONE locked delivery address per store.** *"each company has ONE address where food can be delivered."* Not a list. It lives as columns on `stores`, so one-ness is enforced by the schema.
* **Reseller prices are prefilled from retail.** *"just use the same price as the current retails price to prefill all fields."* A one-time idempotent backfill of `reseller_price` from `price` on all 1,371 variants, then the admin edits down. Not a runtime fallback.
* **Not every variant is sold to resellers.** *"the admin user also has a checkbox that enables this variant for resellers, not all variants are available."* `dish_variants.reseller_available`, a global per-variant boolean, **default false** — so the channel is opt-in. Verified live: 0 of 1,371 currently enabled.
* **Per-store cart**, no cross-store cart.
* **Single platform Viva account** in V1; per-store revenue split is back-office reconciliation.
* **The per-day minimum order is judged on the subtotal BEFORE the benefit** — otherwise €2 silently turns a €15 floor into €13.
* **A refund reverses** the matching benefit accrual, computed from `order_payment_summary(order_id)`, never `orders.total`.
* **Company Benefit** — an automatically applied monetary deduction, **per delivery day** (confirmed 2026-09-06), admin-editable per store, **visible in the cart**, with one ordinary voucher allowed on top. **The company reimburses Fitpal**, so it must be its own amount and never folded into `orders.discount_amount`.
* **Company portals are open** — anyone with the URL. He chose this over a recommended email-domain restriction. The locked address is the control.
* **Reseller portals are gated** to admin-selected users, there are **many** of them, and there is **one reseller price for all resellers** on `dish_variants.reseller_price`, with a global `reseller_available` boolean.
* **One login across everything except resellers.**
* Per company: fixed window + cutoff, fixed address, own minimum, own menu, `store_id` on orders, **payment methods freely selectable** (confirmed 2026-09-06), company-scoped vouchers.
* **User accounts work normally, but saved preferences lose to the store's fixed values.** A customer's stored day-preferences must not override the corporate address or window.
* **Category-level discounts** per company — **and the same feature on the retail site**, each with its own values.
* Orders **appear normally in `/admin/orders`**, with the store shown and filterable.

### Deliberately shut doors

Do not open these without asking. Each was considered and rejected:

* Menu inheritance, propagation, or any automatic re-derivation from the main menu.
* Store-scoped dish catalogues or per-store dish/variant override tables.
* Per-reseller price overrides — one price for all resellers.
* Per-reseller variant availability — the flag is global.
* Multiple addresses per store.
* Subdomain routing in V1 (though the resolver should be written so it stays possible).

## 3. The tickets

Epic: **WEC-649** «[EPIC] Company Portals & Reseller Portals — multi-store platform». Eleven children, in dependency order:

| Ticket | | Risk |
| --- | --- | --- |
| **WEC-709** | B2B-1 — DB foundation: stores + per-store tables | Low, additive |
| **WEC-710** | B2B-2 — Store resolution from the URL path + StoreProvider | Low |
| **WEC-711** | B2B-3 — Per-store data loading + cart isolation | ⚠ **central loader** |
| **WEC-712** | B2B-4 — Per-store checkout + server enforcement | ⚠⚠ **core write path** |
| **WEC-713** | B2B-5 — Company Benefit, per delivery day | ⚠⚠ **money** |
| **WEC-714** | B2B-6 — Reseller pricing + access gate | Medium |
| **WEC-715** | B2B-7 — Admin: store CRUD, switcher, Store column on orders | Low |
| **WEC-716** | B2B-8 — Store-to-store menu cloning, multi-target | Low |
| **WEC-717** | B2B-9 — Category discounts, per store and retail | Medium |
| **WEC-718** | B2B-10 — Per-company monthly benefit report | Low |
| **WEC-719** | B2B-11 — First store live: Airtable tagging + runbook | Medium |

Also under the epic, not part of this sequence: **WEC-648** «Reseller pricing per variant — DB done, admin UI to build» and **WEC-674** «B2B/reseller pricing: the sheet carries it, `dish_variants.reseller_price` empty on all 1,359 rows».

**WEC-715 (admin store CRUD) has no dependency beyond WEC-709** and can run in parallel with the customer-side work. Until it ships, a store can only be created by hand-written SQL.

## 4. Rules — from CLAUDE.md, non-negotiable

**Rule 0 — never a naked ticket number.** Every WEC number you mention, in chat or in a comment, carries a short plain-language description beside it. *"WEC-711 (per-store data loading)"*, never *"WEC-711"*. Ioustinos does not memorise ticket numbers.

**Linear protocol.** Parallel chats cannot talk to each other; Linear is the only shared state.

1. Before starting: move the ticket to **In Progress**. No ticket, no work.
2. Code-complete → **In Review** plus a comment the same session: files changed, migration applied yes/no, pushed to dev yes/no, how to test. **"Code-complete" means pushed to `dev`.** Unpushed work does not exist.
3. Before In Review, re-read the spec and post a **per-leg checklist** — customer UI / server / admin / migration / email / Airtable, each ✓ shipped or ✗ descoped-with-reason.
4. Any DB change applied via MCP also lands as a migration file in `supabase/migrations/` the same session.
5. **Half-shipped is not shipped.** A UI whose server leg is missing is a live bug, not progress.
6. Never report status from ticket state — verify against code and the database.

**Git.** Never run git from the workspace folder (the FUSE mount breaks lock files) — clone to a fresh `/tmp` path. `git add` specific files, **never `git add -A`**. Credentials in `<workspace>/.auto-memory/github_credentials.sh`, variable `$GITHUB_TOKEN`, sourced in every bash call.

## 5. Environment facts that will bite you

* **`main` IS production** → `orders.fitpal.gr`, live since 1 Sept. `dev` → `dev--fitpal-order.netlify.app`. **All B2B work goes to `dev` only.** Promotion to production is a separate, deliberate decision by Ioustinos.
* **dev and prod share ONE Supabase project** (`rhwetztxwjxfstffalwl`). **There is no staging database.** Every migration is live for paying customers the moment it runs. This is the single most dangerous fact in this project, and this epic retrofits `store_id` onto live ordering tables. Additive only.
* The site is **one month from a launch that pays for this work**. A retail regression is worse than a delayed B2B feature. Every time.
* Build command is **`vite build`**, not `tsc -b && vite build`. ~24 pre-existing TS errors; typecheck is available (`npm run typecheck`) but not gating. Do not "fix" unrelated ones.
* `public/_redirects` is evaluated **before** `netlify.toml`.
* Netlify **scheduled functions cannot be invoked by URL** — bare 403.
* Money is in **cents**, everywhere.
* Bilingual EL/EN throughout. Greek is the default. Every user-facing string needs both.

## 6. The regression gate

`WEC-711` and everything after it touches code every retail customer runs.

**After each of WEC-711, WEC-712, WEC-713, WEC-714: run the `fitpal-e2e-tests` testBot suite against the MAIN store on dev.** Browse, cart, checkout, cutoffs, all payment methods.

**If it fails, stop. Do not proceed to the next ticket.** Report what broke and wait. Working through a red suite at 3am is how a launch gets lost.

Never place test orders under `demo@fitpal.gr` — use fresh `ioustinos.sarris+e2e-<runId>@gmail.com` aliases.

## 7. Working unattended

Ioustinos may start this and go to sleep. That is fine for everything additive; it is not fine for anything that silently changes what a paying customer experiences.

**Proceed on your own** through: WEC-709 (DB foundation), WEC-710 (store resolution), WEC-711 (per-store loading), WEC-715 (admin store CRUD), WEC-716 (menu cloning). All additive; retail behaviour is unchanged and provably so.

**Stop and wait for him** before: promoting anything to `main`; any non-additive migration; changing retail pricing, cutoff or zone logic; anything he must do by hand (an Airtable field, a Netlify env var, a Viva setting).

**Stop immediately and report** if: the testBot suite fails on main; a migration errors halfway; you find that a ticket's premise is wrong; or you are about to do something you cannot undo.

Leave a comment on every ticket you touch, whatever state you end in. A ticket left In Progress with a clear WIP comment is fine. A ticket left silent is not.

## 8. First actions

1. Read **WEC-649** in full, then **WEC-709**.
2. Say back, in your own words, what you are building and where you think the risk is — before writing code.
3. Flag anything you disagree with — but note that everything in §2 is decided, so disagreement means raising it, not quietly building it differently.
4. Start WEC-709. Move it to In Progress first.

⚠️ **Do not change the retail store's behaviour without flagging it.** The site is live and in its launch window. Every shared code path you touch affects someone ordering real food today.
