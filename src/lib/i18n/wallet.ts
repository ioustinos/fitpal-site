// ─────────────────────────────────────────────────────────────────────────
//  i18n · wallet
//  Wallet balance and subscription plan wording outside the account tab.
//
//  WEC-728: extracted verbatim from the old single translations.ts. Values
//  were NOT edited — this split is mechanical on purpose, so that the
//  δεύτερο-ενικό sweep (WEC-675 part A) is the only thing that ever changes
//  wording, and a diff of this commit is provably value-identical.
//
//  Add new strings to the module they belong to, never to a global file:
//  one flat namespace is what pushed every other chat into inline ternaries.
// ─────────────────────────────────────────────────────────────────────────

export const wallet = {
  el: {
    // WEC-778: cash-on-delivery cap. {max} is replaced at render with
    // settings.cash_max_amount, so editing this text in /admin/copy keeps the
    // number in sync with the actual rule. Drop the token and you lose the
    // number, not the sentence.
    walCashOverCapHint: 'Η αντικαταβολή δεν είναι διαθέσιμη για κόστος συνδρομής πάνω από {max} ευρώ',
    walCashOverCapShort: 'Μη διαθέσιμη άνω των {max} €',
    // WEC-777: wraps the DiscountPill — «κέρδισες [−2%] έκπτωση επιπλέον»
    walEarnedPrefix: 'κέρδισες',
    walEarnedSuffix: 'έκπτωση επιπλέον',
    // Wallet
    walletBalance: 'Υπόλοιπο',
    walletTopUp: 'Αναπλήρωση',
    walletManage: 'Διαχείριση',
    walletSubscribe: 'Εγγραφή',
  },
  en: {
    walCashOverCapHint: 'Cash on delivery is not available for subscriptions over {max} €',
    walCashOverCapShort: 'Unavailable over {max} €',
    walEarnedPrefix: 'you earned an extra',
    walEarnedSuffix: 'discount',
    // Wallet
    walletBalance: 'Balance',
    walletTopUp: 'Top Up',
    walletManage: 'Manage',
    walletSubscribe: 'Subscribe',
  },
} as const
