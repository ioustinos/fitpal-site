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
  <p>The dietitian partner feature (WEC-838 — Dietitian Partners epic: dietitians resell plans and order for their clients) on the dev site, from three seats: <strong>admin</strong>, <strong>dietitian</strong> and <strong>client</strong>. It walks every screen that shipped: admin dietitian management, the /partner portal, the client's accept and consent prompts, the dietitian discount at checkout, commission and payouts, and the two paid add-ons. The dev database holds 25 anonymized customers «Πελάτης Δοκιμής N» with real-looking orders; none is linked to a dietitian yet.</p>
</div>

<div class="block">
  <h3>Sign-ins — three seats, three browser sessions</h3>
  <div class="scroller"><table>
    <tr><th>Seat</th><th>Where</th><th>Login</th></tr>
    <tr><td><strong>A · Admin</strong></td><td>Your normal browser window</td><td>{il("ioustinos.sarris@gmail.com")} — admin, and also an owner of the TEST dietitian</td></tr>
    <tr><td><strong>B · Dietitian</strong></td><td>A second browser or Chrome profile</td><td>{il("ioustinos.sarris+diet@gmail.com")} — created in step 1.2, no admin rights</td></tr>
    <tr><td><strong>C · Client</strong></td><td>An incognito window; sign out between clients</td><td>{il("ioustinos.sarris+devNN@gmail.com")} and new aliases named in the steps</td></tr>
  </table></div>
  <p>Every login is by email code. All codes land in your own Gmail because every account is a +alias.</p>
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
    <li>Leaving «ως πελάτης» mode signs you out; the portal says so in its own note. Signing in again is expected.</li>
    <li>Wallet-paid orders always show 0 commission. The commission was earned when the plan was bought.</li>
    <li>Cash and transfer orders show 0 commission until they're marked paid. Commission counts collected money only.</li>
    <li>Ordering for a client from <em>your own</em> account records the order as placed by admin, not by the dietitian, because you're an admin. Part 5 uses the +diet login for that reason.</li>
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

