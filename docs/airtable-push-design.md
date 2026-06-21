# New Platform → Airtable — push design (platform → Airtable direct)

> Written 2026-06-16 (Fil). Decision baseline: B2B stays on GonnaOrder, Airtable persists, the new platform pushes **retail** orders into Airtable **directly** (no n8n). The new platform is "just another store source." Schema below is from the Admin Dev repo (`fitpal-admin` CLAUDE.md + Netlify functions) — the live tables the ops suite reads. Items marked **⚠ confirm live** need a real Airtable read or your confirmation.

## Principle
The retail push must produce Airtable rows **shaped exactly like the existing order rows**, tagged with a retail `Store Id`, so the Admin Dev suite (kitchen, packages, stickers, changes, timelines, order detail) treats retail identically to any GonnaOrder store — **zero changes to that app.**

## Target Airtable schema (base `appQkyoF5gnDpSW9C`)
- **Orders:** `Customer Email`, `Admin Order ID`, `Customer Name`, `Order Placement Time`, `Total Order Value`, `Total Order Price (After Discount)` (stores a **ratio**, 0.2 = 20%), `Child/Day Orders` (link)
- **Child/Day Orders:** `Order Wish Time` (datetime), `Address`, `Post Code`, `Total Quantity`, `Total Θερμίδες/Υδατάνθρακες/Πρωτεϊνη/Λιπαρά`, `Order Items` (link)
- **Order Items:** `Item Name`, `Item Variant`, `Quantity`, `Item Price`, `Θερμίδες/Υδατάνθρακες/Πρωτεϊνη/Λιπαρά`, `Item Comment`, `Κρύα / Ζεστή` (lookup), `Order Wish Time (from Child/Day Order ID)` (lookup), `Full Ingredients Description`, `Item Long Description`, `Store Id`, `Customer Name`, `Category`
- **Stores:** `Store Id`, `Store Name`, `Cutoff`, `is Company`
- **(No separate Customers table** — `getCustomers` derives unique customers from Orders by email. So we write nothing extra; customers fall out of Orders.)

## Field mapping (platform DB → Airtable)

### Orders
| Airtable | ← Platform | Notes |
|---|---|---|
| `Admin Order ID` | `orders.order_number` | **also the idempotency merge key** (⚠ confirm this field is safe to use as the stable key, or add `Platform Order Number`) |
| `Customer Email` | `orders.customer_email` | |
| `Customer Name` | `orders.customer_name` | |
| `Order Placement Time` | `orders.created_at` | |
| `Total Order Value` | `orders.subtotal` | pre-discount |
| `Total Order Price (After Discount)` | `orders.total` | **RESOLVED:** push the real final total (not a ratio). Admin has a filter that flags Total-Order-Price vs calculated-price mismatches for recheck. |
| `Child/Day Orders` | link → child records | set via linked-record IDs |

**`Admin Order ID` ← `orders.order_number`** — RESOLVED: GonnaOrder's Admin Order ID is a human-readable token id; we put the new platform's readable order id here. Doubles as the **idempotency merge key**.

