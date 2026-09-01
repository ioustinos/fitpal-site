#!/usr/bin/env python3
"""
Build Fitpal Klaviyo email templates from the 2026-08 agency pack.

Why a script and not hand-edited HTML: the agency markup is 12-26 KB of
table-layout email HTML per file. Hand-editing it is how you lose a closing
</td> and don't notice until Outlook. This applies a small set of surgical,
reviewable transforms and leaves every other byte of their markup untouched.

Transforms:
  1. ASSETS-BASE   -> real Supabase public bucket URL
  2. hero .png     -> .jpg   (re-encoded: 9.6 MB -> 0.9 MB across the set)
  3. 01 day loop   -> restore time window, address, per-item price, macros,
                      variant label, comment, day total
  4. 01 shipping   -> discount row (no shipping concept exists; discount does,
                      and without it subtotal/total don't reconcile)
  5. 01 greeting   -> restore event.first_name
  6. 04 / 05       -> restore detail rows the agency dropped but the live
                      templates and backend already provide
  7. EL -> EN      -> translate copy, identical markup

Gates (all fatal): unresolved placeholders, unbalanced liquid blocks,
unbalanced <table>/<tr>/<td>, and any Greek character surviving into an EN
build.

Run:  python3 build_templates.py
Out:  ./out/<name>.html
"""

import os
import re
import sys

SRC = os.environ.get("FITPAL_AGENCY_SRC", "/tmp/fpnew")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

ASSETS = "https://rhwetztxwjxfstffalwl.supabase.co/storage/v1/object/public/email-assets"

# Public host for customer-facing links. Matches what the live templates
# already use. AT PROD CUTOVER: change this one line and rebuild.
SITE = "https://orders.fitpal.gr"

# Emit {% unsubscribe %} in the footer.
#
# OFF by default — the agency design omits it, and these messages are meant to
# be Transactional, which doesn't require one. Editing a flow message in
# Klaviyo strips its transactional status until Klaviyo re-approves, so there
# IS a window where these send as non-transactional without an unsubscribe
# link. Decision (Ioustinos, 2026-08-15): acceptable while pre-launch, ship the
# final format and wait for Klaviyo.
#
# Flip to True if the messages ever go non-transactional with real volume.
WANT_UNSUBSCRIBE = False

HEROES = ["order-confirmation-hero", "subscription-hero", "signup-hero",
          "login-hero", "voucher-hero", "newsletter-hero"]

FONT = ("'Geologica',-apple-system,BlinkMacSystemFont,'Segoe UI',"
        "Roboto,Arial,sans-serif")

GREEN, MUTED, ITALIC, ACCENT = "#004636", "#7A957A", "#3D5A3D", "#00B96B"
GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")


# ---------------------------------------------------------------- helpers

def assets(html):
    html = html.replace("https://ASSETS-BASE/", ASSETS + "/")
    for h in HEROES:
        html = html.replace(f"{ASSETS}/{h}.png", f"{ASSETS}/{h}.jpg")
    return html


def strip_agency_comment(html):
    return re.sub(r"^\s*<!--.*?-->\s*", "", html, count=1, flags=re.S)


def billing_block(html):
    """
    The agency prints `|default:'—'` on four billing fields, three of which
    the backend does not send — so a live send shows a "Billing details"
    block that is three quarters em-dashes. Show only what exists.
    """
    old = re.search(
        r"\{\{ event\.billing_name\|default:'—' \}\}<br />\s*"
        r"\{\{ event\.billing_address\|default:'—' \}\}<br />\s*"
        r"\{\{ person\.email\|default:'—' \}\}<br />\s*"
        r"\{\{ event\.billing_mobile\|default:'—' \}\}", html)
    if not old:
        raise SystemExit("FAIL [billing block]: not found")
    new = ("{% if event.billing_name %}{{ event.billing_name }}<br />{% endif %}"
           "{% if event.billing_address %}{{ event.billing_address }}<br />{% endif %}"
           "{{ person.email }}"
           "{% if event.billing_mobile %}<br />{{ event.billing_mobile }}{% endif %}")
    return html[:old.start()] + new + html[old.end():]


def add_unsubscribe(html):
    """
    The agency stripped {% unsubscribe %} on the basis that 01-06 would be
    Transactional, which doesn't require one.

    Reality (2026-08-15): editing a flow message's content in Klaviyo STRIPS
    its transactional status, and re-granting is not self-serve — it needs a
    Klaviyo support request. So between any content edit and re-approval the
    message is a non-transactional send, which DOES require an unsubscribe
    link. Keep the tag: it is harmless while transactional (Klaviyo just
    renders it) and essential the moment status lapses.
    """
    if not WANT_UNSUBSCRIBE:
        return html
    n = 0
    for el, label in ((True, "Διαγραφή"), (False, "Unsubscribe")):
        marker = ("Δεν πρόκειται για διαφημιστικό μήνυμα." if el
                  else "This is not a marketing message.")
        if marker in html:
            html = html.replace(
                marker, marker + " {% unsubscribe '" + label + "' %}")
            n += 1
    if n != 1:
        raise SystemExit(f"FAIL [unsubscribe]: expected 1 footer marker, found {n}")
    return html


