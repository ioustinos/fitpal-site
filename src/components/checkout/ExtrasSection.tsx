import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { makeTr } from '../../lib/translations'
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
  const t = makeTr(lang)

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
          customers don't read it as an invoice-related notes field.
          WEC-407: capped at 500 chars (client maxLength + server mirror). */}
      <div className="order-notes">
        <div className="order-notes-head">
          <label className="order-notes-label" htmlFor="order-notes-input">
            <svg className="order-notes-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            {t('coOrderNotesLabel')}
          </label>
          <span className={`order-notes-counter${(payment.notes?.length ?? 0) >= 500 ? ' is-max' : ''}`}>
            {payment.notes?.length ?? 0} / 500
          </span>
        </div>
        <textarea
          id="order-notes-input"
          className="form-input order-notes-ta"
          value={payment.notes ?? ''}
          maxLength={500}
          onChange={(e) => setPayment({ notes: e.target.value.slice(0, 500) })}
          rows={2}
          placeholder={t('coOrderNotesPh')}
        />
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
          <span>{t('coCutlery')}</span>
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
          <span>{t('prefInvoice')}</span>
        </div>
        <Toggle
          checked={payment.invoice ?? false}
          onChange={(v) => setPayment({ invoice: v })}
        />
      </div>

      {payment.invoice && (
        <div className="invoice-fields">
          <div className="form-row">
            <label className="form-label">{t('coCompanyOrName')}</label>
            <input
              className={`form-input${showNameErr ? ' is-invalid' : ''}`}
              value={payment.invoiceName ?? ''}
              onChange={(e) => setPayment({ invoiceName: e.target.value })}
            />
            {showNameErr && (
              <div className="form-hint form-hint-error">
                {t('coEnterCompanyName')}
              </div>
            )}
          </div>
          <div className="form-row">
            <label className="form-label">{t('vat')}</label>
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
                  ? t('coVatRequired')
                  : vatBadLength
                    ? t('coVat9Digits')
                    : t('coVatInvalid')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
