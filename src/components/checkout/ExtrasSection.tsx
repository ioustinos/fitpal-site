import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { Toggle } from '../ui/Toggle'
import { isValidGreekVat, vatDigits } from '../../lib/vat'

interface ExtrasSectionProps {
  /** When true, show red error hints on invoice fields that fail validation. */
  attempted?: boolean
}

/**
 * Order notes, cutlery, invoice. WEC-355: notes now lives at the TOP of
 * the section (not buried under the invoice block) and uses the standard
 * form-input contrast — testers were associating it with the invoice
 * fields because of low contrast + below-invoice position.
 *
 * WEC-354: ΑΦΜ field caps at 9 digits, strips non-digits, and validates
 * via the Greek checksum (`src/lib/vat.ts`). Replaces the previous
 * "≥ 5 digits" heuristic.
 */
export function ExtrasSection({ attempted = false }: ExtrasSectionProps) {
  const lang = useUIStore((s) => s.lang)
  const payment = useCartStore((s) => s.payment)
  const setPayment = useCartStore((s) => s.setPayment)
  const isEl = lang === 'el'

  // ── Validation rules ─────────────────────────────────────────────
  // Keep these in sync with CheckoutPage.tsx's `validationIssues` block.
  const vatRaw = payment.invoiceVat ?? ''
  const vatStripped = vatDigits(vatRaw)
  const nameMissing = payment.invoice && !(payment.invoiceName ?? '').trim()
  const vatMissing = payment.invoice && vatStripped.length === 0
  const vatBadLength = payment.invoice && vatStripped.length > 0 && vatStripped.length !== 9
  const vatBadChecksum = payment.invoice && vatStripped.length === 9 && !isValidGreekVat(vatStripped)
  const showNameErr = attempted && nameMissing
  const showVatErr = attempted && (vatMissing || vatBadLength || vatBadChecksum)

  return (
    <div className="extras-section">
      {/* WEC-355: order notes — top of section, full-contrast styling so
          customers don't read it as an invoice-related notes field. */}
      <div className="order-notes">
        <label className="order-notes-label" htmlFor="order-notes-input">
          <svg className="order-notes-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          {isEl ? 'Σχόλια για την παραγγελία σας' : 'Notes for your order'}
        </label>
        <textarea
          id="order-notes-input"
          className="form-input order-notes-ta"
          value={payment.notes ?? ''}
          onChange={(e) => setPayment({ notes: e.target.value })}
          rows={2}
          placeholder={isEl
            ? 'π.χ. χτυπήστε δύο φορές το κουδούνι, αφήστε στη θυρωρό…'
            : 'e.g. ring the bell twice, leave with the doorman…'}
        />
        <div className="order-notes-hint">
          {isEl
            ? 'Σημειώσεις για την παράδοση ή ειδικά αιτήματα — όχι για το τιμολόγιο.'
            : 'For delivery instructions or special requests — not for invoice details.'}
        </div>
      </div>

      {/* WEC-237: setPayment is a partial-merge (state.payment + info), so we
          pass ONLY the field we want to update. Avoids the stale-closure
          regression where setPayment({ ...payment, X: y }) silently clobbered
          just-applied keys. */}
      <div className="extra-row">
        <div className="extra-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11V7a9 9 0 0118 0v4"/><path d="M21 11H3l1 10h16z"/>
          </svg>
          <span>{isEl ? 'Μαχαιροπίρουνα' : 'Cutlery'}</span>
        </div>
        <Toggle
          checked={payment.cutlery ?? false}
          onChange={(v) => setPayment({ cutlery: v })}
        />
      </div>

      <div className="extra-row">
        <div className="extra-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
          <span>{isEl ? 'Τιμολόγιο' : 'Invoice'}</span>
        </div>
        <Toggle
          checked={payment.invoice ?? false}
          onChange={(v) => setPayment({ invoice: v })}
        />
      </div>

      {payment.invoice && (
        <div className="invoice-fields">
          <div className="form-row">
            <label className="form-label">{isEl ? 'Επωνυμία / Όνομα' : 'Company / Name'}</label>
            <input
              className={`form-input${showNameErr ? ' is-invalid' : ''}`}
              value={payment.invoiceName ?? ''}
              onChange={(e) => setPayment({ invoiceName: e.target.value })}
            />
            {showNameErr && (
              <div className="form-hint form-hint-error">
                {isEl ? 'Συμπλήρωσε την επωνυμία ή το όνομα' : 'Enter a company or name'}
              </div>
            )}
          </div>
          <div className="form-row">
            <label className="form-label">{isEl ? 'ΑΦΜ' : 'VAT Number'}</label>
            <input
              className={`form-input${showVatErr ? ' is-invalid' : ''}`}
              value={vatStripped}
              inputMode="numeric"
              maxLength={9}
              onChange={(e) => setPayment({ invoiceVat: vatDigits(e.target.value) })}
              placeholder="123456782"
              aria-invalid={showVatErr || undefined}
            />
            {showVatErr && (
              <div className="form-hint form-hint-error">
                {vatMissing
                  ? (isEl ? 'Το ΑΦΜ είναι υποχρεωτικό' : 'VAT number is required')
                  : vatBadLength
                    ? (isEl ? 'Το ΑΦΜ πρέπει να έχει 9 ψηφία' : 'VAT must be 9 digits')
                    : (isEl ? 'Μη έγκυρο ΑΦΜ — έλεγξε τα ψηφία' : 'Invalid VAT — check the digits')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