def load(name):
    html = assets(strip_agency_comment(open(f"{SRC}/{name}.html").read()))
    html = html.replace("https://ORDER-BASE/", f"{SITE}/")
    html = html.replace("https://ACCOUNT-BASE/", f"{SITE}/account")
    return billing_block(html)


def must_replace(html, old, new, label):
    n = html.count(old)
    if n != 1:
        raise SystemExit(f"FAIL [{label}]: expected 1 occurrence of {old!r}, found {n}")
    return html.replace(old, new)


def find_block(html, open_tag, label):
    """
    Span of a {% for %}…{% endfor %}, nesting-aware.

    A non-greedy regex stops at the FIRST {% endfor %} — for the day loop
    that's the *inner* item loop's, silently truncating the block and leaving
    orphaned </td></tr>. Walk the tag stream and match depth instead.
    """
    start = html.find(open_tag)
    if start == -1:
        raise SystemExit(f"FAIL [{label}]: opening tag not found")
    depth = 0
    for m in re.finditer(r"\{%\s*(for|endfor)\b.*?%\}", html[start:], re.S):
        depth += 1 if m.group(1) == "for" else -1
        if depth == 0:
            return start, start + m.end()
    raise SystemExit(f"FAIL [{label}]: unbalanced for/endfor")


def row(label, value, bold=False, colour=GREEN):
    """One detail row in the agency's own style."""
    w = "800" if bold else "400"
    return f"""
    <tr>
      <td class="pad-side" style="padding:20px 48px 0 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:{FONT};">
          <tr>
            <td align="left" valign="top" width="150" style="width:150px; font-size:14px; font-weight:700; line-height:1.4; color:{colour};">{label}</td>
            <td align="right" valign="top" style="font-size:14px; font-weight:{w}; color:{colour};">{value}</td>
          </tr>
        </table>
      </td>
    </tr>
"""


def insert_after_block(html, marker, block, label):
    """
    Insert `block` after the agency comment-delimited block containing
    `marker`. Their file uses `<!-- ── Name ── -->` separators, so the next
    one after the marker is a safe, structure-preserving seam.
    """
    i = html.find(marker)
    if i == -1:
        raise SystemExit(f"FAIL [{label}]: marker {marker!r} not found")
    j = html.find("<!-- ──", i)
    if j == -1:
        raise SystemExit(f"FAIL [{label}]: no block seam after marker")
    return html[:j] + block.strip("\n") + "\n\n    " + html[j:]


# ------------------------------------------------------------- 01 day loop

def day_loop(lang):
    el = lang == "el"
    label = "day_label_el" if el else "day_label_en"
    name = ("item.name_el|default:item.name_en" if el
            else "item.name_en|default:item.name_el")
    variant = ("item.variant_label_el|default:item.variant_label_en" if el
               else "item.variant_label_en|default:item.variant_label_el")
    vtest = ("item.variant_label_el or item.variant_label_en" if el
             else "item.variant_label_en or item.variant_label_el")
    total = "Σύνολο ημέρας" if el else "Day total"
    P, C, F = ("Π", "Υ", "Λ") if el else ("P", "C", "F")

    cell = f"font-family:{FONT}; font-size:13px; line-height:1.55; color:{GREEN};"
    meta = f"font-family:{FONT}; font-size:11px; line-height:1.5; color:{MUTED};"

    return f"""{{% for day in event.days %}}
                    <tr>
                      <td class="daycol" width="84" valign="top" style="width:84px; padding:0 0 20px 0; font-family:{FONT}; font-size:14px; font-weight:700; color:{GREEN}; line-height:1.5;">
                        {{% if day.{label} %}}{{{{ day.{label} }}}}{{% elif day.date_short %}}{{{{ day.date_short }}}}{{% else %}}{{{{ day.date }}}}{{% endif %}}
                      </td>
                      <td valign="top" style="padding:0 0 20px 18px; border-left:2px solid {GREEN};">
                        {{% if day.time_window or day.address %}}
                        <div style="{meta} padding:0 0 9px 0;">{{{{ day.time_window }}}}{{% if day.time_window and day.address %}} &middot; {{% endif %}}{{{{ day.address }}}}</div>
                        {{% endif %}}
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                          {{% for item in day.items %}}
                          <tr>
                            <td width="15" valign="top" style="width:15px; padding:0 0 7px 0; {cell}">&bull;</td>
                            <td valign="top" style="padding:0 0 7px 0; {cell}">
                              {{{{ {name} }}}}{{% if item.qty > 1 %}} &times; {{{{ item.qty }}}}{{% endif %}}
                              <div style="{meta}">{{% if {vtest} %}}{{{{ {variant} }}}} &middot; {{% endif %}}{{{{ item.calories }}}} kcal &middot; {P} {{{{ item.protein }}}}g &middot; {C} {{{{ item.carbs }}}}g &middot; {F} {{{{ item.fat }}}}g</div>
                              {{% if item.comment %}}<div style="font-family:{FONT}; font-size:11px; line-height:1.5; font-style:italic; color:{ITALIC};">&ldquo;{{{{ item.comment }}}}&rdquo;</div>{{% endif %}}
                            </td>
                            <td align="right" valign="top" style="padding:0 0 7px 10px; {cell} white-space:nowrap;">{{{{ item.total_price|floatformat:2 }}}} &euro;</td>
                          </tr>
                          {{% endfor %}}
                        </table>
                        {{% if day.day_total %}}
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px; border-top:1px solid #E2EDE2;">
                          <tr>
                            <td align="left" style="padding:7px 0 0 0; font-family:{FONT}; font-size:12px; font-weight:700; color:{GREEN};">{total}</td>
                            <td align="right" style="padding:7px 0 0 0; font-family:{FONT}; font-size:12px; font-weight:700; color:{GREEN}; white-space:nowrap;">{{{{ day.day_total|floatformat:2 }}}} &euro;</td>
                          </tr>
                        </table>
                        {{% endif %}}
                      </td>
                    </tr>
                    {{% endfor %}}"""


