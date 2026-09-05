# Agent onboarding — B2B stores (Company Portals + Reseller Portals)

Paste this into a fresh dev chat on the **Fitpal New Site** project.

---

You are building the **B2B multi-store feature** for the Fitpal ordering platform: Company Portals and Reseller Portals running alongside the main retail store.

This is a large, well-specified programme. **Almost all the design thinking is already done and written down.** Your job is to implement it faithfully, not to redesign it. Where you disagree with a decision, say so and wait — do not quietly do it differently.

## 1. Read these first, in this order

| # | File | Why |
| -- | -- | -- |
| 1 | `docs/enterprise-stores/15-2026-08-decisions.md` | **The most recent decisions. This wins over everything else.** |
| 2 | `docs/b2b-implementation-plan.md` | Phase-by-phase, file-by-file implementation route (Y0–Y8) |
| 3 | `docs/b2b-native-substores-spec.md` | The functional spec |
| 4 | `docs/enterprise-stores/01-architecture.md`, `02-routing.md`, `03-database-schema.md` | The structural design |
| 5 | `CLAUDE.md` (repo root) | Project rules — non-negotiable, summarised below |

⚠️ **Precedence.** `15-2026-08-decisions.md` (25 Aug) explicitly supersedes `11-open-questions.md` and `14-b2b-native-decision-framework.md` wherever they conflict. Documents `00`–`14` were written May–July for a different framing ("enterprise clone stores") and were then parked. **Where a July document and the August decisions disagree, August wins.** Do not reopen those decisions without Ioustinos.

## 2. The decisions that most change the shape of the build

Read them properly in doc 15; this is orientation only.

- **D1 — No menu inheritance.** Each store owns its weekly menus outright. Cloning from the main store is a **manual one-time action**. No resolver, no precedence rules, no propagation job. *"a tree of inherits and overrides (like GonnaOrder does) is dangerous."* Build multi-target cloning ("clone week of 14/09 → Acme, Beta, Gamma") from day one — that's one manual action applied to several targets, not inheritance.
- **D2 — Company Benefit is company-funded and per delivery day.** It must be tracked as its **own amount, never folded into `orders.discount_amount`**, or the company can't be invoiced. Natural home: `child_orders.company_benefit_amount`, summed to the parent — which makes day-level cancellation correct for free.
- **D3 — Company portals are open** (no access gate). Resellers use an allowlist via `store_members`.
- **D4/D5 — Reseller pricing is one global price on the variant** (`dish_variants.reseller_price`), availability global.
- **D6 — Reseller is a store TYPE, not a singleton.** `stores.type ∈ (main | company | reseller)`. The two profiles differ in exactly three ways — price source, access, benefit. **Build one store engine, configure two profiles.**

## 3. The tickets — ONE epic

**Epic: WEC-649 «[EPIC] Company Portals & Reseller Portals — multi-store platform».** Everything hangs off it.

⚠️ **WEC-463 «Epic: B2B Native Sub-Stores ("Y")» is CLOSED as a duplicate.** It was the earlier, more complicated approach — it assumed an inherit-and-override menu model with a resolver and a propagation job, which decision **D1** designs away. Ioustinos: *"the 463 was a more complicated approach."* Its children have all been moved under WEC-649. **Do not work from WEC-463 or from the docs it was built on.**

### 🔴 Phase 0 is a blocker, and it is not B2B work

WEC-649 states it plainly: **fix the money code before building the Company Benefit.**

- **WEC-605** — percentage voucher discount frozen at order-time value when an admin edits the order
- **WEC-608** — refund tab computes "total paid" from `orders.total` rather than what was actually paid
- **WEC-606** — no reliable "paid so far" on the order timeline

The Company Benefit stacks a **second always-on discount** on top of this machinery. Building it first means debugging two problems at once, with real money. **Check the current state of those three before starting anything in Phase 2+.**

### Children (all currently Backlog)

