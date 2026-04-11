// ═══════════════════════════════════════════════════════════════════════════
// Menu Data for Fitpal - Extracted from demo.html
// Generated: 2026-04-11
// ═══════════════════════════════════════════════════════════════════════════

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

export interface Dish {
  id: string
  emoji: string
  img?: string
  nameEl: string
  nameEn: string
  descEl?: string
  descEn?: string
  catId: string
  tags?: string[]
  discount?: number
  variants: Variant[]
}

export interface WeekDay {
  date: string
  dishIds: string[]
}

export interface WeekDef {
  id: string
  labelEl: string
  labelEn: string
  days: WeekDay[]
}

export interface CategoryDef {
  id: string
  labelEl: string
  labelEn: string
}

export interface WalletPlan {
  id: string
  nameEl: string
  nameEn: string
  price: number
  credits: number
  bonusPct: number
  discountPct: number
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

export const CATS: CategoryDef[] = [
  { id: 'breakfast', labelEl: 'Πρωινά', labelEn: 'Breakfasts' },
  { id: 'cooked', labelEl: 'Μαγειρευτά', labelEn: 'Cooked' },
  { id: 'grilled', labelEl: 'Ψητές Επιλογές', labelEn: 'Grilled' },
  { id: 'salads', labelEl: 'Σαλάτες', labelEn: 'Salads' },
  { id: 'snacks', labelEl: 'Snacks', labelEn: 'Snacks' },
]

// ═══════════════════════════════════════════════════════════════════════════
// MENU DATA
// ═══════════════════════════════════════════════════════════════════════════

const UNS = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=600&h=400&q=82`

// ── SNACKS (identical every day) ──

const SNACK_DATA: Dish[] = [
  {
    id: 's01',
    emoji: '🌯',
    img: UNS('1600891964092-4316c288032e'),
    catId: 'snacks',
    tags: ['hot'],
    nameEl: 'Wrap Κοτόπουλο BBQ',
    nameEn: 'BBQ Chicken Wrap',
    descEl: 'Ψητό κοτόπουλο BBQ, tortilla ολικής, coleslaw, αβοκάντο και σάλτσα γιαουρτιού.',
    descEn: 'BBQ grilled chicken, whole wheat tortilla, coleslaw, avocado and yoghurt sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Tortilla 1 · Αβοκάντο ½',
        labelEn: 'Chicken 150g · Tortilla 1 · Avocado ½',
        price: 7.0,
        macros: { cal: 400, pro: 32, carb: 36, fat: 13 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Tortilla 2 · Αβοκάντο 1',
        labelEn: 'Chicken 200g · Tortilla 2 · Avocado 1',
        price: 9.0,
        macros: { cal: 560, pro: 43, carb: 52, fat: 19 },
      },
    ],
  },
  {
    id: 's02',
    emoji: '🍔',
    img: UNS('1568901346375-23c9450c58cd'),
    catId: 'snacks',
    tags: [],
    nameEl: 'Burger Μοσχαρίσιο Protein',
    nameEn: 'Beef Protein Burger',
    descEl: 'Burger μοσχαρίσιο, ψωμάκι ολικής, χαλούμι, ρόκα, ντομάτα.',
    descEn: 'Beef burger patty, whole wheat bun, halloumi cheese, arugula, tomato.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Burger 180γρ · Χαλούμι 40γρ · Ψωμάκι',
        labelEn: 'Patty 180g · Halloumi 40g · Bun',
        price: 9.5,
        macros: { cal: 520, pro: 41, carb: 38, fat: 20 },
      },
      {
        id: 'v2',
        labelEl: 'Burger 250γρ · Χαλούμι 60γρ · Ψωμάκι',
        labelEn: 'Patty 250g · Halloumi 60g · Bun',
        price: 12.0,
        macros: { cal: 700, pro: 56, carb: 42, fat: 28 },
      },
    ],
  },
  {
    id: 's03',
    emoji: '🥪',
    img: UNS('1512621776951-a57141f2eefd'),
    catId: 'snacks',
    tags: ['veg'],
    nameEl: 'Toast Αβοκάντο & Αυγό',
    nameEn: 'Avocado & Egg Toast',
    descEl: 'Ψωμί ολικής, αβοκάντο, ποσέ αυγό, φέτα και ντοματίνια.',
    descEn: 'Whole grain toast, avocado, poached egg, feta and cherry tomatoes.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Αβοκάντο ½ · 1 Αυγό · 1 Φέτα Ψωμί',
        labelEn: 'Avocado ½ · 1 Egg · 1 Toast',
        price: 6.0,
        macros: { cal: 310, pro: 14, carb: 28, fat: 16 },
      },
      {
        id: 'v2',
        labelEl: 'Αβοκάντο 1 · 2 Αυγά · 2 Φέτες Ψωμί',
        labelEn: 'Avocado 1 · 2 Eggs · 2 Toasts',
        price: 8.0,
        macros: { cal: 490, pro: 22, carb: 44, fat: 26 },
      },
    ],
  },
]

export const SNACKS = SNACK_DATA

// ── ALL DISHES BY ID ──

export const MENU: Record<string, Dish> = {
  // ── MONDAY (a01-a10) ──
  a01: {
    id: 'a01',
    emoji: '🥚',
    img: UNS('1525351484163-7529414344d8'),
    catId: 'breakfast',
    tags: ['hot'],
    nameEl: 'Ομελέτα Πρωτεΐνης με Λαχανικά',
    nameEn: 'Protein Omelette with Vegetables',
    descEl: 'Ομελέτα ασπραδιών, φέτα, ντομάτα, πιπεριά, μανιτάρια. Με φρυγανιές ολικής.',
    descEn: 'Egg white omelette with feta, tomato, pepper and mushrooms. With whole wheat toast.',
    variants: [
      {
        id: 'v1',
        labelEl: '5 Ασπράδια · Φέτα 30γρ · 1 Φρυγανιά',
        labelEn: '5 Egg Whites · Feta 30g · 1 Toast',
        price: 6.5,
        macros: { cal: 300, pro: 28, carb: 16, fat: 11 },
      },
      {
        id: 'v2',
        labelEl: '7 Ασπράδια · Φέτα 50γρ · 2 Φρυγανιές',
        labelEn: '7 Egg Whites · Feta 50g · 2 Toasts',
        price: 8.0,
        macros: { cal: 410, pro: 38, carb: 24, fat: 15 },
      },
    ],
  },
  a02: {
    id: 'a02',
    emoji: '🥣',
    img: UNS('1571748982800-fa51cac26d6b'),
    catId: 'breakfast',
    tags: ['veg'],
    nameEl: 'Greek Yogurt Power Bowl',
    nameEn: 'Greek Yogurt Power Bowl',
    descEl: 'Στραγγιστό γιαούρτι 2%, granola βρώμης, φρέσκα φρούτα εποχής και μέλι θυμαριού.',
    descEn: 'Strained Greek yogurt 2%, oat granola, fresh seasonal fruits and thyme honey.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Γιαούρτι 200γρ · Granola 40γρ · Φρούτα 80γρ',
        labelEn: 'Yogurt 200g · Granola 40g · Fruits 80g',
        price: 5.5,
        macros: { cal: 330, pro: 18, carb: 44, fat: 7 },
      },
      {
        id: 'v2',
        labelEl: 'Γιαούρτι 300γρ · Granola 60γρ · Φρούτα 120γρ',
        labelEn: 'Yogurt 300g · Granola 60g · Fruits 120g',
        price: 7.0,
        macros: { cal: 480, pro: 26, carb: 64, fat: 10 },
      },
    ],
  },
  a03: {
    id: 'a03',
    emoji: '🍛',
    img: UNS('1565557623262-b51c2513a641'),
    catId: 'cooked',
    tags: ['hot'],
    discount: 20,
    nameEl: 'Κοτόπουλο Tikka Masala',
    nameEn: 'Chicken Tikka Masala',
    descEl: 'Κλασικό tikka masala με σάλτσα τομάτας, μπαχαρικά Ινδίας και ρύζι basmati.',
    descEn: 'Classic tikka masala with tomato sauce, Indian spices and basmati rice.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Ρύζι Basmati 100γρ',
        labelEn: 'Chicken 150g · Basmati Rice 100g',
        price: 8.5,
        macros: { cal: 440, pro: 34, carb: 44, fat: 12 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Ρύζι Basmati 130γρ',
        labelEn: 'Chicken 200g · Basmati Rice 130g',
        price: 10.5,
        macros: { cal: 590, pro: 45, carb: 59, fat: 16 },
      },
      {
        id: 'v3',
        labelEl: 'Κοτόπουλο 250γρ · Ρύζι Basmati 160γρ',
        labelEn: 'Chicken 250g · Basmati Rice 160g',
        price: 12.5,
        macros: { cal: 740, pro: 57, carb: 74, fat: 20 },
      },
      {
        id: 'v4',
        labelEl: 'Κοτόπουλο 300γρ · Ρύζι 180γρ · Naan',
        labelEn: 'Chicken 300g · Rice 180g · Naan Bread',
        price: 14.5,
        macros: { cal: 890, pro: 68, carb: 94, fat: 24 },
      },
      {
        id: 'v5',
        labelEl: 'Κοτόπουλο 350γρ · Ρύζι 200γρ · Naan · Raita',
        labelEn: 'Chicken 350g · Rice 200g · Naan · Raita',
        price: 16.5,
        macros: { cal: 1040, pro: 79, carb: 108, fat: 28 },
      },
      {
        id: 'v6',
        labelEl: 'Family — Κοτόπουλο 500γρ · Ρύζι 300γρ · 2 Naan',
        labelEn: 'Family — Chicken 500g · Rice 300g · 2 Naan',
        price: 22.0,
        macros: { cal: 1500, pro: 113, carb: 158, fat: 40 },
      },
    ],
  },
  a04: {
    id: 'a04',
    emoji: '🌱',
    img: UNS('1512621776951-a57141f2eefd'),
    catId: 'cooked',
    tags: ['veg'],
    nameEl: 'Vegan Μπολ Φακής & Πλιγουριού',
    nameEn: 'Vegan Lentil & Bulgur Bowl',
    descEl: 'Πράσινες φακές, ψητά λαχανικά, ταχίνι, πλιγούρι και χούμους.',
    descEn: 'Green lentils, roasted vegetables, tahini, bulgur wheat and hummus.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Φακές 150γρ · Πλιγούρι 100γρ · Χούμους 40γρ',
        labelEn: 'Lentils 150g · Bulgur 100g · Hummus 40g',
        price: 7.0,
        macros: { cal: 340, pro: 17, carb: 50, fat: 7 },
      },
      {
        id: 'v2',
        labelEl: 'Φακές 200γρ · Πλιγούρι 130γρ · Χούμους 60γρ',
        labelEn: 'Lentils 200g · Bulgur 130g · Hummus 60g',
        price: 8.5,
        macros: { cal: 455, pro: 23, carb: 66, fat: 9 },
      },
    ],
  },
  a05: {
    id: 'a05',
    emoji: '🐟',
    img: UNS('1490645935967-10de6ba17061'),
    catId: 'cooked',
    tags: [],
    nameEl: 'Μπακαλιάρος με Ρεβίθια & Κάρι',
    nameEn: 'Cod with Chickpeas & Curry',
    descEl: 'Φιλέτο μπακαλιάρου, ρεβίθια, κόκκινη πιπεριά, κάρι και σπανάκι.',
    descEn: 'Cod fillet with chickpeas, red pepper, curry and spinach.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Μπακαλιάρος 150γρ · Ρεβίθια 100γρ',
        labelEn: 'Cod 150g · Chickpeas 100g',
        price: 8.0,
        macros: { cal: 360, pro: 32, carb: 32, fat: 8 },
      },
      {
        id: 'v2',
        labelEl: 'Μπακαλιάρος 200γρ · Ρεβίθια 150γρ',
        labelEn: 'Cod 200g · Chickpeas 150g',
        price: 10.0,
        macros: { cal: 490, pro: 43, carb: 48, fat: 11 },
      },
    ],
  },
  a06: {
    id: 'a06',
    emoji: '🍗',
    img: UNS('1546069901-ba9599a7e63c'),
    catId: 'grilled',
    tags: ['hot'],
    nameEl: 'Κοτόπουλο με Ρύζι & Ψητά Λαχανικά',
    nameEn: 'Chicken with Rice & Roasted Vegetables',
    descEl: 'Φιλέτο κοτόπουλο, βραστό ρύζι, ψητά λαχανικά εποχής και σάλτσα βοτάνων.',
    descEn: 'Chicken fillet, steamed rice, seasonal roasted vegetables and herb sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Ρύζι 100γρ',
        labelEn: 'Chicken 150g · Rice 100g',
        price: 7.5,
        macros: { cal: 390, pro: 34, carb: 42, fat: 7 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Ρύζι 130γρ',
        labelEn: 'Chicken 200g · Rice 130g',
        price: 9.0,
        macros: { cal: 520, pro: 45, carb: 56, fat: 10 },
      },
      {
        id: 'v3',
        labelEl: 'Κοτόπουλο 250γρ · Ρύζι 150γρ',
        labelEn: 'Chicken 250g · Rice 150g',
        price: 10.5,
        macros: { cal: 650, pro: 56, carb: 68, fat: 13 },
      },
      {
        id: 'v4',
        labelEl: 'Κοτόπουλο 300γρ · Ρύζι 150γρ · Ψητά Λαχανικά Extra',
        labelEn: 'Chicken 300g · Rice 150g · Extra Roasted Veg',
        price: 12.0,
        macros: { cal: 750, pro: 67, carb: 75, fat: 15 },
      },
      {
        id: 'v5',
        labelEl: 'Κοτόπουλο 350γρ · Ρύζι 200γρ',
        labelEn: 'Chicken 350g · Rice 200g',
        price: 13.5,
        macros: { cal: 870, pro: 78, carb: 90, fat: 17 },
      },
      {
        id: 'v6',
        labelEl: 'Κοτόπουλο 400γρ · Ρύζι 200γρ · Σάλτσα Βοτάνων',
        labelEn: 'Chicken 400g · Rice 200g · Herb Sauce',
        price: 15.0,
        macros: { cal: 985, pro: 89, carb: 100, fat: 20 },
      },
      {
        id: 'v7',
        labelEl: 'Κοτόπουλο 450γρ · Ρύζι 250γρ · Σαλάτα',
        labelEn: 'Chicken 450g · Rice 250g · Side Salad',
        price: 16.5,
        macros: { cal: 1100, pro: 100, carb: 114, fat: 23 },
      },
      {
        id: 'v8',
        labelEl: 'Family — Κοτόπουλο 500γρ · Ρύζι 300γρ',
        labelEn: 'Family — Chicken 500g · Rice 300g',
        price: 20.0,
        macros: { cal: 1280, pro: 112, carb: 132, fat: 26 },
      },
    ],
  },
  a07: {
    id: 'a07',
    emoji: '🐟',
    img: UNS('1519708227418-c8fd9a32b7a2'),
    catId: 'grilled',
    tags: [],
    discount: 15,
    nameEl: 'Σολομός με Κινόα & Σπανάκι',
    nameEn: 'Salmon with Quinoa & Spinach',
    descEl: 'Φρέσκο φιλέτο σολομού ψημένο στο φούρνο, κινόα και σπανάκι σε σάλτσα λεμόνι.',
    descEn: 'Freshly baked salmon fillet with quinoa and spinach in a lemon sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Σολομός 150γρ · Κινόα 80γρ',
        labelEn: 'Salmon 150g · Quinoa 80g',
        price: 9.5,
        macros: { cal: 440, pro: 36, carb: 28, fat: 17 },
      },
      {
        id: 'v2',
        labelEl: 'Σολομός 200γρ · Κινόα 110γρ',
        labelEn: 'Salmon 200g · Quinoa 110g',
        price: 12.0,
        macros: { cal: 590, pro: 48, carb: 38, fat: 23 },
      },
      {
        id: 'v3',
        labelEl: 'Σολομός 250γρ · Κινόα 130γρ · Σπανάκι Extra',
        labelEn: 'Salmon 250g · Quinoa 130g · Extra Spinach',
        price: 14.0,
        macros: { cal: 720, pro: 60, carb: 46, fat: 28 },
      },
      {
        id: 'v4',
        labelEl: 'Σολομός 300γρ · Κινόα 160γρ · Σάλτσα Λεμόνι',
        labelEn: 'Salmon 300g · Quinoa 160g · Lemon Sauce',
        price: 16.5,
        macros: { cal: 860, pro: 72, carb: 55, fat: 34 },
      },
      {
        id: 'v5',
        labelEl: 'Σολομός 350γρ · Κινόα 200γρ · Αβοκάντο 50γρ',
        labelEn: 'Salmon 350g · Quinoa 200g · Avocado 50g',
        price: 19.0,
        macros: { cal: 1010, pro: 84, carb: 68, fat: 42 },
      },
    ],
  },
  a08: {
    id: 'a08',
    emoji: '🥩',
    img: UNS('1555939594-58d7cb561ad1'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Μοσχαρίσιο Μπολ με Γλυκοπατάτα',
    nameEn: 'Beef Bowl with Sweet Potato',
    descEl: 'Μαριναρισμένο μοσχαρίσιο με γλυκοπατάτα, μπρόκολο και μαύρα φασόλια.',
    descEn: 'Marinated ground beef with sweet potato, broccoli and black beans.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κιμάς 150γρ · Γλυκοπατάτα 120γρ',
        labelEn: 'Beef 150g · Sweet Potato 120g',
        price: 8.5,
        macros: { cal: 480, pro: 38, carb: 46, fat: 11 },
      },
      {
        id: 'v2',
        labelEl: 'Κιμάς 200γρ · Γλυκοπατάτα 160γρ',
        labelEn: 'Beef 200g · Sweet Potato 160g',
        price: 10.5,
        macros: { cal: 640, pro: 51, carb: 62, fat: 15 },
      },
    ],
  },
  a09: {
    id: 'a09',
    emoji: '🥗',
    img: UNS('1512621776951-a57141f2eefd'),
    catId: 'salads',
    tags: ['lc'],
    nameEl: 'Σαλάτα Τόνου με Αβοκάντο',
    nameEn: 'Tuna & Avocado Salad',
    descEl: 'Φρέσκος τόνος, αβοκάντο, αγγούρι, ντοματάκια, ελιές και dressing λεμόνι-μουστάρδα.',
    descEn: 'Fresh tuna, avocado, cucumber, cherry tomatoes, olives and lemon-mustard dressing.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Τόνος 120γρ · Αβοκάντο ½',
        labelEn: 'Tuna 120g · Avocado ½',
        price: 8.0,
        macros: { cal: 320, pro: 26, carb: 12, fat: 18 },
      },
      {
        id: 'v2',
        labelEl: 'Τόνος 160γρ · Αβοκάντο 1',
        labelEn: 'Tuna 160g · Avocado 1',
        price: 10.0,
        macros: { cal: 430, pro: 35, carb: 16, fat: 26 },
      },
    ],
  },
  a10: {
    id: 'a10',
    emoji: '🥗',
    img: UNS('1546793665-c74683f339c1'),
    catId: 'salads',
    tags: ['hot'],
    nameEl: 'Κοτόπουλο Caesar Bowl',
    nameEn: 'Chicken Caesar Bowl',
    descEl: 'Ψητό κοτόπουλο, ρομαίν μαρούλι, παρμεζάνα, κρουτόν και αυθεντικό caesar dressing.',
    descEn: 'Grilled chicken, romaine lettuce, parmesan, croutons and authentic caesar dressing.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Ρομαίν 80γρ',
        labelEn: 'Chicken 150g · Romaine 80g',
        price: 8.0,
        macros: { cal: 370, pro: 33, carb: 22, fat: 14 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Ρομαίν 120γρ',
        labelEn: 'Chicken 200g · Romaine 120g',
        price: 10.0,
        macros: { cal: 500, pro: 44, carb: 30, fat: 19 },
      },
    ],
  },

  // ── TUESDAY (b01-b10) ──
  b01: {
    id: 'b01',
    emoji: '🥞',
    img: UNS('1484723091739-30f299b829a5'),
    catId: 'breakfast',
    tags: ['hot'],
    nameEl: 'Pancakes Βρώμης με Μπανάνα',
    nameEn: 'Oat Pancakes with Banana',
    descEl: 'Pancakes ολικής βρώμης, μπανάνα, φυστικοβούτυρο, μέλι και σπόροι chia.',
    descEn: 'Whole oat pancakes with banana, peanut butter, honey and chia seeds.',
    variants: [
      {
        id: 'v1',
        labelEl: '3 Pancakes · Μπανάνα ½ · Φυστ/βούτυρο 15γρ',
        labelEn: '3 Pancakes · Banana ½ · PB 15g',
        price: 6.0,
        macros: { cal: 380, pro: 16, carb: 54, fat: 10 },
      },
      {
        id: 'v2',
        labelEl: '5 Pancakes · Μπανάνα 1 · Φυστ/βούτυρο 25γρ',
        labelEn: '5 Pancakes · Banana 1 · PB 25g',
        price: 8.0,
        macros: { cal: 560, pro: 24, carb: 78, fat: 16 },
      },
    ],
  },
  b02: {
    id: 'b02',
    emoji: '🫙',
    img: UNS('1578985545062-1a1152f2e0d4'),
    catId: 'breakfast',
    tags: ['veg'],
    nameEl: 'Overnight Oats Πρωτεΐνης',
    nameEn: 'Protein Overnight Oats',
    descEl: 'Βρώμη, γάλα αμυγδάλου, πρωτεΐνη βανίλιας, φράουλες και ξηροί καρποί.',
    descEn: 'Oats, almond milk, vanilla protein, strawberries and mixed nuts.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Βρώμη 70γρ · Πρωτεΐνη 1 μερίδα · Φράουλες 80γρ',
        labelEn: 'Oats 70g · 1 Protein Scoop · Strawberries 80g',
        price: 5.5,
        macros: { cal: 340, pro: 24, carb: 42, fat: 9 },
      },
      {
        id: 'v2',
        labelEl: 'Βρώμη 100γρ · Πρωτεΐνη 2 μερίδες · Φράουλες 120γρ',
        labelEn: 'Oats 100g · 2 Protein Scoops · Strawberries 120g',
        price: 7.0,
        macros: { cal: 490, pro: 38, carb: 60, fat: 13 },
      },
    ],
  },
  b03: {
    id: 'b03',
    emoji: '🦃',
    img: UNS('1621996346565-e3dbc646d9a9'),
    catId: 'cooked',
    tags: [],
    nameEl: 'Γαλοπούλα με Ζυμαρικά Ολικής',
    nameEn: 'Turkey with Whole Wheat Pasta',
    descEl: 'Στήθος γαλοπούλας, ζυμαρικά ολικής άλεσης, σάλτσα ντομάτας και ρόκα.',
    descEn: 'Turkey breast, whole wheat pasta, tomato sauce and arugula.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Γαλοπούλα 150γρ · Ζυμαρικά 100γρ',
        labelEn: 'Turkey 150g · Pasta 100g',
        price: 7.5,
        macros: { cal: 430, pro: 36, carb: 44, fat: 6 },
      },
      {
        id: 'v2',
        labelEl: 'Γαλοπούλα 200γρ · Ζυμαρικά 130γρ',
        labelEn: 'Turkey 200g · Pasta 130g',
        price: 9.5,
        macros: { cal: 575, pro: 48, carb: 59, fat: 8 },
      },
    ],
  },
  b04: {
    id: 'b04',
    emoji: '🐟',
    img: UNS('1519708227418-c8fd9a32b7a2'),
    catId: 'cooked',
    tags: [],
    nameEl: 'Σαρδέλες με Κριθαράκι & Κάππαρη',
    nameEn: 'Sardines with Orzo & Capers',
    descEl: 'Φρέσκες σαρδέλες, κριθαράκι, λεμόνι, κάππαρη και μαϊντανό.',
    descEn: 'Fresh sardines with orzo pasta, lemon, capers and parsley.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Σαρδέλες 150γρ · Κριθαράκι 100γρ',
        labelEn: 'Sardines 150g · Orzo 100g',
        price: 7.5,
        macros: { cal: 390, pro: 30, carb: 38, fat: 13 },
      },
      {
        id: 'v2',
        labelEl: 'Σαρδέλες 200γρ · Κριθαράκι 130γρ',
        labelEn: 'Sardines 200g · Orzo 130g',
        price: 9.5,
        macros: { cal: 520, pro: 40, carb: 50, fat: 17 },
      },
    ],
  },
  b05: {
    id: 'b05',
    emoji: '🫘',
    img: UNS('1490645935967-10de6ba17061'),
    catId: 'cooked',
    tags: [],
    nameEl: 'Κοτόπουλο με Λευκά Φασόλια & Σπανάκι',
    nameEn: 'Chicken with White Beans & Spinach',
    descEl: 'Στήθος κοτόπουλου, λευκά φασόλια, σπανάκι, σκόρδο και εξαιρετικό παρθένο ελαιόλαδο.',
    descEn: 'Chicken breast with white beans, spinach, garlic and extra virgin olive oil.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Φασόλια 120γρ · Σπανάκι 80γρ',
        labelEn: 'Chicken 150g · Beans 120g · Spinach 80g',
        price: 8.0,
        macros: { cal: 390, pro: 36, carb: 34, fat: 9 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Φασόλια 160γρ · Σπανάκι 100γρ',
        labelEn: 'Chicken 200g · Beans 160g · Spinach 100g',
        price: 10.0,
        macros: { cal: 520, pro: 48, carb: 45, fat: 12 },
      },
    ],
  },
  b06: {
    id: 'b06',
    emoji: '🍗',
    img: UNS('1547592180-85f173990554'),
    catId: 'grilled',
    tags: ['hot'],
    discount: 10,
    nameEl: 'Κοτόπουλο Teriyaki με Edamame',
    nameEn: 'Teriyaki Chicken with Edamame',
    descEl: 'Μαριναρισμένο κοτόπουλο teriyaki, edamame, ρύζι jasmine και κρεμμυδάκια.',
    descEn: 'Teriyaki marinated chicken with edamame, jasmine rice and spring onions.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Ρύζι Jasmine 100γρ',
        labelEn: 'Chicken 150g · Jasmine Rice 100g',
        price: 8.5,
        macros: { cal: 460, pro: 34, carb: 48, fat: 9 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Ρύζι Jasmine 130γρ',
        labelEn: 'Chicken 200g · Jasmine Rice 130g',
        price: 10.5,
        macros: { cal: 615, pro: 45, carb: 64, fat: 12 },
      },
      {
        id: 'v3',
        labelEl: 'Κοτόπουλο 250γρ · Ρύζι Jasmine 150γρ · Edamame Extra',
        labelEn: 'Chicken 250g · Jasmine Rice 150g · Extra Edamame',
        price: 12.5,
        macros: { cal: 760, pro: 57, carb: 78, fat: 15 },
      },
      {
        id: 'v4',
        labelEl: 'Κοτόπουλο 300γρ · Ρύζι Jasmine 180γρ · Σουσάμι',
        labelEn: 'Chicken 300g · Jasmine Rice 180g · Sesame Seeds',
        price: 14.5,
        macros: { cal: 905, pro: 68, carb: 93, fat: 18 },
      },
      {
        id: 'v5',
        labelEl: 'XL — Κοτόπουλο 400γρ · Ρύζι Jasmine 250γρ',
        labelEn: 'XL — Chicken 400g · Jasmine Rice 250g',
        price: 18.0,
        macros: { cal: 1180, pro: 90, carb: 126, fat: 24 },
      },
    ],
  },
  b07: {
    id: 'b07',
    emoji: '🥩',
    img: UNS('1529692236671-f1f6cf9683ba'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Χοιρινή Μπριζόλα με Πουρέ & Φασολάκια',
    nameEn: 'Pork Chop with Mash & Green Beans',
    descEl: 'Χοιρινή μπριζόλα ψητή, πουρέ πατάτας, πράσινα φασολάκια και σάλτσα μανιταριών.',
    descEn: 'Grilled pork chop with mashed potato, green beans and mushroom sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Μπριζόλα 200γρ · Πουρέ 150γρ',
        labelEn: 'Pork Chop 200g · Mash 150g',
        price: 9.0,
        macros: { cal: 510, pro: 40, carb: 35, fat: 19 },
      },
      {
        id: 'v2',
        labelEl: 'Μπριζόλα 280γρ · Πουρέ 200γρ',
        labelEn: 'Pork Chop 280g · Mash 200g',
        price: 11.5,
        macros: { cal: 680, pro: 53, carb: 46, fat: 25 },
      },
    ],
  },
  b08: {
    id: 'b08',
    emoji: '🐟',
    img: UNS('1519708227418-c8fd9a32b7a2'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Τσιπούρα στο Φούρνο με Λαχανικά',
    nameEn: 'Baked Sea Bream with Vegetables',
    descEl: 'Φρέσκια τσιπούρα, ψητές πατάτες, κρεμμύδι, ελιές, ντομάτα και μυρωδικά.',
    descEn: 'Fresh sea bream with roasted potatoes, onion, olives, tomato and herbs.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Τσιπούρα 250γρ · Πατάτες 150γρ',
        labelEn: 'Sea Bream 250g · Potatoes 150g',
        price: 10.5,
        macros: { cal: 410, pro: 36, carb: 28, fat: 15 },
      },
      {
        id: 'v2',
        labelEl: 'Τσιπούρα 350γρ · Πατάτες 200γρ',
        labelEn: 'Sea Bream 350g · Potatoes 200g',
        price: 13.5,
        macros: { cal: 570, pro: 50, carb: 38, fat: 21 },
      },
    ],
  },
  b09: {
    id: 'b09',
    emoji: '🥗',
    img: UNS('1498837167922-ddd27525d352'),
    catId: 'salads',
    tags: ['veg', 'lc'],
    nameEl: 'Power Σαλάτα Κινόα & Ρόδι',
    nameEn: 'Power Quinoa & Pomegranate Salad',
    descEl: 'Κινόα, ρόκα, ρόδι, βατόμουρα, φέτα, καρύδια και balsamic dressing.',
    descEn: 'Quinoa, arugula, pomegranate, blueberries, feta, walnuts and balsamic dressing.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κινόα 100γρ · Φέτα 40γρ · Καρύδια 20γρ',
        labelEn: 'Quinoa 100g · Feta 40g · Walnuts 20g',
        price: 7.5,
        macros: { cal: 330, pro: 15, carb: 40, fat: 13 },
      },
      {
        id: 'v2',
        labelEl: 'Κινόα 140γρ · Φέτα 60γρ · Καρύδια 30γρ',
        labelEn: 'Quinoa 140g · Feta 60g · Walnuts 30g',
        price: 9.5,
        macros: { cal: 450, pro: 20, carb: 55, fat: 18 },
      },
    ],
  },
  b10: {
    id: 'b10',
    emoji: '🥗',
    img: UNS('1546793665-c74683f339c1'),
    catId: 'salads',
    tags: [],
    nameEl: 'Ελληνική Σαλάτα με Κοτόπουλο',
    nameEn: 'Greek Salad with Grilled Chicken',
    descEl: 'Ψητό κοτόπουλο, ντομάτα, αγγούρι, κρεμμύδι, ελιές, φέτα και ελαιόλαδο.',
    descEn: 'Grilled chicken, tomato, cucumber, onion, olives, feta and olive oil.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 130γρ · Φέτα 50γρ · Λαχανικά',
        labelEn: 'Chicken 130g · Feta 50g · Vegetables',
        price: 7.5,
        macros: { cal: 340, pro: 29, carb: 14, fat: 19 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 180γρ · Φέτα 70γρ · Λαχανικά',
        labelEn: 'Chicken 180g · Feta 70g · Vegetables',
        price: 9.5,
        macros: { cal: 460, pro: 39, carb: 18, fat: 26 },
      },
    ],
  },

  // ── WEDNESDAY (c01-c10) ──
  c01: {
    id: 'c01',
    emoji: '🥑',
    img: UNS('1512621776951-a57141f2eefd'),
    catId: 'breakfast',
    tags: ['hot'],
    nameEl: 'Toast Αβοκάντο & Ποσέ Αυγό',
    nameEn: 'Avocado Toast with Poached Egg',
    descEl: 'Ψωμί ολικής, αβοκάντο, ποσέ αυγό, φέτα, ντοματίνια και ρίγανη.',
    descEn: 'Whole grain toast, avocado, poached egg, feta, cherry tomatoes and oregano.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Αβοκάντο ½ · 1 Αυγό · 1 Φέτα Ψωμί',
        labelEn: 'Avocado ½ · 1 Egg · 1 Toast',
        price: 6.0,
        macros: { cal: 310, pro: 14, carb: 28, fat: 16 },
      },
      {
        id: 'v2',
        labelEl: 'Αβοκάντο 1 · 2 Αυγά · 2 Φέτες Ψωμί',
        labelEn: 'Avocado 1 · 2 Eggs · 2 Toasts',
        price: 8.0,
        macros: { cal: 490, pro: 22, carb: 44, fat: 26 },
      },
    ],
  },
  c02: {
    id: 'c02',
    emoji: '🫐',
    img: UNS('1541614101331-1a5a3a194e92'),
    catId: 'breakfast',
    tags: ['veg'],
    nameEl: 'Smoothie Bowl Φρούτων & Πρωτεΐνης',
    nameEn: 'Protein Fruit Smoothie Bowl',
    descEl: 'Frozen μπανάνα, blueberries, spinach, πρωτεΐνη βανίλιας, granola και σπόροι.',
    descEn: 'Frozen banana, blueberries, spinach, vanilla protein, granola and seeds.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Smoothie 250ml · Granola 30γρ · Σπόροι 10γρ',
        labelEn: 'Smoothie 250ml · Granola 30g · Seeds 10g',
        price: 6.5,
        macros: { cal: 350, pro: 22, carb: 48, fat: 8 },
      },
      {
        id: 'v2',
        labelEl: 'Smoothie 350ml · Granola 50γρ · Σπόροι 15γρ',
        labelEn: 'Smoothie 350ml · Granola 50g · Seeds 15g',
        price: 8.0,
        macros: { cal: 490, pro: 30, carb: 66, fat: 11 },
      },
    ],
  },
  c03: {
    id: 'c03',
    emoji: '🍅',
    img: UNS('1534483509719-3feaee7c30da'),
    catId: 'cooked',
    tags: ['veg'],
    nameEl: 'Γεμιστές Πιπεριές & Ντομάτες',
    nameEn: 'Stuffed Peppers & Tomatoes',
    descEl: 'Γεμιστά λαχανικά με ρύζι, κιμά γαλοπούλας, μυρωδικά και σάλτσα ντομάτας.',
    descEn: 'Stuffed vegetables with rice, ground turkey, herbs and tomato sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: '2 Γεμιστά · Κιμάς 120γρ · Ρύζι 80γρ',
        labelEn: '2 Stuffed Veg · Turkey 120g · Rice 80g',
        price: 8.0,
        macros: { cal: 400, pro: 28, carb: 44, fat: 10 },
      },
      {
        id: 'v2',
        labelEl: '3 Γεμιστά · Κιμάς 160γρ · Ρύζι 110γρ',
        labelEn: '3 Stuffed Veg · Turkey 160g · Rice 110g',
        price: 10.0,
        macros: { cal: 545, pro: 38, carb: 60, fat: 13 },
      },
    ],
  },
  c04: {
    id: 'c04',
    emoji: '🌱',
    img: UNS('1546069901-ba9599a7e63c'),
    catId: 'cooked',
    tags: ['veg'],
    nameEl: 'Buddha Bowl Vegan',
    nameEn: 'Vegan Buddha Bowl',
    descEl: 'Ρύζι κουρκουμά, ρεβίθια crispy, αβοκάντο, λαχανικά ψητά, tahini και dukkah.',
    descEn: 'Turmeric rice, crispy chickpeas, avocado, roasted vegetables, tahini and dukkah.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Ρύζι 100γρ · Ρεβίθια 100γρ · Αβοκάντο ½',
        labelEn: 'Rice 100g · Chickpeas 100g · Avocado ½',
        price: 8.0,
        macros: { cal: 370, pro: 15, carb: 52, fat: 14 },
      },
      {
        id: 'v2',
        labelEl: 'Ρύζι 140γρ · Ρεβίθια 140γρ · Αβοκάντο 1',
        labelEn: 'Rice 140g · Chickpeas 140g · Avocado 1',
        price: 10.0,
        macros: { cal: 510, pro: 21, carb: 72, fat: 20 },
      },
    ],
  },
  c05: {
    id: 'c05',
    emoji: '🦑',
    img: UNS('1519708227418-c8fd9a32b7a2'),
    catId: 'cooked',
    tags: [],
    nameEl: 'Χταπόδι με Κριθαράκι & Ντομάτα',
    nameEn: 'Octopus with Orzo & Tomato',
    descEl: 'Τρυφερό χταπόδι, κριθαράκι, σάλτσα ντομάτας, μαϊντανός και ελαιόλαδο.',
    descEn: 'Tender octopus, orzo pasta, tomato sauce, parsley and olive oil.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Χταπόδι 150γρ · Κριθαράκι 100γρ',
        labelEn: 'Octopus 150g · Orzo 100g',
        price: 9.5,
        macros: { cal: 370, pro: 28, carb: 40, fat: 9 },
      },
      {
        id: 'v2',
        labelEl: 'Χταπόδι 200γρ · Κριθαράκι 140γρ',
        labelEn: 'Octopus 200g · Orzo 140g',
        price: 12.0,
        macros: { cal: 500, pro: 38, carb: 56, fat: 12 },
      },
    ],
  },
  c06: {
    id: 'c06',
    emoji: '🥩',
    img: UNS('1546964124-0cce460eda80'),
    catId: 'grilled',
    tags: ['hot'],
    discount: 25,
    nameEl: 'Steak Μοσχαρίσιο με Ασπαράγια',
    nameEn: 'Beef Steak with Asparagus',
    descEl: 'Μοσχαρίσιο steak, ψητά ασπαράγια, πατάτες baby και σάλτσα pepper.',
    descEn: 'Beef steak, grilled asparagus, baby potatoes and pepper sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Steak 180γρ · Ασπαράγια 100γρ · Πατάτες 120γρ',
        labelEn: 'Steak 180g · Asparagus 100g · Potatoes 120g',
        price: 11.0,
        macros: { cal: 540, pro: 45, carb: 28, fat: 22 },
      },
      {
        id: 'v2',
        labelEl: 'Steak 250γρ · Ασπαράγια 150γρ · Πατάτες 150γρ',
        labelEn: 'Steak 250g · Asparagus 150g · Potatoes 150g',
        price: 14.0,
        macros: { cal: 730, pro: 62, carb: 36, fat: 30 },
      },
    ],
  },
  c07: {
    id: 'c07',
    emoji: '🐟',
    img: UNS('1547592180-85f173990554'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Σολομός Teriyaki με Edamame',
    nameEn: 'Teriyaki Salmon with Edamame',
    descEl: 'Φιλέτο σολομού teriyaki, edamame, ρύζι μαύρο, σουσάμι και κρεμμυδάκια.',
    descEn: 'Teriyaki salmon fillet, edamame, black rice, sesame and spring onions.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Σολομός 150γρ · Μαύρο Ρύζι 100γρ · Edamame 60γρ',
        labelEn: 'Salmon 150g · Black Rice 100g · Edamame 60g',
        price: 10.5,
        macros: { cal: 490, pro: 36, carb: 46, fat: 16 },
      },
      {
        id: 'v2',
        labelEl: 'Σολομός 200γρ · Μαύρο Ρύζι 130γρ · Edamame 80γρ',
        labelEn: 'Salmon 200g · Black Rice 130g · Edamame 80g',
        price: 13.0,
        macros: { cal: 650, pro: 48, carb: 62, fat: 21 },
      },
    ],
  },
  c08: {
    id: 'c08',
    emoji: '🍗',
    img: UNS('1546069901-ba9599a7e63c'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Κοτόπουλο Souvlaki με Πίτα',
    nameEn: 'Chicken Souvlaki with Pita',
    descEl: 'Κοτόπουλο souvlaki, πίτα ολικής, τζατζίκι, ντομάτα, κρεμμύδι και παπρίκα.',
    descEn: 'Chicken souvlaki, whole wheat pita, tzatziki, tomato, onion and paprika.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Πίτα 1 · Τζατζίκι 50γρ',
        labelEn: 'Chicken 150g · Pita 1 · Tzatziki 50g',
        price: 7.0,
        macros: { cal: 420, pro: 32, carb: 40, fat: 12 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Πίτα 2 · Τζατζίκι 70γρ',
        labelEn: 'Chicken 200g · Pita 2 · Tzatziki 70g',
        price: 9.0,
        macros: { cal: 580, pro: 43, carb: 58, fat: 17 },
      },
    ],
  },
  c09: {
    id: 'c09',
    emoji: '🥗',
    img: UNS('1498837167922-ddd27525d352'),
    catId: 'salads',
    tags: ['veg'],
    nameEl: 'Mediterranean Power Salad',
    nameEn: 'Mediterranean Power Salad',
    descEl: 'Ρόκα, σπανάκι, αγγούρι, ντομάτα, ρεβίθια, ελιές, φέτα και dressing tahini.',
    descEn: 'Arugula, spinach, cucumber, tomato, chickpeas, olives, feta and tahini dressing.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Φέτα 50γρ · Ρεβίθια 80γρ · Λαχανικά 200γρ',
        labelEn: 'Feta 50g · Chickpeas 80g · Vegetables 200g',
        price: 7.0,
        macros: { cal: 300, pro: 13, carb: 28, fat: 15 },
      },
      {
        id: 'v2',
        labelEl: 'Φέτα 70γρ · Ρεβίθια 120γρ · Λαχανικά 280γρ',
        labelEn: 'Feta 70g · Chickpeas 120g · Vegetables 280g',
        price: 9.0,
        macros: { cal: 420, pro: 19, carb: 40, fat: 21 },
      },
    ],
  },
  c10: {
    id: 'c10',
    emoji: '🥗',
    img: UNS('1512621776951-a57141f2eefd'),
    catId: 'salads',
    tags: ['lc'],
    nameEl: 'Σαλάτα Σολομού Νικουάζ',
    nameEn: 'Salmon Niçoise Salad',
    descEl: 'Φιλέτο σολομού ψητό, πράσινα φασολάκια, αυγό, ελιές, πατάτες baby και vinaigrette.',
    descEn: 'Grilled salmon fillet, green beans, egg, olives, baby potatoes and vinaigrette.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Σολομός 130γρ · Αυγό 1 · Πατάτες 80γρ',
        labelEn: 'Salmon 130g · 1 Egg · Potatoes 80g',
        price: 9.0,
        macros: { cal: 380, pro: 32, carb: 22, fat: 18 },
      },
      {
        id: 'v2',
        labelEl: 'Σολομός 180γρ · Αυγό 2 · Πατάτες 120γρ',
        labelEn: 'Salmon 180g · 2 Eggs · Potatoes 120g',
        price: 11.5,
        macros: { cal: 520, pro: 44, carb: 32, fat: 25 },
      },
    ],
  },

  // ── THURSDAY (d01-d10) ──
  d01: {
    id: 'd01',
    emoji: '🫙',
    img: UNS('1555126634-323283e090fa'),
    catId: 'breakfast',
    tags: ['hot'],
    nameEl: 'Granola με Γιαούρτι & Φρέσκα Φρούτα',
    nameEn: 'Granola with Yogurt & Fresh Fruits',
    descEl: 'Σπιτική granola καρπών, στραγγιστό γιαούρτι, φρέσκα βατόμουρα, μέλι και κανέλα.',
    descEn: 'Homemade nut granola, strained yogurt, fresh blueberries, honey and cinnamon.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Granola 50γρ · Γιαούρτι 200γρ · Φρούτα 80γρ',
        labelEn: 'Granola 50g · Yogurt 200g · Fruits 80g',
        price: 6.0,
        macros: { cal: 360, pro: 20, carb: 48, fat: 10 },
      },
      {
        id: 'v2',
        labelEl: 'Granola 80γρ · Γιαούρτι 300γρ · Φρούτα 120γρ',
        labelEn: 'Granola 80g · Yogurt 300g · Fruits 120g',
        price: 8.0,
        macros: { cal: 530, pro: 29, carb: 70, fat: 14 },
      },
    ],
  },
  d02: {
    id: 'd02',
    emoji: '🥚',
    img: UNS('1551248429-40975aa4de74'),
    catId: 'breakfast',
    tags: [],
    nameEl: 'Egg Muffins Πρωτεΐνης',
    nameEn: 'Protein Egg Muffins',
    descEl: 'Muffins αυγών με γαλοπούλα, σπανάκι, φέτα και πιπεριές. Χωρίς γλουτένη.',
    descEn: 'Egg muffins with turkey, spinach, feta and peppers. Gluten free.',
    variants: [
      {
        id: 'v1',
        labelEl: '4 Muffins · Γαλοπούλα 80γρ',
        labelEn: '4 Muffins · Turkey 80g',
        price: 6.5,
        macros: { cal: 280, pro: 26, carb: 8, fat: 16 },
      },
      {
        id: 'v2',
        labelEl: '6 Muffins · Γαλοπούλα 120γρ',
        labelEn: '6 Muffins · Turkey 120g',
        price: 8.5,
        macros: { cal: 420, pro: 39, carb: 12, fat: 24 },
      },
    ],
  },
  d03: {
    id: 'd03',
    emoji: '🍝',
    img: UNS('1565557623262-b51c2513a641'),
    catId: 'cooked',
    tags: ['hot'],
    discount: 15,
    nameEl: 'Γαρίδες με Orzo & Σάλτσα Ντομάτας',
    nameEn: 'Shrimp with Orzo & Tomato Sauce',
    descEl: 'Γαρίδες τίγρης, κριθαράκι, σάλτσα ντομάτας, σκόρδο, κρεμμύδι και μαϊντανός.',
    descEn: 'Tiger shrimp, orzo pasta, tomato sauce, garlic, onion and parsley.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Γαρίδες 150γρ · Κριθαράκι 100γρ',
        labelEn: 'Shrimp 150g · Orzo 100g',
        price: 9.0,
        macros: { cal: 360, pro: 28, carb: 40, fat: 7 },
      },
      {
        id: 'v2',
        labelEl: 'Γαρίδες 220γρ · Κριθαράκι 140γρ',
        labelEn: 'Shrimp 220g · Orzo 140g',
        price: 12.0,
        macros: { cal: 500, pro: 40, carb: 56, fat: 10 },
      },
    ],
  },
  d04: {
    id: 'd04',
    emoji: '🍗',
    img: UNS('1490645935967-10de6ba17061'),
    catId: 'cooked',
    tags: [],
    nameEl: 'Κοτόπουλο με Σάλτσα Μανιταριών',
    nameEn: 'Chicken with Mushroom Sauce',
    descEl: 'Στήθος κοτόπουλο, σάλτσα μανιταριών, πουρέ γλυκοπατάτας και χόρτα.',
    descEn: 'Chicken breast with creamy mushroom sauce, sweet potato mash and greens.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Πουρέ 120γρ · Σάλτσα 60γρ',
        labelEn: 'Chicken 150g · Mash 120g · Sauce 60g',
        price: 8.5,
        macros: { cal: 420, pro: 36, carb: 34, fat: 13 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Πουρέ 160γρ · Σάλτσα 80γρ',
        labelEn: 'Chicken 200g · Mash 160g · Sauce 80g',
        price: 10.5,
        macros: { cal: 560, pro: 48, carb: 46, fat: 17 },
      },
    ],
  },
  d05: {
    id: 'd05',
    emoji: '🫘',
    img: UNS('1512621776951-a57141f2eefd'),
    catId: 'cooked',
    tags: ['veg'],
    nameEl: 'Φακόσουπα με Σπανάκι & Κουρκουμά',
    nameEn: 'Lentil Soup with Spinach & Turmeric',
    descEl: 'Φακές, σπανάκι, κουρκουμάς, τζίντζερ, κρεμμύδι και χυμός λεμόνι.',
    descEn: 'Lentils, spinach, turmeric, ginger, onion and lemon juice.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Φακές 150γρ · Σπανάκι 100γρ · Ψωμί 1 Φέτα',
        labelEn: 'Lentils 150g · Spinach 100g · 1 Bread Slice',
        price: 6.5,
        macros: { cal: 310, pro: 18, carb: 46, fat: 5 },
      },
      {
        id: 'v2',
        labelEl: 'Φακές 220γρ · Σπανάκι 150γρ · Ψωμί 2 Φέτες',
        labelEn: 'Lentils 220g · Spinach 150g · 2 Bread Slices',
        price: 8.5,
        macros: { cal: 450, pro: 26, carb: 66, fat: 7 },
      },
    ],
  },
  d06: {
    id: 'd06',
    emoji: '🍗',
    img: UNS('1546069901-ba9599a7e63c'),
    catId: 'grilled',
    tags: ['hot'],
    nameEl: 'Κοτόπουλο με Γλυκοπατάτα & Μπρόκολο',
    nameEn: 'Chicken with Sweet Potato & Broccoli',
    descEl: 'Φιλέτο κοτόπουλο, ψητή γλυκοπατάτα, ατμιστό μπρόκολο και σάλτσα αβοκάντο.',
    descEn: 'Chicken fillet, roasted sweet potato, steamed broccoli and avocado sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Γλυκοπατάτα 130γρ · Μπρόκολο 80γρ',
        labelEn: 'Chicken 150g · Sweet Potato 130g · Broccoli 80g',
        price: 8.0,
        macros: { cal: 410, pro: 36, carb: 38, fat: 9 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Γλυκοπατάτα 180γρ · Μπρόκολο 110γρ',
        labelEn: 'Chicken 200g · Sweet Potato 180g · Broccoli 110g',
        price: 10.0,
        macros: { cal: 550, pro: 48, carb: 52, fat: 12 },
      },
    ],
  },
  d07: {
    id: 'd07',
    emoji: '🐷',
    img: UNS('1529692236671-f1f6cf9683ba'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Χοιρινό Souvlaki με Ρύζι & Τζατζίκι',
    nameEn: 'Pork Souvlaki with Rice & Tzatziki',
    descEl: 'Σουβλάκι χοιρινό, ρύζι basmati, τζατζίκι, λαχανικά σχάρας και πίτα ολικής.',
    descEn: 'Pork souvlaki, basmati rice, tzatziki, grilled vegetables and whole wheat pita.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Χοιρινό 150γρ · Ρύζι 100γρ · Τζατζίκι 50γρ',
        labelEn: 'Pork 150g · Rice 100g · Tzatziki 50g',
        price: 8.0,
        macros: { cal: 460, pro: 34, carb: 44, fat: 14 },
      },
      {
        id: 'v2',
        labelEl: 'Χοιρινό 200γρ · Ρύζι 130γρ · Τζατζίκι 70γρ',
        labelEn: 'Pork 200g · Rice 130g · Tzatziki 70g',
        price: 10.0,
        macros: { cal: 615, pro: 45, carb: 60, fat: 19 },
      },
    ],
  },
  d08: {
    id: 'd08',
    emoji: '🐟',
    img: UNS('1555939594-58d7cb561ad1'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Τόνος Ψητός με Quinoa & Edamame',
    nameEn: 'Grilled Tuna with Quinoa & Edamame',
    descEl: 'Φρέσκος τόνος ψητός, κινόα, edamame, αβοκάντο και σάλτσα σόγιας-σησαμιού.',
    descEn: 'Grilled fresh tuna, quinoa, edamame, avocado and soy-sesame sauce.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Τόνος 150γρ · Κινόα 80γρ · Edamame 60γρ',
        labelEn: 'Tuna 150g · Quinoa 80g · Edamame 60g',
        price: 10.0,
        macros: { cal: 420, pro: 38, carb: 32, fat: 13 },
      },
      {
        id: 'v2',
        labelEl: 'Τόνος 200γρ · Κινόα 110γρ · Edamame 80γρ',
        labelEn: 'Tuna 200g · Quinoa 110g · Edamame 80g',
        price: 13.0,
        macros: { cal: 570, pro: 51, carb: 44, fat: 18 },
      },
    ],
  },
  d09: {
    id: 'd09',
    emoji: '🥗',
    img: UNS('1512621776951-a57141f2eefd'),
    catId: 'salads',
    tags: ['lc'],
    nameEl: 'Σαλάτα Τόνου με Αβοκάντο & Ξηρούς Καρπούς',
    nameEn: 'Tuna, Avocado & Nut Salad',
    descEl: 'Φρέσκος τόνος, αβοκάντο, ρόκα, αμύγδαλα, ντοματίνια και dressing εσπεριδοειδών.',
    descEn: 'Fresh tuna, avocado, arugula, almonds, cherry tomatoes and citrus dressing.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Τόνος 120γρ · Αβοκάντο ½ · Αμύγδαλα 20γρ',
        labelEn: 'Tuna 120g · Avocado ½ · Almonds 20g',
        price: 9.0,
        macros: { cal: 350, pro: 28, carb: 12, fat: 22 },
      },
      {
        id: 'v2',
        labelEl: 'Τόνος 170γρ · Αβοκάντο 1 · Αμύγδαλα 30γρ',
        labelEn: 'Tuna 170g · Avocado 1 · Almonds 30g',
        price: 11.5,
        macros: { cal: 480, pro: 38, carb: 17, fat: 31 },
      },
    ],
  },
  d10: {
    id: 'd10',
    emoji: '🥗',
    img: UNS('1546793665-c74683f339c1'),
    catId: 'salads',
    tags: [],
    nameEl: 'Σαλάτα Κοτόπουλο & Quinoa με Pesto',
    nameEn: 'Chicken & Quinoa Salad with Pesto',
    descEl: 'Ψητό κοτόπουλο, κινόα, σπανάκι, ντοματίνια, pesto βασιλικού και παρμεζάνα.',
    descEn: 'Grilled chicken, quinoa, spinach, cherry tomatoes, basil pesto and parmesan.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 140γρ · Κινόα 80γρ · Pesto 20γρ',
        labelEn: 'Chicken 140g · Quinoa 80g · Pesto 20g',
        price: 8.5,
        macros: { cal: 390, pro: 34, carb: 30, fat: 16 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 190γρ · Κινόα 110γρ · Pesto 30γρ',
        labelEn: 'Chicken 190g · Quinoa 110g · Pesto 30g',
        price: 10.5,
        macros: { cal: 520, pro: 45, carb: 42, fat: 22 },
      },
    ],
  },

  // ── FRIDAY (e01-e10) ──
  e01: {
    id: 'e01',
    emoji: '🍞',
    img: UNS('1484985831135-1347bf26f0e6'),
    catId: 'breakfast',
    tags: ['hot'],
    nameEl: 'French Toast Πρωτεΐνης',
    nameEn: 'Protein French Toast',
    descEl: 'Ψωμί brioche ολικής, αυγό, βανίλια, κανέλα, φράουλες, σιρόπι σφενδάμου χαμηλών θερμίδων.',
    descEn: 'Whole grain brioche, egg, vanilla, cinnamon, strawberries and low-calorie maple syrup.',
    variants: [
      {
        id: 'v1',
        labelEl: '2 Φέτες Brioche · 2 Αυγά · Φράουλες 80γρ',
        labelEn: '2 Brioche Slices · 2 Eggs · Strawberries 80g',
        price: 6.5,
        macros: { cal: 360, pro: 20, carb: 42, fat: 12 },
      },
      {
        id: 'v2',
        labelEl: '3 Φέτες Brioche · 3 Αυγά · Φράουλες 130γρ',
        labelEn: '3 Brioche Slices · 3 Eggs · Strawberries 130g',
        price: 8.5,
        macros: { cal: 530, pro: 30, carb: 62, fat: 18 },
      },
    ],
  },
  e02: {
    id: 'e02',
    emoji: '🫐',
    img: UNS('1497534446932-1795ed71594b'),
    catId: 'breakfast',
    tags: ['veg'],
    nameEl: 'Açaí Bowl Superfood',
    nameEn: 'Superfood Açaí Bowl',
    descEl: 'Βάση açaí, μπανάνα, chia, granola, φρέσκα φρούτα, coconut flakes και μέλι.',
    descEn: 'Açaí base, banana, chia, granola, fresh fruits, coconut flakes and honey.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Açaí 150γρ · Granola 30γρ · Φρούτα 100γρ',
        labelEn: 'Açaí 150g · Granola 30g · Fruits 100g',
        price: 7.0,
        macros: { cal: 370, pro: 8, carb: 58, fat: 12 },
      },
      {
        id: 'v2',
        labelEl: 'Açaí 220γρ · Granola 50γρ · Φρούτα 150γρ',
        labelEn: 'Açaí 220g · Granola 50g · Fruits 150g',
        price: 9.0,
        macros: { cal: 540, pro: 12, carb: 84, fat: 17 },
      },
    ],
  },
  e03: {
    id: 'e03',
    emoji: '🍝',
    img: UNS('1621996346565-e3dbc646d9a9'),
    catId: 'cooked',
    tags: [],
    nameEl: 'Pasta θαλασσινών',
    nameEn: 'Seafood Pasta',
    descEl: 'Γαρίδες, μύδια, χταπόδι, σπαγγέτι ολικής, σάλτσα ντομάτας, σκόρδο και μαϊντανός.',
    descEn: 'Shrimp, mussels, octopus, whole wheat spaghetti, tomato sauce, garlic and parsley.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Θαλασσινά 150γρ · Σπαγγέτι 100γρ',
        labelEn: 'Seafood 150g · Spaghetti 100g',
        price: 10.0,
        macros: { cal: 400, pro: 30, carb: 46, fat: 8 },
      },
      {
        id: 'v2',
        labelEl: 'Θαλασσινά 220γρ · Σπαγγέτι 130γρ',
        labelEn: 'Seafood 220g · Spaghetti 130g',
        price: 13.0,
        macros: { cal: 550, pro: 42, carb: 62, fat: 11 },
      },
    ],
  },
  e04: {
    id: 'e04',
    emoji: '🌿',
    img: UNS('1565557623262-b51c2513a641'),
    catId: 'cooked',
    tags: ['veg'],
    nameEl: 'Curry Ρεβιθιών & Κολοκύθας',
    nameEn: 'Chickpea & Pumpkin Curry',
    descEl: 'Ρεβίθια, κολοκύθα, κάρι κόκκινο, γάλα καρύδας, σπανάκι και ρύζι basmati.',
    descEn: 'Chickpeas, pumpkin, red curry, coconut milk, spinach and basmati rice.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Ρεβίθια 150γρ · Κολοκύθα 120γρ · Ρύζι 80γρ',
        labelEn: 'Chickpeas 150g · Pumpkin 120g · Rice 80g',
        price: 7.5,
        macros: { cal: 380, pro: 14, carb: 58, fat: 10 },
      },
      {
        id: 'v2',
        labelEl: 'Ρεβίθια 200γρ · Κολοκύθα 160γρ · Ρύζι 110γρ',
        labelEn: 'Chickpeas 200g · Pumpkin 160g · Rice 110g',
        price: 9.5,
        macros: { cal: 520, pro: 20, carb: 80, fat: 14 },
      },
    ],
  },
  e05: {
    id: 'e05',
    emoji: '🍗',
    img: UNS('1490645935967-10de6ba17061'),
    catId: 'cooked',
    tags: ['hot'],
    nameEl: 'Κοτόπουλο με Σάλτσα Πέστο & Gnocchi',
    nameEn: 'Chicken Pesto with Gnocchi',
    descEl: 'Φιλέτο κοτόπουλο, gnocchi πατάτας ολικής, pesto βασιλικού, ντοματίνια και παρμεζάνα.',
    descEn: 'Chicken fillet, whole wheat potato gnocchi, basil pesto, cherry tomatoes and parmesan.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Gnocchi 120γρ · Pesto 25γρ',
        labelEn: 'Chicken 150g · Gnocchi 120g · Pesto 25g',
        price: 9.0,
        macros: { cal: 460, pro: 36, carb: 46, fat: 14 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Gnocchi 160γρ · Pesto 35γρ',
        labelEn: 'Chicken 200g · Gnocchi 160g · Pesto 35g',
        price: 11.0,
        macros: { cal: 615, pro: 48, carb: 62, fat: 19 },
      },
    ],
  },
  e06: {
    id: 'e06',
    emoji: '🐟',
    img: UNS('1519708227418-c8fd9a32b7a2'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Τσιπούρα στο Φούρνο με Λαχανικά',
    nameEn: 'Baked Sea Bream with Vegetables',
    descEl: 'Φρέσκια τσιπούρα, ψητές πατάτες, κρεμμύδι, ελιές, ντομάτα και μυρωδικά.',
    descEn: 'Fresh sea bream with roasted potatoes, onion, olives, tomato and herbs.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Τσιπούρα 250γρ · Πατάτες 150γρ',
        labelEn: 'Sea Bream 250g · Potatoes 150g',
        price: 10.5,
        macros: { cal: 410, pro: 36, carb: 28, fat: 15 },
      },
      {
        id: 'v2',
        labelEl: 'Τσιπούρα 350γρ · Πατάτες 200γρ',
        labelEn: 'Sea Bream 350g · Potatoes 200g',
        price: 13.5,
        macros: { cal: 570, pro: 50, carb: 38, fat: 21 },
      },
    ],
  },
  e07: {
    id: 'e07',
    emoji: '🥩',
    img: UNS('1555939594-58d7cb561ad1'),
    catId: 'grilled',
    tags: ['hot'],
    nameEl: 'Μοσχαρίσιο Μπολ με Γλυκοπατάτα',
    nameEn: 'Beef Bowl with Sweet Potato',
    descEl: 'Μαριναρισμένο μοσχαρίσιο με γλυκοπατάτα, μπρόκολο και μαύρα φασόλια.',
    descEn: 'Marinated ground beef with sweet potato, broccoli and black beans.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κιμάς 150γρ · Γλυκοπατάτα 120γρ',
        labelEn: 'Beef 150g · Sweet Potato 120g',
        price: 8.5,
        macros: { cal: 480, pro: 38, carb: 46, fat: 11 },
      },
      {
        id: 'v2',
        labelEl: 'Κιμάς 200γρ · Γλυκοπατάτα 160γρ',
        labelEn: 'Beef 200g · Sweet Potato 160g',
        price: 10.5,
        macros: { cal: 640, pro: 51, carb: 62, fat: 15 },
      },
    ],
  },
  e08: {
    id: 'e08',
    emoji: '🦃',
    img: UNS('1621996346565-e3dbc646d9a9'),
    catId: 'grilled',
    tags: [],
    nameEl: 'Steak Γαλοπούλας με Κινόα & Pesto',
    nameEn: 'Turkey Steak with Quinoa & Pesto',
    descEl: 'Στήθος γαλοπούλας ψητό, κινόα, pesto ρόκας, ψητές κολοκυθάκια και cherry tomato.',
    descEn: 'Grilled turkey breast, quinoa, arugula pesto, grilled zucchini and cherry tomato.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Γαλοπούλα 160γρ · Κινόα 80γρ · Pesto 20γρ',
        labelEn: 'Turkey 160g · Quinoa 80g · Pesto 20g',
        price: 8.5,
        macros: { cal: 400, pro: 38, carb: 30, fat: 11 },
      },
      {
        id: 'v2',
        labelEl: 'Γαλοπούλα 220γρ · Κινόα 110γρ · Pesto 30γρ',
        labelEn: 'Turkey 220g · Quinoa 110g · Pesto 30g',
        price: 10.5,
        macros: { cal: 545, pro: 51, carb: 42, fat: 15 },
      },
    ],
  },
  e09: {
    id: 'e09',
    emoji: '🥗',
    img: UNS('1546793665-c74683f339c1'),
    catId: 'salads',
    tags: ['hot'],
    nameEl: 'Caesar Κοτόπουλο Deluxe',
    nameEn: 'Chicken Caesar Deluxe',
    descEl: 'Ψητό κοτόπουλο, cos μαρούλι, παρμεζάνα, κρουτόν ολικής, αντζούγιες και caesar dressing.',
    descEn: 'Grilled chicken, cos lettuce, parmesan, whole grain croutons, anchovies and caesar dressing.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Κοτόπουλο 150γρ · Cos Μαρούλι 100γρ · Παρμεζάνα 20γρ',
        labelEn: 'Chicken 150g · Cos Lettuce 100g · Parmesan 20g',
        price: 8.5,
        macros: { cal: 380, pro: 34, carb: 20, fat: 16 },
      },
      {
        id: 'v2',
        labelEl: 'Κοτόπουλο 200γρ · Cos Μαρούλι 140γρ · Παρμεζάνα 30γρ',
        labelEn: 'Chicken 200g · Cos Lettuce 140g · Parmesan 30g',
        price: 10.5,
        macros: { cal: 510, pro: 46, carb: 27, fat: 22 },
      },
    ],
  },
  e10: {
    id: 'e10',
    emoji: '🥗',
    img: UNS('1498837167922-ddd27525d352'),
    catId: 'salads',
    tags: ['veg', 'lc'],
    nameEl: 'Σαλάτα Αβοκάντο & Ρόδι',
    nameEn: 'Avocado & Pomegranate Salad',
    descEl: 'Αβοκάντο, ρόδι, σπανάκι baby, αμύγδαλα, φέτα και dressing lime-μέλι.',
    descEn: 'Avocado, pomegranate, baby spinach, almonds, feta and lime-honey dressing.',
    variants: [
      {
        id: 'v1',
        labelEl: 'Αβοκάντο ½ · Ρόδι 60γρ · Φέτα 40γρ · Αμύγδαλα 20γρ',
        labelEn: 'Avocado ½ · Pomegranate 60g · Feta 40g · Almonds 20g',
        price: 7.5,
        macros: { cal: 310, pro: 11, carb: 24, fat: 20 },
      },
      {
        id: 'v2',
        labelEl: 'Αβοκάντο 1 · Ρόδι 90γρ · Φέτα 60γρ · Αμύγδαλα 30γρ',
        labelEn: 'Avocado 1 · Pomegranate 90g · Feta 60g · Almonds 30g',
        price: 9.5,
        macros: { cal: 450, pro: 16, carb: 35, fat: 30 },
      },
    ],
  },

  // ── SNACKS (s01-s03) ──
  s01: SNACK_DATA[0],
  s02: SNACK_DATA[1],
  s03: SNACK_DATA[2],
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEK DATA
// ═══════════════════════════════════════════════════════════════════════════

export const WEEK_DATA: WeekDef[] = [
  {
    id: 'week1',
    labelEl: 'Εβδομάδα 1',
    labelEn: 'Week 1',
    days: [
      {
        date: '2026-04-06',
        dishIds: ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-07',
        dishIds: ['b01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08', 'b09', 'b10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-08',
        dishIds: ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-09',
        dishIds: ['d01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07', 'd08', 'd09', 'd10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-10',
        dishIds: ['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08', 'e09', 'e10', 's01', 's02', 's03'],
      },
    ],
  },
  {
    id: 'week2',
    labelEl: 'Εβδομάδα 2',
    labelEn: 'Week 2',
    days: [
      {
        date: '2026-04-13',
        dishIds: ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-14',
        dishIds: ['b01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08', 'b09', 'b10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-15',
        dishIds: ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-16',
        dishIds: ['d01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07', 'd08', 'd09', 'd10', 's01', 's02', 's03'],
      },
      {
        date: '2026-04-17',
        dishIds: ['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08', 'e09', 'e10', 's01', 's02', 's03'],
      },
    ],
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// WALLET PLANS
// ═══════════════════════════════════════════════════════════════════════════

export const WALLET_PLANS: WalletPlan[] = [
  {
    id: 'basic',
    nameEl: 'Basic',
    nameEn: 'Basic',
    price: 50,
    credits: 53.5,
    bonusPct: 7,
    discountPct: 5,
  },
  {
    id: 'plus',
    nameEl: 'Plus',
    nameEn: 'Plus',
    price: 100,
    credits: 110,
    bonusPct: 10,
    discountPct: 8,
  },
  {
    id: 'premium',
    nameEl: 'Premium',
    nameEn: 'Premium',
    price: 150,
    credits: 168,
    bonusPct: 12,
    discountPct: 10,
  },
]
