# Fitpal — Task Board

_Living tracker. Updated as we progress. Last update: 2026-09-04._

Legend: ✅ Done · 🔵 In Review · 🟡 In Progress (this chat) · ⬜ Open · 🚫 Won't do · 👤 On Ioustinos

---

## ✅ Done today (dev, verified)

- ✅ **WEC-701** [EPIC] Subscription purchase → real success page, bank email, Subscribe tracking, invoice persist. testBot 5/5.
- ✅ **WEC-700** bank-transfer success popup → real page + conversion tracking.
- ✅ **WEC-693** Τιμολόγιο/ΑΦΜ persisted on wallet_plans + admin + email.
- ✅ **WEC-698** admin can edit invoice name/ΑΦΜ + invoice shown on all customer surfaces.
- ✅ **WEC-697** (urgent) Airtable delete-reconcile — kitchen stops cooking removed dishes. Live-verified; `AIRTABLE_DELETE_ENABLED=true` set.
- ✅ **WEC-699** subscription wizard: mobile ΤΚ/meals feedback + Friday hand-over copy.
- ✅ **WEC-702** plan characteristics panel on the account Συνδρομές tab (shared, bilingual) + footer copy.

## 🔵 In Review (shipped/verified, pending final sign-off / external leg)

- 🔵 **WEC-586** euro sign AFTER the amount (`13.80 €`) — app done; email 04/06 need the Klaviyo paste.
- 🔵 **WEC-690** admin BCC emails show admin's address — code done (server + templates); needs Klaviyo paste.
- 🔵 **WEC-569** payment link for ANY order + custom amounts — verified already working; only paid-order extra-charge unbuilt (needs decision).

## 🟡 In Progress (this chat)

- 🟡 **WEC-703** vouchers for subscription purchases + admin scope selector — **code-complete, awaiting push to dev.** Migration `applies_to` (§1) + `wallet_plans.voucher_id/voucher_amount_cents` (§1b) applied. Wizard voucher UI, admin Applies-to selector (hides categories for subs), success page + 05 email code/discount, atomic redeem + refund/abandon un-redeem all done. tsc 16=baseline.

---

## ⬜ Open — actionable dev

### 🔴 Urgent
- 👤 **WEC-695** Viva prod OAuth `invalid_client` — creds added by Ioustinos; ships on next prod promotion. Nothing dev-side.
- ⬜ **WEC-680** notifications land in Hotmail/Outlook Junk — switch Supabase Auth sender `noreply@`→`info@fitpal.gr` (likely dashboard).
- ⬜ **WEC-671** catalogue reconciliation — one scripted run, incl. scrambled Healthy-Bowls descriptions (dry-run first).

### 🟠 High
- ⬜ **WEC-703** vouchers for subscription purchases + admin scope selector (orders OR subscriptions). ← **next**
- ⬜ **WEC-690** admin BCC emails show admin's address under «Στοιχεία χρέωσης» — _checking if already done._
- ⬜ **WEC-662** cart: «Παράδοση στον χώρο μου», «υδατάνθρακας» singular, macro icons. _(αλατοπίπερο + remove-comments-box dropped by Ioustinos.)_
- 🚫 **WEC-685** impersonation takes over every tab — _decision: admins open two tabs; no work._
- ⬜ **WEC-216** admin notification emails: own subject/content + per-type recipients.
- ⬜ **WEC-547** admin menu builder laggy for Nena post-migration (image res + dnd-kit).
- ⬜ **WEC-677** import 315 legacy GonnaOrder customers into auth.users + profiles (data).
- ⬜ **WEC-694** run k6 load suite against PROD, then re-enable rate limiting.
- ⬜ **WEC-569** admin payment link for any order (in progress above).

### 🟡 Medium / Low
- ⬜ **WEC-520** status pills: read as clickable + one colour across statuses.
- ⬜ **WEC-648** reseller pricing admin UI (DB already done).
- ⬜ **WEC-672** subscription renewal flow (needs a decision first).
- ⬜ **WEC-660** dish descriptions from Υλικά + recipe-editor error (error needs Christos's repro).
- ⬜ **WEC-507** impersonation strip: plan summary (check vs WEC-688).
- ⬜ **WEC-351** instant CDN invalidation via Netlify cache tags (only when the 5-min lag bites).

## ⬜ Open — blocked / external
- ⬜ **WEC-666** emails: global changes + per-template rewrites — needs the Klaviyo live paste sitting (01/05/04/06 queued).
- ⬜ **WEC-667** two new emails (change-request confirmation, Saturday reminder) — Blue Dot design.
- ⬜ **WEC-643** agency follow-ups: EN masters, 3 undesigned templates, hero images.
- ⬜ **WEC-646** reconcile liveness alerting before go-live.
- ⬜ **WEC-677 / WEC-694** data + prod load — coordinate timing.

## 🧾 Your open loops (quick)
- Paste the 4 Klaviyo templates (Chrome extension prompt provided).
- Confirm Airtable deletes are live after the dev redeploy.
