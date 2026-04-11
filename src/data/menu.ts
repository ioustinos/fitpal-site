// ─── Types ────────────────────────────────────────────────────────────────────

export interface Macros {
  cal: number
  pro: number
  carb: number
  fat: number
}

export interface Variant {
  id: string
  labelEl: string
  labelEn: string
  price: number
  macros: Macros
}

export type DishTag = 'hot' | 'veg' | 'lc' | 'hp'

export interface Dish {
  id: string
  nameEl: string
  nameEn: string
  descEl?: string
  descEn?: string
  catId: string
  tags?: DishTag[]
  variants: Variant[]
  discount?: number    // % off the variant price
}

export interface CategoryDef {
  id: string
  labelEl: string
  labelEn: string
}

export interface WeekDay {
  date: string    // ISO e.g. "2026-04-13"
  dishIds: string[]
}

export interface WeekDef {
  id: string
  labelEl: string
  labelEn: string
  days: WeekDay[]   // Mon–Fri
}

export interface WalletPlan {
  id: string
  labelEl: string
  labelEn: string
  price: number
  creditsAwarded: number
  discountPct: number
}

// ─── Categories ───────────────────────────────────────────────────────────────

export const CATS: CategoryDef[] = [
  { id: 'breakfast', labelEl: 'Πρωινά',         labelEn: 'Breakfast' },
  { id: 'cooked',    labelEl: 'Μαγειρευτά',     labelEn: 'Cooked Meals' },
  { id: 'grilled',   labelEl: 'Ψητές Επιλογές', labelEn: 'Grilled' },
  { id: 'salads',    labelEl: 'Σαλάτες',        labelEn: 'Salads' },
  { id: 'snacks',    labelEl: 'Snacks',          labelEn: 'Snacks' },
]

// ─── Shared Snacks (available every day) ──────────────────────────────────────

export const SNACKS: Dish[] = [
  {
    id: 's01',
    nameEl: 'Wrap Κοτόπουλο BBQ', nameEn: 'BBQ Chicken Wrap',
    descEl: 'Ψητό κοτόπουλο BBQ, tortilla ολικής, coleslaw, αβοκάντο και σάλτσα γιαουρτιού.',
    descEn: 'BBQ grilled chicken, whole wheat tortilla, coleslaw, avocado and yoghurt sauce.',
    catId: 'snacks', tags: ['hot'],
    variants: [
      { id: 'v1', labelEl: 'Κοτόπουλο 150γρ · Tortilla', labelEn: 'Chicken 150g · Tortilla', price: 7.00, macros: { cal: 400, pro: 32, carb: 36, fat: 13 } },
      { id: 'v2', labelEl: 'Κοτόπουλο 200γρ · 2 Tortillas', labelEn: 'Chicken 200g · 2 Tortillas', price: 9.00, macros: { cal: 560, pro: 43, carb: 52, fat: 19 } },
    ],
  },
  {
    id: 's02',
    nameEl: 'Burger Μοσχαρίσιο Protein', nameEn: 'Beef Protein Burger',
    descEl: 'Burger μοσχαρίσιο, ψωμάκι ολικής, χαλούμι, ρόκα, ντομάτα.',
    descEn: 'Beef burger patty, whole wheat bun, halloumi, arugula, tomato.',
    catId: 'snacks',
    variants: [
      { id: 'v1', labelEl: 'Burger 180γρ · Χαλούμι 40γρ', labelEn: 'Patty 180g · Halloumi 40g', price: 9.50, macros: { cal: 520, pro: 41, carb: 38, fat: 20 } },
      { id: 'v2', labelEl: 'Burger 250γρ · Χαλούμι 60γρ', labelEn: 'Patty 250g · Halloumi 60g', price: 12.00, macros: { cal: 700, pro: 56, carb: 42, fat: 28 } },
    ],
  },
  {
    id: 's03',
    nameEl: 'Toast Αβοκάντο & Αυγό', nameEn: 'Avocado & Egg Toast',
    descEl: 'Ψωμί ολικής, αβοκάντο, ποσέ αυγό, φέτα και ντοματίνια.',
    descEn: 'Whole grain toast, avocado, poached egg, feta and cherry tomatoes.',
    catId: 'snacks', tags: ['veg'],
    variants: [
      { id: 'v1', labelEl: 'Αβοκάντο ½ · 1 Αυγό', labelEn: 'Avocado ½ · 1 Egg', price: 6.00, macros: { cal: 310, pro: 14, carb: 28, fat: 16 } },
      { id: 'v2', labelEl: 'Αβοκάντο 1 · 2 Αυγά', labelEn: 'Avocado 1 · 2 Eggs', price: 8.00, macros: { cal: 490, pro: 22, carb: 44, fat: 26 } },
    ],
  },
]

