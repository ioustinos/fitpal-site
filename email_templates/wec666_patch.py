#!/usr/bin/env python3
# WEC-666 — non-blocking email copy changes, applied to the BUILT html in
# out/ + klaviyo/ + supabase_auth/ (the paste-into-Klaviyo source).
#
# Why a patch and not build_templates.py alone: the agency source pack isn't in
# this environment, so `python3 build_templates.py` can't regenerate out/. This
# script edits the built HTML directly and is grep-verifiable. The equivalent
# changes are ALSO applied to build_templates.py so the next real rebuild
# reproduces them (see wec666 markers there).
#
# Idempotent: every change is a guarded replace/removal — running twice is a
# no-op. BLUE-DOT-blocked items (φωτιά-στα-τηγάνια line, end icon, subscription
# title/subtitle) and the renewal reminder are intentionally NOT touched here.

import os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIRS = ["out", "klaviyo", "supabase_auth"]

# --- inline text swaps: (search, replace) applied to any file that has them ---
INLINE = [
    # Υποσύνολο → Κόστος παραγγελίας  (discount row is already {% if %}-conditional)
    ("Υποσύνολο", "Κόστος παραγγελίας"),
    ("Subtotal", "Order cost"),
    # Bank-transfer closing → email the deposit receipt to orders@fitpal.gr
    ("Η παραγγελία ενεργοποιείται μόλις λάβουμε την επιβεβαίωση.",
     "Για την επιβεβαίωση της παραγγελίας σου, στείλε μας στο orders@fitpal.gr το αποδεικτικό κατάθεσής σου."),
    ("Your order activates as soon as we confirm receipt.",
     "To confirm your order, email your deposit receipt to orders@fitpal.gr."),
    # Subscription heading: Plan details → Subscription details
    ("Λεπτομέρειες Πλάνου", "Λεπτομέρειες Συνδρομής"),
    ("Plan details", "Subscription details"),
    # Payment-link intro → shorter new line
    ("Ένα βήμα έμεινε για τα πιο απολαυστικά και υγιεινά γεύματα της εβδομάδας! Όπως συμφωνήσαμε, θα βρεις παρακάτω το ασφαλές payment link για να ολοκληρώσεις την πληρωμή της παραγγελίας σου γρήγορα και εύκολα. Μόλις ολοκληρωθεί, εμείς αναλαμβάνουμε τα υπόλοιπα!",
     "Παρακάτω θα βρεις το ασφαλές payment link για να ολοκληρώσεις την πληρωμή της παραγγελίας σου εύκολα και γρήγορα."),
    ("One step left before the tastiest, healthiest meals of your week. As agreed, below is your secure payment link so you can finish paying quickly and easily. Once it's done, we'll take care of the rest.",
     "Below you'll find the secure payment link to complete your order's payment easily and quickly."),
    # Sign-up confirmation title (Greek only per the ticket)
    ("Καλωσήρθες στην παρέα<br />του Fitpal!", "Καλώς ήρθες στην παρέα<br />των Fitpal meals!"),
    ("Καλωσήρθες στην παρέα<br />του Fitpal,", "Καλώς ήρθες στην παρέα<br />των Fitpal meals,"),
    # WEC-690: the «Στοιχεία χρέωσης» block rendered {{ person.email }} — which
    # on an admin BCC copy is the ADMIN, telling them they placed the order.
    # Prefer the customer's email from the event (added in the WEC-690 server
    # leg), fall back to person.email. Anchored to the billing suffix so the
    # footer's own {{ person.email }} (the real recipient) is left alone.
    # NOTE: must use an {% if %}/{% else %} — NOT `|default:person.email`.
    # Klaviyo's validator raises on a missing variable used as a FILTER ARGUMENT
    # ("Failed lookup for key person"), whereas a bare {{ person.email }} renders
    # empty. So person.email must stay bare, inside the else branch.
    ("{{ person.email }}{% if event.billing_mobile %}",
     "{% if event.customer_email %}{{ event.customer_email }}{% else %}{{ person.email }}{% endif %}{% if event.billing_mobile %}"),
    # Migrate any file already carrying the broken `default:` form.
    ("{{ event.customer_email|default:person.email }}",
     "{% if event.customer_email %}{{ event.customer_email }}{% else %}{{ person.email }}{% endif %}"),
]

