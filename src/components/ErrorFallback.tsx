/**
 * WEC-762 — what the customer sees when React crashes.
 *
 * Before this, a render crash left a WHITE PAGE: no message, no way back, and
 * no signal to us. Whatever else happens, the customer should be told something
 * broke and be given a way out.
 *
 * Deliberately dependency-free: it must render even when the app's stores,
 * translations or router are the thing that just died, so it does not call
 * useUIStore or t(). Language comes from <html lang> with Greek as the default,
 * matching the house rule that a failed lookup degrades to Greek.
 */
export function ErrorFallback({ onReset }: { onReset?: () => void }) {
  const isEl = (document.documentElement.lang || 'el').toLowerCase().startsWith('el')
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14,
      padding: '40px 24px', textAlign: 'center',
      fontFamily: "'Geologica',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif",
    }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#004739' }}>
        {isEl ? 'Κάτι πήγε στραβά' : 'Something went wrong'}
      </div>
      <div style={{ fontSize: 15, color: '#5c6b62', maxWidth: 420, lineHeight: 1.55 }}>
        {isEl
          ? 'Λυπούμαστε — παρουσιάστηκε ένα πρόβλημα. Το καταγράψαμε και το κοιτάμε. Δοκίμασε ξανά.'
          : 'Sorry — something broke. We have logged it and are looking into it. Please try again.'}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => (onReset ? onReset() : window.location.reload())}
          style={{
            background: '#004739', color: '#fff', border: 0, borderRadius: 999,
            padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {isEl ? 'Δοκίμασε ξανά' : 'Try again'}
        </button>
        <a
          href="/"
          style={{
            border: '1px solid #cfdad4', borderRadius: 999, padding: '11px 22px',
            fontSize: 14, fontWeight: 700, color: '#004739', textDecoration: 'none',
          }}
        >
          {isEl ? 'Αρχική' : 'Home'}
        </a>
      </div>
      <div style={{ fontSize: 12.5, color: '#8c9990', marginTop: 8 }}>
        {isEl ? 'Χρειάζεσαι βοήθεια;' : 'Need help?'}{' '}
        <a href="mailto:support@fitpal.gr" style={{ color: '#00875a' }}>support@fitpal.gr</a>
      </div>
    </div>
  )
}
