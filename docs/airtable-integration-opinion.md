# Fitpal × Airtable integration — design opinion

> Written 2026-05-25 (autonomous session, Fil). This is an **opinion / design memo**, not an implementation. Nothing was built. It reflects what I could inspect from Linear, Supabase and Netlify; the one thing I could **not** see is the Airtable base itself (no Airtable connector is connected). Where I'm guessing, I say so.

## The three systems in play

1. **New ordering platform** — `fitpal-order` (Supabase) + `order.fitpal.gr` after cutover. Customer site **plus** a full `/admin` we built (dishes, menus, orders, zones, settings, wallets, vouchers, users). 40 public tables. This is the modern, actively-maintained system.
2. **Fitpal Dev Admin** — `admin.fitpal.gr` (Netlify site `sweet-kringle-acf671`). A *separate, pre-existing* internal admin app. Its RBAC lives in the `admin` schema of the **same** `fitpal-order` database (`admin.admin_users`, `admin.page_permissions`) — so it reads/writes largely the **same operational data** as our new `/admin`, through a different UI. (Worth confirming it points at this DB and not another, but the evidence says yes.)
3. **Airtable** — described as the team's "main workflow at the moment." I can't see its contents. In a meal-prep / delivery business, Airtable almost always holds some mix of: kitchen/production planning, procurement & inventory, delivery routing / driver sheets, recipe costing & margins, staff scheduling, customer CRM / leads, content calendar.

## The core problem

The same nouns — **orders, menu, customers** — can live in all three places. That invites double-entry, drift, and "which number is right?" arguments. The whole design should follow one rule:

> **One source of truth per data domain. Everything else is a read-only mirror, synced one-way.**

Bi-directional sync between Airtable and the DB is the thing to avoid — it feels convenient and becomes a permanent reconciliation tax.

## Recommended source-of-truth split

| Domain | Source of truth | Airtable's role |
|---|---|---|
| Orders / child-orders / items | **Platform DB** | read-only mirror (if wanted) |
| Payments / wallets / vouchers | **Platform DB** | none / read-only |
| Customer accounts & profiles | **Supabase Auth + `profiles`** | read-only CRM mirror at most |
| Menu catalogue (dishes, variants, macros, recipes, weekly menus) | **Pick ONE** (see below) | depends on choice |
| Production planning, procurement, inventory, delivery routing, staffing, recipe costing | **Airtable** | stays — source of truth |
| Leads / marketing | one home (platform has a `leads` table) — pick one | one-way sync |

## What's genuinely redundant

- **The biggest redundancy is two admin apps over one database**: `admin.fitpal.gr` (Fitpal Dev Admin) and the new platform `/admin` both sit on the `fitpal-order` data model (the order hierarchy was deliberately built to match). Running two admins is a standing cost — duplicate features, duplicate bugs, double the training, and a real chance of two people editing the same order two ways. **Long-term recommendation: consolidate onto the new platform `/admin` and retire `admin.fitpal.gr`**, *unless* the old admin does specific things the new one doesn't yet (list those, port the few that matter, then sunset). This is the single highest-leverage cleanup.
- **Any manual re-typing of orders into Airtable** becomes redundant the moment orders are pushed automatically (below). That's usually the most painful daily chore to kill.

## What we might build (bring into / connect to the platform)

Ordered by value-to-effort:

1. **Daily production aggregate → Airtable (highest value).** The platform already has every `order_item` with quantities + macros, keyed by delivery date. A scheduled function can, per delivery date, sum `dish × variant → quantity` and push a "today's prep list" into an Airtable base. This turns order data into the kitchen's cook-list automatically — no manual counting. This is the integration I'd build first.
2. **Order → Airtable push (event-driven).** On order confirm, upsert a summarized row (order number, customer, day, items, total, status) into an Airtable "Orders" view so ops see live demand without leaving Airtable. Idempotent upsert keyed by `order_number`.
3. **Airtable → platform menu import (only if the kitchen authors the menu in Airtable today).** We already have a CSV menu importer (WEC-242/243). Pointing it at the Airtable API instead of a CSV is the same shape of work. Keep it **one-way** (Airtable drafts → platform publishes).

## What should stay on Airtable

Don't migrate things just to migrate them. Procurement, inventory, supplier management, delivery routing/driver sheets, staff scheduling, recipe costing/margins, and the content/marketing calendar are genuine ops workflows the platform doesn't model and shouldn't try to (at least pre-launch). Airtable is good at exactly this kind of flexible, human-edited operational work. Leave it.

## Integration mechanics I'd recommend

- **Direction:** overwhelmingly **platform → Airtable** (push), one-way, idempotent (upsert by a stable key like `order_number` or `delivery_date`).
- **Mechanism:** Netlify function(s) + Airtable REST API with a scoped Personal Access Token in Netlify env. Two triggers: (a) event-driven on order confirm, (b) a scheduled per-day aggregate — reusing the patterns we already run (e.g. the `viva-reconcile` scheduled function, service-role DB access).
- **Discipline:** never let Airtable edits silently flow back into orders/menu. If ops need to change an order, they do it in `/admin` (which writes the DB **and** the `admin_change_log` audit trail) — not in Airtable. Airtable mirrors; the platform governs.
- **Secrets:** Airtable PAT in Netlify, scoped to the one base. Same secure-exchange pattern we use for other creds.

## What I need from you to turn this into a concrete plan

1. **Airtable base structure** — table + field names (a share link, export, or screenshots). That's the missing piece for exact field mappings.
2. **`admin.fitpal.gr` scope** — what does it do that the new `/admin` doesn't? That list decides whether (and when) we can retire it.
3. **Where is the menu authored today** — platform or Airtable? That single answer sets the menu-sync direction.

## My one-line opinion

Make the **platform the system of record for orders, menu, customers and money**; make **Airtable the system of record for kitchen/ops**; connect them with a **one-way daily production push** from platform → Airtable; and put **retiring the second admin (`admin.fitpal.gr`)** on the roadmap so you're not maintaining two control panels over one database.