# -------------------------------------------------------------- builders

def build_01():
    html = load("01_order_confirmation_el")

    s, e = find_block(html, "{% for day in event.days %}", "01 day loop")
    html = html[:s] + day_loop("el") + html[e:]

    ship = re.search(r'<tr>\s*<td align="left"[^>]*>Μεταφορικά</td>.*?</tr>', html, re.S)
    if not ship:
        raise SystemExit("FAIL [01 shipping row]: not found")
    disc = (
        '{% if event.discount_amount > 0 %}<tr>\n'
        f'                        <td align="left" style="padding:0 0 9px 0; font-size:14px; font-weight:700; color:{ACCENT};">Έκπτωση</td>\n'
        f'                        <td align="right" style="padding:0 0 9px 0; font-size:14px; font-weight:400; color:{ACCENT};">&minus;{{{{ event.discount_amount|floatformat:2 }}}} &euro;</td>\n'
        '                      </tr>{% endif %}'
    )
    html = html[:ship.start()] + disc + html[ship.end():]

    html = must_replace(
        html,
        "Σε ευχαριστούμε που επέλεξες τα Fitpal Meals!",
        "{% if event.first_name %}{{ event.first_name }}, σ{% else %}Σ{% endif %}"
        "ε ευχαριστούμε που επέλεξες τα Fitpal Meals!",
        "01 greeting")

    # Bank details. The agency moved these out of 01 into their standalone
    # template 02, which is NOT wired to a flow — so shipping 01 without them
    # means a transfer customer receives no IBAN anywhere. Put them back, as
    # the current live template does.
    # The {% if %} wraps the whole <tr>, not just its contents — otherwise a
    # card order renders an empty cell worth 22px of dead vertical space.
    bank = f"""
    {{% if event.payment_method == "transfer" %}}
    <tr>
      <td class="pad-side" style="padding:22px 48px 0 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF7ED; border:1px solid #FED7AA; border-radius:10px;">
          <tr>
            <td style="padding:16px 18px; font-family:{FONT}; font-size:13px; line-height:1.7; color:{GREEN};">
              <strong>Στοιχεία τραπεζικής μεταφοράς</strong><br />
              {{% for b in event.bank_transfer_infos %}}IBAN: <strong>{{{{ b.iban }}}}</strong><br />
              Δικαιούχος: {{{{ b.beneficiary }}}}{{% if b.bank_name %}} &middot; {{{{ b.bank_name }}}}{{% endif %}}<br />
              {{% endfor %}}Αιτιολογία: <strong>{{{{ event.order_number }}}}</strong><br />
              <span style="color:{MUTED};">Η παραγγελία ενεργοποιείται μόλις λάβουμε την επιβεβαίωση.</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    {{% endif %}}
"""
    return insert_after_block(html, "Τρόπος πληρωμής", bank, "01 bank details")


def build_03():
    return load("03_payment_link_sent_el")


def build_04():
    html = load("04_order_refunded_el")
    extra = (
        row("Αρχικό ποσό", "{% if event.order_total %}{{ event.order_total|floatformat:2 }} &euro;{% else %}&mdash;{% endif %}")
        + '{% if event.is_full_refund %}'
        + row("Τύπος", "Πλήρης επιστροφή")
        + '{% else %}'
        + row("Τύπος", "Μερική επιστροφή")
        + '{% if event.cumulative_refund_amount %}'
        + row("Σύνολο επιστροφών", "{{ event.cumulative_refund_amount|floatformat:2 }} &euro;")
        + '{% endif %}{% endif %}'
        + '{% if event.reason %}' + row("Αιτία", "{{ event.reason }}") + '{% endif %}'
    )
    return insert_after_block(html, "Ποσό<br />επιστροφής", extra, "04 refund detail")


