import {
  PaymentMethodsSection,
  BankTransferInfoSection,
  MinOrderSection,
  parseVisibility,
  parseBankInfos,
} from './Settings'
import { useAdminSettings } from '../hooks/useAdminSettings'

/**
 * Payments (WEC-278) — every payment-related lever in one page.
 *
 * Sections (in order):
 *   1. Payment methods grid              — settings.payment_methods_enabled
 *   2. Bank transfer info (multi-IBAN)   — settings.bank_transfer_info
 *   3. Minimum delivery amount           — settings.min_order
 *
 * The min-order section lives here because it gates payment acceptance —
 * an order under the threshold can't be placed regardless of which method
 * the customer picks. Per-zone overrides in Delivery Zones can lift this
 * floor higher per postcode.
 */
export function Payments() {
  const { byKey, loading, err, savingMsg, save } = useAdminSettings()

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Payments</h1>
      <p className="admin-page-sub">
        What methods customers can use, bank details for transfers, and the global minimum order amount.
      </p>

      {err && <div className="admin-error-banner">{err}</div>}
      {savingMsg && <div className="admin-info-banner">{savingMsg}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <PaymentMethodsSection
            value={parseVisibility(byKey.get('payment_methods_enabled'))}
            onSave={(v) => save('payment_methods_enabled', v)}
          />
          <BankTransferInfoSection
            value={parseBankInfos(byKey.get('bank_transfer_info'))}
            onSave={(v) => save('bank_transfer_info', v)}
          />
          <MinOrderSection
            value={Number(byKey.get('min_order') ?? 1500)}
            onSave={(v) => save('min_order', v)}
          />
        </>
      )}
    </div>
  )
}
