import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { subTotal } from '../../lib/helpers'

const PAYMENT_METHODS = [
  { id: 'wallet',   iconPath: 'M2 9h20M2 5h20v14H2zM16 12h.01',  labelEl: 'Fitpal Wallet',               labelEn: 'Fitpal Wallet', descEl: 'Χρέωση από το υπόλοιπο Wallet', descEn: 'Deduct from your Wallet balance' },
  { id: 'card',     iconPath: 'M3 9h18M7 15h.01M11 15h2',        labelEl: 'Κάρτα online',               labelEn: 'Credit card online',   descEl: 'Ασφαλής πληρωμή με χρεωστική/πιστωτική κάρτα', descEn: 'Secure credit/debit card payment' },
  { id: 'cash',     iconPath: 'M12 12a4 4 0 100-8 4 4 0 000 8zM3 20c0-4 3.6-7 9-7s9 3 9 7', labelEl: 'Μετρητά κατά την παράδοση', labelEn: 'Cash on delivery', descEl: 'Πληρωμή με μετρητά κατά την παράδοση', descEn: 'Pay with cash at delivery' },
  { id: 'link',     iconPath: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71', labelEl: 'Link πληρωμής αργότερα', labelEn: 'Payment link later', descEl: 'Θα λάβετε link πληρωμής μετά την επιβεβαίωση', descEn: 'You\'ll receive a payment link after confirmation' },
  { id: 'transfer', iconPath: 'M4 6h16M4 12h16M4 18h16',         labelEl: 'Τραπεζική μεταφορά',         labelEn: 'Bank transfer', descEl: 'Κατάθεση σε τραπεζικό λογαριασμό', descEn: 'Deposit to bank account' },
] as const

export function PaymentSection() {
  const lang = useUIStore((s) => s.lang)
  const payment = useCartStore((s) => s.payment)
  const setPayment = useCartStore((s) => s.setPayment)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const user = useAuthStore((s) => s.user)
  const walletBalance = user?.wallet?.balance ?? 0
  const walletActive = user?.wallet?.active

  const total = subTotal(cart, voucher)
  const walletSufficient = walletBalance >= total

  return (
    <div className="payment-section">
      <div className="payment-methods">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m.id}
            className={`payment-opt${payment.method === m.id ? ' active' : ''}${m.id === 'wallet' && walletActive && !walletSufficient ? ' insufficient' : ''}`}
            onClick={() => setPayment({ ...payment, method: m.id })}
            disabled={m.id === 'wallet' && walletActive && !walletSufficient}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={m.iconPath}/>
            </svg>
            <div className="payment-text">
              <span className="payment-label">
                {lang === 'el' ? m.labelEl : m.labelEn}
                {m.id === 'wallet' && walletActive && (
                  <span className={`wallet-bal-badge${!walletSufficient ? ' insufficient' : ''}`}>
                    {!walletSufficient ? `€${walletBalance.toFixed(2)} — ${lang === 'el' ? 'Ανεπαρκές' : 'Insufficient'}` : `€${walletBalance.toFixed(2)}`}
                  </span>
                )}
              </span>
              <span className="payment-desc">{lang === 'el' ? m.descEl : m.descEn}</span>
            </div>
            {payment.method === m.id && (
              <svg className="payment-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
