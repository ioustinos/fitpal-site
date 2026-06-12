# Fitpal — Transactional emails setup

Two providers, one job each:

| Layer | Who fires it | Where the templates live |
|---|---|---|
| **Brevo** (via Supabase Auth SMTP) | Supabase Auth — `signInWithOtp`, `resetPasswordForEmail`, signup, email change | **Supabase Dashboard → Auth → Email Templates** |
| **Klaviyo** | Our backend (`netlify/lib/klaviyo.ts` → `track('Order Placed', …)` etc) | **Klaviyo Dashboard → Templates** + **Flows** |

All HTML in this folder is **source-of-truth on disk**. If a Klaviyo or Supabase admin edits a template via the dashboard, copy their version back here.

---

## Brevo / Supabase Auth — paste guide (4 templates)

Open **Supabase Dashboard → Auth → Email Templates** and paste each `.html` file in this folder into the matching template type:

| File | Supabase template type | Notes |
|---|---|---|
| `supabase_auth/01_signup_confirmation.html` | **Confirm signup** | Uses `{{ .ConfirmationURL }}` |
| `supabase_auth/02_magic_link_otp.html` | **Magic Link** AND **Email OTP** | Uses `{{ .Token }}` — same template for both since we show the code, not a link |
| `supabase_auth/03_password_reset.html` | **Reset Password** | Uses `{{ .ConfirmationURL }}` |
| `supabase_auth/04_email_change.html` | **Change Email Address** | Uses `{{ .ConfirmationURL }}` |

**Language routing** — every template uses a Go-template conditional:

```
{{ if eq .UserMetaData.lang "el" }}
  Ελληνικά block
{{ else }}
  English block
{{ end }}
```

For this to work, our client code passes `data: { lang }` on every Supabase Auth call. Already wired in `signInWithOtp` / `resetPasswordForEmail` / etc — see `src/lib/api/auth.ts`.

**Brevo SMTP creds** — already configured in Supabase Dashboard → Auth → SMTP (per project memory `feedback_klaviyo_pitfalls.md`). Don't touch unless emails stop arriving.

---

## Klaviyo — already pushed

All 14 customer-facing templates are **already live in your Klaviyo workspace**. They were created via the Klaviyo MCP. Reference IDs:

| Email | EL template ID | EN template ID |
|---|---|---|
| Order Confirmation | `SAvFw9` | `VJMqFY` |
| Payment Link Sent | `UF5Qcf` | `VvXDGx` |
| Order Refunded | `SzjrnU` | `UzC5M4` |
| Order Cancelled | `Ughyuc` | `SB7bvY` |
| Subscription Purchased | `XxNNci` | `XbgLEd` |
| Wallet Credit Granted | `XW8zRt` | `XPujmy` |

Direct edit URL: `https://www.klaviyo.com/email-editor/{TEMPLATE_ID}/edit`

**Existing "Order Confirmed" template (`WpaRis`, drag-and-drop)** is left untouched as a backup. Delete once you've verified the new templates render.

---

## Klaviyo Flows — still to configure

Klaviyo flows route each event metric to an EL or EN template based on `event.lang`. For each event, create one flow with a conditional split:

```
Trigger: <Metric>
  ↓
Conditional split: event.lang
  ├─ "el" → Email → <EL template>
  └─ else → Email → <EN template>
```

| Metric (event name) | EL template | EN template | Status |
|---|---|---|---|
| `Order Placed` | `SAvFw9` | `VJMqFY` | **Replace existing "Order Placed (Cash)" + "Order Placed (Bank)" flows with one unified flow with EL/EN split. The Order Confirmation template's payment-method conditional handles cash/bank/card/wallet internally.** |
| `Order Refunded` | `SzjrnU` | `UzC5M4` | New flow |
| `Order Cancelled` | `Ughyuc` | `SB7bvY` | New flow |
| `Payment Link Sent` | `UF5Qcf` | `VvXDGx` | New flow |
| `Subscription Purchased` | `XxNNci` | `XbgLEd` | New flow |
| `Wallet Credit Granted` | `XW8zRt` | `XPujmy` | New flow |

Each flow's sender = `info@fitpal.gr` (account default — verified during template push).

---

## Backend trigger wiring — what's done vs TODO

**Already firing from code:**
| Event | Site | lang status |
|---|---|---|
| `Order Placed` | `netlify/functions/submit-order.ts` | ✅ — reads `body.lang` (CheckoutPage passes it from `useUIStore.lang`) |
| `Order Refunded` | `netlify/functions/viva-refund.ts` | ✅ — looks up `user_prefs.lang` |
| `Subscription Purchased` (transfer path) | `netlify/functions/wallet-plan-purchase.ts` | ✅ — reads `body.lang` |

**Not yet firing — wire in a follow-up session:**
| Event | Should fire when | File to edit |
|---|---|---|
| `Subscription Purchased` (card/link path) | `verifyWalletPlanTransaction` flips to paid | `netlify/lib/wallet/verifyWalletPlanTransaction.ts` |
| `Payment Link Sent` | Admin clicks "Regenerate link" | `netlify/functions/viva-regenerate-link.ts` |
| `Order Cancelled` | Admin sets `status=cancelled` | `src/lib/api/adminOrders.ts` `setOrderStatus` (or a server fn behind it) |
| `Wallet Credit Granted` | Admin grants credit in `/admin/wallets` | wherever the credit-grant button posts to |

**WalletPage `lang` plumbing:** the `PurchaseBody` already accepts `lang`. WalletPage's `purchaseWalletPlan(...)` call needs `lang: useUIStore.getState().lang` added. Quick — single line.

---

## Variables each Klaviyo template expects

The template HTML files in this folder are commented with the exact `event.X` variables required. Quick reference:

### Order Placed
`event.first_name`, `event.order_number`, `event.subtotal`, `event.discount_amount`, `event.total`, `event.payment_method`, `event.days[]` (`day_label_el`, `day_label_en`, `time_window`, `address`, `day_total`, `day_macros`, `items[]`), `event.bank_transfer_infos[]`, `event.lang`

### Order Refunded
`event.order_number`, `event.order_total`, `event.refund_amount`, `event.cumulative_refund_amount`, `event.is_full_refund`, `event.reason`, `event.lang`

### Order Cancelled
`event.order_number`, `event.total`, `event.payment_method`, `event.was_paid`, `event.reason`, `event.lang`

### Payment Link Sent
`event.order_number`, `event.total`, `event.payment_url`, `event.lang`

### Subscription Purchased
`event.first_name`, `event.plan_length_label`, `event.meals_per_week`, `event.amount_paid`, `event.bonus_credits`, `event.new_balance`, `event.lang`

### Wallet Credit Granted
`event.amount`, `event.bonus_expires_at`, `event.new_balance`, `event.reason`, `event.lang`

---

## Testing each email

1. **Klaviyo:** open any template in the editor → click "Preview & test" → paste event JSON (use the variables list above) → choose your email → "Send test" → check inbox.
2. **Supabase Auth:** trigger a real signup / OTP / reset flow on `dev--fitpal-order.netlify.app` using a sandbox email. The Brevo dashboard logs every send.

---

## Brand assets

Logo URL used in all headers: `https://dev--fitpal-order.netlify.app/brand/on-dark-green.png`. Swap to a production URL when prod cutover happens.

Brand colours (locked, from WEC-439): green `#004739` (header), neon-green `#00B96B` (CTA), cream `#F9F2E1` (body), lime `#CFD72B` (footer links), text `#1C2B1C`.
