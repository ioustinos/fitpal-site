# Fitpal — First Serious Code Review

Scope: security, scalability, performance, and "did I leave any backdoors open". Covers the public site, admin V1, Netlify Functions, and RLS posture. Pre-launch audit — nothing here is blocking today's work, but items marked **🔴 CRITICAL** and **🟠 HIGH** should be fixed before production traffic.

---

## 🔴 CRITICAL — fix before launch

### 1. `submit-order.ts` trusts `body.userId` without verifying the JWT

**File:** `netlify/functions/submit-order.ts`, lines 225–229

```ts
let userId = body.userId ?? null
if (token && !userId) {
  const { data: { user } } = await supabase.auth.getUser()
  userId = user?.id ?? null
}
```

**The hole.** If a client sends `userId: "<victim-uuid>"` in the JSON body WITHOUT an Authorization header, the server never verifies it. It falls through to the service-role branch (no `token`) and inserts an `orders` row with that victim's `user_id`. RLS doesn't save us because the service role bypasses RLS entirely.

**Impact.** An attacker can attribute arbitrary orders to any user account — poisoning their order history, inflating their totals, creating headaches for customer support. If the wallet-debit logic lands later and trusts `orders.user_id`, this becomes actual monetary theft.

**Fix.**
```ts
// Always derive userId from the JWT. If no JWT, this is a guest order — userId is null.
let userId: string | null = null
if (token) {
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user } } = await authClient.auth.getUser()
  userId = user?.id ?? null
  if (!userId) {
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }
}
// NEVER read userId from the request body.
```

Same pattern exists in `validate-voucher.ts` (lines 56–65). Consequences there are lower (per-user-limit bypass / probing who has what voucher) but the fix is identical.

### 2. Voucher redemption has a race condition on `max_uses` and `remaining`

**File:** `submit-order.ts`, lines 424–426, 571–580

The check is: `if (voucher.uses_count >= voucher.max_uses) reject`. The insert is: separately `UPDATE vouchers SET uses_count = old + 1`. Two concurrent orders both see `uses_count = 0` with `max_uses = 1`, both pass, both commit. Same problem for credit-voucher `remaining`.

**Fix.** Push the decrement into Postgres as an atomic conditional update, and check rows-affected:

```ts
const { data: updated, error } = await supabase
  .from('vouchers')
  .update({ uses_count: voucher.uses_count + 1 })
  .eq('id', voucher.id)
  .eq('uses_count', voucher.uses_count)  // optimistic lock
  .select('id')
  .single()

if (error || !updated) {
  // Lost the race — voucher was redeemed concurrently
  return Response.json({ error: 'Voucher is no longer available' }, { status: 409 })
}
```

Or, more robustly, do the full order insert + voucher decrement inside a Postgres function (`rpc('place_order_with_voucher', ...)`) so it's one transaction. Given the scale Fitpal will launch at, the optimistic-lock pattern is sufficient.

### 3. No wallet debit happens when `paymentMethod = 'wallet'`

**File:** `submit-order.ts`

Accepting `'wallet'` as a payment method without debiting the wallet means: a user with €0 balance can order and mark the order "paid by wallet". It currently lands with `payment_status: 'pending'`, so an admin would catch it — but the *expected* semantics of `'wallet'` is "I already paid, deduct now".

**Options:**
1. Remove `'wallet'` from `payment_methods_enabled` until WEC-XXX-wallet-debit ships.
2. Implement wallet debit inside `submit-order.ts` (atomic Postgres RPC, same reasoning as vouchers).

**Recommended for launch:** option 1. Then ship (2) as a follow-up with proper transaction boundaries.

---

## 🟠 HIGH — fix soon after launch

### 4. `Access-Control-Allow-Origin: '*'` on all Netlify functions

Both `submit-order.ts` and `validate-voucher.ts` respond with `'Access-Control-Allow-Origin': '*'`. In a browser, same-origin wouldn't need CORS headers at all (but it's fine to send them). The issue is that wildcard CORS is *permissive* — any website can POST to these endpoints from a user's browser.

For `validate-voucher` this enables voucher enumeration from any origin. For `submit-order` this enables fraudulent order submission from any origin (the JWT requirement doesn't fully mitigate because guest orders don't need a JWT).

