"""Builds docs/dietitian-partners-test.html from the qa-test-script template.
Run: python3 docs/build_dietitian_test.py /tmp/claude-0/qa_template.html
"""
import sys, re, html

SITE = "https://dev--fitpal-order.netlify.app"

def il(s):  # inline code
    return f'<span class="inline">{s}</span>'

E = il  # alias

INTRO = f"""
<div class="block">
  <h3>What this pass covers</h3>
  <p>The dietitian partner feature (WEC-838 — Dietitian Partners epic: dietitians resell plans and order for their clients) on the dev site, from three browser windows: <strong>admin</strong>, <strong>dietitian</strong> and <strong>client</strong>. It walks every screen that shipped: admin dietitian management, the /partner portal, the client's accept and consent prompts, the dietitian discount at checkout, commission and payouts, and the two paid add-ons. The dev database holds 25 anonymized customers «Πελάτης Δοκιμής N» with real-looking orders; none is linked to a dietitian yet.</p>
</div>

<div class="block">
  <h3>The three browser windows</h3>
  <p>You play three people at once, so you need three windows that don't share a sign-in. Every step starts with <strong>SIGNED IN AS</strong>: it names the window and the account. Keep all three open side by side for the whole pass.</p>
  <div class="scroller"><table>
    <tr><th>Window</th><th>How to open it</th><th>Signed in as</th></tr>
    <tr><td><strong>ADMIN window</strong></td><td>Your normal Chrome window</td><td>{il("ioustinos.sarris@gmail.com")}: you. You're an admin and also an owner of the TEST dietitian.</td></tr>
    <tr><td><strong>DIETITIAN window</strong></td><td>A second Chrome profile: click your profile picture at the top right of Chrome → «Add» → «Continue without an account». It opens a new window with its own sign-ins.</td><td>{il("ioustinos.sarris+diet@gmail.com")}: plays the dietitian and has no admin rights.</td></tr>
    <tr><td><strong>CLIENT window</strong></td><td>An incognito window from your normal Chrome: ⌘ + Shift + N</td><td>The customer named in each step, e.g. {il("ioustinos.sarris+dev23@gmail.com")}. Only one customer at a time: sign out before you sign in as the next one.</td></tr>
  </table></div>
</div>

<div class="block">
  <h3>How to sign in (the same in every window)</h3>
  <ol>
    <li>Open {il(SITE)} in that window.</li>
    <li>Click «Σύνδεση» at the top right.</li>
    <li>Click «Στείλε μου κωδικό στο email».</li>
    <li>Type the account's email and click «Στείλε μου κωδικό».</li>
    <li>Open your own Gmail ({il("ioustinos.sarris@gmail.com")}). The code arrives there for every account, because they are all +aliases of your address.</li>
    <li>Type the code and click «Επαλήθευση &amp; σύνδεση».</li>
  </ol>
  <p><strong>To check who is signed in:</strong> your name or email shows at the top right. <strong>To sign out:</strong> click it, then «Αποσύνδεση».</p>
  <p>A step that says «SIGNED OUT» means: sign out in that window before you start.</p>
</div>

<div class="block">
  <h3>Reaching the first screen</h3>
  <ul>
    <li>Site: {il(SITE)}</li>
    <li>Admin: {il("/admin/partners")} (sidebar «Dietitians»). Portal: {il("/partner")}. Referral: {il("/ref/test-e2e-diet")}</li>
    <li>Viva sandbox card: {il("4111 1111 1111 1111")}, any future expiry, any CVV, 3DS code {il("111111")}</li>
    <li>The TEST dietitian «TEST Διαιτολόγος (E2E)» starts at <strong>6% client discount / 6% commission</strong> with progress tracking and referral on. If you change the defaults in 1.3, read every 6% below as your number.</li>
  </ul>
</div>

<div class="block">
  <h3>Looks like a fault, is not</h3>
  <ul>
    <li>Seeded orders have numbers starting {il("SD-")}, not {il("FP-")}. That's deliberate so they never clash with new dev orders.</li>
    <li>«Ως πελάτης» / «Place order for this customer» opens a <strong>new tab</strong> (WEC-868). If Chrome says it blocked a pop-up, allow pop-ups for the dev site once and press the button again.</li>
    <li>Wallet-paid orders always show 0 commission. The commission was earned when the plan was bought.</li>
    <li>Cash and transfer orders show 0 commission until they're marked paid. Commission counts collected money only.</li>
    <li>Ordering for a client from <em>your own</em> account records the order as placed by admin, not by the dietitian, because you're an admin. Part 5 uses the DIETITIAN window for that reason.</li>
  </ul>
</div>

<div class="block">
  <h3>Reporting a failure</h3>
  <p>Press <strong>Fail</strong> and write what you saw: the amount, the text on screen, the client, and whether it repeats. <strong>Blocked</strong> means an earlier failure stopped you. Press <strong>Save results</strong> as you go, then send me the JSON file or press <strong>Copy</strong> and paste it here.</p>
</div>

<div class="block flag">
  <h3>Known gaps going in — read before you start</h3>
  <ul>
    <li><strong>No ticket reflects the code yet.</strong> In Linear, WEC-839 (Partners DB foundation) is In Progress and WEC-840…853 are all Todo, although most of their code is on dev. Your verdicts here decide where each one goes.</li>
    <li><strong>WEC-853 (dietitian notifications)</strong> is not built. The add-on switch saves, but nothing is sent. Not covered below.</li>
    <li><strong>WEC-842 (add client) asks for an email confirmation for existing customers.</strong> What was built instead is an in-site prompt at the client's next sign-in. No email is sent.</li>
    <li><strong>WEC-849 (plans through the dietitian):</strong> in the code, the client discount applies to orders only. A plan bought through a dietitian earns commission but gets no dietitian discount.</li>
    <li><strong>Order history:</strong> the dietitian sees every order of a linked client, including orders placed before the link existed.</li>
    <li><strong>The QR image</strong> is drawn by an outside service (api.qrserver.com), which receives the referral link.</li>
  </ul>
</div>
"""


