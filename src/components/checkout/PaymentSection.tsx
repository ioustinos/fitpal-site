import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useImpersonationStore } from '../../store/useImpersonationStore'
import { subTotal } from '../../lib/helpers'
import { makeTr } from '../../lib/translations'
import { PAYMENT_METHODS as PM } from '../../lib/paymentMethods'
import { CopyButton } from '../ui/CopyButton'

// WEC-499: labels + descriptions now come from the shared payment-methods
// source. This array only carries the per-method icon + display order; the
// labelEl/descEl field names are preserved so the render below is untouched.
const PAYMENT_METHODS = [
  { id: 'wallet',   iconPath: 'M2 9h20M2 5h20v14H2zM16 12h.01',  labelEl: PM.wallet.titleEl,   labelEn: PM.wallet.titleEn,   descEl: PM.wallet.descEl,   descEn: PM.wallet.descEn },
  { id: 'card',     iconPath: 'M3 9h18M7 15h.01M11 15h2',        labelEl: PM.card.titleEl,     labelEn: PM.card.titleEn,     descEl: PM.card.descEl,     descEn: PM.card.descEn },
  { id: 'cash',     iconPath: 'M12 12a4 4 0 100-8 4 4 0 000 8zM3 20c0-4 3.6-7 9-7s9 3 9 7', labelEl: PM.cash.titleEl, labelEn: PM.cash.titleEn, descEl: PM.cash.descEl, descEn: PM.cash.descEn },
  { id: 'link',     iconPath: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71', labelEl: PM.link.titleEl, labelEn: PM.link.titleEn, descEl: PM.link.descEl, descEn: PM.link.descEn },
  { id: 'transfer', iconPath: 'M4 6h16M4 12h16M4 18h16',         labelEl: PM.transfer.titleEl, labelEn: PM.transfer.titleEn, descEl: PM.transfer.descEl, descEn: PM.transfer.descEn },
] as const

export function PaymentSection() {
  const lang = useUIStore((s) => s.lang)
  const t = makeTr(lang)
  const payment = useCartStore((s) => s.payment)
  const setPayment = useCartStore((s) => s.setPayment)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const user = useAuthStore((s) => s.user)
  // WEC-255: per-method visibility flags { public, admin }. The legacy
  // paymentMethodsEnabled is the public subset and is no longer consumed
  // here — we read the full map and pick the right flag below based on
  // whether an admin is impersonating.
  const visibility = useMenuStore((s) => s.settings.paymentMethodVisibility)
  // With session-swap impersonation, `user` already IS the impersonated
  // customer (their JWT is active, their profile/wallet were re-loaded by
  // App.tsx's onAuthStateChange handler). So we just read user.wallet
  // directly — no special-case swap.
  const isImpersonating = useImpersonationStore((s) => s.active)
  const walletBalance = user?.wallet?.balance ?? 0
  const walletActive = user?.wallet?.active
  // WEC-262: scope-aware total — wallet sufficiency check needs to use
  // the same number the customer sees in the order summary.
  const dishMap = useMenuStore((s) => s.dishMap)
  const catLookup = (id: string) => dishMap[id]?.catId

  const total = subTotal(cart, voucher, catLookup)
  const walletSufficient = walletBalance >= total

  // Filter hardcoded catalog by the admin-configured visibility map (WEC-255).
  //
  // Two layers of filtering, applied in order:
  //   1. Visibility flag — `admin` flag if an admin is impersonating, else
  //      `public`. Lets ops hide methods like the wallet from public customers
  //      while still letting admins debit it on their behalf.
  //   2. Wallet special-cases (kept from WEC-194):
  //        - admin-managed wallets only show during impersonation
  //        - non-impersonating users without an active wallet or with 0 balance
  //          don't see the wallet option at all (cleaner than a disabled chip)
  //        - during impersonation we keep showing wallet even at €0 so admins
  //          notice the empty state instead of hunting for a missing button
  const visibleMethods = PAYMENT_METHODS.filter((m) => {
    const v = visibility[m.id]
    if (!v) return false
    if (!(isImpersonating ? v.admin : v.public)) return false
    if (m.id === 'wallet' && !isImpersonating) {
      // Customers: hide the wallet entirely unless it's spendable — cleaner
      // than a disabled chip they can't act on.
      if (user?.wallet?.adminManaged) return false
      if (!walletActive || walletBalance <= 0) return false
    }
    // WEC-362: while impersonating we ALWAYS keep the wallet visible so the
    // admin can see the customer's wallet state — but it renders greyed +
    // disabled below when the customer has no wallet (or can't cover the order)
    // instead of looking like a usable option.
    return true
  })

  // WEC-260: bank info is now an array of up to 5 entries. Customer sees
  // all configured IBANs stacked when they pick the bank-transfer method.
  const bankInfos = useMenuStore((s) => s.settings.bankTransferInfos)

  return (
    <div className="payment-section">
      <div className="payment-methods">
        {visibleMethods.map((m) => {
          const isWallet = m.id === 'wallet'
          // No spendable wallet (none / inactive). For customers this case is
          // already filtered out; under impersonation the button still shows
          // but greyed + disabled (WEC-362).
          const noWallet = isWallet && !walletActive
          const walletInsufficient = isWallet && walletActive && !walletSufficient
          const walletDisabled = noWallet || walletInsufficient
          return (
            <button
              key={m.id}
              className={`payment-opt${payment.method === m.id ? ' active' : ''}${walletDisabled ? ' insufficient' : ''}`}
              onClick={() => setPayment({ ...payment, method: m.id })}
              disabled={walletDisabled}
              title={noWallet ? t('coCustomerNoWallet') : undefined}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={m.iconPath}/>
              </svg>
              <div className="payment-text">
                <span className="payment-label">
                  {lang === 'el' ? m.labelEl : m.labelEn}
                  {isWallet && walletActive && (
                    <span className={`wallet-bal-badge${!walletSufficient ? ' insufficient' : ''}`}>
                      {!walletSufficient ? `€${walletBalance.toFixed(2)} — ${t('coInsufficient')}` : `€${walletBalance.toFixed(2)}`}
                    </span>
                  )}
                  {isWallet && noWallet && (
                    <span className="wallet-bal-badge insufficient">
                      {t('coNoWallet')}
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
          )
        })}
      </div>

      {payment.method === 'transfer' && bankInfos.length > 0 && (
        <div className="bank-info-box">
          <div className="bank-info-title">
            {t('coBankTransferDetails')}
          </div>
          {/* WEC-260: render every configured IBAN. Customer can pick whichever
              bank is most convenient. Each entry is its own definition list so
              the visual grouping survives long IBANs and odd ordering. */}
          {bankInfos.map((b, i) => (
            <dl key={`${b.iban}-${i}`} className="bank-info-list" style={i > 0 ? { marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' } : undefined}>
              {b.bankName && (<><dt>{t('coBank')}</dt> <dd>{b.bankName}</dd></>)}
              {/* WEC-556 O17 — copy button next to the IBAN */}
              <dt>IBAN</dt>
              <dd className="bank-info-copyrow"><span>{b.iban}</span><CopyButton value={b.iban} lang={lang} ariaLabel={lang === 'el' ? 'Αντιγραφή IBAN' : 'Copy IBAN'} /></dd>
              <dt>{t('coBeneficiary')}</dt> <dd>{b.beneficiary}</dd>
            </dl>
          ))}
          <div className="bank-info-note">
            {t('coBankTransferNote')}
          </div>
        </div>
      )}
    </div>
  )
}