| | |
| --- | --- |
| **WEC-464** | Y0 — Revert safety: feature branch + DB snapshot |
| **WEC-465** | Y1 — DB foundation (stores + per-store tables) |
| **WEC-466** | Y2 — Store resolver + StoreProvider |
| **WEC-467** | Y3 — Central loader + fetchers take storeId *(⚠ touches loader)* |
| **WEC-468** | Y4 — Override read path + per-store weekly menu |
| **WEC-469** | Y5 — Checkout/server per-store *(⚠⚠ core write path)* |
| **WEC-470** | Y6 — Per-store UI (address, banners, invoice, payment) |
| **WEC-471** | Y7 — Admin: store switcher + per-store authoring |
| **WEC-472** | Y8 — First store launch + verification runbook |
| **WEC-538** | Y9 — Employer subsidy: renewable daily voucher per employee (V1.1) |
| **WEC-539** | Y10 — Employer invoicing: consolidated monthly export (backlog) |

Also under WEC-649: **WEC-648** «Reseller pricing: per-variant reseller price + availability flag — DB already applied, admin UI to build» · **WEC-674** «B2B / reseller pricing: the sheet now carries it, `dish_variants.reseller_price` is empty on all 1,359 rows».

### ⚠️ The Y-ticket descriptions predate the August decisions — reconcile before working them

They were written 21 June – 12 July. Their verification checkpoints and file:line references are genuinely useful and worth keeping, but three describe the superseded design:

- **WEC-465 (Y1)** specifies `store_dish_overrides` / `store_variant_overrides` for **menu composition**. Under D1 those survive **only for pricing**. It also predates `child_orders.company_benefit_amount`, `store_members` and `category_discounts`, all of which WEC-649's Phase 1 requires.
- **WEC-468 (Y4)** is titled "Override read path" — the hide/show-dishes-per-store half is designed out by D1. The pricing half stands.
- **WEC-471 (Y7)** needs **multi-target menu cloning** ("clone week of 14/09 → Acme, Beta, Gamma") which D1 makes the central mitigation, plus the per-company monthly benefit report. Neither existed in July.

**Nothing in the Y series mentions the Company Benefit at all — D2 is entirely new work.**

**A dev following WEC-465 as written today would build an override layer that D1 deleted.** Reconcile the tickets against WEC-649's Phase 0–4 first, as your opening task, and get the edits approved before coding.

**Then start at Y0 (WEC-464)** — feature branch `b2b-substores` off `dev` plus a Supabase snapshot before any migration, so revert = abandon branch + restore snapshot. Do not skip it.

## 4. Project rules — from CLAUDE.md, non-negotiable

### Rule 0 — never a naked ticket number
Every time you mention a WEC number in chat, a comment or a report, put a short plain-language description beside it. *"WEC-465 (DB foundation — stores table)"*, never just *"WEC-465"*. Ioustinos does not memorise ticket numbers. He has asked for this many times.

### Linear protocol
Parallel chats cannot talk to each other. **Linear is the single source of truth.**

1. Before starting any work: find or create the ticket, move it to **In Progress**. No ticket = no work.
2. Code-complete → **In Review** + a comment in the same session: files changed, migrations applied, pushed to dev (yes/no), how to test. **"Code-complete" REQUIRES pushed to dev.** Unpushed work does not exist.
3. Before moving to In Review, re-read the spec top to bottom and post a **per-leg checklist** — every named surface (customer UI / server / admin / migration file / email / Airtable) marked ✓ shipped or ✗ descoped-with-reason.
4. Any DB change applied via MCP **also lands as a migration file** in `supabase/migrations/` the same session.
5. **Half-shipped = not shipped.** A feature with only the UI leg is a live bug, not progress.
6. Never report status from ticket states alone — verify against code and git.
7. End every session with `git status` against `origin/dev`.

### Show before execute
Before **any** action in Linear, Supabase, GitHub or Netlify: write out what you plan to do and wait for Ioustinos's explicit approval.

### Git
- **Never run git from the workspace folder** — the FUSE mount breaks lock files. Clone to a fresh `/tmp` path and use `GIT_DIR` / `GIT_WORK_TREE`.
- **Never push unless Ioustinos says so.**
- `git add` specific files — **never `git add -A`**.
- Credentials: `<workspace>/.auto-memory/github_credentials.sh`, variable is `$GITHUB_TOKEN`. Source it in every bash call.

### Verify, don't assume
- Check code and the live DB before asserting anything. A checklist file records what someone *intended*, not what is true.
- A scheduled job writing an audit row is not proof it worked — check the error columns too.
- Duplicate-check Linear before creating a ticket.

## 5. Environment facts that will bite you