# (part title, part note, [steps]); step = dict(id,title,where,do,expect,fail,aside)
PARTS = [
 ("1 · Setup", "One-time setup. A client's terms are copied from the dietitian's defaults at the moment of linking, so settle the defaults before linking anyone.", [
  dict(id="1.1", title="The dev site loads and you are admin",
       where=f"Seat A · {il(SITE)}",
       do=["Open the site signed in as yourself."],
       expect=["The weekly menu loads.", "The Admin entry is available."],
       fail=["The menu shows an error or no dishes.", "No Admin entry."]),
  dict(id="1.2", title="A plain dietitian login exists",
       where=f"Seat B · {il(SITE)}",
       do=[f"Sign in with {il('ioustinos.sarris+diet@gmail.com')} by email code."],
       expect=["The code arrives in your Gmail.", "You are signed in as an ordinary customer, with no Admin entry."],
       fail=["No code email within 2 minutes.", "«Error sending confirmation email»."]),
  dict(id="1.3", title="The dietitian login is attached to TEST",
       where=f"Seat A · {il('/admin/partners')} → «TEST Διαιτολόγος (E2E)» → tab «Details &amp; add-ons»",
       do=["Under «Portal logins», enter the +diet email and press «Link login».",
           "Check the defaults: client discount, commission, «Progress tracking» and «Referral link + QR» ticked, referral code «test-e2e-diet».",
           "Change the percentages if you want spec-like numbers, press «Save», reload."],
       expect=["The +diet email is listed under Portal logins.", "Every value you saved is still there after reload."],
       fail=["«Δεν υπάρχει λογαριασμός με αυτό το email» although 1.2 passed.", "Values revert after reload."]),
 ]),
 ("2 · Admin: managing dietitians", "", [
  dict(id="2.1", title="A second dietitian can be created",
       where=f"Seat A · {il('/admin/partners')}",
       do=["Press «+ New dietitian».", "Name «Δοκιμή Β», commission 12, client discount 10, no add-ons ticked. Press «Save».", "Reload the page."],
       expect=["«Δοκιμή Β» is in the list with 12 / 10 after reload."],
       fail=["Save error, or the values change after reload."]),
  dict(id="2.2", title="Admin can open any dietitian's portal",
       where="Seat A · «Δοκιμή Β» → button «Open portal as Δοκιμή Β →»",
       do=["Press the button.", "Then switch the top-bar selector «Προβολή ως» to «TEST Διαιτολόγος (E2E)»."],
       expect=[f"{il('/partner')} opens as Δοκιμή Β: no clients, no referral banner.", "After switching, the portal shows TEST with its referral banner."],
       fail=["«Δεν είστε συνεργάτης διαιτολόγος».", "The selector switches but the data stays the same."]),
  dict(id="2.3", title="Admin links an existing customer directly",
       where=f"Seat A · {il('/admin/partners')} → TEST → tab «Clients &amp; terms»",
       do=[f"Type {il('ioustinos.sarris+dev23@gmail.com')} in «link an existing customer by email» and press «Link»."],
       expect=["A row «Πελάτης Δοκιμής 23», status active, discount and commission equal to TEST's defaults, consent «—»."],
       fail=["Status pending, or percentages not equal to the defaults."]),
  dict(id="2.4", title="One client cannot have two dietitians",
       where="Seat A · «Δοκιμή Β» → «Clients &amp; terms»",
       do=["Try to link the same +dev23 email."],
       expect=["Refused with «Ο πελάτης είναι ήδη συνδεδεμένος με διαιτολόγο.»"],
       fail=["A second link is created."]),
 ]),
 ("3 · Dietitian portal: list, client card, targets, orders", "Πελάτης Δοκιμής 23 has a paid 3-month plan, a wallet, and three wallet-paid orders.", [
  dict(id="3.1", title="The dietitian sees only their own portal",
       where=f"Seat B · {il('/partner')}",
       do=["Open the portal."],
       expect=["Menu «Πελάτες · Παραγγελίες · Οικονομικά».", "Top bar shows the TEST name badge, the +diet email and «Αποσύνδεση». No «Προβολή ως» selector."],
       fail=["Any admin screen or selector is visible.", "«Δεν είστε συνεργάτης διαιτολόγος»."]),
  dict(id="3.2", title="The client list shows the linked client",
       where="Seat B · «Πελάτες»",
       do=["Read the row for Πελάτης Δοκιμής 23."],
       expect=["«Ενεργός» plus «Χωρίς συγκατάθεση».", "6% / 6%.", "Wallet 1.186,78 €.", "«Πλάνο έως» 23/12/2026."],
       fail=["Other customers are listed.", "Wallet or plan date differ."]),
  dict(id="3.3", title="Referral link copies and the QR scans",
       where="Seat B · «Πελάτες», the referral banner",
       do=["Press «Αντιγραφή» and paste somewhere.", "Press «QR» and scan it with your phone."],
       expect=[f"The pasted text is {il(SITE + '/ref/test-e2e-diet')}.", "The QR opens the same link."],
       fail=["The copy does nothing.", "The QR points elsewhere."]),
  dict(id="3.4", title="The client card shows plan, wallet and address but hides body data",
       where="Seat B · click Πελάτης Δοκιμής 23",
       do=["Read every card on the page."],
       expect=["«Στοιχεία πελάτη» shows name and phone, then the consent warning instead of body fields.",
               "«Πλάνο &amp; πορτοφόλι»: 3 μήνες · 5 ημέρες/εβδ., 1454 kcal, 21/09/2026 → 23/12/2026, 1.513,67 € · Πληρωμένο.",
               "«Διευθύνσεις»: Αγίας Θέκλας 34.", "«Παραγγελίες» lists SD- orders."],
       fail=["Height, weight or sex are visible before consent.", "Any figure differs from the above."]),
  dict(id="3.5", title="Daily and per-meal targets save",
       where="Seat B · client 23 → card «Στόχοι (ίδιοι κάθε μέρα)»",
       do=["Press «Θερμίδες από το πλάνο (1454)».", "Enter protein 90, carbs 180, fat 48 for the day.",
           "Fill Πρωινό / Μεσημεριανό / Βραδινό so the meal kcal add up to about 1000 (deliberately low).",
           "Press «Αποθήκευση στόχων», then reload."],
       expect=["«✓ Αποθηκεύτηκε».", "After reload every value is still there.", "«Σύνολο γευμάτων» kcal is red, since it's more than 5% off the day."],
       fail=["An error on save.", "Values lost after reload.", "The meal total isn't flagged."]),
  dict(id="3.6", title="Orders compare against the target per day",
       where="Seat B · client 23 → «Παραγγελίες» at the bottom",
       do=["Read the day rows and the week boxes above them."],
       expect=["Each day's kcal/P/C/F is green within ±10% of target, red otherwise, with the +/− difference.",
               "A weekly box per week: days, average kcal, «στόχος 1454», days within ±10%.",
               "The weekday on each row matches its date."],
       fail=["Wrong weekday for a date.", "Colours inverted, or no comparison."]),
  dict(id="3.7", title="Dish detail adds up",
       where="Seat B · any day row → «Πιάτα»",
       do=["Open one day and add up the dish kcal."],
       expect=["Rows read qty × name — variant, macros already multiplied by quantity.", "The sum equals the day's kcal."],
       fail=["Sum differs from the day row."]),
  dict(id="3.8", title="«Παραγγελίες» shows only own clients",
       where="Seat B · «Παραγγελίες», selector «Όλοι οι πελάτες»",
       do=["Read the list."],
       expect=["Only Πελάτης Δοκιμής 23's orders."],
       fail=["Any other customer's order."]),
  dict(id="3.9", title="Finance is empty before any linked order",
       where="Seat B · «Οικονομικά»",
       do=["Look at this month, then tick «Όλα»."],
       expect=["«Καμία κίνηση» and 0,00 € on all four tiles."],
       fail=["Any line from a seeded order."],
       aside="Seeded orders were placed before the link, so they carry no dietitian. That's why Finance starts empty."),
 ]),
 ("4 · Client side: consent and discount", "", [
  dict(id="4.1", title="The linked client is asked for consent",
       where=f"Seat C · {il(SITE)}",
       do=[f"Sign in as {il('ioustinos.sarris+dev23@gmail.com')}.", "Switch the site to English and read the prompt, then back to Greek."],
       expect=["A prompt at the bottom: «Συγκατάθεση για τον/την διαιτολόγο TEST Διαιτολόγος (E2E)», a ticked checkbox, «Αργότερα» and «Συμφωνώ».", "The English version reads correctly."],
       fail=["No prompt.", "The prompt shows commission or anything financial."]),
  dict(id="4.2", title="Consent sticks and unlocks body data",
       where="Seat C, then seat B · client 23's card",
       do=["In C press «Συμφωνώ» and reload.", "In B reload client 23's card and the client list."],
       expect=["In C the prompt is gone for good.", "In B body data shows: Γυναίκα, 1983, 166 cm, 55 kg, and the «Πρόοδος &amp; μετρήσεις» card appears.", "The list no longer says «Χωρίς συγκατάθεση»."],
       fail=["The prompt returns after reload.", "B still hides body data."]),
  dict(id="4.3", title="The client sees the dietitian discount as its own line",
       where="Seat C · menu, cart, checkout",
       do=["As +dev23 add dishes on two days.", "Open the cart, then checkout."],
       expect=["A line «Έκπτωση διαιτολόγου 6%» equal to 6% of the items subtotal, in the cart and at checkout.", "No commission is shown anywhere."],
       fail=["No discount line.", "Discount computed on something other than the items subtotal.", "Commission visible to the client."]),
  dict(id="4.4", title="The discount stacks with a voucher",
       where="Seat C · checkout",
       do=["Apply a public voucher, if you have one handy. Note the totals.", "Remove it again."],
       expect=["Both discounts show and the total never goes below zero."],
       fail=["The voucher removes the dietitian discount or the other way round."],
       aside="Leave as Blocked if you have no public voucher code to hand."),
  dict(id="4.5", title="A cash order keeps the discount",
       where="Seat C · checkout → place order",
       do=["Pay with cash and place the order."],
       expect=["The confirmation total equals subtotal minus 6%."],
       fail=["The total on the confirmation differs from the checkout total."]),
  dict(id="4.6", title="The dietitian sees the order, with no commission yet",
       where="Seat B · «Παραγγελίες» and «Οικονομικά»",
       do=["Find the new FP- order."],
       expect=["The order card shows «(έκπτωση X €)» and «Μετρητά».", "Finance has one line: «Πληρώθηκε» 0,00 €, commission 0,00 €."],
       fail=["Commission accrues before payment."]),
  dict(id="4.7", title="Commission accrues once the cash is marked paid",
       where="Seat A · the order in admin, then seat B · «Οικονομικά»",
       do=["Mark that order paid in admin the way you normally do.", "Reload Finance in B."],
       expect=["The line shows the collected amount and a 6% commission, status «Οφείλεται»."],
       fail=["Commission still 0 after the order is paid."]),
 ]),
 ("5 · Dietitian creates a client and orders for them", "", [
  dict(id="5.1", title="A brand-new client is active at once",
       where="Seat B · «Πελάτες» → «+ Νέος πελάτης»",
       do=[f"Name «Νέος Δοκιμής», email {il('ioustinos.sarris+dnew1@gmail.com')}, any phone.",
           "Address Λεωφόρος Πεντέλης 64, Βριλήσσια, Τ.Κ. 15238.",
           "Keep «Αποστολή email σύνδεσης στον πελάτη» ticked. Press «Προσθήκη»."],
       expect=["The client card opens; the list shows «Ενεργός».", "A sign-in code email arrives for +dnew1."],
       fail=["Any error.", "Status pending.", "No email."]),
  dict(id="5.2", title="«Ως πελάτης» other tabs stay as they were",
       where="Seat B · open a second tab on /partner first",
       do=["With two /partner tabs open, press «Παραγγελία ως πελάτης» in one.", "Then look at the other tab and reload it."],
       expect=["Tab 1 is the normal site as Νέος Δοκιμής, with the impersonation banner and «Έκπτωση διαιτολόγου 6%» in the cart.",
               "Tab 2 is still your dietitian portal (WEC-844, impersonation for own clients: «without killing other tabs»)."],
       fail=["Tab 2 turns into the client or shows «Είστε συνδεδεμένοι ως πελάτης»."],
       aside="I expect this one to fail: the swap changes the browser's session, which all tabs share. Mark it as you find it."),
  dict(id="5.3", title="A card order placed by the dietitian completes",
       where="Seat B, client mode · checkout",
       do=["Order 2 days to the saved address.", "Pay by card with the sandbox card and 3DS code 111111."],
       expect=["The saved address is preselected.", "Payment completes and lands on the success page."],
       fail=["Payment hangs or the order stays pending."],
       aside="Viva sandbox hasn't been run against the new dev database yet. If it hangs, mark Blocked and note where."),
  dict(id="5.4", title="Leaving client mode returns to the portal",
       where="Seat B · the impersonation banner",
       do=["Exit client mode."],
       expect=[f"You land on {il('/partner')}, after signing in again if asked."],
       fail=["You land on /admin or on the site as the client."]),
  dict(id="5.5", title="The order is marked «από εσάς» and earns commission",
       where="Seat B · Νέος Δοκιμής's card and «Οικονομικά»",
       do=["Find the card order."],
       expect=["The pill «από εσάς».", "Finance: amount and «Πληρώθηκε» both equal the order total, commission 6% of it."],
       fail=["No pill.", "Commission 0 on a paid card order."]),
  dict(id="5.6", title="A plan bought through the dietitian",
       where="Seat B · Νέος Δοκιμής → «Νέο πλάνο / συνδρομή»",
       do=["Build a plan in the wizard and pay by payment link (or cash).", "Exit client mode, open the client card and «Οικονομικά»."],
       expect=["The «Πλάνο &amp; πορτοφόλι» card shows the plan with «Στάλθηκε link» or «Εκκρεμεί πληρωμή».", "Finance has a «Πλάνο …» line with commission 0."],
       fail=["The plan isn't shown.", "Commission before payment."],
       aside="By the code, the plan gets no dietitian discount. If you want one, mark Fail and say so."),
  dict(id="5.7", title="Plan commission accrues once paid",
       where="Seat A · confirm the plan as paid where you normally do; then seat B · «Οικονομικά»",
       do=["Confirm the plan paid.", "Reload Finance."],
       expect=["The plan line now carries 6% of the plan amount."],
       fail=["Still 0 after payment."]),
 ]),
 ("6 · Existing Fitpal customer added by a dietitian", "The client must accept and Fitpal must approve, in either order. Πελάτες Δοκιμής 4, 13 and 6 have past orders and no dietitian.", [
  dict(id="6.1", title="Adding an existing customer creates a pending link",
       where="Seat B · «+ Νέος πελάτης»",
       do=[f"Email {il('ioustinos.sarris+dev04@gmail.com')}, press «Προσθήκη»."],
       expect=["A message that the customer already exists and activates after they accept and Fitpal approves.", "The row reads «Αναμονή αποδοχής πελάτη» and can't be opened."],
       fail=["The client is active immediately.", "The row opens the client card."]),
  dict(id="6.2", title="Approval alone does not activate",
       where="Seat A · TEST → «Clients &amp; terms»",
       do=["Press «Approve» on Πελάτης Δοκιμής 4."],
       expect=["«Approve» disappears; the pill reads «pending · client ✗ · Fitpal ✓»."],
       fail=["The link turns active before the client accepted."]),
  dict(id="6.3", title="The client accepts and the link activates",
       where="Seat C · sign out, sign in as +dev04",
       do=["Read the prompt, keep consent ticked, press «Αποδοχή»."],
       expect=["The prompt «Ο/Η διαιτολόγος TEST Διαιτολόγος (E2E) σας πρόσθεσε στους πελάτες του/της» with «Απόρριψη» and «Αποδοχή».",
               "Afterwards: «active» in A, «Ενεργός» and clickable in B with body data; +dev04's cart shows the dietitian discount."],
       fail=["No prompt.", "Still pending after accepting."]),
  dict(id="6.4", title="Client accepts first, Fitpal approves second",
       where=f"Seat B adds {il('ioustinos.sarris+dev13@gmail.com')}; seat C signs in as +dev13; then seat A",
       do=["In C accept.", "Check B and +dev13's cart.", "In A press «Approve»."],
       expect=["Before approval B reads «Αναμονή έγκρισης Fitpal» and the cart has no dietitian discount.", "After approval it is active and the discount appears."],
       fail=["Discount before approval.", "Still pending after approval."]),
  dict(id="6.5", title="The client can decline",
       where=f"Seat B adds {il('ioustinos.sarris+dev06@gmail.com')}; seat C signs in as +dev06",
       do=["Press «Απόρριψη»."],
       expect=["The prompt closes and doesn't return.", "The link ends: B no longer lists +dev06, and in A it only shows with «show ended links» ticked, as «ended»."],
       fail=["The prompt returns.", "The dietitian still sees +dev06 as pending."]),
 ]),
 ("7 · Referral link (paid add-on)", "", [
  dict(id="7.1", title="A new sign-up through the link becomes a client",
       where=f"Seat C, signed out · {il('/ref/test-e2e-diet')}",
       do=[f"Open the link, then sign up as {il('ioustinos.sarris+ref1@gmail.com')}."],
       expect=["The link lands on the menu.", "After sign-up +ref1 is an active TEST client in B and the consent prompt appears in C."],
       fail=["Not linked.", "Linked as pending."]),
  dict(id="7.2", title="An existing customer through the link goes to approval",
       where=f"Seat C, signed out · {il('/ref/test-e2e-diet')}",
       do=[f"Open the link, then sign in as existing customer {il('ioustinos.sarris+dev05@gmail.com')}."],
       expect=["A pending link awaiting Fitpal.", "A shows +dev05 with «Approve»."],
       fail=["Active straight away.", "Not linked at all."]),
  dict(id="7.3", title="With the add-on off, the link does nothing",
       where="Seat A · TEST → «Details &amp; add-ons»",
       do=["Untick «Referral link + QR», save.", f"In C sign out, open the referral link, sign up as {il('ioustinos.sarris+ref2@gmail.com')}.", "Tick the add-on back on afterwards."],
       expect=["+ref2 belongs to no dietitian.", "While off, B's referral banner is gone."],
       fail=["+ref2 is linked.", "The banner stays visible while off."]),
 ]),
 ("8 · Progress tracking (paid add-on)", "", [
  dict(id="8.1", title="Measurements draw a weight chart",
       where="Seat B · client 23 → «Πρόοδος &amp; μετρήσεις»",
       do=["Add a measurement dated a week ago (weight 56).", "Add one for today (weight 55)."],
       expect=["After the second, a weight chart appears with both dates.", "The table lists newest first."],
       fail=["No chart after two points.", "Dates or values wrong."]),
  dict(id="8.2", title="Switching the add-on off hides the card",
       where="Seat A · TEST → untick «Progress tracking»; seat B reload; tick it back",
       do=["Untick, reload B.", "Tick it back on, reload B."],
       expect=["The card disappears while off and returns with both measurements."],
       fail=["The card stays while off.", "Measurements lost."]),
 ]),
 ("9 · Commission payouts", "", [
  dict(id="9.1", title="Fitpal marks commission paid",
       where="Seat A · TEST → «Commission &amp; payouts»",
       do=["Tick the lines from 4.7 and 5.5.", "Type a reference, press «Mark selected paid (…)»."],
       expect=["A row under «Payouts» with the total and your reference.", "Those lines show 0 outstanding."],
       fail=["Payout total differs from the ticked commissions."]),
  dict(id="9.2", title="The dietitian sees the payout",
       where="Seat B · «Οικονομικά» → tick «Όλα»",
       do=["Read the tiles and the lines."],
       expect=["Those lines read «Εξοφλήθηκε».", "«Εξοφλημένο» went up and «Οφειλόμενο» down by the payout."],
       fail=["Tiles don't move.", "The dietitian can mark anything paid."]),
  dict(id="9.3", title="The monthly statement exports",
       where="Seat B · «Οικονομικά» → «Statement (CSV)»",
       do=["Download and open in Excel or Numbers."],
       expect=["Greek characters render.", "Columns split on «;».", "Amounts match the screen."],
       fail=["Garbled Greek.", "Everything in one column."]),
 ]),
 ("10 · Access and safety", "What must not be possible.", [
  dict(id="10.1", title="A customer cannot open the portal",
       where=f"Seat C · as {il('ioustinos.sarris+dev10@gmail.com')} → {il('/partner')}",
       do=["Open the portal URL."],
       expect=["«Δεν είστε συνεργάτης διαιτολόγος» and nothing else."],
       fail=["Any client data."]),
  dict(id="10.2", title="A dietitian cannot open someone else's client",
       where="Seat A · admin customer page, then seat B",
       do=["Copy the id of an unlinked customer (e.g. Πελάτης Δοκιμής 10) from the admin customer page URL.", f"In B open {il('/partner/clients/&lt;that id&gt;')}."],
       expect=["An error. No name, address, order or body data shows."],
       fail=["Any of that person's data."]),
  dict(id="10.3", title="The dietitian cannot accept for a client",
       where="Seat B",
       do=["Add +dev10 so it's pending.", "Then «Παραγγελία ως πελάτης» on any active client and browse the site."],
       expect=["No accept or consent prompt appears while in client mode.", "The pending +dev10 row can't be opened or used for client mode."],
       fail=["A prompt shows in client mode.", "You can act as a pending client."]),
  dict(id="10.4", title="Ending a link removes access and discount",
       where="Seat A · TEST → «Clients &amp; terms» → +dev13 row → «End»",
       do=["End the link, confirm.", "Check B's list and +dev13's cart in C."],
       expect=["B no longer lists or opens +dev13.", "+dev13's cart has no dietitian discount."],
       fail=["Either still present."]),
  dict(id="10.5", title="The in-house dietitian view",
       where="Seat A · /partner → «Προβολή ως» → «Fitpal (εσωτερικοί διαιτολόγοι)»",
       do=["Search «Δοκιμής»."],
       expect=["Customers from all of Fitpal are found.", "No discount / commission column.", "No «Παραγγελίες» or «Οικονομικά» menu."],
       fail=["Search returns nothing.", "Commission columns shown."]),
 ]),
]

def ul(items):
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"

def ol(items):
    return "<ol>" + "".join(f"<li>{i}</li>" for i in items) + "</ol>"

def card(s):
    out = [f'<div class="step" data-id="{s["id"]}">',
           f'  <div class="step__hd"><span class="step__n">{s["id"]}</span><p class="step__t">{s["title"]}</p><div class="verdict"></div></div>',
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
              '<p>Fitpal · dev (dev--fitpal-order.netlify.app, Supabase branch dev) · written 12 Oct 2026 against commit ec33161</p>')
open("docs/dietitian-partners-test.html", "w").write(t)
print("steps:", sum(len(p[2]) for p in PARTS))
