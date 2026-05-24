# QA Checklist — Admin-call fixes (2026-05-24)

Test on **localhost:8888** (`netlify dev`) or `dev--fitpal-order.netlify.app` after push.
Admin login required for most items. Nothing here is pushed yet — it's all on your working copy.

Legend: ☐ to test · ✦ design/UX check

---

## WEC-361 · Order detail = one screen  (+ design polish)
- ☐ Open any order in `/admin/orders`. The drawer shows **Details / Refund / Timeline** tabs only (no separate Overview/Items/Delivery).
- ☐ **Details** scrolls: Customer / Payment / Totals **on one row** → Extras (single-line strip) → **Delivery Days** (one card per day) → any notes as full-width callouts.
- ✦ Looks compact and icon-led, using the horizontal space — not a tall sparse column. (1080p laptop: key info above the fold.)
- ✦ The two status pills at top are now labelled **Order** and **Payment**.
- ✦ Customer email/phone are clickable (mailto/tel) with mail/phone icons.

## WEC-370 / WEC-372 · Order status = Pending + Confirmed (+ Cancel)
- ☐ Pending order shows buttons: **→ confirmed** and **Cancel** only (no preparing/delivering/delivered).
- ☐ Confirmed order shows **→ pending** and **Cancel**.
- ☐ The Status filter (toolbar) lists only pending / confirmed / cancelled.

## WEC-386 · Per-day Child Order cards (layout)
- ☐ In **Details**, items + delivery are now one **card per delivery day**: ▾ collapse, day + date, 📍 address line, green time-window pill, "N items", and **Cancel Day**.
- ☐ Address block shows Address / Post Code / City / Floor, with an **Edit address & time** toggle (editable in any status).
- ☐ Items table columns: Item · Variant · Comment · Qty · Unit · Total · ×.
- ☐ The ▾ arrow collapses / expands a day.

## WEC-371 / WEC-386 / WEC-372 · Edit items (Pending only)
- ☐ On a **Pending** day: **+ Add item from menu** — search is accent-insensitive; dishes **on that day's menu** get an "on menu" badge + sort to top; off-menu still addable. Pick dish → variant → qty → **Add €X.XX**; line appears, order Total recalculates.
- ☐ **Edit variant inline:** the Variant column is a dropdown of that dish's variants — pick another size; the line **re-prices** and the order Total updates.
- ☐ Change a qty (a **Save** appears) / click **×** to remove a line → total recalculates.
- ☐ On a **Confirmed** order, items are **read-only** with a "revert to Pending" notice; **address/time stay editable**. Revert → editing returns.
- ☐ On a **paid** order, the add-item panel shows the "already paid — send a balance link" warning.

## WEC-389 · Cancel a whole day (soft-cancel) + Restore
- ☐ On a Pending order with 2+ days, click **Cancel Day** → confirm. The day goes **greyed with a red "Cancelled" badge**, its items become read-only, and the order **Total drops** by that day's amount.
- ☐ The cancelled day now shows **Restore** (instead of Cancel Day). Click it → the day returns and the Total is restored.
- ☐ Cancel **all** days → order status flips to **cancelled**. Restore any day → order re-opens as **pending**.
- ☐ As that **customer** (impersonate or their account): a cancelled day **does not appear** in their order history, and their total matches.
- ☐ Dashboard **"today's deliveries"** does **not** count a cancelled day dated today.
- ☐ **Timeline** tab logs the cancel + restore actions.

## WEC-390 / WEC-392 · Editable notes + provenance
- ☐ An order's **Details** has two editable boxes: **Customer note** and an amber **Admin note** ("internal — kitchen / packaging / management"). Edit either → **Save** (+ Reset) appears → save → reopen → it persists.
- ☐ Both are editable in **any status** (not gated to Pending). **Timeline** logs the edits.
- ☐ Open an **admin-placed** order (placed via impersonation): the **Customer card** shows a read-only line *"Placed by an admin on behalf of the customer · {date}"*, and the **Admin-note box is empty** (provenance is no longer dumped into it).
- ☐ A **normal customer** order shows **no** provenance line; both note boxes start empty.

## WEC-362 · Wallet under impersonation
- ☐ Impersonate a customer **with no wallet** → at checkout the **Fitpal Wallet** option is **greyed/disabled** with a "No wallet" badge (not hidden, not usable).
- ☐ Impersonate a customer **with** a wallet → wallet shows normally (disabled only if balance can't cover the order).
- ☐ As a normal customer with no wallet → wallet option not shown (unchanged).

## WEC-369 · Dish editor (the stuck-save / lost-ingredients bug)
- ☐ Open an existing dish in `/admin/dishes`. The editor has **Basic** and **Recipe & Variants** tabs.
- ☐ **Basic** = name, code, image, category, tags, macro dots. **Recipe & Variants** = variants, sync bar, ingredients.
- ☐ Immediately after opening, the Save button reads **"Loading recipe…"** and is disabled until the recipe loads — then becomes **Save changes**. (This prevents the wipe.)
- ☐ Edit only the name on the Basic tab → Save → reopen → ingredients are **still intact**.
- ☐ Add several brand-new ingredients → Save → should be fast (one round-trip) and not hang.

## WEC-365 · Accent-insensitive dish search
- ☐ `/admin/dishes` and Menu builder library: search "κοτοπουλο" (no accent) matches "Κοτόπουλο".

## WEC-367 · Menu builder honours category order
- ☐ In Menu builder, set a custom category order in the strip → **Apply**. The **day columns** reorder to match (previously they ignored it).

## WEC-366 · Export menu
- ☐ Menu builder → **Export PDF**: opens a print view (Save as PDF), per day, grouped by category, with variants. Greek renders correctly.
- ☐ **Export Excel**: downloads a `.xls` that opens in Excel/Numbers with Day / Date / Category / Dish (EL/EN) / Variants.

## WEC-368 · Allergy icon
- ☐ On a menu card with an allergy flag, hovering the ⚠ icon shows an **instant** tooltip (no ~1s delay) and a help cursor.
- ☐ Clicking the ⚠ icon does **not** open the dish modal (by design).

## WEC-363 · Spelling
- ☐ Admin: Wallet settings tab "Diet (dietitian)", Users "Dietitian" field, Wallet purchases "Dietitian-managed" → all read **dietitian**.

---

## Decisions waiting on you
1. **Confirmed → back to Pending** is enabled (unlock-edit-reconfirm). ✅ done.
2. **Cancel Day = soft-cancel** (reversible, record kept), per your call. ✅ done.
3. Lock delivery address/time behind Pending too? (currently editable in any status)
4. Allergy icon no longer opens the dish on click — keep, or revert?
5. Minor: the orders **list** still counts a cancelled day in its "Days" badge / date-chips (admin-only, not customer-facing). Strike them through, or leave as-is?