- **`main` IS production** → `orders.fitpal.gr`, live since 1 Sept. `dev` → `dev--fitpal-order.netlify.app`. **`main` can lag `dev` badly** — check `git rev-list --count origin/main..origin/dev` before assuming a fix is live.
- **dev and prod share ONE Supabase project** (`rhwetztxwjxfstffalwl`). **There is no staging database.** Every migration is live for customers the moment it runs. This matters enormously for a programme that retrofits `store_id` onto live ordering tables.
- Build command is **`vite build`**, not `tsc -b && vite build`. There are ~24 known pre-existing TS errors; typecheck is available (`npm run typecheck`) but not gating.
- `public/_redirects` is evaluated **before** `netlify.toml`. Both `/api/*` and the SPA fallback live in `_redirects`, in that order.
- Netlify **scheduled functions cannot be invoked by URL** — they return a bare 403. Anything needing HTTP invocation must not declare a `schedule`.

## 6. The known dangers — read these before writing any code

From doc 15, still true:

1. **Cross-tenant leak — highest severity.** Every store-scoped query must go through **one helper that always applies `store_id`**. Never grant client-side admin access until strict RLS is done. A B2B customer seeing another company's orders is the failure that ends the product.
2. **The Company Benefit lands on money code that is currently broken.** **WEC-605** (percentage voucher discounts frozen on admin edit), **WEC-608** (refunds computed from `orders.total` rather than what was actually paid) and **WEC-606** (no reliable "paid so far") must be fixed **before** a second always-on discount is stacked on top. Check their state before starting Y5.
3. **Per-store hostnames break two integrations that hardcode URLs** — the Supabase Auth redirect allowlist, and Viva's success/failure return URLs (configured **per payment source in Viva's dashboard**, not in code). Silent failures if missed, and the cost multiplies per store.
4. **Sequencing.** `store_id` retrofits touch live ordering tables while the retail site is running.

## 7. What has changed since the implementation plan was written

`docs/b2b-implementation-plan.md` is dated **2026-07-12** and already warns that it postdates some things. **More has changed since.** Re-verify against the current code before trusting any file:line reference in it:

- **Production cutover happened (1 Sept).** `main` is live on `orders.fitpal.gr`. The plan was written when dev was effectively the only environment.
- **The Airtable retail mirror (WEC-473) shipped**, and B2B orders are meant to be tagged by store — but note **WEC-697** «removing a dish or a day in admin leaves the record ALIVE in Airtable» is open and unfixed. Don't build store-tagged Airtable pushes on top of a mirror that can't delete.
- **Subscription flow was substantially rebuilt** (WEC-701): there is now a real `/subscription/success/:reference` page and `OrderReturn` redirects wallet purchases to it. Any store-context recovery on the payment return path must account for this.
- **`viva-reconcile` is currently failing on production credentials** — WEC-695. Payment reconciliation is not currently a safety net you can lean on.
- Several money tickets referenced in the plan have moved; check their real state rather than the plan's snapshot.

## 8. First actions — in this order

1. **Read** the five documents in §1, and **WEC-649** in full (its description carries Phases 0–4, the ranked dangers and the sizing).
2. **Reconcile the Y tickets** against WEC-649's Phase 0–4 — see §3. Propose the edits, get them approved, apply them. This is the first deliverable, before any code.
3. **Report back**: your understanding of the build, anything in the docs that contradicts what you find in the code, and anything you think is wrong. **Do not start coding.**
4. **Ask about the four items** doc 15 lists as *"still open (not blocking Phase 1)"*:
   - order numbering — keep the global `FP-YYMMDD-NNNNN` series with a Store column, or per-store prefixes (`ACM-…`)?
   - is the wallet **plan purchase** UI visible on company/reseller stores? (wallet *spending* works either way)
   - Airtable — add a Store field so B2B orders don't mix with retail in ops?
   - are Fitpal-branded transactional emails to corporate employees acceptable for V1?
5. **Check the Phase 0 money tickets** (WEC-605 / WEC-606 / WEC-608) and report their real state — from code and the DB, not from their Linear status.
6. Then propose the Y0 plan and wait for approval.

⚠️ **Do not touch the main retail store's behaviour** without flagging it. The site is live and in its launch window. Every change you make to a shared code path affects real customers ordering real food today.
