import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { Toggle } from '../ui/Toggle'
import { makeTr } from '../../lib/translations'

export function ExtrasSection() {
  const lang = useUIStore((s) => s.lang)
  const payment = useCartStore((s) => s.payment)
  const setPayment = useCartStore((s) => s.setPayment)
  const t = makeTr(lang)

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
              className="form-input"
              value={payment.invoiceName ?? ''}
              onChange={(e) => setPayment({ ...payment, invoiceName: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label className="form-label">{lang === 'el' ? 'ΑΦΜ' : 'VAT Number'}</label>
            <input
              className="form-input"
              value={payment.invoiceVat ?? ''}
              onChange={(e) => setPayment({ ...payment, invoiceVat: e.target.value })}
            />
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
