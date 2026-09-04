// `ui-primitives-data/02`. The 4/4/9 kcal-per-gram conversion, written down
// once. It lives here rather than in the component that first needed it for
// the reason every formula in this package does (`code-conventions` §1): the
// API's `daily_nutrition_summary` recompute (P13 `nutrition-summary/01`) and
// the device's diary row have to agree on what a day's calories were, and a
// second copy of these three numbers is a second answer.
//
// These are the Atwater general factors — the same integers every food
// database, label, and coach uses. They are deliberately NOT rounded
// physiological values (protein is closer to 4.1, fat to 8.8): the whole
// point is that the number we show matches the number on the packet.
//
// Alcohol (7 kcal/g) is absent because CoachOS does not log it; adding it is
// a product decision, not a constant.

export const KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
} as const;

export type MacroGrams = {
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type MacroKcal = {
  proteinKcal: number;
  carbsKcal: number;
  fatKcal: number;
  totalKcal: number;
};

/**
 * Converts a gram breakdown into the calories each macro contributed, plus
 * their total.
 *
 * A negative or non-finite gram value is clamped to zero rather than thrown
 * on: the callers are a diary row and a summary recompute, and neither has a
 * sensible way to render an exception. A negative macro is a bug upstream,
 * and it shows up as a missing segment rather than as a bar drawn backwards.
 */
export function macroKcal({ proteinG, carbsG, fatG }: MacroGrams): MacroKcal {
  const proteinKcal = safeGrams(proteinG) * KCAL_PER_GRAM.protein;
  const carbsKcal = safeGrams(carbsG) * KCAL_PER_GRAM.carbs;
  const fatKcal = safeGrams(fatG) * KCAL_PER_GRAM.fat;

  return {
    proteinKcal,
    carbsKcal,
    fatKcal,
    totalKcal: proteinKcal + carbsKcal + fatKcal,
  };
}

function safeGrams(grams: number): number {
  return Number.isFinite(grams) && grams > 0 ? grams : 0;
}
