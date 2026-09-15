// ─────────────────────────────────────────────────────────────────────────
//  i18n · menu
//  The weekly menu, dish cards, the dish modal, macros, and the subscription banner that sits on the menu page.
//
//  WEC-728: extracted verbatim from the old single translations.ts. Values
//  were NOT edited — this split is mechanical on purpose, so that the
//  δεύτερο-ενικό sweep (WEC-675 part A) is the only thing that ever changes
//  wording, and a diff of this commit is provably value-identical.
//
//  Add new strings to the module they belong to, never to a global file:
//  one flat namespace is what pushed every other chat into inline ternaries.
// ─────────────────────────────────────────────────────────────────────────

export const menu = {
  el: {
    // Macros
    from: 'από',
    kcal: 'kcal',
    pro: 'Πρωτ.',
    carb: 'Υδ/κες',
    fat: 'Λίπη',
    lvl1: 'Πολύ Χαμ.',
    lvl2: 'Χαμηλό',
    lvl3: 'Μέτριο',
    lvl4: 'Υψηλό',
    lvl5: 'Πολύ Υψ.',
    // Dish modal
    addCart: 'Προσθήκη στο Καλάθι',
    updateCart: 'Ενημέρωση',
    selectSize: 'Επίλεξε Μέγεθος',
    dishComment: 'Σχόλιο για το πιάτο',
    dishCommentPh: 'π.χ. χωρίς κρεμμύδι...',
    // Tags
    popular: 'Popular',
    veg: 'Veg',
    lc: 'Low Carb',
    forDay: 'Για',
    added: 'Προστέθηκε στο καλάθι!',
    // MenuPage (WEC-499)
    loadingMenu: 'Φόρτωση μενού…',
    menuLoadError: 'Σφάλμα φόρτωσης μενού',
    weekWord: 'Εβδομάδα',
    subPromoGoalsEyebrow: 'FITPAL ΣΤΟΧΟΙ',
    subPromoGoalsSub: 'Δες τη συνδρομή σου, την πρόοδό σου και τα γεύματα που σου ταιριάζουν.',
    subPromoGoalsCta: 'Δες τους στόχους μου',
    subPromoSubEyebrow: 'ΣΥΝΔΡΟΜΗ FITPAL',
    subPromoSubSub: 'Εξατομικευμένο πλάνο διατροφής. Έκπτωση έως 20%.',
    subPromoSubCta: 'Φτιάξε το πλάνο μου',
    // WEC-647 Option 2 — subscription banner (wizard preview)
    subBannerEyebrow: 'ΣΥΝΔΡΟΜΗ FITPAL',
    subBannerDiscount: 'ΕΩΣ -20%',
    subBannerHeadline: 'Βρες το πλάνο που σου ταιριάζει',
    subBannerCta: 'Φτιάξε το Πλάνο σου',
    subBannerStepLabel: 'Βήμα 1 από 4',
    subBannerStep1: 'Στοιχεία / Διατροφή',
    subBannerStep2: 'Διάρκεια Πακέτου',
    subBannerStep3: 'Ημέρες ανά Εβδομάδα',
    subBannerStep4: 'Αριθμός Γευμάτων',
    // DishModal (WEC-499)
    dietBasedOn: 'Με βάση τη διατροφή σου:',
    dietAllergens: 'Αλλεργιογόνα: ',
    dietAvoidedIngredients: 'Συστατικά προς αποφυγή: ',
    dietSeeRecipe: '(δες τη συνταγή πιο κάτω)',
    ordersClosed: 'Οι παραγγελίες έχουν κλείσει',
    removeFromCart: 'Αφαίρεση από το καλάθι',
    savedToast: 'Αποθηκεύτηκε!',
    // New component keys
    protein: 'Πρωτεΐνη',
    carbs: 'Υδ/κες',
    addToCart: 'Προσθήκη',
    selectVariant: 'Επιλογή μεγέθους',
    allCategories: 'Όλα',
    // Menu components (WEC-499)
    mnClosed: 'Κλειστό',
    mnClosedCaps: 'ΚΛΕΙΣΤΟ',
    mnComingSoon: 'Σύντομα διαθέσιμο',
    mnFromNoSpace: 'από',
    mnOrdersClosedForDay: 'Οι παραγγελίες για αυτή την ημέρα έχουν κλείσει',
    mnNutritionBreakdown: 'Διατροφική ανάλυση ημέρας',
    mnNoDishesToday: 'Δεν υπάρχουν πιάτα σήμερα',
    mnDishesWord: 'πιάτα',
    mnIngredients: 'Συστατικά',
    mnAdjustHint: ' · προσαρμογή',
  },
  en: {
    // Macros
    from: 'from',
    kcal: 'kcal',
    pro: 'Prot.',
    carb: 'Carbs',
    fat: 'Fat',
    lvl1: 'Very Low',
    lvl2: 'Low',
    lvl3: 'Medium',
    lvl4: 'High',
    lvl5: 'Very High',
    // Dish modal
    addCart: 'Add to Cart',
    updateCart: 'Update',
    selectSize: 'Select Size',
    dishComment: 'Dish comment',
    dishCommentPh: 'e.g. no onion...',
    // Tags
    popular: 'Popular',
    veg: 'Veg',
    lc: 'Low Carb',
    forDay: 'For',
    added: 'Added to cart!',
    // MenuPage (WEC-499)
    loadingMenu: 'Loading menu…',
    menuLoadError: 'Error loading menu',
    weekWord: 'Week',
    subPromoGoalsEyebrow: 'FITPAL GOALS',
    subPromoGoalsSub: 'Track your plan, your progress, and the meals that fit you.',
    subPromoGoalsCta: 'View my goals',
    subPromoSubEyebrow: 'FITPAL SUBSCRIPTION',
    subPromoSubSub: 'A meal plan made for you. Save up to 20%.',
    subPromoSubCta: 'Build my plan',
    // WEC-647 Option 2 — subscription banner (wizard preview)
    subBannerEyebrow: 'FITPAL SUBSCRIPTION',
    subBannerDiscount: 'UP TO -20%',
    subBannerHeadline: 'Find the plan that fits you',
    subBannerCta: 'Build your plan',
    subBannerStepLabel: 'Step 1 of 4',
    subBannerStep1: 'Details / Diet',
    subBannerStep2: 'Plan length',
    subBannerStep3: 'Days per week',
    subBannerStep4: 'Meals',
    // DishModal (WEC-499)
    dietBasedOn: 'Based on your diet:',
    dietAllergens: 'Allergens: ',
    dietAvoidedIngredients: 'Ingredients you avoid: ',
    dietSeeRecipe: '(see the recipe below)',
    ordersClosed: 'Orders closed',
    removeFromCart: 'Remove from cart',
    savedToast: 'Saved!',
    // New component keys
    protein: 'Protein',
    carbs: 'Carbs',
    addToCart: 'Add to cart',
    selectVariant: 'Select size',
    allCategories: 'All',
    // Menu components (WEC-499)
    mnClosed: 'Closed',
    mnClosedCaps: 'CLOSED',
    mnComingSoon: 'Coming soon',
    mnFromNoSpace: 'from',
    mnOrdersClosedForDay: 'Orders for this day are closed',
    mnNutritionBreakdown: 'Nutrition breakdown for this day',
    mnNoDishesToday: 'No dishes today',
    mnDishesWord: 'dishes',
    mnIngredients: 'Ingredients',
    mnAdjustHint: ' · adjusts',
  },
} as const