def build_05():
    html = load("05_subscription_purchased_el")

    # Django's `date` filter needs a date object; on the ISO string the backend
    # sends it yields "", which then trips `default` and prints an em-dash.
    # Verified by render probe. Print the raw value instead.
    html = must_replace(
        html,
        '{{ event.plan_start_date|date:"d/m/Y"|default:\'—\' }}',
        "{{ event.plan_start_date|default:'&mdash;' }}",
        "05 start date")

    # English heading inside an otherwise Greek email.
    html = must_replace(html, "Plan details", "Λεπτομέρειες Πλάνου", "05 heading")
    extra = (
        '{% if event.meals_label %}' + row("Γεύματα", "{{ event.meals_label }}") + '{% endif %}'
        + '{% if event.meals_per_week %}' + row("Ημέρες ανά εβδομάδα", "{{ event.meals_per_week }}") + '{% endif %}'
        + '{% if event.goal_label %}' + row("Στόχος", "{{ event.goal_label }}") + '{% endif %}'
        + '{% if event.daily_kcal %}' + row("Θερμίδες ανά ημέρα", "{{ event.daily_kcal }} kcal") + '{% endif %}'
        + '{% if event.bonus_credits %}' + row("Bonus", "+{{ event.bonus_credits|floatformat:2 }} &euro;", colour=ACCENT) + '{% endif %}'
        + '{% if event.new_balance %}' + row("Υπόλοιπο Wallet", "{{ event.new_balance|floatformat:2 }} &euro;", bold=True) + '{% endif %}'
        + '{% if event.dietician_managed %}' + row("Υπηρεσίες", "Διαχείριση από διατροφολόγο") + '{% endif %}'
    )
    return insert_after_block(html, "Ημερομηνία έναρξης", extra, "05 plan detail")


# ------------------------------------------------------------ translation

