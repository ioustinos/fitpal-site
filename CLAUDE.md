# Fitpal Ordering Platform — Claude Context

## Stack
- React 18 + TypeScript + Vite
- Netlify (hosting + serverless functions in `netlify/functions/`)
- Supabase (auth + database) — project ID: `rhwetztxwjxfstffalwl`
- Viva Payments (payment processing — not yet integrated)

## Local Dev
```bash
netlify dev   # → http://localhost:8888
```
- Vite hot-reloads on every file save — no deploy needed during iteration
- `netlify.toml` has only the `/api/*` redirect — no `/*` catch-all (that broke Vite module requests)
- The `/*` SPA fallback lives in `public/_redirects` for production only

## Git Push Rules — CRITICAL
- **NEVER run git from the workspace folder** — the FUSE mount blocks `unlink`, permanently breaking git lock files
- **NEVER push to GitHub unless Ioustinos explicitly says so**
- **Iterate on localhost:8888, batch fixes, commit only on command**
- When a push IS requested, use this pattern (clone fresh if `/tmp/fitpal-push` doesn't exist):

```bash
# Note: $GITHUB_PAT must be set in the shell env before running — never commit the literal token.
git clone https://${GITHUB_PAT}@github.com/ioustinos/fitpal-site.git /tmp/fitpal-push
cd /tmp/fitpal-push && git checkout dev
git config user.email "ioustinos.sarris@gmail.com" && git config user.name "ioustinos"

export GIT_DIR=/tmp/fitpal-push/.git
export GIT_WORK_TREE="/sessions/<session-id>/mnt/Fitpal New Site"

git add src/specific/file.tsx   # specific files only — never git add -A
git commit -m "description"
git push origin dev
```

Branches:
- `dev` → https://dev--fitpal-order.netlify.app
- `main` → https://fitpal-order.netlify.app (production)

## Demo Account
- Email: `demo@fitpal.gr` / Password: `1234`
- Pre-confirmed in Supabase, no email verification needed
- Supabase user ID: `4613c0d8-8c88-4e9f-bbfe-7256ba9d3eee`

## Project Structure
```
src/
  components/
    cart/        CartSidebar.tsx, DayOrderGroup.tsx
    layout/      Header.tsx, AuthModal.tsx, Footer.tsx
    menu/        MenuPage.tsx, ProductCard.tsx, ProductModal.tsx
    checkout/    CheckoutPage.tsx
    ui/          Modal.tsx, Button.tsx, etc.
  lib/
    helpers.ts   dayAmt(), subTotal(), MIN_ORDER=15, fmt(), activeDays(), delivOk()
    translations.ts  makeTr() — bilingual string maps
    supabase.ts
  store/
    useCartStore.ts    Zustand — cart items keyed by day
    useUIStore.ts      Zustand — sidebar, auth modal, lang, page navigation
    useAuthStore.ts    Zustand — user session, mock user data (profile, addresses, goals, prefs, orders, wallet)
  pages/
    AccountPage.tsx    All 6 account tabs as inline components (orders, wallet, addresses, goals, prefs, profile)
  index.css            Global styles — single file (refactor to Tailwind planned, see Linear backlog)
```

## Key Design Decisions
- Single `index.css` currently — **refactor to Tailwind or CSS Modules is in backlog**
- Zustand for all global state (cart, UI, auth)
- Bilingual Greek/English via `lang` toggle in header, `t()` helper for string lookups
- Order hierarchy: Order → ChildOrder (one per day) → OrderItem
- Minimum order per day: €15 (`MIN_ORDER` constant in helpers.ts)
- Delivery time windows: 9-11, 10-12, 11-13, 12-14, 13-15
- Payment options: cash on delivery, card online, payment link sent later, bank transfer, wallet (deduct from Fitpal wallet balance)

## Cutoff model (WEC-101 family)
`getCutoffDate(isoDate, settings)` resolves in this order (first match wins):
1. `settings.cutoffDateOverrides[isoDate]` — ad-hoc per-date (holidays, long weekends). Key = delivery date YYYY-MM-DD. Value = `{ cutoffDate, hour }`.
2. `settings.cutoffWeekdayOverrides[deliveryIsoDow]` — recurring weekday rule. Key = ISO weekday 1–7 (1=Mon..7=Sun). Value = `{ dow, hour }` meaning cutoff lands on weekday `dow` (most recent before delivery) at `hour`. Currently seeded: `{ "1": { "dow": 6, "hour": 18 } }` → **Monday deliveries close on Saturday 18:00**.
3. Default — previous calendar day at `settings.cutoffHour` (currently 18).

All cutoff-related code flows through this one helper: `findLandingDay`, `isDayOrderable`, `CutoffBar`, and server-side `submit-order.ts` (WEC-106).

## Critical Behaviours
- No login gate on checkout — users can proceed as guest
- Per-day minimum order shown as yellow pill in cart sidebar and warning in checkout
- Menu is weekly — navigation is per-day, not per-category

## Linear
- Workspace: Wecook, Team key: WEC
- Project: Fitpal Ordering Platform
- Check Linear for open issues before starting new work

## Database Schema (Definitive — 27 tables)

Full ERD with column details: `supabase/schema_erd.html`
Schema decisions tracked in Linear: WEC-82

### Auth
- Supabase Auth manages `auth.users` — we don't touch it
- Launch: email + password with one-time email verification
- Later: magic link, phone + OTP (SMS)
- On signup trigger creates `profiles`, `user_goals`, `user_prefs`

### User & Prefs
- `profiles` (extends auth.users) — name, name_en, phone, avatar_url, dietician, dietary_notes
- `addresses` — label_el/en, street, area, zip, floor, doorbell, notes, lat, lng, is_default, sort_order
- `user_goals` — enabled, cal/protein/carbs/fat min+max (one row per user)
- `user_prefs` — payment_method, cutlery, invoice, vegetarian, gluten_free, low_carb, lang, newsletter, only_admin_orders, goal_tracking (bool, default false — on-page goal vs order comparison)
- `user_day_prefs` — day_of_week (1–5), address_id, time_from (time), time_to (time)
- `allergies` + `profile_allergies` junction
- `meal_services` — user_id, curator_id, start_date, end_date, active, notes

### Menu & Catalogue
- `categories` — text id, name_el/en, sort_order, active
- `dishes` — text id, category_id, name_el/en, desc_el/en, image_url, emoji, discount_pct, active, preview_cal/pro/carb/fat (smallint 1–5, admin-set dot levels for menu card display)
- `dish_variants` — text id, dish_id, label_el/en, price (cents), calories, protein, carbs, fat, sort_order
- `tags` — text id, label_el/en, bg_color, font_color, sort_order
- `dish_tags` — dish_id + tag_id junction
- `weekly_menus` — name, from_date, to_date, active
- `menu_day_dishes` — menu_id, date, dish_id, sort_order

### Orders
- `orders` — order_number, user_id, customer_name/email/phone, subtotal, discount_amount, total, payment_method (enum), payment_status (enum), status (enum), cutlery, invoice_type/name/vat, notes, admin_order_id, admin_notes
- `child_orders` — order_id, delivery_date, time_from (time), time_to (time), address_street/area/zip/floor
- `order_items` — child_order_id, dish_id, variant_id, name_el/en, variant_label_el/en, quantity, unit_price, total_price, calories, protein, carbs, fat, comment

### Wallet & Payments
- `wallet_plans` — wallet_id, consumer_type (enum), meal_breakfast/lunch/dinner (bools), people, days_per_week, frequency (enum), cost, credits, bonus_pct, bonus_amount, bonus_expires_at (purchase history — one row per package bought)
- `wallets` — user_id, active_plan_id, balance, base_balance, bonus_balance, auto_renew, next_renewal, active (live wallet state — one row per user)
- `wallet_transactions` — wallet_id, type (enum: topup/bonus/debit/refund/bonus_expired/adjustment), amount, description_el/en, order_id
- `payment_links` — order_id, viva_ref_code, payment_url, status (enum)

### Vouchers
- `vouchers` — code (unique), user_id (nullable, for customer-linked), type (enum), value, remaining (int, for credit vouchers that deplete), min_order, max_uses, uses_count, per_user_limit, expires_at, active
- `voucher_uses` — voucher_id, user_id, order_id, amount (int, discount applied), used_at (source of truth for applied vouchers per order)

### System
- `delivery_zones` — name_el/en, postcodes (array), active
- `zone_time_slots` — zone_id, time_from (time), time_to (time), active
- `settings` — key (PK), value (jsonb), description
- `admin_change_log` — order/child_order/order_item ids, table_name, field_name, old/new value, label, admin_user

### Conventions
- All money in cents (int)
- Bilingual: `_el` / `_en` suffix columns
- All tables have `created_at` / `updated_at` (timestamptz) where relevant
- `fmtTimeSlot(from, to)` helper derives display string from time fields
- Voucher discounts tracked via `voucher_uses`, not on orders directly (supports double voucher stacking)

## Database Status (Live — seeded 2026-04-16, admin layer added 2026-04-18)
- All 27 tables created via 9 Supabase migrations (enums → user/prefs → menu/catalogue → orders → wallet/payments → vouchers → system → signup trigger → RLS policies)
- RLS enabled on all tables; public read for menu/settings, user-own-data policies for the rest
- Signup trigger: `handle_new_user()` auto-creates `profiles`, `user_goals`, `user_prefs` on `auth.users` INSERT
- `updated_at` auto-update triggers on all mutable tables
- Demo user seeded: `demo@fitpal.gr` / `1234` (Supabase ID: `4613c0d8-8c88-4e9f-bbfe-7256ba9d3eee`)
- Seed data: 53 dishes, 122 variants, 2 weekly menus (Apr 6–10, Apr 13–17), 130 menu-day assignments, 3 orders (9 items, 4 child orders), wallet (Plus plan, €78.40 balance), 21 delivery zones (105 time slots), 4 vouchers
- Enum values to remember:
  - `consumer_type`: light, medium, regular, large, athletic
  - `wallet_frequency`: biweekly, monthly, quarterly
  - `voucher_type`: pct, fixed, credit
  - `payment_method`: cash, card, link, transfer, wallet
  - `payment_status`: pending, paid, failed, refunded
  - `order_status`: pending, confirmed, preparing, delivering, delivered, cancelled
  - `admin_role`: owner, menu_order  *(WEC-110, new admin panel)*

### Admin panel auth (WEC-110, applied 2026-04-18)
- `public.admin_users` — `id`, `user_id` (→ auth.users), `role` (`admin_role`), `created_at`, `updated_at`. RLS: user can read own row; `owner` can read all; only `owner` can write.
- **Distinct from** legacy `admin.admin_users` (GonnaOrder admin) — do not mix.
- Helpers: `public.is_admin(uid uuid)` / `public.is_admin()` / `public.current_admin_role()` — all SECURITY DEFINER, grant to authenticated. Use these in other tables' RLS policies instead of inline subqueries.
- Storage bucket `dish-images` (public read, admin-only write via the helpers).
- **Owner seeding:** manual one-liner after `ioustinos.sarris@gmail.com` signs up on the site: `insert into public.admin_users (user_id, role) select id, 'owner' from auth.users where email='ioustinos.sarris@gmail.com';`

### Admin panel V1 (WEC-109 + children, shipped 2026-04-18/19)
- **Route tree:** `/admin/*` lazy-loaded from `src/admin/AdminApp.tsx`, wrapped in `<AdminGuard>`. Customer site unchanged.
- **Sections:** Dashboard (`/admin`), Dishes (`/admin/dishes`), Menu builder (`/admin/menus`), Orders (`/admin/orders`), Settings (`/admin/settings`), Zones (`/admin/zones`).
- **Auth integration:** `isAdmin` + `adminRole` now live on `useAuthStore.user`, populated by `buildFullUser` via `fetchAdminStatus()` (`src/lib/api/admin.ts`).
- **Post-login redirect:** `AuthModal` navigates admins to `/admin` automatically; `Header` renders a small "Admin" pill for admins.
- **API modules** under `src/lib/api/`: `admin.ts`, `adminDashboard.ts`, `adminDishes.ts`, `adminMenus.ts`, `adminOrders.ts`, `adminSettings.ts`, `adminZones.ts`.
- **Admin writes use direct Supabase client + admin RLS** (not service-role Netlify Functions). See WEC-121 for the eventual migration path.

### Admin RLS policies (WEC-113..119, applied 2026-04-18)
- Migration `admin_rls_policies_and_zone_min_order` installs `admin_all_*` policies (FOR ALL) on: `dishes`, `dish_variants`, `categories`, `tags`, `dish_tags`, `weekly_menus`, `menu_day_dishes`, `delivery_zones`, `zone_time_slots`, `settings`, `allergies`, `orders`, `child_orders`, `order_items`, `wallets`, `wallet_transactions`, `wallet_plans`, `vouchers`, `voucher_uses`, `admin_change_log`.
- Plus admin-read policies on `profiles` and `addresses` so the orders drawer can resolve customer info.

### Schema additions for admin V1
- **`weekly_menus.inactive_dates date[] default '{}'`** (migration `weekly_menu_inactive_dates`, WEC-114) — dates where kitchen is closed. Customer menu (`fetchActiveWeeksMeta`) filters these out.
- **`delivery_zones.min_order_amount int null`** (migration `admin_rls_policies_and_zone_min_order`, WEC-119) — per-zone minimum-order override in cents; null = falls back to `settings.min_order`.

### Settings keys (all jsonb, managed via `/admin/settings`)
- `cutoff_hour` (int) — default cutoff hour on previous day.
- `cutoff_weekday_overrides` ({deliveryDow: {dow, hour}}) — e.g. Mon → Sat 18:00.
- `cutoff_date_overrides` ({deliveryDate: {cutoffDate, hour}}) — holiday overrides.
- `min_order` (int, cents) — global minimum per day. Honoured on both customer and server (submit-order.ts reads it rather than hardcoded).
- `time_slots` (string[]) — default delivery windows.
- `payment_methods_enabled` (payment_method[]) — methods offered at checkout. `PaymentSection` filters its catalog by this list.
- `contact` ({supportEmail, supportPhone, instagramUrl, facebookUrl}) — customer-facing contact.

### Delivery zones — postcode-only (WEC-119 + stabilization 2026-04-20)
Zone membership is determined **exclusively by postcode**. `delivery_zones.name_el` / `name_en` are admin-organizational labels, never matched against the customer's free-text "area" field.
- `src/lib/helpers.ts` exports `resolveZone(zip, zones)` and `zipInZone(zip, zones)`. The previous `zoneOk(area, zones)` / `addressInZone(area, zip, zones)` area-fallback helpers are gone.
- Customer checkout (`AddressSection`): area is plain text with no zone styling/feedback; zip input drives `zoneStatus` and renders the ✓/✗ feedback directly beneath it.
- `TimeSlotPicker`: resolves zone from zip; slots outside that zone are rendered but disabled + visually greyed.
- **Server-side mirror** (`netlify/functions/submit-order.ts`): same postcode-only match, explicit error messages when zip is missing / unknown.
- **Validation errors surfacing**: submit-order returns `{ error, validationErrors: { day_N: [...] } }`. CheckoutPage flattens `validationErrors` into the existing red `.checkout-validation` block, prefixed with the day label. No more vague "Order validation failed" toasts.

### First end-to-end order — 2026-04-20
Real order placed by Ioustinos via the customer flow, visible in `/admin/orders`. Status-change + confirmation-screen UX audit tracked as WEC-123 (post-V1 polish).

- Next step: replace mock data in `useAuthStore` + `menu.ts` with real Supabase queries

## Show Before Execute
Before ANY action in Linear, Supabase, GitHub, Netlify or any other external system —
write out exactly what you plan to do and wait for explicit approval from Ioustinos.