ADMIN_ACC = "ioustinos.sarris@gmail.com"
DIET_ACC = "ioustinos.sarris+diet@gmail.com"
def adm(): return f"<strong>ADMIN window</strong>: {il(ADMIN_ACC)} (you)"
def die(): return f"<strong>DIETITIAN window</strong>: {il(DIET_ACC)}"
def cli(email, how="sign in"):
    if how == "switch":
        return f"<strong>CLIENT window</strong>: sign out of the previous client first («Αποσύνδεση» under your name, top right), then sign in as {il(email)}"
    if how == "signup":
        return f"<strong>CLIENT window</strong>: SIGNED OUT. You create {il(email)} in this step, with the «Εγγραφή» tab instead of «Σύνδεση»"
    if how == "same":
        return f"<strong>CLIENT window</strong>: still {il(email)} from the previous step"
    return f"<strong>CLIENT window</strong>: {il(email)}"
D = lambda n: f"ioustinos.sarris+dev{n}@gmail.com"

# Who must be signed in where, per step.
LOGIN = {
  "1.1": [adm()], "1.2": [die()], "1.3": [adm()],
  "2.1": [adm()], "2.2": [adm()], "2.3": [adm()], "2.4": [adm()],
  **{k: [die()] for k in ["3.1","3.2","3.3","3.4","3.5","3.6","3.7","3.8","3.9"]},
  "4.1": [cli(D(23))], "4.2": [cli(D(23), "same"), die()], "4.3": [cli(D(23), "same")],
  "4.4": [cli(D(23), "same")], "4.5": [cli(D(23), "same")], "4.6": [die()], "4.7": [adm(), die()],
  **{k: [die()] for k in ["5.1","5.2","5.3","5.4","5.5","5.6"]}, "5.7": [adm(), die()],
  "6.1": [die()], "6.2": [adm()], "6.3": [cli(D("04"), "switch"), adm(), die()],
  "6.4": [die(), cli(D(13), "switch"), adm()], "6.5": [die(), cli(D("06"), "switch"), adm()],
  "7.1": [cli("ioustinos.sarris+ref1@gmail.com", "signup"), die()],
  "7.2": [f"<strong>CLIENT window</strong>: SIGNED OUT first; you sign in as {il(D('05'))} after opening the link", adm()],
  "7.3": [adm(), cli("ioustinos.sarris+ref2@gmail.com", "signup"), die()],
  "8.1": [die()], "8.2": [adm(), die()],
  "9.1": [adm()], "9.2": [die()], "9.3": [die()],
  "10.1": [cli(D(10), "switch")], "10.2": [adm(), die()], "10.3": [die()],
  "10.4": [adm(), die(), cli(D(13), "switch")], "10.5": [adm()],
  "11.1": [adm()], "11.2": [adm()], "11.3": [adm()], "11.4": [adm()], "11.5": [adm()],
  "11.6": [adm()], "11.7": [adm(), die()], "11.8": [die(), cli(D(23), "switch")],
  "11.9": [die(), cli(D(23), "same")], "11.10": [adm()],
}