# --- full <tr> blocks to REMOVE, matched by a stable inner anchor (DOTALL) ---
# 1) subscription "ΔΕΣ ΤΟ ΜΕΝΟΥ & ΠΑΡΑΓΓΕΙΛΕ" CTA — unique padding on its cell.
BTN_RE = re.compile(
    r'\n *<tr>\s*<td class="pad-side" align="center" style="padding:48px 48px 0 48px;">.*?</tr>',
    re.DOTALL)
# 2) payment-link post-CTA closing paragraph (delete "after the CTA entirely").
PAY_CLOSE_RE = re.compile(
    r'\n *<tr>\s*<td class="pad-side"[^>]*>\s*<p class="body-copy"[^>]*>\s*'
    r'(?:Μόλις ολοκληρώσεις την πληρωμή|Once you)[^<]*'
    r'</p>\s*</td>\s*</tr>', re.DOTALL)
# 3) refunded closing paragraph.
REFUND_CLOSE_RE = re.compile(
    r'\n *<tr>\s*<td class="pad-side"[^>]*>\s*<p class="body-copy"[^>]*>\s*'
    r'(?:Για οποιαδήποτε απορία σχετικά με την επιστροφή|If you have any questions about this refund)[^<]*'
    r'</p>\s*</td>\s*</tr>', re.DOTALL)

# --- subscription: insert a "we'll call you" row after the allergies line ---
CALL_EL = ("Μην ξεχάσεις να μας ενημερώσεις για τυχόν αλλεργίες.",
           "Μην ξεχάσεις να μας ενημερώσεις για τυχόν αλλεργίες.<br /><br />Η ομάδα μας θα σε καλέσει εντός 1 εργάσιμης ημέρας για να φτιάξουμε το πλάνο γευμάτων σου.")
CALL_EN = ("Don't forget to tell us about any allergies.",
           "Don't forget to tell us about any allergies.<br /><br />Our team will call you within 1 business day to build your meal plan.")

# --- WEC-701 §B: bank-transfer details block on the subscription email ---
# For a `transfer` purchase the plan stays pending until the customer pays, so
# the confirmation email must carry IBAN / beneficiary / reference (the WP- code
# from event.bank_reference — NOT an order number). Mirrors the order
# confirmation block (01_order_confirmation). Inserted right before the CTA
# comment; conditional on payment_method == "transfer" (cash never shows it).
BANK_CTA_ANCHOR = "\n    <!-- ── CTA "
def _bank_block(is_el):
    if is_el:
        title, benef, ref, note = (
            "Στοιχεία τραπεζικής μεταφοράς", "Δικαιούχος", "Αιτιολογία",
            "Για την ενεργοποίηση της συνδρομής σου, στείλε μας στο orders@fitpal.gr το αποδεικτικό κατάθεσής σου.")
    else:
        title, benef, ref, note = (
            "Bank transfer details", "Beneficiary", "Reference",
            "To activate your subscription, email your deposit receipt to orders@fitpal.gr.")
    return (
        '\n    {% if event.payment_method == "transfer" %}'
        '\n    <tr>'
        '\n      <td class="pad-side" style="padding:22px 48px 0 48px;">'
        '\n        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF7ED; border:1px solid #FED7AA; border-radius:10px;">'
        '\n          <tr>'
        '\n            <td style="padding:16px 18px; font-family:\'Geologica\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif; font-size:13px; line-height:1.7; color:#004636;">'
        f'\n              <strong>{title}</strong><br />'
        '\n              {% for b in event.bank_transfer_infos %}IBAN: <strong>{{ b.iban }}</strong><br />'
        f'\n              {benef}: {{{{ b.beneficiary }}}}{{% if b.bank_name %}} &middot; {{{{ b.bank_name }}}}{{% endif %}}<br />'
        f'\n              {{% endfor %}}{ref}: <strong>{{{{ event.bank_reference }}}}</strong><br />'
        f'\n              <span style="color:#7A957A;">{note}</span>'
        '\n            </td>'
        '\n          </tr>'
        '\n        </table>'
        '\n      </td>'
        '\n    </tr>'
        '\n    {% endif %}\n'
    )