TR = [
    # --- <title> (never the inbox subject — Klaviyo sets that on the flow
    #     message — but it leaks into "view in browser" and webmail tabs) --
    ("<title>Η παραγγελία σου επιβεβαιώθηκε</title>",
     "<title>Your order is confirmed</title>"),
    ("<title>Το link πληρωμής σου είναι έτοιμο</title>",
     "<title>Your payment link is ready</title>"),
    ("<title>Ενημέρωση επιστροφής χρημάτων</title>",
     "<title>Refund confirmation</title>"),
    ("<title>Καλωσήρθες στο πλάνο σου</title>",
     "<title>Welcome to your plan</title>"),
    # --- shared chrome -------------------------------------------------
    ("Λάβαμε την παραγγελία σου. Δες παρακάτω όλες τις λεπτομέρειες.",
     "We've got your order. All the details are below."),
    ("Ολοκλήρωσε την πληρωμή της παραγγελίας σου με ασφάλεια σε λίγα δευτερόλεπτα.",
     "Pay for your order securely in seconds."),
    ("Η επιστροφή χρημάτων για την παραγγελία σου έχει πραγματοποιηθεί.",
     "The refund for your order has been processed."),
    ("Το πλάνο σου είναι ενεργό. Δες παρακάτω τις λεπτομέρειες.",
     "Your plan is active. Details below."),
    ("Αν χρειαστείς οτιδήποτε ή θέλεις να κάνεις κάποια αλλαγή, είμαστε εδώ για σένα.",
     "If you need anything or want to make a change, we're here for you."),
    ("Απλώς επικοινώνησε μαζί μας:", "Just get in touch:"),
    ("Τηλεφωνικά:", "Phone:"),
    ("Καθημερινά 09:30 &ndash; 18:00", "Every day 09:30 &ndash; 18:00"),
    ("Στοιχεία χρέωσης", "Billing details"),
    ("Τρόπος πληρωμής", "Payment method"),
    ("Κάρτα online", "Card online"),
    ("Τραπεζική μεταφορά", "Bank transfer"),
    ("Σύνδεσμος πληρωμής", "Payment link"),
    ("Αντικαταβολή", "Cash on delivery"),
    ("Κάρτα", "Card"),
    # --- 01 -------------------------------------------------------------
    ("Η παραγγελία σου<br />επιβεβαιώθηκε!", "Your order is<br />confirmed!"),
    ("{% if event.first_name %}{{ event.first_name }}, σ{% else %}Σ{% endif %}ε ευχαριστούμε που επέλεξες τα Fitpal Meals!",
     "{% if event.first_name %}{{ event.first_name }}, thank{% else %}Thank{% endif %} you for choosing Fitpal Meals!"),
    ("Η παραγγελία σου καταχωρήθηκε με επιτυχία και η ομάδα μας ετοιμάζεται ήδη να βάλει φωτιά στα τηγάνια.",
     "Your order went through, and our team is already firing up the pans."),
    ("Σύντομα, τα αγαπημένα σου φρεσκομαγειρεμένα γεύματα θα βρίσκονται στην πόρτα σου.",
     "Your favourite freshly cooked meals will be at your door before you know it."),
    ("Παρακάτω μπορείς να δεις όλες τις λεπτομέρειες της παραγγελίας σου.",
     "You'll find the full details of your order below."),
    ("Λεπτομέρειες Παραγγελίας", "Order details"),
    ("Υποσύνολο", "Subtotal"),
    ("Έκπτωση", "Discount"),
    ("Συνολικό κόστος", "Total"),
    ("Σύνολο ημέρας", "Day total"),
    ("Θα λάβεις ενημέρωση από εμάς μέσω email μόλις η παραγγελία σου είναι καθ&rsquo; οδόν για να μπορείς να παρακολουθείς την πορεία της προς εσένα!",
     "We'll email you the moment your order is on its way, so you can follow it right to your door."),
    ("Λαμβάνεις αυτό το email επειδή έκανες παραγγελία στο Fitpal Meals. Δεν πρόκειται για διαφημιστικό μήνυμα.",
     "You're receiving this email because you placed an order with Fitpal Meals. This is not a marketing message."),
    # --- 03 -------------------------------------------------------------
    ("Το link πληρωμής σου<br />είναι έτοιμο!", "Your payment link<br />is ready!"),
    ("Ένα βήμα έμεινε για τα πιο απολαυστικά και υγιεινά γεύματα της εβδομάδας! Όπως συμφωνήσαμε, θα βρεις παρακάτω το ασφαλές payment link για να ολοκληρώσεις την πληρωμή της παραγγελίας σου γρήγορα και εύκολα. Μόλις ολοκληρωθεί, εμείς αναλαμβάνουμε τα υπόλοιπα!",
     "One step left before the tastiest, healthiest meals of your week. As agreed, below is your secure payment link so you can finish paying quickly and easily. Once it's done, we'll take care of the rest."),
    ("Ποσό προς<br />εξόφληση", "Amount<br />due"),
    ("Ολοκλήρωση Πληρωμής", "Complete payment"),
    ("Ο σύνδεσμος πληρωμής δεν είναι διαθέσιμος αυτή τη στιγμή. Απάντησε σε αυτό το email και θα σου τον στείλουμε αμέσως.",
     "The payment link isn't available right now. Reply to this email and we'll send it over straight away."),
    ("Μόλις ολοκληρώσεις την πληρωμή, δεν χρειάζεται να κάνεις κάτι άλλο. Θα λάβεις ενημέρωση από εμάς μέσω email!",
     "Once you've paid there's nothing else to do — we'll confirm by email."),
    ("Λαμβάνεις αυτό το email επειδή έχεις εκκρεμή παραγγελία στο Fitpal Meals. Δεν πρόκειται για διαφημιστικό μήνυμα.",
     "You're receiving this email because you have a pending order with Fitpal Meals. This is not a marketing message."),
    # --- 04 -------------------------------------------------------------
    ("Ενημέρωση επιστροφής<br />χρημάτων", "Refund<br />confirmation"),
    ("Θα θέλαμε να σε ενημερώσουμε ότι έχει πραγματοποιηθεί επιστροφή χρημάτων για την παραγγελία σου με αριθμό",
     "We're writing to let you know a refund has been issued for your order"),
    ("Το ποσό θα εμφανιστεί στον λογαριασμό σου μέσα στις επόμενες εργάσιμες ημέρες, ανάλογα με την τράπεζά σου. Η ομάδα μας είναι πάντα εδώ για ό,τι χρειαστείς!",
     "The amount will appear in your account within the next few working days, depending on your bank. Our team is always here if you need anything."),
    ("Λεπτομέρειες Επιστροφής", "Refund details"),
    ("Λεπτομέρειες Πλάνου", "Plan details"),
    ("Στοιχεία τραπεζικής μεταφοράς", "Bank transfer details"),
    ("Δικαιούχος:", "Beneficiary:"),
    ("Αιτιολογία:", "Reference:"),
    ("Η παραγγελία ενεργοποιείται μόλις λάβουμε την επιβεβαίωση.",
     "Your order activates as soon as we confirm receipt."),
    ("Ποσό<br />επιστροφής", "Refund<br />amount"),
    ("Αρχικό ποσό", "Original amount"),
    ("Σύνολο επιστροφών", "Refunded to date"),
    ("Πλήρης επιστροφή", "Full refund"),
    ("Μερική επιστροφή", "Partial refund"),
    ("Τύπος", "Type"),
    ("Αιτία", "Reason"),
    ("Για οποιαδήποτε απορία σχετικά με την επιστροφή, απάντησε σε αυτό το email.",
     "If you have any questions about this refund, just reply to this email."),
    ("Λαμβάνεις αυτό το email επειδή πραγματοποιήθηκε επιστροφή για παραγγελία σου στο Fitpal Meals. Δεν πρόκειται για διαφημιστικό μήνυμα.",
     "You're receiving this email because a refund was issued for your Fitpal Meals order. This is not a marketing message."),
    # --- 05 -------------------------------------------------------------
    ("{% if event.first_name %}Καλωσήρθες στο πλάνο σου, {{ event.first_name }}!{% else %}Καλωσήρθες στο πλάνο σου!{% endif %}",
     "{% if event.first_name %}Welcome to your plan, {{ event.first_name }}!{% else %}Welcome to your plan!{% endif %}"),
    ("Σε ευχαριστούμε για την αγορά του Wallet Plan! Πλέον, έχεις ακόμα μεγαλύτερη ευελιξία για να απολαμβάνεις τα Fitpal Meals σου. Ετοιμάσου για ένα υγιεινό, γευστικό ταξίδι χωρίς άγχος για το «τι θα φάμε σήμερα;».",
     "Thank you for buying a Wallet Plan! You've now got even more flexibility to enjoy your Fitpal Meals. Get ready for a healthy, tasty run of weeks without the daily “what's for dinner?” question."),
    ("Ποσό που προστέθηκε<br />στο Wallet", "Added to<br />your Wallet"),
    ("Ημερομηνία έναρξης", "Start date"),
    ("Γεύματα", "Meals"),
    ("Ημέρες ανά εβδομάδα", "Days per week"),
    ("Στόχος", "Goal"),
    ("Θερμίδες ανά ημέρα", "Calories per day"),
    ("Υπόλοιπο Wallet", "Wallet balance"),
    ("Υπηρεσίες", "Services"),
    ("Διαχείριση από διατροφολόγο", "Dietitian-managed plan"),
    ("ΔΕΣ ΤΟ ΜΕΝΟΥ &amp; ΠΑΡΑΓΓΕΙΛΕ", "SEE THE MENU &amp; ORDER"),
    ("Μην ξεχάσεις να μας ενημερώσεις για τυχόν αλλεργίες.",
     "Don't forget to tell us about any allergies."),
    ("Λαμβάνεις αυτό το email επειδή ενεργοποίησες ένα πλάνο Fitpal Meals. Δεν πρόκειται για διαφημιστικό μήνυμα.",
     "You're receiving this email because you activated a Fitpal Meals plan. This is not a marketing message."),
]