**Fix.** Lock CORS to `fitpal-order.netlify.app` and `dev--fitpal-order.netlify.app` once those domains are stable. Use a small allowlist and echo the request's `Origin` only if it's in the list.

### 5. No rate limiting anywhere

`submit-order`, `validate-voucher`, and Supabase Auth (login/signup) all sit behind zero rate limits. Attack surface:

- **Voucher brute force:** an attacker scripts POSTs to `/api/validate-voucher` with random codes until one returns `valid: true`. Fitpal voucher codes look like short human-readable strings — fully enumerable.
- **Order spam:** bot submits thousands of `cash` orders to clog the admin panel.
- **Signup abuse:** bot creates thousands of fake accounts (Supabase Auth default caps help somewhat but not enough).

**Fix.**
1. Put Netlify Edge Middleware (or Cloudflare in front) and rate-limit by IP: 5 voucher checks per minute, 3 orders per 5 minutes per IP.
2. Add a captcha (hCaptcha / Turnstile) on the signup modal and as a pre-flight to `submit-order` for guest orders.

### 6. Voucher enumeration via distinct error messages

`validate-voucher.ts` returns distinct errors for:
- `Invalid voucher code` (code doesn't exist)
- `This voucher has expired`
- `This voucher has reached its usage limit`
- `Already used`

An attacker can distinguish "this code exists but you can't use it" from "this code doesn't exist" — reducing the search space. Once they find a valid-but-limit-hit code, they know the naming pattern.

**Fix.** Return a single opaque `Voucher unavailable` message to unauthenticated requests. Keep the specific messages only when the caller is authenticated AND already inside checkout.

### 7. `buildFullUser` runs 4 parallel queries on every session restore — and `fetchUserOrders` is unbounded

`fetchUserOrders` selects ALL orders for a user, then ALL child_orders, then ALL order_items. For a long-standing customer with hundreds of orders this becomes a multi-megabyte payload loaded into memory at login.

**Fix.** Add `.limit(50)` to the orders query, and expose a "load more" button in the Account → Orders tab. Only fetch child orders + items for the orders that are in the current page.

### 8. RLS helper `public.is_admin()` is SECURITY DEFINER

This is the correct pattern, but it means: any SQL injection *anywhere in the stack* that lets an attacker run `SELECT public.is_admin()` on behalf of the service role would let them see admin-status for any user. We don't have raw SQL in the app code, which mitigates this — but if you ever add `execute_sql` tooling or admin query features, `is_admin()` must not be exposed.

**Action.** Keep an eye on this. Not a current bug but a design constraint. Document in CLAUDE.md.

---

## 🟡 MEDIUM — quality-of-code items

### 9. Client-side `admin.ts` + direct Supabase writes (WEC-121)

Known tradeoff. Admin users hold RLS-scoped tokens that let them write to customer tables directly. An admin with a compromised token = full customer-data access. This is fine for V1 internal use, but:

- Enforce strong passwords on admin accounts (no weak secrets).
- Consider adding 2FA via Supabase Auth's MFA once the admin panel is real.
- Follow through on WEC-121 (move admin writes to Netlify Functions with service-role, guarded by `is_admin()` check) before onboarding any non-Ioustinos admin users.

### 10. Cart store is entirely client-side, no server-side validation of `comment` length or content

A user can put a 10MB string in `comment` and the server will accept it into `order_items.comment` (which is just `text`, unlimited in Postgres). Not a security issue per se, but a cost vector and a display-breakage vector.

**Fix.** Cap `comment.length <= 300` server-side in `submit-order.ts`. Reject or truncate.

Similar caps needed for `notes`, `invoiceName`, `invoiceVat`, `addressStreet`, `addressFloor`.

### 11. Server-side validation accepts any string for email, phone

`validatePayload` only checks that `customerEmail` is non-empty — not that it looks like an email. Phone likewise. A malformed email breaks transactional email later; a malformed phone breaks SMS confirmations.

**Fix.** Add a cheap regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` for email, `libphonenumber-js` on the server (or defer to the client validation but add a short regex fallback).

### 12. Admin panel auth: no idle-session logout

Once signed in as admin, the session lives until Supabase's token expires (default 1 hour, refreshed). If an admin laptop is borrowed, the admin panel is open-for-business.

**Fix (later, not V1-blocking).** Add an idle-timeout (15 min) that calls `logout()` and shows the AdminGuard sign-in. Add a "Sign out of admin" button that's more prominent than the user-menu one.

### 13. `submit-order.ts` duplicates cutoff logic from `src/lib/helpers.ts`

Any change to `getCutoffDate()` must be applied to *both* files. A comment in `submit-order.ts` flags this, but that's not enforcement. Past incidents in similar setups: someone updates the client helper, misses the server copy, and the UI disagrees with the server for weeks.

**Fix.** Extract `cutoff.ts` into `shared/` or `lib/shared/` and `import` it from both the function and the client. Netlify Functions bundle will pick it up fine with Vite's module resolution.

### 14. `orders.ts` formatDayLabel doesn't use `src/lib/datelabels.ts`

You introduced `dayLabel()` in WEC-137 as the single source of truth for weekday strings. But `orders.ts` still hand-rolls `fmtDayLabel` using `toLocaleDateString`. Likely-fine today — but this is the kind of drift that will produce inconsistent labeling between Cart and Account.

**Fix.** Replace with `dayLabel(dateStr, lang, 'long')`.

---

## 🟢 LOW — good-to-know

### 15. Single-file `index.css` at 1600+ lines

Already on the roadmap (refactor to Tailwind or CSS Modules). No immediate impact — gzip handles it well, and there's no FOUC. But merge-conflict surface for any new feature touching styles.

### 16. `console.error` / `console.warn` in production bundle

Several functions and stores log errors to console. Fine for debugging but visible in DevTools to any user. No secrets leak — the messages are just human-readable.

### 17. `weeklymenu.inactive_dates` array — no indexing

If this grows to hundreds of dates per menu, the `inactive_dates.contains(date)` filter becomes a sequential scan. Unlikely at Fitpal scale for years.

### 18. Typescript `any` casts in `AccountPage.tsx` OrdersTab

`function OrdersTab({ user, lang }: any)` — throws away type safety. Low-severity but would catch the `order.date + 'T12:00:00'` bug at compile time if typed properly. Worth tightening when you touch this tab next.

### 19. `settings.cutoff_weekday_overrides` JSONB — no DB-side validation

An admin typo in the Settings page could write an invalid structure (e.g. `"dow": "Monday"` instead of `1`) — the server's `parseCutoffSettings` guards against bad values, but silently falls back to defaults. Worth surfacing "invalid setting, using fallback" somewhere.

### 20. Memory — `useMenuStore` holds all dishes for all weeks loaded

If the user browses many weeks, memory footprint grows unbounded. Small cost per week (~50 dishes × ~500 bytes), but worth an LRU when you ship week-10+.

---

## What I DID NOT find (re: "backdoors you might have left")

I did a direct search. Confirming absence of:

- ❌ No `dangerouslySetInnerHTML` anywhere in `src/`.
- ❌ No hardcoded secrets, passwords, or API keys in the repo. `GITHUB_PAT` / `SUPABASE_SERVICE_ROLE_KEY` are referenced as env vars only.
- ❌ No `eval()`, `Function()` constructors, or dynamic script injection.
- ❌ No raw SQL strings — everything uses Supabase's query builder with parameter binding. No SQL-injection surface from the app.
- ❌ No auto-admin-escalation path. `admin_users` rows are inserted manually via SQL; there's no client-reachable API that writes to it.
- ❌ No backdoor endpoint for "log in as any user." `checkSession`/`login` both go through proper Supabase Auth.
- ❌ No client-trusted price or macro values — `submit-order.ts` refetches them from DB and ignores anything the client sent.

The things that look sketchy but aren't:
- `SUPABASE_SERVICE_ROLE_KEY` fallback in `submit-order.ts` — only used when there's no JWT (guest orders). The server never echoes it to clients.
- Admin-writes-via-RLS — a known V1 tradeoff, tracked as WEC-121.

---

## Triage summary

| Severity | # items | Before launch? |
|---|---|---|
| 🔴 Critical | 3 | **Yes** — fix all three |
| 🟠 High | 5 | Strongly recommended |
| 🟡 Medium | 6 | Within 1–2 sprints post-launch |
| 🟢 Low | 6 | Backlog |

Top-3 picks for the next push: **#1 (userId from body)**, **#2 (voucher race)**, **#3 (wallet debit gap — disable the payment method until implemented)**.
