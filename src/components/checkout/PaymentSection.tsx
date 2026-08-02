import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useMenuStore } from '../../store/useMenuStore'
import { useImpersonationStore } from '../../store/useImpersonationStore'
import { subTotal } from '../../lib/helpers'
import { makeTr } from '../../lib/translations'
import { visiblePaymentMethods } from '../../lib/paymentVisibility'
import { CopyButton } from '../ui/CopyButton'

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

  // WEC-255/588: filter by the admin visibility map via the shared helper
  // (single source, also used by Account → Προτιμήσεις). Checkout applies the
  // wallet spendability gating (layer 2): admin-managed wallets only show during
  // impersonation; non-impersonating customers without an active/positive wallet
  // don't see the option. During impersonation the wallet always shows (WEC-362),
  // rendering greyed + disabled below when it can't cover the order.
  const visibleMethods = visiblePaymentMethods(visibility, {
    isImpersonating,
    applyWalletGating: true,
    wallet: user?.wallet,
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
                      {!walletSufficient ? `${walletBalance.toFixed(2)} € — ${t('coInsufficient')}` : `${walletBalance.toFixed(2)} €`}
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
