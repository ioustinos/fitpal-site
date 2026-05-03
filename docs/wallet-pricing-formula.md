# Fitpal Wallet — Pricing & Diet Calculation

Reference document for the wallet plan calculator. Explains every formula and parameter the calculator uses, where each value lives in code, and who owns it (dietician vs operations).

All current values are in [`src/lib/wallet/constants.ts`](../src/lib/wallet/constants.ts). When the backend ships, these move into Supabase `settings` jsonb keys and become editable from `/admin/settings → Wallet pricing`. Until then, edits to the constants file are the way to tune the model.

---

## Ownership

The model has two layers, owned by two different people:

| Layer | Owner | What they tune |
|---|---|---|
| **Diet parameters** | Head dietician | Caloric formula, activity multipliers, goal calorie adjustments, macro splits per goal, meal-time split |
| **Pricing parameters** | Operations / founder | Per-meal pricing matrix (intercepts + macro coefficients), discount matrix, plan-length definitions |

The calculator runs the diet layer first to produce `(daily kcal, kcal of each macro at each meal)`, then the pricing layer turns that into a euro price.

---

## The full formula chain

```
profile inputs
    │
    ▼
[1] BMR  — Mifflin-St Jeor             ─┐
                                        │
[2] Daily kcal  = BMR × activity        │  DIET LAYER
                       + goal_adj       │  (dietician owns)
                                        │
[3] Macros (g/day)  = daily_kcal × macro_split / kcal_per_gram
                                        │
[4] Per-meal kcal  = daily_kcal × meal_split[meal]
[5] Per-meal-per-macro kcal             │
                                       ─┘
                                        │
                                        ▼
[6] Per-meal price  = intercept + Σ(macro_kcal × coefficient)  ─┐
                                                                │
[7] Daily price  = Σ(price for each included meal)              │  PRICING LAYER
                                                                │  (operations owns)
[8] Period subtotal  = daily_price × weeks × days_per_week      │
                                                                │
[9] Discount  = subtotal × discount_matrix[length][days/wk]    ─┘
                                        │
                                        ▼
[10] Amount to pay  = subtotal − discount
[11] Wallet credits  = subtotal           (the discount becomes "bonus credits")
```

---

## DIET LAYER — owned by the dietician

### Step 1 · BMR (Basal Metabolic Rate)

We use the **Mifflin-St Jeor** equation. It's the most accurate of the standard BMR formulas for the general population and is what every reputable nutrition app uses (MyFitnessPal, Cronometer, etc.).

```
Male:    BMR = 10·weight + 6.25·height − 5·age + 5
Female:  BMR = 10·weight + 6.25·height − 5·age − 161
```

Weight in kg, height in cm, age in years. Output is kcal/day.

If the dietician prefers a different formula (Harris-Benedict, Katch-McArdle, etc.), that swap happens in `calculator.ts` — not just a settings change.

### Step 2 · Activity multiplier

BMR is what the body burns at rest. Multiply by an activity factor to get total daily energy expenditure (TDEE):

| Level | Multiplier | Description shown to user |
|---|---|---|
| Sedentary | **1.20** | Desk job, no exercise |
| Light | **1.375** | 1–3 workouts/week |
| Moderate | **1.55** | 3–5 workouts/week |
| Active | **1.725** | 6–7 workouts/week |
| Very active | **1.90** | 2× daily or physical job |

These are the standard textbook values. The dietician can tune them.

### Step 3 · Goal calorie adjustment

After computing TDEE, we shift the target up or down based on the user's goal:

| Goal | Adjustment (kcal/day) |
|---|---|
| Lose weight | **−500** |
| Maintain weight | **0** |
| Build muscle / Gain | **+300** |

A 500 kcal/day deficit produces ~0.5 kg/week loss (the classical "safe deficit"). A 300 kcal/day surplus produces ~0.25 kg/week lean gain (the typical "lean bulk" recommendation).

**Final daily kcal** = round( BMR × activity_multiplier + goal_adjustment ).

### Step 4 · Macro split (P/C/F by goal)

The same daily kcal can be split into protein/carbs/fat in many ways. We use a default split per goal:

| Goal | Protein | Carbs | Fat |
|---|---|---|---|
| Lose | **35%** | **35%** | **30%** |
| Maintain | **25%** | **50%** | **25%** |
| Gain | **30%** | **50%** | **20%** |