# (part title, part note, [steps]); step = dict(id,title,where,do,expect,fail,aside)
PARTS = [
 ("1 · Setup", "One-time setup. A client's terms are copied from the dietitian's defaults at the moment of linking, so settle the defaults before linking anyone.", [
  dict(id="1.1", title="The dev site loads and you are admin",
       where=f"ADMIN window · {il(SITE)}",
       do=["Open the site signed in as yourself."],
       expect=["The weekly menu loads.", "The Admin entry is available."],
       fail=["The menu shows an error or no dishes.", "No Admin entry."]),
  dict(id="1.2", title="A plain dietitian login exists",
       where=f"DIETITIAN window · {il(SITE)}",
       do=[f"In a SECOND browser or Chrome profile (not the admin one), sign in with {il('ioustinos.sarris+diet@gmail.com')} by email code. This is the dietitian's own account, not admin.",
           "If this account already signed in during an earlier run, just confirm it is signed in and move on."],
       expect=["The code arrives in your Gmail.", "You are signed in as an ordinary customer, with no Admin entry."],
       fail=["No code email within 2 minutes.", "«Error sending confirmation email»."]),
  dict(id="1.3", title="The dietitian login is attached to TEST",
       where=f"ADMIN window · {il('/admin/partners')} → «TEST Διαιτολόγος (E2E)» → tab «Details &amp; add-ons»",
       do=["Under «Portal logins», enter the +diet email and press «Link login».",
           "Check the defaults: client discount, commission, «Progress tracking» and «Referral link + QR» ticked, referral code «test-e2e-diet».",
           "Change the percentages if you want spec-like numbers, press «Save», reload."],
       expect=["The +diet email is listed under Portal logins.", "Every value you saved is still there after reload."],
       fail=["«Δεν υπάρχει λογαριασμός με αυτό το email» although 1.2 passed.", "Values revert after reload."]),
 ]),
 ("2 · Admin: managing dietitians", "", [
  dict(id="2.1", title="A second dietitian can be created",
       where=f"ADMIN window · {il('/admin/partners')}",
       do=["Press «+ New dietitian».", "Name «Δοκιμή Β», commission 12, client discount 10, no add-ons ticked. Press «Save».", "Reload the page."],
       expect=["«Δοκιμή Β» is in the list with 12 / 10 after reload."],
       fail=["Save error, or the values change after reload."]),
  dict(id="2.2", title="Admin can open any dietitian's portal",
       where="ADMIN window · «Δοκιμή Β» → button «Open portal as Δοκιμή Β →»",
       do=["Press the button.", "Then switch the top-bar selector «Προβολή ως» to «TEST Διαιτολόγος (E2E)»."],
       expect=[f"{il('/partner')} opens as Δοκιμή Β: no clients, no referral banner.", "After switching, the portal shows TEST with its referral banner."],
       fail=["«Δεν είστε συνεργάτης διαιτολόγος».", "The selector switches but the data stays the same."]),
  dict(id="2.3", title="Admin links an existing customer directly",
       where=f"ADMIN window · {il('/admin/partners')} → TEST → tab «Clients &amp; terms»",
       do=[f"Type {il('ioustinos.sarris+dev23@gmail.com')} in «link an existing customer by email» and press «Link»."],
       expect=["A row «Πελάτης Δοκιμής 23», status active, discount and commission equal to TEST's defaults, consent «—»."],
       fail=["Status pending, or percentages not equal to the defaults."]),
  dict(id="2.4", title="One client cannot have two dietitians",
       where="ADMIN window · «Δοκιμή Β» → «Clients &amp; terms»",
       do=["Try to link the same +dev23 email."],
       expect=["Refused with «Ο πελάτης είναι ήδη συνδεδεμένος με διαιτολόγο.»"],
       fail=["A second link is created."]),
 ]),
 ("3 · Dietitian portal: list, client card, targets, orders", "Πελάτης Δοκιμής 23 has a paid 3-month plan, a wallet, and three wallet-paid orders.", [
  dict(id="3.1", title="The dietitian sees only their own portal",
       where=f"DIETITIAN window · {il('/partner')}",
       do=["Open the portal."],
       expect=["Menu «Πελάτες · Παραγγελίες · Οικονομικά».", "Top bar shows the TEST name badge, the +diet email and «Αποσύνδεση». No «Προβολή ως» selector."],
       fail=["Any admin screen or selector is visible.", "«Δεν είστε συνεργάτης διαιτολόγος»."]),
  dict(id="3.2", title="The client list shows the linked client",
       where="DIETITIAN window · «Πελάτες»",
       do=["Read the row for Πελάτης Δοκιμής 23."],
       expect=["«Ενεργός» plus «Χωρίς συγκατάθεση».", "6% / 6%.", "Wallet 1.186,78 €.", "«Πλάνο έως» 23/12/2026."],
       fail=["Other customers are listed.", "Wallet or plan date differ."]),
  dict(id="3.3", title="Referral link copies and the QR scans",
       where="DIETITIAN window · «Πελάτες», the referral banner",
       do=["Press «Αντιγραφή» and paste somewhere.", "Press «QR» and scan it with your phone."],
       expect=[f"The pasted text is {il(SITE + '/ref/test-e2e-diet')}.", "The QR opens the same link."],
       fail=["The copy does nothing.", "The QR points elsewhere."]),
  dict(id="3.4", title="The client card shows plan, wallet and address but hides body data",
       where="DIETITIAN window · click Πελάτης Δοκιμής 23",
       do=["Read every card on the page."],
       expect=["«Στοιχεία πελάτη» shows name and phone, then the consent warning instead of body fields.",
               "«Πλάνο &amp; πορτοφόλι»: 3 μήνες · 5 ημέρες/εβδ., 1454 kcal, 21/09/2026 → 23/12/2026, 1.513,67 € · Πληρωμένο.",
               "«Διευθύνσεις»: Αγίας Θέκλας 34.", "«Παραγγελίες» lists SD- orders."],
       fail=["Height, weight or sex are visible before consent.", "Any figure differs from the above."]),
  dict(id="3.5", title="Daily and per-meal targets save",
       where="DIETITIAN window · client 23 → card «Στόχοι (ίδιοι κάθε μέρα)»",
       do=["Press «Θερμίδες από το πλάνο (1454)».", "Enter protein 90, carbs 180, fat 48 for the day.",
           "Fill Πρωινό / Μεσημεριανό / Βραδινό so the meal kcal add up to about 1000 (deliberately low).",
           "Press «Αποθήκευση στόχων», then reload."],
       expect=["«✓ Αποθηκεύτηκε».", "After reload every value is still there.", "«Σύνολο γευμάτων» kcal is red, since it's more than 5% off the day."],
       fail=["An error on save.", "Values lost after reload.", "The meal total isn't flagged."]),
  dict(id="3.6", title="Orders compare against the target per day",
       where="DIETITIAN window · client 23 → «Παραγγελίες» at the bottom",
       do=["Read the day rows and the week boxes above them."],
       expect=["Each day's kcal/P/C/F is green within ±10% of target, red otherwise, with the +/− difference.",
               "A weekly box per week: days, average kcal, «στόχος 1454», days within ±10%.",
               "The weekday on each row matches its date."],
       fail=["Wrong weekday for a date.", "Colours inverted, or no comparison."]),
  dict(id="3.7", title="Dish detail adds up",
       where="DIETITIAN window · any day row → «Πιάτα»",
       do=["Open one day and add up the dish kcal."],
       expect=["Rows read qty × name — variant, macros already multiplied by quantity.", "The sum equals the day's kcal."],
       fail=["Sum differs from the day row."]),
  dict(id="3.8", title="«Παραγγελίες» shows only own clients",
       where="DIETITIAN window · «Παραγγελίες», selector «Όλοι οι πελάτες»",
       do=["Read the list."],
       expect=["Only Πελάτης Δοκιμής 23's orders."],
       fail=["Any other customer's order."]),
  dict(id="3.9", title="Finance is empty before any linked order",
       where="DIETITIAN window · «Οικονομικά»",
       do=["Look at this month, then tick «Όλα»."],
       expect=["«Καμία κίνηση» and 0,00 € on all four tiles."],
       fail=["Any line from a seeded order."],
       aside="Seeded orders were placed before the link, so they carry no dietitian. That's why Finance starts empty."),
 ]),
 ("4 · Client side: consent and discount", "", [
  dict(id="4.1", title="The linked client is asked for consent",
       where=f"CLIENT window · {il(SITE)}",
       do=[f"Sign in as {il('ioustinos.sarris+dev23@gmail.com')}.", "Switch the site to English and read the prompt, then back to Greek."],
       expect=["A prompt at the bottom: «Συγκατάθεση για τον/την διαιτολόγο TEST Διαιτολόγος (E2E)», a ticked checkbox, «Αργότερα» and «Συμφωνώ».", "The English version reads correctly."],
       fail=["No prompt.", "The prompt shows commission or anything financial."]),
  dict(id="4.2", title="Consent sticks and unlocks body data",
       where="CLIENT window, then DIETITIAN window · client 23's card",
       do=["In the CLIENT window press «Συμφωνώ» and reload.", "In the DIETITIAN window reload client 23's card and the client list."],
       expect=["In the CLIENT window the prompt is gone for good.", "In the DIETITIAN window body data shows: Γυναίκα, 1983, 166 cm, 55 kg, and the «Πρόοδος &amp; μετρήσεις» card appears.", "The list no longer says «Χωρίς συγκατάθεση»."],
       fail=["The prompt returns after reload.", "the DIETITIAN window still hides body data."]),
  dict(id="4.3", title="The client sees the dietitian discount as its own line",
       where="CLIENT window · menu, cart, checkout",
       do=["As +dev23 add dishes on two days.", "Open the cart, then checkout."],
       expect=["A line «Έκπτωση διαιτολόγου 6%» equal to 6% of the items subtotal, in the cart and at checkout.", "No commission is shown anywhere."],
       fail=["No discount line.", "Discount computed on something other than the items subtotal.", "Commission visible to the client."]),
  dict(id="4.4", title="The discount stacks with a voucher",
       where="CLIENT window · checkout",
       do=["Apply a public voucher, if you have one handy. Note the totals.", "Remove it again."],
       expect=["Both discounts show and the total never goes below zero."],
       fail=["The voucher removes the dietitian discount or the other way round."],
       aside="Leave as Blocked if you have no public voucher code to hand."),
  dict(id="4.5", title="A cash order keeps the discount",
       where="CLIENT window · checkout → place order",
       do=["Pay with cash and place the order."],
       expect=["The confirmation total equals subtotal minus 6%."],
       fail=["The total on the confirmation differs from the checkout total."]),
  dict(id="4.6", title="The dietitian sees the order, with no commission yet",
       where="DIETITIAN window · «Παραγγελίες» and «Οικονομικά»",
       do=["Find the new FP- order."],
       expect=["The order card shows «(έκπτωση X €)» and «Μετρητά».", "Finance has one line: «Πληρώθηκε» 0,00 €, commission 0,00 €."],
       fail=["Commission accrues before payment."]),
  dict(id="4.7", title="Commission accrues once the cash is marked paid",
       where="ADMIN window · the order in admin, then DIETITIAN window · «Οικονομικά»",
       do=["Mark that order paid in admin the way you normally do.", "Reload Finance in the DIETITIAN window."],
       expect=["The line shows the collected amount and a 6% commission, status «Οφείλεται»."],
       fail=["Commission still 0 after the order is paid."]),
 ]),
 ("5 · Dietitian creates a client and orders for them", "", [
  dict(id="5.1", title="A brand-new client is active at once",
       where="DIETITIAN window · «Πελάτες» → «+ Νέος πελάτης»",
       do=[f"Name «Νέος Δοκιμής», email {il('ioustinos.sarris+dnew1@gmail.com')}, any phone.",
           "Address Λεωφόρος Πεντέλης 64, Βριλήσσια, Τ.Κ. 15238.",
           "Keep «Αποστολή email σύνδεσης στον πελάτη» ticked. Press «Προσθήκη»."],
       expect=["The client card opens; the list shows «Ενεργός».", "A sign-in code email arrives for +dnew1."],
       fail=["Any error.", "Status pending.", "No email."]),
  dict(id="5.2", title="«Παραγγελία ως πελάτης» opens a new tab and the portal stays",
       where="DIETITIAN window · Νέος Δοκιμής's card",
       do=["Press «Παραγγελία ως πελάτης».", "Look at the new tab, then go back to the portal tab and reload it."],
       expect=["A NEW tab opens, titled «Ως πελάτης: Νέος Δοκιμής · …», with the purple banner «Ενεργείτε ως Νέος Δοκιμής» and «Έκπτωση διαιτολόγου 6%» once you add dishes.",
               "The portal tab is still your dietitian portal after reload, signed in as +diet (WEC-844, impersonation for own clients: «without killing other tabs»)."],
       fail=["The portal tab turns into the client, or asks you to sign in.", "No new tab and no message about pop-ups."]),
  dict(id="5.3", title="A card order placed by the dietitian completes",
       where="The client tab from 5.2 · checkout",
       do=["Order 2 days to the saved address.", "Pay by card with the sandbox card and 3DS code 111111."],
       expect=["The saved address is preselected.", "Payment completes and lands on the success page."],
       fail=["Payment hangs or the order stays pending."],
       aside="Viva sandbox hasn't been run against the new dev database yet. If it hangs, mark Blocked and note where."),
  dict(id="5.4", title="Closing the client tab leaves the portal as it was",
       where="The client tab · banner button «Κλείσιμο καρτέλας πελάτη»",
       do=["After the success page, check the banner is still there (no automatic exit).", "Press «Κλείσιμο καρτέλας πελάτη»."],
       expect=["The client tab closes.", "The portal tab is still signed in as +diet. No new sign-in."],
       fail=["You are asked to sign in again anywhere.", "The client tab stays open with the site usable."]),
  dict(id="5.5", title="The order is marked «από εσάς» and earns commission",
       where="DIETITIAN window · Νέος Δοκιμής's card and «Οικονομικά»",
       do=["Find the card order."],
       expect=["The pill «από εσάς».", "Finance: amount and «Πληρώθηκε» both equal the order total, commission 6% of it."],
       fail=["No pill.", "Commission 0 on a paid card order."]),
  dict(id="5.6", title="A plan bought through the dietitian",
       where="DIETITIAN window · Νέος Δοκιμής → «Νέο πλάνο / συνδρομή»",
       do=["The button opens a new client tab on the plan wizard. Build a plan and pay by payment link (or cash).", "Close the client tab, then in the portal open the client card and «Οικονομικά»."],
       expect=["The «Πλάνο &amp; πορτοφόλι» card shows the plan with «Στάλθηκε link» or «Εκκρεμεί πληρωμή».", "Finance has a «Πλάνο …» line with commission 0."],
       fail=["The plan isn't shown.", "Commission before payment."],
       aside="By the code, the plan gets no dietitian discount. If you want one, mark Fail and say so."),
  dict(id="5.7", title="Plan commission accrues once paid",
       where="ADMIN window · confirm the plan as paid where you normally do; then DIETITIAN window · «Οικονομικά»",
       do=["Confirm the plan paid.", "Reload Finance."],
       expect=["The plan line now carries 6% of the plan amount."],
       fail=["Still 0 after payment."]),
 ]),
 ("6 · Existing Fitpal customer added by a dietitian", "The client must accept and Fitpal must approve, in either order. Πελάτες Δοκιμής 4, 13 and 6 have past orders and no dietitian.", [
  dict(id="6.1", title="Adding an existing customer creates a pending link",
       where="DIETITIAN window · «+ Νέος πελάτης»",
       do=[f"Email {il('ioustinos.sarris+dev04@gmail.com')}, press «Προσθήκη»."],
       expect=["A message that the customer already exists and activates after they accept and Fitpal approves.", "The row reads «Αναμονή αποδοχής πελάτη» and can't be opened."],
       fail=["The client is active immediately.", "The row opens the client card."]),
  dict(id="6.2", title="Approval alone does not activate",
       where="ADMIN window · TEST → «Clients &amp; terms»",
       do=["Press «Approve» on Πελάτης Δοκιμής 4."],
       expect=["«Approve» disappears; the pill reads «pending · client ✗ · Fitpal ✓»."],
       fail=["The link turns active before the client accepted."]),
  dict(id="6.3", title="The client accepts and the link activates",
       where="CLIENT window · sign out, sign in as +dev04",
       do=["Read the prompt, keep consent ticked, press «Αποδοχή»."],
       expect=["The prompt «Ο/Η διαιτολόγος TEST Διαιτολόγος (E2E) σας πρόσθεσε στους πελάτες του/της» with «Απόρριψη» and «Αποδοχή».",
               "Afterwards: «active» in the ADMIN window, «Ενεργός» and clickable in the DIETITIAN window with body data; +dev04's cart shows the dietitian discount."],
       fail=["No prompt.", "Still pending after accepting."]),
  dict(id="6.4", title="Client accepts first, Fitpal approves second",
       where=f"DIETITIAN window adds {il('ioustinos.sarris+dev13@gmail.com')}; CLIENT window signs in as +dev13; then ADMIN window",
       do=["In the CLIENT window accept.", "Check B and +dev13's cart.", "In the ADMIN window press «Approve»."],
       expect=["Before approval the DIETITIAN window reads «Αναμονή έγκρισης Fitpal» and the cart has no dietitian discount.", "After approval it is active and the discount appears."],
       fail=["Discount before approval.", "Still pending after approval."]),
  dict(id="6.5", title="The client can decline",
       where=f"DIETITIAN window adds {il('ioustinos.sarris+dev06@gmail.com')}; CLIENT window signs in as +dev06",
       do=["Press «Απόρριψη»."],
       expect=["The prompt closes and doesn't return.", "The link ends: the DIETITIAN window no longer lists +dev06, and in the ADMIN window it only shows with «show ended links» ticked, as «ended»."],
       fail=["The prompt returns.", "The dietitian still sees +dev06 as pending."]),
 ]),
 ("7 · Referral link (paid add-on)", "", [
  dict(id="7.1", title="A new sign-up through the link becomes a client",
       where=f"CLIENT window, signed out · {il('/ref/test-e2e-diet')}",
       do=[f"Open the link, then sign up as {il('ioustinos.sarris+ref1@gmail.com')}."],
       expect=["The link lands on the menu.", "After sign-up +ref1 is an active TEST client in the DIETITIAN window and the consent prompt appears in the CLIENT window."],
       fail=["Not linked.", "Linked as pending."]),
  dict(id="7.2", title="An existing customer through the link goes to approval",
       where=f"CLIENT window, signed out · {il('/ref/test-e2e-diet')}",
       do=[f"Open the link, then sign in as existing customer {il('ioustinos.sarris+dev05@gmail.com')}."],
       expect=["A pending link awaiting Fitpal.", "the ADMIN window shows +dev05 with «Approve»."],
       fail=["Active straight away.", "Not linked at all."]),
  dict(id="7.3", title="With the add-on off, the link does nothing",
       where="ADMIN window · TEST → «Details &amp; add-ons»",
       do=["Untick «Referral link + QR», save.", f"In the CLIENT window sign out, open the referral link, sign up as {il('ioustinos.sarris+ref2@gmail.com')}.", "Tick the add-on back on afterwards."],
       expect=["+ref2 belongs to no dietitian.", "While off, the DIETITIAN window's referral banner is gone."],
       fail=["+ref2 is linked.", "The banner stays visible while off."]),
 ]),
 ("8 · Progress tracking (paid add-on)", "", [
  dict(id="8.1", title="Measurements draw a weight chart",
       where="DIETITIAN window · client 23 → «Πρόοδος &amp; μετρήσεις»",
       do=["Add a measurement dated a week ago (weight 56).", "Add one for today (weight 55)."],
       expect=["After the second, a weight chart appears with both dates.", "The table lists newest first."],
       fail=["No chart after two points.", "Dates or values wrong."]),
  dict(id="8.2", title="Switching the add-on off hides the card",
       where="ADMIN window · TEST → untick «Progress tracking»; DIETITIAN window reload; tick it back",
       do=["Untick, then reload the DIETITIAN window.", "Tick it back on, then reload the DIETITIAN window again."],
       expect=["The card disappears while off and returns with both measurements."],
       fail=["The card stays while off.", "Measurements lost."]),
 ]),
 ("9 · Commission payouts", "", [
  dict(id="9.1", title="Fitpal marks commission paid",
       where="ADMIN window · TEST → «Commission &amp; payouts»",
       do=["Tick the lines from 4.7 and 5.5.", "Type a reference, press «Mark selected paid (…)»."],
       expect=["A row under «Payouts» with the total and your reference.", "Those lines show 0 outstanding."],
       fail=["Payout total differs from the ticked commissions."]),
  dict(id="9.2", title="The dietitian sees the payout",
       where="DIETITIAN window · «Οικονομικά» → tick «Όλα»",
       do=["Read the tiles and the lines."],
       expect=["Those lines read «Εξοφλήθηκε».", "«Εξοφλημένο» went up and «Οφειλόμενο» down by the payout."],
       fail=["Tiles don't move.", "The dietitian can mark anything paid."]),
  dict(id="9.3", title="The monthly statement exports",
       where="DIETITIAN window · «Οικονομικά» → «Statement (CSV)»",
       do=["Download and open in Excel or Numbers."],
       expect=["Greek characters render.", "Columns split on «;».", "Amounts match the screen."],
       fail=["Garbled Greek.", "Everything in one column."]),
 ]),
 ("10 · Access and safety", "What must not be possible.", [
  dict(id="10.1", title="A customer cannot open the portal",
       where=f"CLIENT window · as {il('ioustinos.sarris+dev10@gmail.com')} → {il('/partner')}",
       do=["Open the portal URL."],
       expect=["«Δεν είστε συνεργάτης διαιτολόγος» and nothing else."],
       fail=["Any client data."]),
  dict(id="10.2", title="A dietitian cannot open someone else's client",
       where="ADMIN window · admin customer page, then DIETITIAN window",
       do=["Copy the id of an unlinked customer (e.g. Πελάτης Δοκιμής 10) from the admin customer page URL.", f"In the DIETITIAN window open {il('/partner/clients/&lt;that id&gt;')}."],
       expect=["An error. No name, address, order or body data shows."],
       fail=["Any of that person's data."]),
  dict(id="10.3", title="The dietitian cannot accept for a client",
       where="DIETITIAN window",
       do=["Add +dev10 so it's pending.", "Then «Παραγγελία ως πελάτης» on any active client and browse the site."],
       expect=["No accept or consent prompt appears while in client mode.", "The pending +dev10 row can't be opened or used for client mode."],
       fail=["A prompt shows in client mode.", "You can act as a pending client."]),
  dict(id="10.4", title="Ending a link removes access and discount",
       where="ADMIN window · TEST → «Clients &amp; terms» → +dev13 row → «End»",
       do=["End the link, confirm.", "Check the DIETITIAN window's list and +dev13's cart in the CLIENT window."],
       expect=["the DIETITIAN window no longer lists or opens +dev13.", "+dev13's cart has no dietitian discount."],
       fail=["Either still present."]),
  dict(id="10.5", title="The in-house dietitian view",
       where="ADMIN window · /partner → «Προβολή ως» → «Fitpal (εσωτερικοί διαιτολόγοι)»",
       do=["Search «Δοκιμής»."],
       expect=["Customers from all of Fitpal are found.", "No discount / commission column.", "No «Παραγγελίες» or «Οικονομικά» menu."],
       fail=["Search returns nothing.", "Commission columns shown."]),
 ]),
("11 · Client mode in its own tab (WEC-868)", "WEC-868 (client mode in its own tab — one identity per tab for admins and dietitians). Rules under test: the client tab holds the customer's sign-in only for itself; your own tabs never change; one client tab per person at a time; nothing is ordered from a closed or replaced tab; the customer is never signed out of their own devices.", [
  dict(id="11.1", title="Admin opens a client tab; the admin tab stays yours",
       where=f"ADMIN window · first the site {il(SITE)}, then {il('/admin/users')}",
       do=["On the site, put ONE dish in your own cart.",
           "Go to /admin/users, search «Δοκιμής 7», open Πελάτης Δοκιμής 7, press «Place order for this customer →»."],
       expect=["A new tab opens, titled «Ως πελάτης: Πελάτης Δοκιμής 7 · …», with the purple banner and an empty cart.",
               "Your admin tab still shows /admin/users, signed in as you."],
       fail=["The admin tab changes to the customer or signs you out.", "The client tab shows your dish in its cart."]),
  dict(id="11.2", title="Your cart and the client's cart never mix",
       where="ADMIN window · the client tab from 11.1, then your own tab",
       do=["In the client tab add two dishes.", "Go to your own tab, open the site and look at the cart. Reload it.", "Go back to the client tab and reload it."],
       expect=["Your own cart still has only your one dish.", "After reload the client tab is still Πελάτης Δοκιμής 7 with the banner and the two dishes."],
       fail=["Any dish crosses over.", "The client tab loses the customer or the banner on reload."]),
  dict(id="11.3", title="Admin does not open inside a client tab",
       where="ADMIN window · the client tab",
       do=[f"In the client tab's address bar, change the address to {il(SITE + '/admin')} and press Enter.", f"Do the same with {il(SITE + '/partner')}."],
       expect=["Both show «Αυτή η καρτέλα είναι καρτέλα πελάτη» with «Κλείσιμο καρτέλας πελάτη» and «Συνέχεια ως Πελάτης». No admin or portal data."],
       fail=["Any admin or portal screen opens."]),
  dict(id="11.4", title="A copied address does not carry the client's sign-in",
       where="ADMIN window · the client tab",
       do=["Press «Συνέχεια ως Πελάτης» to return to the menu.", "Copy the client tab's address, open a brand-new tab (⌘T) and paste it."],
       expect=["The new tab is YOU (your name top right, no purple banner)."],
       fail=["The new tab is signed in as Πελάτης Δοκιμής 7."]),
  dict(id="11.5", title="An order from the client tab is marked as placed by admin; the tab stays open",
       where="ADMIN window · the client tab → checkout",
       do=["Place a cash order for the two dishes.", "After the success page, look at the banner.", "In your own tab open /admin/orders and find the order."],
       expect=["The order goes through and the banner is still there (no automatic exit, no sign-out).",
               "In admin the order belongs to Πελάτης Δοκιμής 7 and has the orange shield icon «Managed order»."],
       fail=["The order lands under you.", "No shield icon.", "You get signed out anywhere."]),
  dict(id="11.6", title="A second client tab closes the first",
       where="ADMIN window · your own tab → /admin/users",
       do=["Open Πελάτης Δοκιμής 8 and press «Place order for this customer →».", "Switch to the Πελάτης Δοκιμής 7 tab. Wait up to a minute if needed.", "Reload that tab."],
       expect=["The customer-8 tab opens normally.", "The customer-7 tab shows a lock screen «Άνοιξε νεότερη καρτέλα πελάτη», its title starts with «🔒», and nothing behind it can be clicked.",
               "After reload it still shows a lock screen. «Κλείσιμο καρτέλας» closes it."],
       fail=["Both client tabs keep working.", "The locked tab can still place an order."]),
  dict(id="11.7", title="Admin and dietitian client tabs live side by side",
       where="ADMIN window has the customer-8 tab open; DIETITIAN window · client 23's card",
       do=["In the DIETITIAN window press «Παραγγελία ως πελάτης» for Πελάτης Δοκιμής 23.", "Switch back to the ADMIN window's customer-8 tab and add a dish."],
       expect=["Both client tabs stay active: the limit is one client tab PER PERSON, not per browser.", "Each banner names its own customer."],
       fail=["Opening the dietitian's client tab locks the admin's, or the other way round."]),
  dict(id="11.8", title="The customer stays signed in on their own device",
       where="CLIENT window (incognito) signed in as +dev23; DIETITIAN window has the client-23 tab from 11.7",
       do=["In the CLIENT window, sign in as +dev23 and reload once. You're signed in.",
           "In the DIETITIAN window's client-23 tab press «Κλείσιμο καρτέλας πελάτη».", "Back in the CLIENT window, reload."],
       expect=["The CLIENT window is still signed in as +dev23.", "The dietitian's portal tab is still signed in as +diet."],
       fail=["+dev23 is signed out in the CLIENT window.", "The dietitian has to sign in again."]),
  dict(id="11.9", title="«Αποσύνδεση» inside a client tab only leaves client mode",
       where="DIETITIAN window · open client mode for client 23 again",
       do=["In the new client tab click the customer's name top right → «Αποσύνδεση»."],
       expect=["The client tab closes, or shows the lock screen if the browser won't close it.", "The CLIENT window (+dev23) is still signed in after reload; the portal is still +diet."],
       fail=["Anyone is signed out outside the client tab."]),
  dict(id="11.10", title="Closing a client tab with the browser's ✕ is safe",
       where="ADMIN window · the customer-8 tab",
       do=["Close the customer-8 tab with the browser's ✕ (not the banner button).", "Open client mode for Πελάτης Δοκιμής 8 again."],
       expect=["Nothing breaks: a new client tab opens normally.", "The admin tab is still you."],
       fail=["An error, or the admin tab changes."],
       aside="The 2-hour expiry and the «inactive for 5 minutes» rule are tested from the database by Claude, not by hand."),
 ]),

]

