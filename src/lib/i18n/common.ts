// ─────────────────────────────────────────────────────────────────────────
//  i18n · common
//  Chrome shared by every page: top-level navigation, day names, tags-free labels, pagination, filters.
//
//  WEC-728: extracted verbatim from the old single translations.ts. Values
//  were NOT edited — this split is mechanical on purpose, so that the
//  δεύτερο-ενικό sweep (WEC-675 part A) is the only thing that ever changes
//  wording, and a diff of this commit is provably value-identical.
//
//  Add new strings to the module they belong to, never to a global file:
//  one flat namespace is what pushed every other chat into inline ternaries.
// ─────────────────────────────────────────────────────────────────────────

export const common = {
  el: {
    // Banner / heading
    heading: 'Εβδομαδιαίο Μενού',
    sub: 'Επίλεξε μέρα, πρόσθεσε τα αγαπημένα σου πιάτα και παραγγείλε με ένα κλικ',
    pillDelivery: 'Παράδοση 9:00–15:00',
    daylabel: 'Επίλεξε ημέρα',
    // Navigation
    back: 'Πίσω',
    next: 'Επόμενο',
    placeOrder: 'Ολοκλήρωση Παραγγελίας ✓',
    confirmed: 'Η παραγγελία σου καταχωρήθηκε!',
    confSub: 'Θα λάβεις email επιβεβαίωσης σύντομα.\nΕυχαριστούμε που επέλεξες fitpal meals!',
    backMenu: '← Επιστροφή στο Μενού',
    // Days
    monday: 'Δευτέρα',
    tuesday: 'Τρίτη',
    wednesday: 'Τετάρτη',
    thursday: 'Πέμπτη',
    friday: 'Παρασκευή',
    // Header nav (WEC-499)
    myOrders: 'Οι Παραγγελίες μου',
    addressesNav: 'Διευθύνσεις',
    myProfile: 'Τα Στοιχεία μου',
    signOut: 'Αποσύνδεση',
    navSubscription: 'Συνδρομή',
    navDiet: 'Διατροφή',
    adminPanel: 'Πίνακας διαχείρισης',
    languageLbl: 'Γλώσσα',
    // New component keys
    backToMenu: 'Πίσω στο μενού',
    // menu needs its own control — it used to be reachable only via the logo.
    hdrMenu: 'Μενού',
    // Shared components (WEC-499)
    shDateFilter: 'Φίλτρο ημερομηνιών',
    shFrom: 'Από',
    shTo: 'Έως',
    shGoalProgress: 'Πρόοδος στόχων',
    shNutrition: 'Διατροφικά στοιχεία',
    shPagination: 'Πλοήγηση σελίδων',
    shPrevious: 'Προηγούμενη',
    shNext: 'Επόμενη',
  },
  en: {
    // Banner / heading
    heading: 'Weekly Menu',
    sub: 'Pick a day, add your favourite dishes and order with one click',
    pillDelivery: 'Delivery 9:00–15:00',
    daylabel: 'Select a day',
    // Navigation
    back: 'Back',
    next: 'Next',
    placeOrder: 'Place Order ✓',
    confirmed: 'Your order has been placed!',
    confSub: "You'll receive a confirmation email shortly.\nThank you for choosing fitpal meals!",
    backMenu: '← Back to Menu',
    // Days
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    // Header nav (WEC-499)
    myOrders: 'My Orders',
    addressesNav: 'Addresses',
    myProfile: 'My Profile',
    signOut: 'Sign Out',
    navSubscription: 'Subscription',
    navDiet: 'Diet',
    adminPanel: 'Admin panel',
    languageLbl: 'Language',
    // New component keys
    backToMenu: 'Back to menu',
    // menu needs its own control — it used to be reachable only via the logo.
    hdrMenu: 'Menu',
    // Shared components (WEC-499)
    shDateFilter: 'Date filter',
    shFrom: 'From',
    shTo: 'To',
    shGoalProgress: 'Goal progress',
    shNutrition: 'Nutrition',
    shPagination: 'Pagination',
    shPrevious: 'Previous',
    shNext: 'Next',
  },
} as const
