import { useUIStore } from '../store/useUIStore'

/**
 * Placeholder Privacy Policy page (WEC-322 / WEC-323).
 *
 * Required as a public URL by the Facebook Developer Portal before an app
 * can switch to Live mode. Content here is a baseline draft — the legal
 * copy needs review by a Greek attorney before customer launch. Until then
 * it covers the obvious GDPR + tracking commitments truthfully.
 */
export function PrivacyPage() {
  const lang = useUIStore((s) => s.lang)
  const isEl = lang === 'el'

  return (
    <div className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <a href="/" className="legal-back">
            {isEl ? '← Πίσω στην αρχική' : '← Back to home'}
          </a>
          <h1>{isEl ? 'Πολιτική Απορρήτου' : 'Privacy Policy'}</h1>
          <p className="legal-updated">
            {isEl
              ? 'Τελευταία ενημέρωση: 11 Μαΐου 2026'
              : 'Last updated: 11 May 2026'}
          </p>
        </header>

        <section>
          <h2>{isEl ? '1. Ποιοι είμαστε' : '1. Who we are'}</h2>
          <p>
            {isEl
              ? 'Η Fitpal είναι ελληνική επιχείρηση παρασκευής και διανομής ισορροπημένων γευμάτων με έδρα την Αθήνα. Η ιστοσελίδα order.fitpal.gr λειτουργεί ως πλατφόρμα παραγγελιοληψίας για τους πελάτες μας.'
              : 'Fitpal is a Greek balanced-meals preparation and delivery business based in Athens. The site order.fitpal.gr is the ordering platform we operate for our customers.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '2. Τι δεδομένα συλλέγουμε' : '2. What data we collect'}</h2>
          <p>
            {isEl
              ? 'Κατά την εγγραφή και παραγγελία συλλέγουμε: όνομα, email, τηλέφωνο, διεύθυνση παράδοσης, ιστορικό παραγγελιών, διατροφικές προτιμήσεις και αλλεργίες, στοιχεία πληρωμής (μέσω του πιστοποιημένου παρόχου Viva.com — δεν αποθηκεύουμε στοιχεία κάρτας στους δικούς μας servers).'
              : 'When you register and place orders we collect: name, email, phone, delivery address, order history, dietary preferences and allergies, and payment details (handled via certified provider Viva.com — we never store card details on our own servers).'}
          </p>
          <p>
            {isEl
              ? 'Αν συνδεθείς μέσω Google ή Facebook, λαμβάνουμε από τον πάροχο: όνομα, email και δημόσια φωτογραφία προφίλ. Δεν λαμβάνουμε κανένα άλλο στοιχείο.'
              : 'If you sign in via Google or Facebook, we receive from the provider: your name, email, and public profile picture. We do not receive any other data.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '3. Γιατί τα συλλέγουμε' : '3. Why we collect it'}</h2>
          <p>
            {isEl
              ? 'Για να σου παραδώσουμε τις παραγγελίες σου, να σου παρέχουμε υποστήριξη, να βελτιώσουμε τα γεύματά μας με βάση τα διατροφικά σου στοιχεία, και να συμμορφωθούμε με τις νομικές υποχρεώσεις τιμολόγησης.'
              : 'To deliver your orders, provide customer support, improve our menus based on your dietary inputs, and meet legal invoicing obligations.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '4. Με ποιους τα μοιραζόμαστε' : '4. Who we share it with'}</h2>
          <p>
            {isEl
              ? 'Μοιραζόμαστε δεδομένα μόνο με τους εξής συνεργάτες, και μόνο όσα απαιτούνται για τη λειτουργία: Supabase (database και authentication, υπό GDPR-compliant DPA), Viva.com (πληρωμές), Brevo & Klaviyo (email επικοινωνίες), Netlify (φιλοξενία). Δεν πουλάμε ποτέ προσωπικά δεδομένα σε τρίτους.'
              : 'We share data only with the following processors, and only what is necessary: Supabase (database and authentication, GDPR-compliant DPA), Viva.com (payments), Brevo & Klaviyo (email communications), Netlify (hosting). We never sell personal data to third parties.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '5. Τα δικαιώματά σου' : '5. Your rights'}</h2>
          <p>
            {isEl
              ? 'Έχεις δικαίωμα πρόσβασης, διόρθωσης, διαγραφής, περιορισμού επεξεργασίας και φορητότητας των δεδομένων σου, σύμφωνα με τον GDPR. Στείλε αίτημα στο privacy@fitpal.gr.'
              : 'You have the right to access, correct, delete, restrict processing of, and port your data under GDPR. Email privacy@fitpal.gr to exercise these rights.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '6. Cookies' : '6. Cookies'}</h2>
          <p>
            {isEl
              ? 'Χρησιμοποιούμε μόνο essential cookies για τη λειτουργία της συνεδρίας σου (login token, καλάθι). Δεν χρησιμοποιούμε third-party analytics ή advertising cookies.'
              : 'We use essential cookies only — for your session (login token, cart). We do not use third-party analytics or advertising cookies.'}
          </p>
        </section>

        <section>
          <h2>{isEl ? '7. Επικοινωνία' : '7. Contact'}</h2>
          <p>
            {isEl
              ? 'Email: privacy@fitpal.gr · Επιτροπή Προστασίας Δεδομένων: dpa.gr'
              : 'Email: privacy@fitpal.gr · Hellenic DPA: dpa.gr'}
          </p>
        </section>
      </div>
    </div>
  )
}
