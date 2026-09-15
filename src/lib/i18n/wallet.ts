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
    // Wallet
    walletBalance: 'Υπόλοιπο',
    walletTopUp: 'Αναπλήρωση',
    walletManage: 'Διαχείριση',
    walletSubscribe: 'Εγγραφή',
  },
  en: {
    // Wallet
    walletBalance: 'Balance',
    walletTopUp: 'Top Up',
    walletManage: 'Manage',
    walletSubscribe: 'Subscribe',
  },
} as const