def to_en(html):
    html = html.replace('lang="el"', 'lang="en"')
    # longest first, so a short key can't eat a substring of a long one
    for src, dst in sorted(TR, key=lambda p: -len(p[0])):
        html = html.replace(src, dst)
    # EL/EN field selection inside the day loop
    html = (html.replace("day.day_label_el", "day.day_label_en")
                .replace("item.name_el|default:item.name_en", "item.name_en|default:item.name_el")
                .replace("item.variant_label_el|default:item.variant_label_en",
                         "item.variant_label_en|default:item.variant_label_el")
                .replace("item.variant_label_el or item.variant_label_en",
                         "item.variant_label_en or item.variant_label_el"))
    return html.replace("&middot; Π ", "&middot; P ").replace("&middot; Υ ", "&middot; C ").replace("&middot; Λ ", "&middot; F ")


# ----------------------------------------------------------------- gates

def check(name, html):
    errs = []
    for bad, why in (("{{ event.shipping", "shipping var should be gone"),
                     ("day.day.", "double 'day.' prefix")):
        if bad in html:
            errs.append(f"{why} ({bad!r} present)")

    # An em-dash default is fine on always-sent fields (order_number). It is
    # NOT fine on the billing fields the backend doesn't send yet — that
    # renders a block of dashes to a real customer. Hide those rows instead.
    for m in re.findall(r"\{\{\s*event\.billing_\w+\|default[^}]*\}\}", html):
        errs.append(f"em-dash default on an unsent billing field: {m.strip()}")

    # Any UNRESOLVED-BASE style placeholder, not just the one we knew about.
    # ORDER-BASE shipped a dead CTA link past a check that only knew ASSETS-BASE.
    for tok in sorted(set(re.findall(r"\b[A-Z][A-Z0-9]{2,}-[A-Z0-9]{2,}\b", html))):
        if tok not in ("UTF-8", "X-UA-COMPATIBLE"):
            errs.append(f"unresolved placeholder token: {tok}")

    # Django's `date` filter silently returns "" on the ISO strings our backend
    # sends, which then trips `default` and prints an em-dash. Verified by
    # render probe — never let one back in.
    for m in re.findall(r"\{\{[^}]*\|date:[^}]*\}\}", html):
        errs.append(f"`|date:` filter fails on our ISO strings: {m.strip()}")

    want = 1 if WANT_UNSUBSCRIBE else 0
    if html.count("{% unsubscribe") != want:
        errs.append(f"expected {want} unsubscribe tag(s), found {html.count('{% unsubscribe')}")

    tags = re.findall(r"\{%\s*(\w+)", html)
    for o, c in (("for", "endfor"), ("if", "endif")):
        if tags.count(o) != tags.count(c):
            errs.append(f"liquid {o}/{c} unbalanced: {tags.count(o)} vs {tags.count(c)}")

    for t in ("table", "tr", "td"):
        a = len(re.findall(rf"<{t}[\s>]", html))
        b = len(re.findall(rf"</{t}>", html))
        if a != b:
            errs.append(f"<{t}> unbalanced: {a} open vs {b} close")

    if name.endswith("_en"):
        body = re.search(r"<body.*?</body>", html, re.S)
        leftovers = []
        for chunk in re.split(r"<[^>]+>", body.group(0) if body else html):
            for piece in re.split(r"(?:\{%[^%]*%\}|\{\{[^}]*\}\})", chunk):
                s = " ".join(piece.split())
                if s and GREEK.search(s) and s not in leftovers:
                    leftovers.append(s)
        for s in leftovers:
            errs.append(f"untranslated Greek: {s[:70]!r}")

    if errs:
        raise SystemExit(f"FAIL [{name}]:\n    - " + "\n    - ".join(errs))