# --- WEC-698: invoice (Τιμολόγιο) row on the order confirmation (01) email ---
# Shown only for a Τιμολόγιο order; carries Επωνυμία + ΑΦΜ so the customer sees
# their invoice details were recorded. Inserted after the payment-method row —
# anchored on the 01-only 8-space-indented transfer block.
INV_ROW_ANCHOR = '\n        {% if event.payment_method == "transfer" %}'
def _invoice_row(is_el):
    title = "Τιμολόγιο" if is_el else "Invoice"
    vatlabel = "ΑΦΜ" if is_el else "VAT"
    return (
        '\n    {% if event.invoice_type == "invoice" %}'
        '\n    <tr>'
        '\n      <td class="pad-side" style="padding:14px 48px 0 48px;">'
        '\n        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:\'Geologica\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;">'
        '\n          <tr>'
        f'\n            <td align="left"  style="font-size:14px; font-weight:700; color:#004636;">{title}</td>'
        f'\n            <td align="right" style="font-size:14px; font-weight:400; color:#004636;">{{{{ event.invoice_name }}}}{{% if event.invoice_vat %}} &middot; {vatlabel} {{{{ event.invoice_vat }}}}{{% endif %}}</td>'
        '\n          </tr>'
        '\n        </table>'
        '\n      </td>'
        '\n    </tr>'
        '\n    {% endif %}\n'
    )

def patch(text, is_subscription, is_el, is_order_conf=False):
    changed = []
    for a, b in INLINE:
        if a in text:
            text = text.replace(a, b); changed.append(a[:28])
    for name, rx in [("menu-button", BTN_RE), ("payment-close", PAY_CLOSE_RE), ("refund-close", REFUND_CLOSE_RE)]:
        text, n = rx.subn("", text)
        if n: changed.append(f"removed:{name}")
    # The "we'll call you to build your meal plan" line belongs ONLY on the
    # subscription-purchase email — NOT signup, which has its own allergies line.
    if is_subscription:
        for a, b in (CALL_EL, CALL_EN):
            if a in text and "θα σε καλέσει" not in text and "will call you" not in text:
                text = text.replace(a, b); changed.append("call-line")
        # WEC-701 §B bank block — insert once, before the CTA comment.
        if "event.bank_reference" not in text and BANK_CTA_ANCHOR in text:
            text = text.replace(BANK_CTA_ANCHOR, _bank_block(is_el) + BANK_CTA_ANCHOR, 1)
            changed.append("bank-block")
    # WEC-698 invoice row — order-confirmation (01) only, insert once.
    if is_order_conf and "event.invoice_type" not in text and INV_ROW_ANCHOR in text:
        text = text.replace(INV_ROW_ANCHOR, _invoice_row(is_el) + INV_ROW_ANCHOR, 1)
        changed.append("invoice-row")
    return text, changed

def balanced(text):
    def c(t): return len(re.findall(f"<{t}[ >]", text)), text.count(f"</{t}>")
    out = {}
    for t in ("table", "tr", "td"):
        o, cl = c(t); out[t] = (o, cl)
    return out

def main():
    total = 0
    for d in DIRS:
        p = os.path.join(ROOT, d)
        if not os.path.isdir(p): continue
        for fn in sorted(os.listdir(p)):
            if not fn.endswith(".html") or fn.endswith("_preview.html"): continue
            fp = os.path.join(p, fn)
            src = open(fp, encoding="utf-8").read()
            new, changed = patch(src, "05_subscription" in fn, "_en" not in fn, "01_order_confirmation" in fn)
            if new != src:
                bal = balanced(new)
                bad = [t for t,(o,cl) in bal.items() if o != cl]
                open(fp, "w", encoding="utf-8").write(new)
                total += 1
                flag = f"  ⚠️ UNBALANCED {bad} {bal}" if bad else ""
                print(f"{d}/{fn}: {', '.join(changed)}{flag}")
    print(f"\n{total} files changed.")

if __name__ == "__main__":
    main()