### Child/Day Orders
| Airtable | ← Platform | Notes |
|---|---|---|
| `Order Wish Time` | `child_orders.delivery_date` + `time_from` | combine to one ISO datetime (⚠ confirm n8n's exact format so retail matches) |
| `Address` | `child_orders.address_street` (+ area/floor) | |
| `Post Code` | `child_orders.address_zip` | |
| `Total Quantity`, `Total Θερμίδες/…` | **probably ROLLUPS — do NOT write** | ⚠ if these are rollup/formula fields they auto-compute from linked items. Writing them errors. Live read settles this. |
| `Order Items` | link → item records | |

### Order Items
| Airtable | ← Platform | Notes |
|---|---|---|
| `Item Name` | `order_items.name_el` | Greek (ops UI is Greek) |
| `Item Variant` | `order_items.variant_label_el` | |
| `Quantity` | `order_items.quantity` | |
| `Item Price` | `order_items.unit_price` | ⚠ unit vs total — confirm |
| `Θερμίδες/Υδατάνθρακες/Πρωτεϊνη/Λιπαρά` | `order_items.calories/carbs/protein/fat` | |
| `Item Comment` | `order_items.comment` | |
| `Store Id` | retail constant (no Stores row) | **RESOLVED:** no retail Stores row; `Cutoff` is kitchen-ops-only. Minor open item: confirm whether retail items carry a constant Store Id for store-filtered views, or none. |
| `Customer Name` | `orders.customer_name` | denormalised for kitchen |
| **`Menu Reference` (link)** | dish `external_id` → Menu Reference record | **RESOLVED + the key mechanism.** `Κρύα / Ζεστή`, `Category`, `Full Ingredients Description`, `Item Long Description` are all **lookups off Menu Reference**. Link the Order Item to Menu Reference by external id and they ALL resolve automatically. |
| `Κρύα / Ζεστή`, `Category`, `Full Ingredients Description`, `Item Long Description` | auto (lookups) | resolve via the Menu Reference link above — do NOT write directly |
| `Order Wish Time (from Child/Day Order ID)` | auto | lookup resolves once item is linked to its child order |

## Write sequence (per order, idempotent)
Airtable upsert = `PATCH` with `performUpsert.fieldsToMergeOn`. Per table, keyed so re-runs update in place:
1. Upsert **Orders** (merge on `Admin Order ID` = order_number) → record id.
2. Upsert each **Child/Day Order** (merge on a stable child key) with link to the Orders id.
3. Upsert each **Order Item** (merge on a stable item key) with link to its Child/Day id.
4. Ensure parent link fields (`Child/Day Orders`, `Order Items`) are set.

Stable keys needed (idempotency): order_number (Orders), order_number+delivery_date (Child), order_item uuid (Items). If existing fields can't serve as merge keys, add small text key fields (see asks).

## Reliability (event push + reconcile + divergence flag)
- **Event push (latency):** `submit-order.ts`, after the DB commit (and after `markPaid` for card/link), triggers the push **decoupled** — never blocks the customer checkout response. Airtable being slow/down must not affect checkout.
- **Reconcile (safety net):** scheduled `airtable-reconcile.ts` (cron 5–10 min, same shape as `viva-reconcile`). Dirty-flag model: `orders.airtable_dirty` (default true) + `airtable_synced_at`; a DB trigger flips dirty on any order/child/item write. Reconcile re-pushes dirty rows, stamps, clears. Catches dropped pushes **and** `/admin` edits (status changes, cancellations) for free.
- **Divergence flag (your idea):** on reconcile, if the Airtable row's key fields differ from what we last pushed (someone edited in Airtable), set a `needs_review` flag / log instead of silently overwriting. Can be v2.
- **Secrets:** scoped Airtable PAT in Netlify env, base `appQkyoF5gnDpSW9C`. Same secure pattern as Viva.

## Resolved (your answers 2026-06-16)
1. **Hot/Cold → Menu Reference link.** Not a field-add. `Κρύα / Ζεστή` (+ Category, ingredients, long desc) are lookups off **Menu Reference**, linked by the **external id** GonnaOrder items carry. → **The real work is platform-side: every dish gets an `external_id` that matches its Menu Reference record**, and the push links each Order Item to Menu Reference by it.
2. **No retail Stores row.** `Cutoff` is kitchen-ops only — ignore.
3. **`Admin Order ID` ← `order_number`** (readable id), also the merge key. No new field needed.
4. **`Total Order Price (After Discount)` ← `orders.total`** (real final value). No ratio.

## Still open (small)
- **Child/Day `Total *` rollups:** assume `Total Quantity` / `Total Θερμίδες…` are Airtable rollups (auto-computed from linked items) → don't write them. Verify against one live record / the n8n script at build time; trivial to flip if they're plain fields.
- **Retail `Store Id` value:** do retail Order Items carry a constant Store Id (so store-filtered ops views include them), or leave it blank? One-line answer when convenient — not a blocker.

## New platform-side dependency this introduces
The Menu Reference link means **the new platform must store an `external_id` per dish keyed to Airtable's Menu Reference table.** Open sub-questions for the schema sub-issue: is the external id at **dish** or **variant** level? Are all retail dishes already present in Menu Reference (same physical menu as GonnaOrder)? What's the matching key field? This is the one genuinely new piece of work and gets its own sub-issue.

## What does NOT change
- B2B / GonnaOrder → n8n → Airtable: untouched.
- Admin Dev suite (`admin.fitpal.gr`): zero changes.

---

## Authoritative schema (from live `getSchema` meta pull, 2026-06-16) — supersedes inferences above

Base `appQkyoF5gnDpSW9C` = "Fitpal", 15 tables. The ones the push touches:

### Order Items (`tblxu7U6sAI8jAJKK`) — primary `uuid`
- **Write:** `uuid` (= `order_items.id`, merge key), `Item Name` (`name_el`), `Item Variant` (`variant_label_el`), `Item Fitpal ID` (= variant code), `Item Comment`, `Item Long Description`, `Quantity`, `Item Price`, `Items Full Price`, `Category`.
- **Links (set by us):** `Item` → **Μenu Reference** (match on variant code `302-1`), `Child/Day Order ID` → Child/Day, `Customer` → Customers.
- **Do NOT write (computed):** `Θερμίδες/Υδατάνθρακες/Πρωτεϊνη/Λιπαρά`, `Κρύα / Ζεστή`, `Full Ingredients Description`, `Customer Name`, `Customer Phone`, `Store Id`, `Admin Order ID`, `Order Wish Time (...)` — all lookups off the `Item`/`Child` links.

### Orders (`tblFP0xONtQSJxPd9`) — primary `Order Id`
- **Write:** `Order Id` (= order uuid, merge key), `Admin Order ID` (= `order_number`, readable), `Customer Name`, `Customer Phone` (phoneNumber), `Customer Email`, `Order Placement Time`, `Total Order Value` (`subtotal`), `Total Order Price (After Discount)` (`total`), `voucher`, `Order Comments`, `Paid` (singleSelect — map payment status), `Payment Method` (singleSelect), `Store Id` (number), `Μαχαιροπίρουνα` (cutlery, checkbox), `Τιμολόγιο/Απόδειξη` (invoice, singleSelect).
- **Links:** `Customer` → Customers, `Store` → Stores (optional), `Child/Day Orders`, `Payment Links`.
- **Leave alone:** `PAID - Fitpal Check`, `Discount`, all `*Chris Payments* TEMP`, GMV/formula helpers — financial-admin owned.

### Child/Day Orders (`tbljfcHAN40McNOIV`) — primary `Child/Day Order Id`
- **Write:** `Child/Day Order Id` (= `<orderUuid>#<wishTime>`, merge key), `Order Wish Time` (delivery_date+time_from ISO), `Address`, `Post Code`, `City`, `Floor`, `Doorbell`.
- **Links:** `Parent Order Id` → Orders, `Customer` → Customers, `Order Items`.
- **Do NOT write (rollups):** `Total Quantity`, `Total Θερμίδες/…`, `Daily Price`, etc.
- **Ops-owned, never touch:** `Driver`, `Pickup Time`, `Stop Number`, `ΕΤΑ` (delivery routing).

### Μenu Reference (`tblQiMnTsaZu5TWCQ`) — primary `Κωδικός`
- Variant-level menu (`Κωδικός` = `302-1`), carries macros, `Κρύα / Ζεστή`, `Κατηγορία`, `Περιγραφή`, `Ποσότητα`. The `Item` link on Order Items matches on `Κωδικός`. **Read-only for us** (it's the menu master). ⚠ verify a row's `Κωδικός` is variant-level (`302-1`) not dish-level (`302`).

### Customers (`tble7O64X0f6Om6Eo`) — primary `id` (autoNumber)
- Rich CRM (57 fields). Match key = **`Phone Number`** (phoneNumber). Has links back to `Orders`, `Child/Day Orders`, `Order Items`.
- **Push owns the link, not the CRM content:** find-or-create by `Phone Number`, write `Name` / `Phone Number` / `Email` (+ `Source`) on create only, then set the `Customer` link on the three order tables. Never overwrite CRM fields (dietician, notes, macros, allergies) on existing customers.

## Customer linking algorithm (replaces the flaky Airtable automation)
1. Resolve order phone → look up Customers where `Phone Number` matches.
2. Found → use its record id. Not found → create Customer (Name, Phone Number, Email, Source).
3. Set `Customer` link on Orders + each Child/Day + each Order Item to that record id, in our push (atomic — no automation, no race).
4. Concurrency: guard against two simultaneous new-customer orders creating duplicates (serialize per phone, or post-create dedupe sweep).

## Resolved: dedicated `external_id` field (decision 2026-06-21)
Add `external_id` (text) to `dishes` + `dish_variants`, **backfill `external_id = id`** (real menu ids already are the codes `302` / `302-1`). `id` stays auto-generated/untouched — internal refs keep using it. `external_id` is **matching-only** (links Order Items → Μenu Reference `Κωδικός`) and editable in `/admin/dishes` for controlled new-dish codes. Push resolves it via join `order_items.variant_id → dish_variants.external_id` (they can differ for new dishes). Seed dishes (`a06-v2`) are demo data. Tracked in WEC-474.