// ─── Dish library (keyed by id) ───────────────────────────────────────────────

export const MENU: Record<string, Dish> = {
  // ── Breakfasts ──────────────────────────────────────────────────────────────
  a01: {
    id: 'a01',
    nameEl: 'Ομελέτα Πρωτεΐνης με Λαχανικά', nameEn: 'Protein Omelette with Vegetables',
    descEl: 'Ομελέτα ασπραδιών, φέτα, ντομάτα, πιπεριά, μανιτάρια. Με φρυγανιές ολικής.',
    descEn: 'Egg white omelette with feta, tomato, pepper and mushrooms. Served with whole wheat toast.',
    catId: 'breakfast', tags: ['hot'],
    variants: [
      { id: 'v1', labelEl: '5 Ασπράδια · Φέτα 30γρ', labelEn: '5 Egg Whites · Feta 30g', price: 6.50, macros: { cal: 300, pro: 28, carb: 16, fat: 11 } },
      { id: 'v2', labelEl: '7 Ασπράδια · Φέτα 50γρ', labelEn: '7 Egg Whites · Feta 50g', price: 8.00, macros: { cal: 410, pro: 38, carb: 24, fat: 15 } },
    ],
  },
  a02: {
    id: 'a02',
    nameEl: 'Greek Yogurt Power Bowl', nameEn: 'Greek Yogurt Power Bowl',
    descEl: 'Στραγγιστό γιαούρτι 2%, granola βρώμης, φρέσκα φρούτα εποχής και μέλι θυμαριού.',
    descEn: 'Strained Greek yogurt 2%, oat granola, fresh seasonal fruits and thyme honey.',
    catId: 'breakfast', tags: ['veg'],
    variants: [
      { id: 'v1', labelEl: 'Γιαούρτι 200γρ · Granola 40γρ', labelEn: 'Yogurt 200g · Granola 40g', price: 5.50, macros: { cal: 330, pro: 18, carb: 44, fat: 7 } },
      { id: 'v2', labelEl: 'Γιαούρτι 300γρ · Granola 60γρ', labelEn: 'Yogurt 300g · Granola 60g', price: 7.00, macros: { cal: 480, pro: 26, carb: 64, fat: 10 } },
    ],
  },
  // ── Cooked ──────────────────────────────────────────────────────────────────
  a03: {
    id: 'a03',
    nameEl: 'Κοτόπουλο Tikka Masala', nameEn: 'Chicken Tikka Masala',
    descEl: 'Κλασικό tikka masala με σάλτσα τομάτας, μπαχαρικά Ινδίας και ρύζι basmati.',
    descEn: 'Classic tikka masala with tomato sauce, Indian spices and basmati rice.',
    catId: 'cooked', tags: ['hot'], discount: 15,
    variants: [
      { id: 'v1', labelEl: 'Κοτόπουλο 150γρ · Ρύζι 100γρ', labelEn: 'Chicken 150g · Rice 100g', price: 8.50, macros: { cal: 440, pro: 34, carb: 44, fat: 12 } },
      { id: 'v2', labelEl: 'Κοτόπουλο 200γρ · Ρύζι 130γρ', labelEn: 'Chicken 200g · Rice 130g', price: 10.50, macros: { cal: 590, pro: 45, carb: 59, fat: 16 } },
      { id: 'v3', labelEl: 'Κοτόπουλο 250γρ · Ρύζι 160γρ', labelEn: 'Chicken 250g · Rice 160g', price: 12.50, macros: { cal: 740, pro: 57, carb: 74, fat: 20 } },
    ],
  },
  a04: {
    id: 'a04',
    nameEl: 'Vegan Μπολ Φακής & Πλιγουριού', nameEn: 'Vegan Lentil & Bulgur Bowl',
    descEl: 'Πράσινες φακές, ψητά λαχανικά, ταχίνι, πλιγούρι και χούμους.',
    descEn: 'Green lentils, roasted vegetables, tahini, bulgur wheat and hummus.',
    catId: 'cooked', tags: ['veg', 'lc'],
    variants: [
      { id: 'v1', labelEl: 'Φακές 150γρ · Πλιγούρι 100γρ', labelEn: 'Lentils 150g · Bulgur 100g', price: 7.00, macros: { cal: 340, pro: 17, carb: 50, fat: 7 } },
      { id: 'v2', labelEl: 'Φακές 200γρ · Πλιγούρι 130γρ', labelEn: 'Lentils 200g · Bulgur 130g', price: 8.50, macros: { cal: 455, pro: 23, carb: 66, fat: 9 } },
    ],
  },
  // ── Grilled ─────────────────────────────────────────────────────────────────
  a05: {
    id: 'a05',
    nameEl: 'Κοτόπουλο με Ρύζι & Ψητά Λαχανικά', nameEn: 'Chicken with Rice & Roasted Vegetables',
    descEl: 'Φιλέτο κοτόπουλο, βραστό ρύζι, ψητά λαχανικά εποχής και σάλτσα βοτάνων.',
    descEn: 'Chicken fillet, steamed rice, seasonal roasted vegetables and herb sauce.',
    catId: 'grilled', tags: ['hot', 'hp'],
    variants: [
      { id: 'v1', labelEl: 'Κοτόπουλο 150γρ · Ρύζι 100γρ', labelEn: 'Chicken 150g · Rice 100g', price: 7.50, macros: { cal: 390, pro: 34, carb: 42, fat: 7 } },
      { id: 'v2', labelEl: 'Κοτόπουλο 200γρ · Ρύζι 130γρ', labelEn: 'Chicken 200g · Rice 130g', price: 9.00, macros: { cal: 520, pro: 45, carb: 56, fat: 10 } },
      { id: 'v3', labelEl: 'Κοτόπουλο 250γρ · Ρύζι 150γρ', labelEn: 'Chicken 250g · Rice 150g', price: 10.50, macros: { cal: 650, pro: 56, carb: 68, fat: 13 } },
    ],
  },
  a06: {
    id: 'a06',
    nameEl: 'Σολομός με Κινόα & Σπανάκι', nameEn: 'Salmon with Quinoa & Spinach',
    descEl: 'Φρέσκο φιλέτο σολομού ψημένο στο φούρνο, κινόα και σπανάκι σε σάλτσα λεμόνι.',
    descEn: 'Freshly baked salmon fillet with quinoa and spinach in a lemon sauce.',
    catId: 'grilled', tags: [], discount: 10,
    variants: [
      { id: 'v1', labelEl: 'Σολομός 150γρ · Κινόα 80γρ', labelEn: 'Salmon 150g · Quinoa 80g', price: 9.50, macros: { cal: 440, pro: 36, carb: 28, fat: 17 } },
      { id: 'v2', labelEl: 'Σολομός 200γρ · Κινόα 110γρ', labelEn: 'Salmon 200g · Quinoa 110g', price: 12.00, macros: { cal: 590, pro: 48, carb: 38, fat: 23 } },
    ],
  },
  // ── Salads ──────────────────────────────────────────────────────────────────
  a07: {
    id: 'a07',
    nameEl: 'Σαλάτα Τόνος & Αβοκάντο', nameEn: 'Tuna & Avocado Salad',
    descEl: 'Φρέσκος τόνος, αβοκάντο, μικτά φύλλα, ντοματίνια, ελιές και βινεγκρέτ.',
    descEn: 'Fresh tuna, avocado, mixed leaves, cherry tomatoes, olives and vinaigrette.',
    catId: 'salads', tags: ['lc'],
    variants: [
      { id: 'v1', labelEl: 'Τόνος 120γρ · Αβοκάντο ½', labelEn: 'Tuna 120g · Avocado ½', price: 8.00, macros: { cal: 320, pro: 30, carb: 8, fat: 18 } },
      { id: 'v2', labelEl: 'Τόνος 180γρ · Αβοκάντο 1', labelEn: 'Tuna 180g · Avocado 1', price: 10.50, macros: { cal: 460, pro: 44, carb: 12, fat: 26 } },
    ],
  },
  a08: {
    id: 'a08',
    nameEl: 'Σαλάτα Κοτόπουλο & Κινόα', nameEn: 'Chicken & Quinoa Salad',
    descEl: 'Ψητό κοτόπουλο, κινόα, ρόκα, παρμεζάνα και γλυκόξινη σάλτσα μουστάρδας.',
    descEn: 'Grilled chicken, quinoa, arugula, parmesan and honey mustard dressing.',
    catId: 'salads', tags: ['hot', 'hp'],
    variants: [
      { id: 'v1', labelEl: 'Κοτόπουλο 120γρ · Κινόα 60γρ', labelEn: 'Chicken 120g · Quinoa 60g', price: 8.50, macros: { cal: 370, pro: 34, carb: 28, fat: 12 } },
      { id: 'v2', labelEl: 'Κοτόπουλο 180γρ · Κινόα 90γρ', labelEn: 'Chicken 180g · Quinoa 90g', price: 10.50, macros: { cal: 510, pro: 48, carb: 40, fat: 16 } },
    ],
  },

  // ── Tuesday dishes ──────────────────────────────────────────────────────────
  b01: {
    id: 'b01',
    nameEl: 'Pancakes Πρωτεΐνης', nameEn: 'Protein Pancakes',
    descEl: 'Pancakes από βρώμη και σκόνη πρωτεΐνης, με φρέσκα μύρτιλα και σιρόπι βρώμης.',
    descEn: 'Oat and protein powder pancakes with fresh blueberries and oat syrup.',
    catId: 'breakfast', tags: ['hot'],
    variants: [
      { id: 'v1', labelEl: '3 Pancakes · Μύρτιλα 80γρ', labelEn: '3 Pancakes · Blueberries 80g', price: 7.00, macros: { cal: 380, pro: 28, carb: 48, fat: 8 } },
      { id: 'v2', labelEl: '5 Pancakes · Μύρτιλα 120γρ', labelEn: '5 Pancakes · Blueberries 120g', price: 9.50, macros: { cal: 560, pro: 42, carb: 70, fat: 12 } },
    ],
  },
  b02: {
    id: 'b02',
    nameEl: 'Μοσχάρι Κοκκινιστό με Πολέντα', nameEn: 'Beef Stew with Polenta',
    descEl: 'Μαλακό μοσχάρι σε σάλτσα τομάτας με κρεμώδη πολέντα και παρμεζάνα.',
    descEn: 'Tender beef in tomato sauce with creamy polenta and parmesan.',
    catId: 'cooked', tags: [],
    variants: [
      { id: 'v1', labelEl: 'Μοσχάρι 150γρ · Πολέντα 150γρ', labelEn: 'Beef 150g · Polenta 150g', price: 9.50, macros: { cal: 480, pro: 36, carb: 42, fat: 16 } },
      { id: 'v2', labelEl: 'Μοσχάρι 200γρ · Πολέντα 200γρ', labelEn: 'Beef 200g · Polenta 200g', price: 12.00, macros: { cal: 640, pro: 48, carb: 56, fat: 21 } },
    ],
  },
  b03: {
    id: 'b03',
    nameEl: 'Γαρίδες Σχάρας με Ρύζι', nameEn: 'Grilled Prawns with Rice',
    descEl: 'Γαρίδες μεσαίου μεγέθους στη σχάρα, ρύζι jasmine και σαλατικά.',
    descEn: 'Medium prawns on the grill with jasmine rice and salad greens.',
    catId: 'grilled', tags: ['lc'],
    variants: [
      { id: 'v1', labelEl: 'Γαρίδες 150γρ · Ρύζι 100γρ', labelEn: 'Prawns 150g · Rice 100g', price: 10.00, macros: { cal: 360, pro: 32, carb: 38, fat: 7 } },
      { id: 'v2', labelEl: 'Γαρίδες 200γρ · Ρύζι 130γρ', labelEn: 'Prawns 200g · Rice 130g', price: 13.00, macros: { cal: 480, pro: 43, carb: 50, fat: 9 } },
    ],
  },

  // ── Wednesday dishes ─────────────────────────────────────────────────────────
  c01: {
    id: 'c01',
    nameEl: 'Overnight Oats Σοκολάτα', nameEn: 'Chocolate Overnight Oats',
    descEl: 'Βρώμη, γάλα αμυγδάλου, κακάο, σπόροι chia και κομμάτια μαύρης σοκολάτας.',
    descEn: 'Oats, almond milk, cacao, chia seeds and dark chocolate chunks.',
    catId: 'breakfast', tags: ['veg'],
    variants: [
      { id: 'v1', labelEl: 'Βρώμη 80γρ · Chia 15γρ', labelEn: 'Oats 80g · Chia 15g', price: 5.50, macros: { cal: 350, pro: 14, carb: 52, fat: 10 } },
      { id: 'v2', labelEl: 'Βρώμη 120γρ · Chia 25γρ · Σοκολάτα Extra', labelEn: 'Oats 120g · Chia 25g · Extra Chocolate', price: 7.50, macros: { cal: 520, pro: 20, carb: 76, fat: 15 } },
    ],
  },
  c02: {
    id: 'c02',
    nameEl: 'Κοτόπουλο Teriyaki με Ρύζι', nameEn: 'Chicken Teriyaki with Rice',
    descEl: 'Φιλέτο κοτόπουλο σε σάλτσα teriyaki, ρύζι καστανό, εντάμε και σουσάμι.',
    descEn: 'Chicken fillet in teriyaki sauce, brown rice, edamame and sesame.',
    catId: 'cooked', tags: ['hot', 'hp'],
    variants: [
      { id: 'v1', labelEl: 'Κοτόπουλο 150γρ · Ρύζι Καστανό 100γρ', labelEn: 'Chicken 150g · Brown Rice 100g', price: 8.50, macros: { cal: 420, pro: 36, carb: 46, fat: 9 } },
      { id: 'v2', labelEl: 'Κοτόπουλο 200γρ · Ρύζι Καστανό 130γρ', labelEn: 'Chicken 200g · Brown Rice 130g', price: 10.50, macros: { cal: 560, pro: 48, carb: 61, fat: 12 } },
    ],
  },
  c03: {
    id: 'c03',
    nameEl: 'Μπριζόλα Χοιρινή με Πατατοσαλάτα', nameEn: 'Pork Steak with Potato Salad',
    descEl: 'Χοιρινή μπριζόλα στη σχάρα, ζεστή πατατοσαλάτα με μουστάρδα και ρόκα.',
    descEn: 'Grilled pork steak, warm potato salad with mustard and arugula.',
    catId: 'grilled', tags: [],
    variants: [
      { id: 'v1', labelEl: 'Μπριζόλα 180γρ · Πατατοσαλάτα 150γρ', labelEn: 'Steak 180g · Potato Salad 150g', price: 9.50, macros: { cal: 510, pro: 38, carb: 36, fat: 22 } },
      { id: 'v2', labelEl: 'Μπριζόλα 250γρ · Πατατοσαλάτα 200γρ', labelEn: 'Steak 250g · Potato Salad 200g', price: 12.00, macros: { cal: 690, pro: 52, carb: 48, fat: 30 } },
    ],
  },

  // ── Thursday dishes ──────────────────────────────────────────────────────────
  d01: {
    id: 'd01',
    nameEl: 'Smoothie Bowl Φράουλα', nameEn: 'Strawberry Smoothie Bowl',
    descEl: 'Κατεψυγμένες φράουλες, μπανάνα, γάλα αμυγδάλου, granola και καρπούς.',
    descEn: 'Frozen strawberries, banana, almond milk, granola and nuts.',
    catId: 'breakfast', tags: ['veg', 'lc'],
    variants: [
      { id: 'v1', labelEl: 'Φράουλα 150γρ · Granola 40γρ', labelEn: 'Strawberry 150g · Granola 40g', price: 6.50, macros: { cal: 310, pro: 10, carb: 52, fat: 8 } },
    ],
  },
  d02: {
    id: 'd02',
    nameEl: 'Κοτόπουλο Cacciatore', nameEn: 'Chicken Cacciatore',
    descEl: 'Κοτόπουλο με σάλτσα τομάτας, ελιές, κάππαρη, κρεμμύδια και μυρωδικά.',
    descEn: 'Chicken in tomato sauce with olives, capers, onions and fresh herbs.',
    catId: 'cooked', tags: ['hot'],
    variants: [
      { id: 'v1', labelEl: 'Κοτόπουλο 180γρ · Ρύζι 100γρ', labelEn: 'Chicken 180g · Rice 100g', price: 9.00, macros: { cal: 450, pro: 38, carb: 40, fat: 13 } },
      { id: 'v2', labelEl: 'Κοτόπουλο 230γρ · Ρύζι 130γρ', labelEn: 'Chicken 230g · Rice 130g', price: 11.50, macros: { cal: 590, pro: 50, carb: 53, fat: 17 } },
    ],
  },
  d03: {
    id: 'd03',
    nameEl: 'Ξιφίας Σχάρας με Χούμους', nameEn: 'Grilled Swordfish with Hummus',
    descEl: 'Φιλέτο ξιφία, χούμους λεμόνι, ψητά λαχανικά και πιτάκι ολικής.',
    descEn: 'Swordfish fillet, lemon hummus, grilled vegetables and whole wheat pita.',
    catId: 'grilled', tags: ['lc', 'hp'],
    variants: [
      { id: 'v1', labelEl: 'Ξιφίας 180γρ · Χούμους 80γρ', labelEn: 'Swordfish 180g · Hummus 80g', price: 11.00, macros: { cal: 420, pro: 44, carb: 22, fat: 16 } },
      { id: 'v2', labelEl: 'Ξιφίας 230γρ · Χούμους 100γρ · Πιτάκι', labelEn: 'Swordfish 230g · Hummus 100g · Pita', price: 14.00, macros: { cal: 560, pro: 58, carb: 36, fat: 20 } },
    ],
  },

  // ── Friday dishes ────────────────────────────────────────────────────────────
  e01: {
    id: 'e01',
    nameEl: 'Acai Bowl με Granola', nameEn: 'Acai Bowl with Granola',
    descEl: 'Πουρές acai, μπανάνα, granola, καρπός καρύδας, μέλι και φρέσκα φρούτα.',
    descEn: 'Acai puree, banana, granola, coconut flakes, honey and fresh fruits.',
    catId: 'breakfast', tags: ['veg', 'hot'],
    variants: [
      { id: 'v1', labelEl: 'Acai 120γρ · Granola 50γρ', labelEn: 'Acai 120g · Granola 50g', price: 8.00, macros: { cal: 400, pro: 10, carb: 62, fat: 14 } },
      { id: 'v2', labelEl: 'Acai 160γρ · Granola 70γρ · Φρούτα Extra', labelEn: 'Acai 160g · Granola 70g · Extra Fruits', price: 10.00, macros: { cal: 540, pro: 14, carb: 84, fat: 18 } },
    ],
  },
  e02: {
    id: 'e02',
    nameEl: 'Κεφτεδάκια Μοσχαρίσια με Πλιγούρι', nameEn: 'Beef Meatballs with Bulgur',
    descEl: 'Χειροποίητα μοσχαρίσια κεφτεδάκια, σάλτσα τομάτας βοτάνων και πλιγούρι.',
    descEn: 'Handmade beef meatballs, herb tomato sauce and bulgur wheat.',
    catId: 'cooked', tags: [],
    variants: [
      { id: 'v1', labelEl: 'Κεφτεδάκια 180γρ · Πλιγούρι 120γρ', labelEn: 'Meatballs 180g · Bulgur 120g', price: 9.00, macros: { cal: 490, pro: 34, carb: 48, fat: 16 } },
      { id: 'v2', labelEl: 'Κεφτεδάκια 240γρ · Πλιγούρι 150γρ', labelEn: 'Meatballs 240g · Bulgur 150g', price: 11.50, macros: { cal: 650, pro: 45, carb: 63, fat: 21 } },
    ],
  },
  e03: {
    id: 'e03',
    nameEl: 'Τόνος Σχάρας με Φακές & Σπανάκι', nameEn: 'Grilled Tuna with Lentils & Spinach',
    descEl: 'Μεγάλη μπριζόλα τόνου, πράσινες φακές, σπανάκι και σάλτσα tahini-λεμόνι.',
    descEn: 'Large tuna steak, green lentils, spinach and tahini-lemon sauce.',
    catId: 'grilled', tags: ['hp', 'lc'],
    variants: [
      { id: 'v1', labelEl: 'Τόνος 160γρ · Φακές 100γρ', labelEn: 'Tuna 160g · Lentils 100g', price: 12.50, macros: { cal: 440, pro: 52, carb: 26, fat: 12 } },
      { id: 'v2', labelEl: 'Τόνος 220γρ · Φακές 130γρ', labelEn: 'Tuna 220g · Lentils 130g', price: 15.50, macros: { cal: 590, pro: 70, carb: 34, fat: 15 } },
    ],
  },
}