# ------------------------------------------------- Supabase auth templates
#
# One template serves both languages (Supabase has a single template per type),
# so the switch is inline Go-template rather than two files.
#
# Accessor: `.Data` is the DOCUMENTED variable for auth.users.user_metadata
#   https://supabase.com/docs/guides/auth/auth-email-templates
# The current live templates use `.UserMetaData`, which is undocumented. We do
# NOT chain the two: Go templates error on a missing STRUCT field, so an `or`
# across both accessors risks failing the whole render.
#
# Polarity is deliberate: English is the explicit branch, Greek is the default.
# If the accessor ever resolves to nothing, everyone gets GREEK — the right
# fallback for a Greek business. The live templates have it the other way
# round, which is why a broken accessor there would send Greek customers
# English. Confirm with one test send per language.

AUTH_TR = [
    ("Καλωσήρθες στην παρέα<br />του Fitpal,", "Welcome to the<br />Fitpal family,"),
    ("Καλωσήρθες στην παρέα<br />του Fitpal!", "Welcome to the<br />Fitpal family!"),
    ("Επιβεβαίωσε το email σου και ξεκίνα με τα Fitpal Meals.",
     "Confirm your email and get started with Fitpal Meals."),
    ("Χαιρόμαστε πολύ που πλέον ανήκεις στην κοινότητα των Fitpal Meals. Εδώ θα βρεις τον πλέον υγιεινό και γευστικό τρόπο να τρέφεσαι, ακριβώς στα μέτρα σου.",
     "We're really glad you've joined the Fitpal Meals community. This is where you'll find the healthiest, tastiest way to eat — built around you."),
    ("Ο λογαριασμός σου δημιουργήθηκε με επιτυχία και ήρθε η ώρα να ανακαλύψεις το πρώτο σου μενού!",
     "Your account is ready — time to discover your first menu."),
    ("ΞΕΚΙΝΑ ΤΩΡΑ!", "GET STARTED"),
    ("Λαμβάνεις αυτό το email επειδή δημιουργήθηκε λογαριασμός Fitpal Meals με αυτή τη διεύθυνση. Αν δεν ήσουν εσύ, αγνόησε αυτό το μήνυμα και ο λογαριασμός δεν θα ενεργοποιηθεί.",
     "You're receiving this email because a Fitpal Meals account was created with this address. If it wasn't you, ignore this message and the account won't be activated."),
    ("Ο κωδικός σύνδεσης μίας χρήσης βρίσκεται μέσα στο email.",
     "Your one-time sign-in code is inside."),
    ("Η ασφαλής σου σύνδεση<br />στα Fitpal Meals!", "Your secure sign-in<br />to Fitpal Meals"),
    ("Η πρόσβαση στον λογαριασμό σου τώρα είναι πιο εύκολη από ποτέ! Χρησιμοποίησε τον παρακάτω κωδικό μίας χρήσης (OTP) ή κάνε κλικ στο ασφαλές link (Magic Link) για να συνδεθείς απευθείας, χωρίς να χρειάζεται να θυμάσαι κωδικούς.",
     "Getting into your account has never been easier. Use the one-time code (OTP) below, or click the secure Magic Link to sign in directly — no password to remember."),
    ("ΣΥΝΔΕΣΗ ΤΩΡΑ", "SIGN IN NOW"),
    ("Ο κωδικός και το link ισχύουν για 1 ώρα.",
     "The code and the link are valid for 1 hour."),
    ("Αν δεν ζήτησες εσύ αυτήν την πρόσβαση, μπορείς απλώς να αγνοήσεις αυτό το email.",
     "If you didn't request this, you can simply ignore this email."),
    ("Λαμβάνεις αυτό το email επειδή ζητήθηκε σύνδεση στον λογαριασμό Fitpal Meals με αυτή τη διεύθυνση. Αν δεν ήσουν εσύ, αγνόησε αυτό το μήνυμα — κανείς δεν μπορεί να συνδεθεί χωρίς τον κωδικό.",
     "You're receiving this email because a sign-in was requested for the Fitpal Meals account at this address. If it wasn't you, ignore this message — nobody can sign in without the code."),
    ("Πάτησε το κουμπί για να ορίσεις νέο κωδικό πρόσβασης.",
     "Tap the button to set a new password."),
    ("Επαναφορά του κωδικού σου", "Reset your password"),
    ("Ξέχασες τον κωδικό σου; Συμβαίνει και στους καλύτερους. Πάτησε στο παρακάτω κουμπί για να δημιουργήσεις έναν νέο κωδικό πρόσβασης και να επιστρέψεις γρήγορα στον προγραμματισμό των αγαπημένων σου γευμάτων.",
     "Forgotten your password? Happens to the best of us. Tap the button below to set a new one and get straight back to planning your favourite meals."),
    ("ΘΕΛΩ ΝΕΟ ΚΩΔΙΚΟ!", "SET A NEW PASSWORD"),
    ("Ο σύνδεσμος ισχύει για 1 ώρα και μπορεί να χρησιμοποιηθεί μία φορά.",
     "The link is valid for 1 hour and can be used once."),
    ("Αν δεν ζήτησες εσύ αλλαγή κωδικού, μπορείς απλώς να αγνοήσεις αυτό το email.",
     "If you didn't request a password change, you can simply ignore this email."),
    ("Λαμβάνεις αυτό το email επειδή ζητήθηκε επαναφορά κωδικού για τον λογαριασμό Fitpal Meals με αυτή τη διεύθυνση. Αν δεν ήσουν εσύ, αγνόησε αυτό το μήνυμα — ο κωδικός σου παραμένει ο ίδιος.",
     "You're receiving this email because a password reset was requested for the Fitpal Meals account at this address. If it wasn't you, ignore this message — your password stays the same."),
    ("Μην ξεχάσεις να μας ενημερώσεις για τυχόν αλλεργίες.",
     "Don't forget to tell us about any allergies."),
    ("Αν έχεις οποιαδήποτε απορία, είμαστε εδώ για σένα.",
     "If you have any questions, we're here for you."),
    ("Απλώς επικοινώνησε μαζί μας:", "Just get in touch:"),
    ("Τηλεφωνικά:", "Phone:"),
    ("Καθημερινά 09:30 &ndash; 18:00", "Every day 09:30 &ndash; 18:00"),
]

