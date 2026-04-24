import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { Toggle } from '../ui/Toggle'
import { makeTr } from '../../lib/translations'

interface ExtrasSectionProps {
  /** When true, show red error hints on invoice fields that fail validation. */
  attempted?: boolean
}

/**
 * Cutlery, invoice, and order-notes toggles.
 *
 * WEC-138: invoice validation — when the invoice toggle is on, we require
 * the company/name and a VAT that looks plausible (digits-only, ≥ 5 chars).
 * The red-border styling appears after the user has tapped the submit
 * button, mirroring ContactSection's attempted-then-validate pattern so
 * the form doesn't yell at them while they're still typing.
 */
export function ExtrasSection({ attempted = false }: ExtrasSectionProps) {
  const lang = useUIStore((s) => s.lang)
  const payment = useCartStore((s) => s.payment)
  const setPayment = useCartStore((s) => s.setPayment)
  const t = makeTr(lang)

  // Validation rules (see isInvoiceValid below for the matching check in
  // CheckoutPage — keep them in sync).
  const vatDigitsOnly = (payment.invoiceVat ?? '').replace(/\D/g, '')
  const nameMissing = payment.invoice && !(payment.invoiceName ?? '').trim()
  const vatMissing = payment.invoice && vatDigitsOnly.length === 0
  const vatTooShort = payment.invoice && vatDigitsOnly.length > 0 && vatDigitsOnly.length < 5
  const showNameErr = attempted && nameMissing
  const showVatErr = attempted && (vatMissing || vatTooShort)

  return (
    <div className="extras-section">
      <div className="extra-row">
        <div className="extra-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11V7a9 9 0 0118 0v4"/><path d="M21 11H3l1 10h16z"/>
          </svg>
          <span>{t('cutlery')}</span>
        </div>
        <Toggle
          checked={payment.cutlery ?? false}
          onChange={(v) => setPayment({ ...payment, cutlery: v })}
        />
      </div>

      <div className="extra-row">
        <div className="extra-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
          <span>{t('invoice')}</span>
        </div>
        <Toggle
          checked={payment.invoice ?? false}
          onChange={(v) => setPayment({ ...payment, invoice: v })}
        />
      </div>

      {payment.invoice && (
        <div className="invoice-fields">
          <div className="form-row">
            <label className="form-label">{lang === 'el' ? 'Επωνυμία / Όνομα' : 'Company / Name'}</label>
            <input
              className={`form-input${showNameErr ? ' is-invalid' : ''}`}
              value={payment.invoiceName ?? ''}
              onChange={(e) => setPayment({ ...payment, invoiceName: e.target.value })}
            />
            {showNameErr && (
              <div className="form-hint form-hint-error">
                {lang === 'el' ? 'Συμπλήρωσε την επωνυμία ή το όνομα' : 'Enter a company or name'}
              </div>
            )}
          </div>
          <div className="form-row">
            <label className="form-label">{lang === 'el' ? 'ΑΦΜ' : 'VAT Number'}</label>
            <input
              className={`form-input${showVatErr ? ' is-invalid' : ''}`}
              value={payment.invoiceVat ?? ''}
              inputMode="numeric"
              onChange={(e) => setPayment({ ...payment, invoiceVat: e.target.value })}
            />
            {showVatErr && (
              <div className="form-hint form-hint-error">
                {vatMissing
                  ? (lang === 'el' ? 'Το ΑΦΜ είναι υποχρεωτικό' : 'VAT number is required')
                  : (lang === 'el' ? 'Το ΑΦΜ πρέπει να έχει τουλάχιστον 5 ψηφία' : 'VAT must be at least 5 digits')}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="extra-row">
        <label className="form-label">{t('orderNotes')}</label>
        <textarea
          className="form-input notes-ta"
          value={payment.notes ?? ''}
          onChange={(e) => setPayment({ ...payment, notes: e.target.value })}
          rows={2}
          placeholder={lang === 'el' ? 'Σημειώσεις για την παραγγελία...' : 'Any notes for your order...'}
        />
      </div>
    </div>
  )
}
