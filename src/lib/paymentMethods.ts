// WEC-499: single source of truth for payment-method labels.
//
// Before this, the same five methods were labelled in 5 different places with
// drifting wording (checkout, order history, account prefs, admin settings,
// plus dead keys in translations.ts). This module is now the ONE place.
//
// Canonical ids match the `payment_method` Postgres enum: cash / card / link /
// transfer / wallet. (Account prefs previously used a non-enum id 'bank' — now
// 'transfer'.)
//
// Three label registers, because the surfaces genuinely differ:
//   - short*  : compact label (order history, account prefs)
//   - title*/desc* : checkout card heading + subtitle (more descriptive)
//   - adminEn : verbose English for the admin settings/config screens
// Customer-facing strings are preserved verbatim from their prior locations so
// this refactor changes NOTHING visible (except unifying the transfer label,
// which was 'Μεταφορά' / 'Τράπεζα' in two places → now 'Τραπεζική μεταφορά').

export type PaymentMethodId = 'cash' | 'card' | 'link' | 'transfer' | 'wallet'

export interface PaymentMethodCopy {
  shortEl: string
  shortEn: string
  titleEl: string
  titleEn: string
  descEl: string
  descEn: string
  adminEn: string
}

export const PAYMENT_METHODS: Record<PaymentMethodId, PaymentMethodCopy> = {
  cash: {
    shortEl: 'Μετρητά', shortEn: 'Cash',
    titleEl: 'Μετρητά κατά την παράδοση', titleEn: 'Cash on delivery',
    descEl: 'Πληρωμή με μετρητά κατά την παράδοση', descEn: 'Pay with cash at delivery',
    adminEn: 'Cash on delivery',
  },
  card: {
    shortEl: 'Κάρτα', shortEn: 'Card',
    titleEl: 'Κάρτα online', titleEn: 'Credit card online',
    descEl: 'Ασφαλής πληρωμή με χρεωστική/πιστωτική κάρτα', descEn: 'Secure credit/debit card payment',
    adminEn: 'Card online (Viva)',
  },
  link: {
    shortEl: 'Link πληρωμής', shortEn: 'Payment Link',
    titleEl: 'Link πληρωμής αργότερα', titleEn: 'Payment link later',
    descEl: 'Θα λάβετε link πληρωμής μετά την επιβεβαίωση', descEn: "You'll receive a payment link after confirmation",
    adminEn: 'Payment link (sent later)',
  },
  transfer: {
    shortEl: 'Τραπεζική μεταφορά', shortEn: 'Bank transfer',
    titleEl: 'Τραπεζική μεταφορά', titleEn: 'Bank transfer',
    descEl: 'Κατάθεση σε τραπεζικό λογαριασμό', descEn: 'Deposit to bank account',
    adminEn: 'Bank transfer',
  },
  wallet: {
    shortEl: 'Πορτοφόλι', shortEn: 'Wallet',
    titleEl: 'Fitpal Wallet', titleEn: 'Fitpal Wallet',
    descEl: 'Χρέωση από το υπόλοιπο Wallet', descEn: 'Deduct from your Wallet balance',
    adminEn: 'Fitpal wallet',
  },
}

export const PAYMENT_METHOD_IDS: PaymentMethodId[] = ['cash', 'card', 'link', 'transfer', 'wallet']

/** Compact label for a method id, falling back to the raw id if unknown. */
export function paymentShort(id: string, lang: 'el' | 'en'): string {
  const m = (PAYMENT_METHODS as Record<string, PaymentMethodCopy>)[id]
  return m ? (lang === 'el' ? m.shortEl : m.shortEn) : id
}