AUTH_TITLES = [
    ("Καλωσήρθες στην παρέα του Fitpal", "Welcome to Fitpal"),
    ("Η ασφαλής σου σύνδεση στα Fitpal Meals", "Your secure sign-in to Fitpal Meals"),
    ("Επαναφορά του κωδικού σου", "Reset your password"),
]


def build_auth(name):
    html = assets(strip_agency_comment(open(f"{SRC}/{name}.html").read()))
    html = html.replace("https://ORDER-BASE/", f"{SITE}/")
    html = html.replace("https://ACCOUNT-BASE/", f"{SITE}/account")

    # <title> is a plain swap — no conditional, English reads fine in a tab.
    for el, en in AUTH_TITLES:
        html = html.replace(f"<title>{el}</title>", f"<title>{en}</title>")

    for el, en in sorted(AUTH_TR, key=lambda p: -len(p[0])):
        if el in html:
            html = html.replace(
                el, '{{ if eq .Data.lang "en" }}' + en + '{{ else }}' + el + '{{ end }}')
    return html


AUTH = {
    "07_signup_confirmation": "07_signup_confirmation",
    "08_magic_link_otp": "08_magic_link_otp",
    "09_password_reset": "09_password_reset",
}


def check_auth(name, html):
    errs = []
    if "ASSETS-BASE" in html or re.search(r"\b[A-Z]{3,}-[A-Z]{3,}\b", html.replace("UTF-8", "")):
        toks = set(re.findall(r"\b[A-Z][A-Z0-9]{2,}-[A-Z0-9]{2,}\b", html))
        for t in toks - {"UTF-8", "X-UA-COMPATIBLE"}:
            errs.append(f"unresolved placeholder: {t}")
    a, b = html.count("{{ if "), html.count("{{ end }}")
    if a != b:
        errs.append(f"go-template if/end unbalanced: {a} vs {b}")
    if ".UserMetaData" in html:
        errs.append("uses undocumented .UserMetaData accessor")
    for t in ("table", "tr", "td"):
        x = len(re.findall(rf"<{t}[\s>]", html))
        y = len(re.findall(rf"</{t}>", html))
        if x != y:
            errs.append(f"<{t}> unbalanced: {x} vs {y}")
    if errs:
        raise SystemExit(f"FAIL [{name}]:\n    - " + "\n    - ".join(errs))


BUILDERS = {
    "01_order_confirmation": build_01,
    "03_payment_link_sent": build_03,
    "04_order_refunded": build_04,
    "05_subscription_purchased": build_05,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for stem, fn in BUILDERS.items():
        el = fn()
        # unsubscribe is added AFTER translation, so each language gets its
        # own label ('Διαγραφή' / 'Unsubscribe')
        for lang, html in (("el", add_unsubscribe(el)),
                           ("en", add_unsubscribe(to_en(el)))):
            name = f"{stem}_{lang}"
            check(name, html)
            with open(os.path.join(OUT, name + ".html"), "w") as f:
                f.write(html)
            print(f"  OK  {name:34} {len(html):>7,} bytes")

    for name, src in AUTH.items():
        html = build_auth(src)
        check_auth(name, html)
        with open(os.path.join(OUT, name + ".html"), "w") as f:
            f.write(html)
        n = html.count('{{ if eq .Data.lang "en" }}')
        print(f"  OK  {name:34} {len(html):>7,} bytes   ({n} bilingual blocks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
