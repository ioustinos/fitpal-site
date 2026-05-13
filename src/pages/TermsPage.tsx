import { useUIStore } from '../store/useUIStore'

/**
 * Placeholder Terms of Service page (WEC-322 / WEC-323).
 *
 * Required as a public URL by the Facebook Developer Portal before an app
 * can switch to Live mode. Content here is a baseline draft — legal copy
 * needs Greek attorney review before customer launch.
 */
export function TermsPage() {
  const lang = useUIStore((s) => s.lang)
  const isEl = lang === 'el'

  return (
    <div className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <a href="/" className="legal-back">
            {isEl ? '← Πίσω στην αρχική' : '← Back to home'}
          </a>
          <h1>{isEl ? 'Όροι Χρήσης' : 'Terms of Service'}</h1>
          <p className="legal-updated">
            {isEl
              ? 'Τελευταία ενημέρωση: 11 Μαΐου 2026'
              : 'Last updated: 11 May 2026'}
          </p>
        </header>

        <section>
          <h2>{isEl ? '1. Αποδοχή των όρων' : '1. Acceptance of terms'}</h2>
          <p>
            {isEl
              ? 'Με τη χρήση της πλατφόρμας order.fitpal.gr αποδέχεσαι τους παρόντες όρους. Αν δεν συμφωνείς, παρακαλούμε μη χρησιμοποιήσεις την υπηρεσία.'
              : 'By using the order.fitpal.gr platform you accept these terms. If you do not agree, please do not use the service.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '2. Η υπηρεσία' : '2. The service'}</h2>
          <p>
            {isEl
              ? 'Η Fitpal παρέχει εβδομαδιαία μενού ισορροπημένων γευμάτων με παράδοση εντός Αθηνών. Το μενού ανανεώνεται κάθε εβδομάδα και κάθε ημέρα έχει διαφορετικά διαθέσιμα πιάτα.'
              : 'Fitpal offers weekly balanced-meal menus with delivery in the Athens area. The menu refreshes weekly and each day has a different selection of available dishes.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '3. Λογαριασμός χρήστη' : '3. User account'}</h2>
          <p>
            {isEl
              ? 'Είσαι υπεύθυνος για την ασφάλεια του λογαριασμού σου. Μπορείς να συνδεθείς με email + κωδικό, με κωδικό μιας χρήσης (OTP) ή μέσω Google / Facebook. Δηλώνεις ότι τα στοιχεία που παρέχεις είναι αληθή και ότι έχεις τουλάχιστον 18 ετών.'
              : 'You are responsible for keeping your account secure. You may sign in with email + password, one-time code (OTP), or via Google / Facebook. You declare that the information you provide is accurate and that you are at least 18 years old.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '4. Παραγγελίες και πληρωμή' : '4. Orders and payment'}</h2>
          <p>
            {isEl
              ? 'Κάθε παραγγελία υπόκειται σε χρόνο cutoff ανά ημέρα παράδοσης και σε ελάχιστο ποσό. Αν η ημερήσια παραγγελία δεν φτάνει το ελάχιστο, δεν μπορούμε να την επεξεργαστούμε. Πληρωμή με μετρητά στην παράδοση, κάρτα online (μέσω Viva.com), σύνδεσμο πληρωμής, τραπεζική μεταφορά ή πιστωτικό υπόλοιπο Fitpal Wallet.'
              : 'Each order is subject to a per-day cutoff time and a minimum amount. If a daily order does not meet the minimum, we cannot process it. Payment options include cash on delivery, card online (via Viva.com), payment link, bank transfer, or Fitpal Wallet credit.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '5. Ακυρώσεις και επιστροφές' : '5. Cancellations and refunds'}</h2>
          <p>
            {isEl
              ? 'Μπορείς να ακυρώσεις μια ημέρα παράδοσης πριν τον αντίστοιχο χρόνο cutoff. Μετά τον cutoff, η παραγγελία δεν μπορεί να ακυρωθεί επειδή έχει μπει στην παραγωγή. Επιστροφές χρημάτων διεκπεραιώνονται εντός 5 εργάσιμων ημερών.'
              : 'You may cancel a delivery day before its cutoff time. After cutoff, the order is in production and cannot be cancelled. Refunds are processed within 5 business days.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '6. Αλλεργίες και διατροφικές πληροφορίες' : '6. Allergens and dietary information'}</h2>
          <p>
            {isEl
              ? 'Καταβάλλουμε κάθε προσπάθεια να αναφέρουμε με ακρίβεια αλλεργιογόνα και θρεπτικές αξίες. Ωστόσο, η κουζίνα μας επεξεργάζεται γλουτένη, αυγά, γαλακτοκομικά, ψάρι, οστρακοειδή, σόγια και ξηρούς καρπούς. Σε περίπτωση σοβαρής αλλεργίας, επικοινώνησε μαζί μας πριν παραγγείλεις.'
              : 'We make every effort to accurately list allergens and nutritional values. However, our kitchen handles gluten, eggs, dairy, fish, shellfish, soy, and nuts. If you have a severe allergy, please contact us before ordering.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '7. Ευθύνη' : '7. Liability'}</h2>
          <p>
            {isEl
              ? 'Παρέχουμε την υπηρεσία “ως έχει”. Δεν αναλαμβάνουμε ευθύνη για ζημιές που οφείλονται σε ακραίες καιρικές συνθήκες, απεργίες ή άλλους παράγοντες εκτός του ελέγχου μας. Σε καμία περίπτωση η ευθύνη μας δεν υπερβαίνει το ποσό της συγκεκριμένης παραγγελίας.'
              : 'We provide the service "as is." We are not liable for damages caused by extreme weather, strikes, or other factors beyond our control. In no case will our liability exceed the value of the specific order.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '8. Τροποποιήσεις' : '8. Changes'}</h2>
          <p>
            {isEl
              ? 'Διατηρούμε το δικαίωμα να τροποποιήσουμε τους όρους. Η συνεχιζόμενη χρήση της υπηρεσίας μετά από αλλαγές θεωρείται αποδοχή τους.'
              : 'We reserve the right to modify these terms. Continued use of the service after changes constitutes acceptance.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '9. Επικοινωνία' : '9. Contact'}</h2>
          <p>
            {isEl
              ? 'Email: support@fitpal.gr'
              : 'Email: support@fitpal.gr'}
          </p>
        </section>
      </div>
    </div>
  )
}
