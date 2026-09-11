// ─────────────────────────────────────────────────────────────────────────
//  i18n · cart
//  Cart sidebar and the voucher widget.
//
//  WEC-728: extracted verbatim from the old single translations.ts. Values
//  were NOT edited — this split is mechanical on purpose, so that the
//  δεύτερο-ενικό sweep (WEC-675 part A) is the only thing that ever changes
//  wording, and a diff of this commit is provably value-identical.
//
//  Add new strings to the module they belong to, never to a global file:
//  one flat namespace is what pushed every other chat into inline ternaries.
// ─────────────────────────────────────────────────────────────────────────

export const cart = {
  el: {
    // Cart
    cartTitle: 'Η Παραγγελία μου',
    cartSub: 'Ανασκόπηση & ολοκλήρωση',
    cartEmpty: 'Το καλάθι σου είναι άδειο',
    cartEmptySub: 'Πρόσθεσε τα αγαπημένα σου Fitpal γεύματα για να ξεκινήσεις!',
    // Voucher
    voucherLbl: 'Κωδικός Έκπτωσης',
    voucherPh: 'π.χ. FITPAL10',
    voucherApply: 'Εφαρμογή',
    voucherRemove: 'Αφαίρεση',
    voucherOk: 'Κωδικός εφαρμόστηκε',
    voucherErr: 'Μη έγκυρος κωδικός έκπτωσης',
    voucherSaving: 'Εξοικονόμηση',
    voucherDiscount: 'Έκπτωση Κωδικού',
    subtotal: 'Υποσύνολο',
    // New component keys
    yourOrder: 'Η παραγγελία μου',
    voucherPlaceholder: 'Κωδικός έκπτωσης',
    apply: 'Εφαρμογή',
    discount: 'Έκπτωση',
    viewCart: 'Καλάθι',
    // Cart / wallet components (WEC-499)
    cwOpen: 'ΑΝΟΙΓΜΑ',
    cwOneVoucherPerOrder: 'Μόνο 1 κουπόνι ανά παραγγελία',
    cwAvailableBalance: 'Διαθέσιμο υπόλοιπο',
    cwNoActiveWalletSub: 'Δεν έχεις ενεργό συνδρομή wallet.',
    cwGetPackage: 'Αγορά πακέτου',
    cwRenewalLabel: 'Ανανέωση:',
    cwRenewalAutomatic: 'Αυτόματη',
    cwRenewalManual: 'Χειροκίνητη',
    cwChoosePackageIntro: 'Επίλεξε ένα πακέτο και απόλαυσε bonus credits.',
    cwNoTransactions: 'Δεν υπάρχουν συναλλαγές.',
  },
  en: {
    // Cart
    cartTitle: 'My Order',
    cartSub: 'Review & complete',
    cartEmpty: 'Your cart is empty',
    cartEmptySub: 'Add your favourite Fitpal meals to get started!',
    // Voucher
    voucherLbl: 'Discount Code',
    voucherPh: 'e.g. FITPAL10',
    voucherApply: 'Apply',
    voucherRemove: 'Remove',
    voucherOk: 'Voucher applied',
    voucherErr: 'Invalid voucher code',
    voucherSaving: 'Saving',
    voucherDiscount: 'Voucher Discount',
    subtotal: 'Subtotal',
    // New component keys
    yourOrder: 'My order',
    voucherPlaceholder: 'Discount code',
    apply: 'Apply',
    discount: 'Discount',
    viewCart: 'Cart',
    // Cart / wallet components (WEC-499)
    cwOpen: 'OPEN',
    cwOneVoucherPerOrder: '1 voucher per order',
    cwAvailableBalance: 'Available balance',
    cwNoActiveWalletSub: 'You have no active wallet subscription.',
    cwGetPackage: 'Get a package',
    cwRenewalLabel: 'Renewal:',
    cwRenewalAutomatic: 'Automatic',
    cwRenewalManual: 'Manual',
    cwChoosePackageIntro: 'Choose a package to get bonus credits.',
    cwNoTransactions: 'No transactions yet.',
  },
} as const