// ─── Week data ────────────────────────────────────────────────────────────────

export const WEEK_DATA: WeekDef[] = [
  {
    id: 'w1',
    labelEl: 'Εβδ. 6–10 Απρ',
    labelEn: 'Week Apr 6–10',
    days: [
      { date: '2026-04-06', dishIds: ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08'] },
      { date: '2026-04-07', dishIds: ['a01', 'a02', 'b01', 'b02', 'a05', 'b03', 'a07'] },
      { date: '2026-04-08', dishIds: ['c01', 'a02', 'c02', 'a04', 'c03', 'a07', 'a08'] },
      { date: '2026-04-09', dishIds: ['a01', 'd01', 'd02', 'a04', 'a05', 'd03', 'a07'] },
      { date: '2026-04-10', dishIds: ['e01', 'a02', 'e02', 'a04', 'a05', 'e03', 'a08'] },
    ],
  },
  {
    id: 'w2',
    labelEl: 'Εβδ. 13–17 Απρ',
    labelEn: 'Week Apr 13–17',
    days: [
      { date: '2026-04-13', dishIds: ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08'] },
      { date: '2026-04-14', dishIds: ['b01', 'a02', 'b02', 'a04', 'a05', 'b03', 'a07'] },
      { date: '2026-04-15', dishIds: ['c01', 'a02', 'c02', 'a04', 'c03', 'a07', 'a08'] },
      { date: '2026-04-16', dishIds: ['a01', 'd01', 'd02', 'a04', 'a05', 'd03', 'a07'] },
      { date: '2026-04-17', dishIds: ['e01', 'a02', 'e02', 'a04', 'a05', 'e03', 'a08'] },
    ],
  },
]

// ─── Wallet plans ─────────────────────────────────────────────────────────────

export const WALLET_PLANS: WalletPlan[] = [
  { id: 'basic',   labelEl: 'Basic',   labelEn: 'Basic',   price: 50,  creditsAwarded: 53.50, discountPct: 7  },
  { id: 'plus',    labelEl: 'Plus',    labelEn: 'Plus',    price: 100, creditsAwarded: 110,   discountPct: 10 },
  { id: 'premium', labelEl: 'Premium', labelEn: 'Premium', price: 150, creditsAwarded: 168,   discountPct: 12 },
]