Rationale (textbook):
- *Lose* → high protein preserves lean mass during deficit; moderate carbs to spare training intensity; moderate fat for satiety.
- *Maintain* → balanced split, slightly carb-leaning (typical Mediterranean diet pattern, fits the GR market).
- *Gain* → high carbs for recovery and glycogen, moderate protein, lower fat to keep total calories from spiking too fast.

These percentages are applied **independently inside every included meal** in V1. (Per-meal overrides — e.g. more protein at breakfast — are R2 backlog.)

### Step 5 · Meal-time split

What % of the day's calories is delivered at each meal slot:

| Breakfast | Lunch | Dinner | Snack |
|---|---|---|---|
| **25%** | **35%** | **30%** | **10%** |

If the user **un-checks** a meal, those calories simply **are not supplied** — they're not redistributed to the other meals. Example: user picks lunch + dinner only → we deliver 35% + 30% = 65% of their TDEE in those two meals (per Ioustinos's spec).

### Step 6 · kcal-per-gram conversion

To go from "kcal of macro X" → "grams of macro X" (used both for the macro display and for the per-gram pricing table if we ever switch to it):

| Macro | kcal per gram |
|---|---|
| Protein | 4 |
| Carbs | 4 |
| Fat | 9 |

These are biology constants, not parameters — they don't change.

---

## PRICING LAYER — owned by operations

### Step 7 · Per-meal price formula

This is where **intercept** comes from, and the answer to your question is **yes** — it's directly from the table you gave me.

When you (or the original analysis) regressed dish prices against their macro content, the model fitted per meal-type was:

```
price_for_meal = intercept + (kcal_protein × coef_P)
                            + (kcal_carbs   × coef_C)
                            + (kcal_fat     × coef_F)
```

The **intercept** is the constant term — the part of a meal's price that's *not* explained by macro content. Concretely, it captures: packaging, prep labor, fixed kitchen overhead per dish, plate cost, sauce/seasoning that's nutritionally negligible but not free, supplier minimums, and any rounding the chef does on retail prices. That's why the intercept varies meaningfully by meal:

| Meal | Intercept (€) | Why this number |
|---|---|---|
| Breakfast | 3.24 | Simpler prep, smaller portion overhead |
| Lunch | 6.61 | More elaborate cooking, sides, container |
| Dinner | 6.34 | Similar to lunch, slightly less |
| Snack | 2.48 | Minimal prep, small packaging |

### Step 8 · Per-kcal coefficients (the active table)

This is the table the calculator currently uses:

| Meal | Intercept (€) | € / kcal P | € / kcal C | € / kcal F |
|---|---|---|---|---|
| Breakfast | 3.2438 | 0.014903 | 0.000160 | 0.003693 |
| Lunch | 6.6102 | 0.020906 | **−0.008603** | 0.008767 |
| Dinner | 6.3362 | 0.018009 | **−0.001328** | 0.001384 |
| Snack | 2.4800 | 0.006822 | 0.001680 | **−0.001499** |

### Why some coefficients are negative

The negative values (lunch carbs, dinner carbs, snack fat) are **regression artifacts**, not business rules. They appear because in the dataset of existing dishes, the macro variables are correlated — when carbs go up, so do calories and so does protein, on average. The regression fits the data slightly better with a small negative on those terms. The magnitudes are tiny (max −€0.0086 per kcal of carbs at lunch), so for any realistic macro split the meal price is dominated by the intercept and the positive coefficients.

We accept them as-is per the explicit decision (option 1 from the earlier discussion). The calculator floors a meal's final price at €0 as a defensive guard, but in practice no realistic input triggers that floor.

### Step 9 · Per-gram coefficients (kept for reference, NOT used)

The same regression expressed in grams instead of kcal. We store both forms in the settings so we can switch later, but the per-kcal table is currently active because our upstream math computes kcal-per-macro directly:

| Meal | Intercept (€) | € / g P | € / g C | € / g F |
|---|---|---|---|---|
| Breakfast | 3.2438 | 0.059611 | 0.000640 | 0.033241 |
| Lunch | 6.6102 | 0.083625 | −0.034411 | 0.078906 |
| Dinner | 6.3362 | 0.072036 | −0.005313 | 0.012452 |
| Snack | 2.4800 | 0.027286 | 0.006719 | −0.013487 |

Conversion identity: `coef_per_gram = coef_per_kcal × kcal_per_gram_of_that_macro` (4 for P/C, 9 for F).

### Step 10 · Period total

```
plan_length_weeks   = 2  (for "2w") or 4.33 (for "1mo") or 13 (for "3mo")
days_covered        = plan_length_weeks × days_per_week
period_subtotal     = daily_price × days_covered
```

