import { useUIStore } from '../../store/useUIStore'
import { useCartStore } from '../../store/useCartStore'

export function ConfirmationScreen() {
  const lang = useUIStore((s) => s.lang)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const clearAll = useCartStore((s) => s.clearAll)

  function handleDone() {
    clearAll()
    closeCheckout()
  }

  return (
    <div className="confirmation-screen">
      <div className="conf-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h2 className="conf-title">
        {lang === 'el' ? 'Η παραγγελία σου καταχωρήθηκε!' : 'Your order has been placed!'}
      </h2>
      <p className="conf-sub">
        {lang === 'el'
          ? 'Θα λάβεις επιβεβαίωση στο email σου σύντομα.'
          : "You'll receive a confirmation email shortly."}
      </p>
      <button className="btn-conf-done" onClick={handleDone}>
        {lang === 'el' ? 'Επιστροφή στο μενού' : 'Back to menu'}
      </button>
    </div>
  )
}
