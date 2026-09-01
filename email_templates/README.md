# Fitpal — email templates

Last full rebuild: **2026-08-15** (agency redesign, Linear WEC-642).

## Don't hand-edit the HTML

Templates are generated. Edit `build_templates.py`, then:

```bash
python3 build_templates.py     # reads the agency pack, writes ./out/
```

The build gates on: unresolved `*-BASE` placeholders, unbalanced Liquid blocks, unbalanced `<table>/<tr>/<td>`, `|date:` filters, em-dash defaults on fields the backend doesn't send, untranslated Greek in EN output, and the expected `{% unsubscribe %}` count.

Source pack: the agency ZIP, extracted to `/tmp/fpnew` (override with `FITPAL_AGENCY_SRC`).

## Layout

| Folder | What |
|---|---|
| `out/` | **Build output — the source of truth.** 11 templates. |
| `klaviyo/` | Mirror of what's live in Klaviyo. Copied from `out/`. |
| `supabase_auth/` | Mirror of what's live in Supabase Auth. Copied from `out/`. |
| `assets/` | 17 optimised images (heroes JPEG, rest PNG). Uploaded to Supabase Storage. |
| `_backup_2026-08-14/` | **Rollback.** Live Klaviyo HTML as of 2026-08-14, before the redesign. |

## Assets

Public Supabase bucket `email-assets`:
`https://rhwetztxwjxfstffalwl.supabase.co/storage/v1/object/public/email-assets/`

Heroes are JPEG (agency shipped 1.5 MB PNGs — the set went 9.6 MB → 0.9 MB). Logo, stickers, icons and social remain PNG for transparency.

## Klaviyo — how it actually works

**A flow message does not use the library template.** Attaching a template makes Klaviyo take its own copy. Editing the library template afterwards changes nothing for customers. To change a live email you must edit the flow message's copy in the UI — the API returns 404 on those IDs.

Library templates are kept in sync anyway, as the staging source for UI copy-paste.

| Email | Library ID (EL / EN) | Live flow message ID (EL / EN) | Flow |
|---|---|---|---|
| Order confirmation | `SAvFw9` / `VJMqFY` | `TZbfHW` / `VUn9HN` | Order Placed `UnqvNz` |
| Payment link sent | `UF5Qcf` / `VvXDGx` | `XnCYeM` / `TWddQN` | Payment Link Sent `TQCHs9` |
| Order refunded | `SzjrnU` / `UzC5M4` | `TdJaRv` / `Ukhvx3` | Order Refunded `VnzjUB` |
| Subscription purchased | `XxNNci` / `XbgLEd` | `SjpR42` / `UbCuQ6` | Subscription Purchased `Rk62UK` |

Flows split on `event.lang` — Greek on the Yes branch, English on No.

**No new design:** Order Cancelled (`Ughyuc`/`SB7bvY`, flow `Wx3aGF`) and Wallet Credit Granted (`XW8zRt`/`XPujmy`, flow `QQrePR`) still run the June templates.

### Editing a live Klaviyo email

1. Update the source → `python3 build_templates.py`
2. Push `out/` to the library template ID via the API
3. In the Klaviyo UI, open the flow message → Edit email → paste → Save

⚠️ **Editing a flow message strips its transactional status.** Re-apply per message: set status to Manual → tick "Apply for transactional status" → Submit for review → back to Live. Metric-triggered flows are auto-reviewed, ~24h.

Set the Monaco/Ace editor value and click Save in **separate steps** — doing both in one go means React never registers the change and Save silently persists the old content.

## Supabase Auth

Brevo SMTP relays these. Settings: Authentication → Emails → SMTP Settings.
Host `smtp-relay.brevo.com:587`, account `info@wecook.gr`, sends as `noreply@fitpal.gr`.

| File | Supabase template |
|---|---|
| `supabase_auth/01_signup_confirmation.html` | Confirm sign up |
| `supabase_auth/02_magic_link_otp.html` | Magic link or OTP |
| `supabase_auth/03_password_reset.html` | Reset password |
| `supabase_auth/04_email_change.html` | Change email address — **old design, not rebuilt** |

**Language switch changed.** The old templates used `{{ if eq .UserMetaData.lang "el" }}` with English in the `else`. `.UserMetaData` is undocumented — Supabase documents `{{ .Data }}`. If it never resolved, every Greek customer got English (see WEC-515). The rebuilt three use:

```
{{ if eq .Data.lang "en" }} …English… {{ else }} …Greek… {{ end }}
```

English is now the explicit branch and **Greek the default**, so a failed accessor degrades to Greek. `04_email_change.html` still has the old pattern.

## Known gaps

- **Not sent by the backend:** `event.billing_name` / `billing_address` / `billing_mobile`, and the `*_formatted` currency strings. Rows are conditional, so they're hidden rather than showing em-dashes. → WEC-644
- **`|date:` doesn't work in Klaviyo** on our ISO strings — returns empty, then trips `default`. `|format_date_string` is worse: it 400s the whole render. Send preformatted strings instead.
- **Klaviyo strips the Google Fonts `<link>`** on ingest, so Geologica won't load. Recipients get the Arial fallback.
- **Dev URL:** the subscription templates link to `dev--fitpal-order.netlify.app`. Change `SITE` in `build_templates.py` at prod cutover, rebuild, re-push.
- **Parked, built but not wired:** 02 bank transfer standalone (needs a flow branch + de-dupe against 01), 06 renewal reminder (no auto-renewal event), 10 voucher campaign, 11 newsletter opt-in.