`4.33` = 52 weeks ÷ 12 months. This matches the `WEEKS_PER_MONTH` constant the existing wallet code already uses.

### Step 11 · Discount matrix

A single 2-D table, plan length × days/week. Values are fractions applied to the period subtotal:

| Plan length | 5 days/wk | 6 days/wk | 7 days/wk |
|---|---|---|---|
| 2 weeks | 4% | 6% | 8% |
| 1 month | 10% | 12% | 15% |
| 3 months | 18% | 22% | 25% |

Logic: longer commitment = bigger discount; more days/week = bigger discount. These are starter values — operations can rebalance freely without code changes (just edit the matrix).

### Step 12 · Final amounts

```
amount_to_pay   = period_subtotal × (1 − discount_pct)
bonus_credits   = period_subtotal − amount_to_pay
wallet_credit   = period_subtotal           ← user receives this much in their wallet
```

The user **pays less** than the value they receive. The gap (`bonus_credits`) is shown in the green callout under the total — it's the same money expressed two ways for psychological framing.

---

## Worked example — end to end

Default state on the wallet page: female, 30y, 170cm, 70kg, moderate, maintain, lunch + dinner, 1 month, 5 days/week.

**Diet layer**
1. BMR (female) = 10·70 + 6.25·170 − 5·30 − 161 = **1451.5 kcal**
2. TDEE = 1451.5 × 1.55 (moderate) + 0 (maintain) = **2250 kcal/day**
3. Macros (P/C/F = 25/50/25):
   - Protein: 2250 × 25% / 4 = **141 g**
   - Carbs:   2250 × 50% / 4 = **281 g**
   - Fat:     2250 × 25% / 9 = **63 g**
4. Lunch kcal = 2250 × 35% = **787.5 kcal** (P 196.9 / C 393.8 / F 196.9 in kcal)
5. Dinner kcal = 2250 × 30% = **675 kcal** (P 168.75 / C 337.5 / F 168.75 in kcal)

**Pricing layer**
6. Lunch price = 6.6102 + (0.020906 × 196.9) + (−0.008603 × 393.8) + (0.008767 × 196.9) = **€9.06**
7. Dinner price = 6.3362 + (0.018009 × 168.75) + (−0.001328 × 337.5) + (0.001384 × 168.75) = **€9.16**
8. Daily price = 9.06 + 9.16 = **€18.23**
9. Days covered = 4.33 × 5 = **21.65 days**
10. Subtotal = 18.23 × 21.65 = **€394.58**
11. Discount (1mo × 5d) = 10% → **−€39.46**
12. **Amount to pay: €355.12** · **Wallet credit: €394.58** · **Bonus credits: €39.46**

These match what's shown live on the wallet page sidebar.

---

## Where each parameter lives in code

All in [`src/lib/wallet/constants.ts`](../src/lib/wallet/constants.ts), under `DEFAULT_WALLET_SETTINGS`:

| What | Key |
|---|---|
| BMR formula choice | `calorieFormula.formula` |
| Activity multipliers | `calorieFormula.activityMultipliers` |
| Goal kcal adjustments | `calorieFormula.goalAdjustments` |
| Macro splits per goal | `macroSplitByGoal` |
| Meal-time split | `mealSplit` |
| Pricing matrix (both forms) | `pricingMatrix.perKcal` and `pricingMatrix.perGram` |
| Active pricing table | `pricingMatrix.active` |
| Discount matrix | `discountMatrix` |
| Plan-length → weeks | `planLengthWeeks` |

The Mifflin-St Jeor equation itself is in [`src/lib/wallet/calculator.ts`](../src/lib/wallet/calculator.ts) (function `mifflinStJeor`). To swap formulas, change that function.

---

## Roadmap — dietician admin UI

When the backend phase ships, these constants migrate to Supabase `settings` jsonb rows:

| Settings key | Owner |
|---|---|
| `wallet_calorie_formula` | Dietician |
| `wallet_macro_split_by_goal` | Dietician |
| `wallet_meal_split` | Dietician |
| `wallet_pricing_matrix` | Operations |
| `wallet_discount_matrix` | Operations |
| `wallet_plan_lengths` | Operations |

A `/admin/settings → Wallet pricing` tab gives the dietician a form to edit the diet-layer settings without code changes. Operations gets a separate tab for the pricing layer. Changes apply on next page refresh; existing in-flight plans use the snapshot they were created with (frozen on the `wallet_plans` row).

This is part of the backend work tracked in the build plan — flagged here so the dietician knows the editable surface is coming.
