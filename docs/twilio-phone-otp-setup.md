# Twilio + Supabase Phone OTP — setup guide

End-to-end recipe for adding phone-OTP signup to Fitpal as a second channel alongside email-OTP. Picks up where [WEC-236](https://linear.app/wecook/issue/WEC-236) leaves off.

> **Status when this doc was written**: not yet implemented. The `WalletPage` inline signup component is shaped so swapping `signInWithOtp({ email })` for `signInWithOtp({ phone })` is a one-line change once Twilio is configured. R1 ships with email only.

---

## Why Twilio (not Klaviyo, not Yuboto/Routee yet)

| Provider | Greece support | Native Supabase config | Per-SMS cost (GR) | Use it? |
|---|---|---|---|---|
| **Twilio** | ✅ | ✅ Dashboard-only | ~€0.07 | ✅ R1.5 |
| MessageBird (Bird) | ✅ | ✅ Dashboard-only | ~€0.06 | Alternate to Twilio |
| Vonage | ✅ | ✅ Dashboard-only | ~€0.07 | Alternate to Twilio |
| **Yuboto** (GR) | ✅ | ❌ needs Supabase SMS Hook | ~€0.02 | R2 cost optimization |
| **Routee** (GR, AMD Telecom) | ✅ | ❌ needs Supabase SMS Hook | ~€0.02 | R2 cost optimization |
| **Klaviyo** | ❌ no GR | ❌ wrong shape (campaigns only) | n/a | Never. Marketing tool. |

For OTP we need (a) Greek number support, (b) sub-10s delivery, (c) per-message API. Twilio is the cleanest first step. Switch to a Greek-native provider in R2 if SMS volume justifies the migration cost.

---

## Step 1 — Create the Twilio account

1. Go to https://www.twilio.com/try-twilio and sign up. Use a Fitpal email (`tech@fitpal.gr` or similar) so the account isn't tied to a personal address.
2. Complete email + phone verification.
3. Verify your **personal mobile** as a test number — needed before the account is activated for production.
4. From the Twilio Console:
   - Account SID — visible on the dashboard, save it
   - Auth Token — click "Show" on the dashboard, save it
   - Both are needed in the Supabase config below

## Step 2 — Buy a Greek phone number (or use an Alphanumeric Sender ID)

Two options:

### Option A — Buy a Greek phone number

- Twilio Console → Phone Numbers → Manage → Buy a number
- Filter by Country: Greece, Capabilities: SMS
- Pick a number with SMS capability (~€1/month rental + per-message cost)
- This gives you a recognizable +30 number that recipients can text back to (replies hit Twilio webhook, useful for support)

### Option B — Alphanumeric Sender ID (cheaper, faster, recommended for R1.5)

- Twilio Console → Phone Numbers → Manage → Sender IDs → Add Sender ID
- Sender ID: `Fitpal` (max 11 chars, alphanumeric)
- Country: Greece
- Greece **does not** require a sender-ID registration with the regulator (unlike France/Italy), so this is approved within minutes
- **Trade-off**: customers can't reply. For OTP that's fine.
- **Caveat**: alphanumeric sender IDs only work for OUTBOUND. If we ever need 2-way SMS (support replies), we need a phone number too.

> Recommendation: start with Option B — `Fitpal` sender ID. Buy a number later if 2-way support is needed.

## Step 3 — Twilio Verify service (optional but recommended)

Twilio has a dedicated **Verify API** that handles OTP delivery + verification + retry logic + fraud detection. Supabase doesn't use it directly (it sends SMS via Programmable Messaging instead), so for our simple flow, **skip Verify**. Programmable Messaging via Supabase is enough.

## Step 4 — Configure Supabase phone provider

This is dashboard-only:

1. Supabase Dashboard → your project (`rhwetztxwjxfstffalwl`) → Authentication → Providers
2. Find **Phone** in the list, click to expand
3. Enable Phone provider (toggle on)
4. SMS Provider dropdown → select **Twilio**
5. Fill in:
   - **Twilio Account SID** — from Step 1
   - **Twilio Auth Token** — from Step 1
   - **Twilio Message Service SID** OR **Twilio Phone Number** — pick one:
     - If you bought a number (Option A): paste the number in `+306900000000` format
     - If you used Sender ID (Option B): create a Messaging Service in Twilio Console → Messaging → Services → Add. Attach your `Fitpal` sender ID to it. Copy the Messaging Service SID (`MGxxxxxxxx`) into Supabase.
6. **OTP Length**: 6 (default, matches our email OTP)
7. **OTP Expiry**: 60 seconds (default; raise to 300 if iOS autofill latency is an issue)
8. Save.

## Step 5 — Customize the SMS template

Same Authentication page → SMS Templates section:

```
Your Fitpal verification code is {{ .Code }}
```

Keep it short — under 160 chars to stay within a single SMS segment. iOS and Android autofill detect the 6-digit code regardless of surrounding text, so the template wording is mostly UX-cosmetic.

## Step 6 — Test from the Supabase Dashboard

Authentication → Users → "Add user" → "Create new user" → enter your phone in `+306912345678` format → Send OTP. Verify you receive the SMS within ~5s.

If the message doesn't arrive:
- Check Twilio Console → Monitor → Logs → Errors. Common issues: unverified sender ID, wrong country format, account not yet upgraded from trial.
- Twilio trial accounts can only send to verified numbers. Add €20+ credit to upgrade.

## Step 7 — Frontend wiring (the small code change)

In `src/pages/WalletPage.tsx`, the inline signup currently calls:

```ts
await sendEmailOtp(email, name)         // signInWithOtp({ email })
await verifyEmailOtp(email, code)       // verifyOtp({ email, type: 'email' })
```

Add a channel toggle. The signup component grows two new helpers in `src/lib/api/walletPlan.ts`:

```ts
export async function sendPhoneOtp(phone: string, name: string) {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: true, data: { name } },
  })
  return { ok: !error, error: error?.message }
}

export async function verifyPhoneOtp(phone: string, code: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone, token: code, type: 'sms',
  })
  return { ok: !error && !!data.session, error: error?.message }
}
```

The signup form grows a "Use phone instead?" link below the email field that flips the channel. Validate phone with `+30 6XXXXXXXX` for GR.

## Step 8 — Update the wallet purchase flow

`wallet-plan-purchase.ts` already reads `userEmail` from the Supabase session for the Viva customer object. When the user signed up via phone, `userData.user.email` will be empty — we need to capture email at the phone-signup stage too (Greek law / Viva still requires an email for the receipt).

So the flow becomes:

1. Customer enters **phone**, gets SMS OTP, verifies → session active
2. Form prompts for **email** (for receipts) and **full name** if not in metadata
3. Both written to `profiles` and `auth.users.email`
4. Then continue to Viva as today

This matches what we already do in reverse for email-first signup (we capture phone post-verification).

## Step 9 — Cost & rate-limit considerations

- Twilio charges per attempt, not per successful verify. Add client-side rate limiting (1 send / 30s) and server-side per-IP rate limiting via the Auth hook to prevent abuse.
- Supabase has built-in rate limiting on `signInWithOtp` (default: 1/min per IP, 10/hour per phone) — keep these defaults.
- Set up a Twilio usage alert at €20/month so we know if the volume gets weird (Console → Billing → Usage Triggers).

## Step 10 — When to switch to Yuboto / Routee (R2)

- Trigger: SMS spend exceeds ~€100/month
- Migration is a Supabase **SMS Hook** — a custom Postgres function or HTTP endpoint that intercepts the OTP send and dispatches via the Greek provider's REST API
- Reference: https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
- No frontend changes needed; the toggle from Step 7 stays the same

---

## Open ops questions to resolve before going live

1. **Sender ID branding**: `Fitpal` or `FitpalMeals`? 11-char limit, all-caps usually reads better on Greek phones.
2. **OTP language**: Greek SMS or English? My recommendation: Greek for `lang=el` users, English for `lang=en` — needs branching in the Supabase template (currently single template; we'd use Auth Hooks to switch).
3. **Phone-only vs phone+email**: Do we *require* email even for phone signups? Yes — for Viva receipts and Klaviyo flows. UI should make this clear.
4. **Trial-account limits**: Don't enable in production until Twilio account is upgraded from trial.

---

## Linear

This guide is tracked under [WEC-236](https://linear.app/wecook/issue/WEC-236). When we pick this up, link the implementation PR back to that issue.
