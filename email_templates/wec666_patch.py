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

def patch(text, is_subscription):
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
            new, changed = patch(src, "05_subscription" in fn)
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