def ul(items):
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"

def ol(items):
    return "<ol>" + "".join(f"<li>{i}</li>" for i in items) + "</ol>"

def card(s):
    out = [f'<div class="step" data-id="{s["id"]}">',
           f'  <div class="step__hd"><span class="step__n">{s["id"]}</span><p class="step__t">{s["title"]}</p><div class="verdict"></div></div>',
           f'  <div class="seg"><span class="lab">SIGNED IN AS</span>{ul(LOGIN[s["id"]])}</div>',
           f'  <p class="seg where"><span class="lab">WHERE</span>{s["where"]}</p>',
           f'  <div class="seg"><span class="lab">DO</span>{ol(s["do"])}</div>',
           f'  <div class="seg expect"><span class="lab">EXPECT</span>{ul(s["expect"])}</div>']
    if s.get("fail"):
        out.append(f'  <div class="warn"><span class="lab">FAIL IF</span>{ul(s["fail"])}</div>')
    if s.get("aside"):
        out.append(f'  <div class="aside"><span class="lab">KNOWN, DO NOT RE-FILE</span>{s["aside"]}</div>')
    out.append('</div>')
    return "\n".join(out)

steps_html = [INTRO]
for title, note, steps in PARTS:
    steps_html.append(f'<h2 class="part">{title}</h2>')
    if note:
        steps_html.append(f'<p class="partnote">{note}</p>')
    steps_html += [card(s) for s in steps]

t = open(sys.argv[1]).read()
a, rest = t.split("<!-- STEPS -->", 1)
_, b = rest.split("<!-- /STEPS -->", 1)
t = a + "<!-- STEPS -->\n\n" + "\n\n".join(steps_html) + "\n\n<!-- /STEPS -->" + b

t = t.replace("<title>TEST PASS NAME</title>", "<title>Dietitian Partners Test Pass</title>")
t = t.replace('<div class="wrap" data-name="test-pass">', '<div class="wrap" data-name="dietitian-partners-run1">')
t = t.replace('<p class="eyebrow">PROJECT · ENVIRONMENT · TICKET</p>', '<p class="eyebrow">FITPAL · DEV · WEC-838</p>')
t = t.replace('<h1>TEST PASS NAME</h1>', '<h1>Dietitian Partners Test Pass</h1>')
t = t.replace('<p class="standfirst">Say what this pass is about, in one sentence.</p>',
              '<p class="standfirst">A first full walk of the dietitian partner feature on dev, as admin, dietitian and client, to find what breaks before anyone outside sees it.</p>')
t = t.replace('<p>PROJECT · ENVIRONMENT · date</p>',
              '<p>Fitpal · dev (dev--fitpal-order.netlify.app, Supabase branch dev) · written 12 Oct 2026; part 11 added for WEC-868 (commit 01b2ba0)</p>')
open("docs/dietitian-partners-test.html", "w").write(t)
print("steps:", sum(len(p[2]) for p in PARTS))
