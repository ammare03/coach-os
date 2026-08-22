// DB§21: ~500 foods, "Indian and Western staples" — CLAUDE.md's stated
// market is India alongside the US/EU (§2), and a food list skewed
// entirely Western would make `phase-13-nutrition`'s search feature
// untestable against the product's actual target users (seed-and-fixtures/
// 01's own Approach §6). 100 base foods (roughly half Indian, half
// Western) × 5 brand variants each = ~500 rows — the base macros are real
// per-100g estimates, the "brand" layer is what actually reaches 500.
import type { Transaction } from '../aggregates/types.ts';
import { foods } from '../schema/nutrition.ts';

import { timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

// The food database is seeded as one event — coach.ts's comment explains
// why this must be explicit rather than left to `.defaultNow()`.
const FOODS_CREATED_AT = timestampFromAnchor(-500, 6);

type BaseFood = {
  name: string;
  caloriesPer100g: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
};

// 50 Indian staples, then 50 Western staples — per-100g macro estimates,
// realistic but not clinically precise (this is dev/demo data, not a
// nutrition database).
const BASE_FOODS: BaseFood[] = [
  // Indian
  {
    name: 'Roti (whole wheat)',
    caloriesPer100g: 297,
    proteinG: 11,
    carbsG: 51,
    fatG: 6,
    fiberG: 8,
  },
  { name: 'Naan', caloriesPer100g: 310, proteinG: 9, carbsG: 50, fatG: 8, fiberG: 2 },
  { name: 'Steamed Rice', caloriesPer100g: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: 0.4 },
  { name: 'Jeera Rice', caloriesPer100g: 165, proteinG: 3, carbsG: 30, fatG: 4, fiberG: 0.6 },
  { name: 'Dal Tadka', caloriesPer100g: 116, proteinG: 7, carbsG: 15, fatG: 3, fiberG: 5 },
  { name: 'Chana Masala', caloriesPer100g: 164, proteinG: 8, carbsG: 22, fatG: 5, fiberG: 7 },
  { name: 'Rajma', caloriesPer100g: 140, proteinG: 8.5, carbsG: 22, fatG: 2, fiberG: 6.5 },
  {
    name: 'Paneer Butter Masala',
    caloriesPer100g: 220,
    proteinG: 10,
    carbsG: 8,
    fatG: 16,
    fiberG: 1,
  },
  { name: 'Palak Paneer', caloriesPer100g: 180, proteinG: 9, carbsG: 7, fatG: 13, fiberG: 2 },
  { name: 'Paneer (raw)', caloriesPer100g: 265, proteinG: 18, carbsG: 3.6, fatG: 20, fiberG: 0 },
  { name: 'Chicken Curry', caloriesPer100g: 190, proteinG: 16, carbsG: 6, fatG: 11, fiberG: 1 },
  { name: 'Chicken Tikka', caloriesPer100g: 175, proteinG: 24, carbsG: 3, fatG: 7, fiberG: 0.5 },
  { name: 'Butter Chicken', caloriesPer100g: 210, proteinG: 15, carbsG: 7, fatG: 14, fiberG: 0.5 },
  { name: 'Tandoori Chicken', caloriesPer100g: 165, proteinG: 25, carbsG: 2, fatG: 6, fiberG: 0 },
  { name: 'Egg Curry', caloriesPer100g: 155, proteinG: 10, carbsG: 5, fatG: 10, fiberG: 1 },
  { name: 'Idli', caloriesPer100g: 132, proteinG: 4, carbsG: 27, fatG: 0.5, fiberG: 1.5 },
  { name: 'Dosa (plain)', caloriesPer100g: 168, proteinG: 3.9, carbsG: 28, fatG: 4, fiberG: 1 },
  { name: 'Masala Dosa', caloriesPer100g: 195, proteinG: 4.5, carbsG: 32, fatG: 5.5, fiberG: 2 },
  { name: 'Upma', caloriesPer100g: 145, proteinG: 3.5, carbsG: 22, fatG: 5, fiberG: 1.5 },
  { name: 'Poha', caloriesPer100g: 130, proteinG: 2.5, carbsG: 24, fatG: 3, fiberG: 1 },
  { name: 'Sambar', caloriesPer100g: 75, proteinG: 3.5, carbsG: 11, fatG: 2, fiberG: 2.5 },
  { name: 'Curd (dahi)', caloriesPer100g: 60, proteinG: 3.5, carbsG: 4.7, fatG: 3.3, fiberG: 0 },
  { name: 'Lassi', caloriesPer100g: 90, proteinG: 3, carbsG: 12, fatG: 3, fiberG: 0 },
  { name: 'Chole Bhature', caloriesPer100g: 280, proteinG: 7, carbsG: 34, fatG: 13, fiberG: 4 },
  { name: 'Aloo Gobi', caloriesPer100g: 110, proteinG: 3, carbsG: 15, fatG: 5, fiberG: 3 },
  { name: 'Baingan Bharta', caloriesPer100g: 95, proteinG: 2, carbsG: 10, fatG: 5, fiberG: 3.5 },
  { name: 'Bhindi Masala', caloriesPer100g: 105, proteinG: 2.5, carbsG: 11, fatG: 6, fiberG: 3.5 },
  {
    name: 'Mixed Vegetable Sabzi',
    caloriesPer100g: 100,
    proteinG: 3,
    carbsG: 12,
    fatG: 4.5,
    fiberG: 3,
  },
  {
    name: 'Biryani (chicken)',
    caloriesPer100g: 200,
    proteinG: 10,
    carbsG: 24,
    fatG: 7,
    fiberG: 1.5,
  },
  {
    name: 'Biryani (vegetable)',
    caloriesPer100g: 175,
    proteinG: 4,
    carbsG: 28,
    fatG: 5.5,
    fiberG: 2,
  },
  { name: 'Khichdi', caloriesPer100g: 120, proteinG: 4.5, carbsG: 20, fatG: 2.5, fiberG: 2 },
  { name: 'Samosa', caloriesPer100g: 260, proteinG: 4.5, carbsG: 28, fatG: 15, fiberG: 2 },
  { name: 'Pakora', caloriesPer100g: 280, proteinG: 6, carbsG: 25, fatG: 18, fiberG: 3 },
  { name: 'Sprouts Salad', caloriesPer100g: 90, proteinG: 7, carbsG: 13, fatG: 1, fiberG: 4 },
  { name: 'Moong Dal Chilla', caloriesPer100g: 140, proteinG: 9, carbsG: 18, fatG: 4, fiberG: 4 },
  { name: 'Ragi Roti', caloriesPer100g: 250, proteinG: 8, carbsG: 46, fatG: 4, fiberG: 9 },
  { name: 'Ghee', caloriesPer100g: 900, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0 },
  { name: 'Coconut Chutney', caloriesPer100g: 200, proteinG: 3, carbsG: 8, fatG: 18, fiberG: 3 },
  { name: 'Buttermilk (chaas)', caloriesPer100g: 30, proteinG: 1.5, carbsG: 3, fatG: 1, fiberG: 0 },
  { name: 'Paneer Tikka', caloriesPer100g: 230, proteinG: 15, carbsG: 6, fatG: 16, fiberG: 1 },
  { name: 'Fish Curry', caloriesPer100g: 145, proteinG: 17, carbsG: 4, fatG: 7, fiberG: 0.5 },
  { name: 'Mutton Curry', caloriesPer100g: 220, proteinG: 18, carbsG: 5, fatG: 15, fiberG: 1 },
  { name: 'Paratha (plain)', caloriesPer100g: 320, proteinG: 7, carbsG: 43, fatG: 13, fiberG: 4 },
  { name: 'Aloo Paratha', caloriesPer100g: 290, proteinG: 6, carbsG: 40, fatG: 12, fiberG: 3.5 },
  { name: 'Rasam', caloriesPer100g: 40, proteinG: 1.5, carbsG: 6, fatG: 1, fiberG: 1 },
  { name: 'Kadhi', caloriesPer100g: 85, proteinG: 3, carbsG: 8, fatG: 4.5, fiberG: 0.5 },
  { name: 'Vegetable Pulao', caloriesPer100g: 160, proteinG: 3.5, carbsG: 26, fatG: 5, fiberG: 2 },
  { name: 'Egg Bhurji', caloriesPer100g: 165, proteinG: 12, carbsG: 3, fatG: 12, fiberG: 0.5 },
  { name: 'Papad (roasted)', caloriesPer100g: 350, proteinG: 22, carbsG: 55, fatG: 3, fiberG: 4 },
  { name: 'Pickle (achaar)', caloriesPer100g: 240, proteinG: 1.5, carbsG: 12, fatG: 20, fiberG: 3 },
  // Western
  {
    name: 'Chicken Breast (grilled)',
    caloriesPer100g: 165,
    proteinG: 31,
    carbsG: 0,
    fatG: 3.6,
    fiberG: 0,
  },
  {
    name: 'Ground Beef 90/10 (cooked)',
    caloriesPer100g: 217,
    proteinG: 26,
    carbsG: 0,
    fatG: 12,
    fiberG: 0,
  },
  { name: 'Salmon (baked)', caloriesPer100g: 208, proteinG: 20, carbsG: 0, fatG: 13, fiberG: 0 },
  {
    name: 'Egg (whole, boiled)',
    caloriesPer100g: 155,
    proteinG: 13,
    carbsG: 1.1,
    fatG: 11,
    fiberG: 0,
  },
  { name: 'Egg Whites', caloriesPer100g: 52, proteinG: 11, carbsG: 0.7, fatG: 0.2, fiberG: 0 },
  {
    name: 'Greek Yogurt (plain, non-fat)',
    caloriesPer100g: 59,
    proteinG: 10,
    carbsG: 3.6,
    fatG: 0.4,
    fiberG: 0,
  },
  {
    name: 'Whey Protein Powder',
    caloriesPer100g: 400,
    proteinG: 80,
    carbsG: 8,
    fatG: 6,
    fiberG: 1,
  },
  {
    name: 'Rolled Oats (dry)',
    caloriesPer100g: 389,
    proteinG: 16.9,
    carbsG: 66,
    fatG: 6.9,
    fiberG: 10.6,
  },
  {
    name: 'White Rice (cooked)',
    caloriesPer100g: 130,
    proteinG: 2.7,
    carbsG: 28,
    fatG: 0.3,
    fiberG: 0.4,
  },
  {
    name: 'Brown Rice (cooked)',
    caloriesPer100g: 112,
    proteinG: 2.6,
    carbsG: 24,
    fatG: 0.9,
    fiberG: 1.8,
  },
  {
    name: 'Sweet Potato (baked)',
    caloriesPer100g: 90,
    proteinG: 2,
    carbsG: 21,
    fatG: 0.1,
    fiberG: 3.3,
  },
  {
    name: 'Potato (baked)',
    caloriesPer100g: 93,
    proteinG: 2.5,
    carbsG: 21,
    fatG: 0.1,
    fiberG: 2.2,
  },
  {
    name: 'Broccoli (steamed)',
    caloriesPer100g: 35,
    proteinG: 2.4,
    carbsG: 7.2,
    fatG: 0.4,
    fiberG: 3.3,
  },
  {
    name: 'Spinach (raw)',
    caloriesPer100g: 23,
    proteinG: 2.9,
    carbsG: 3.6,
    fatG: 0.4,
    fiberG: 2.2,
  },
  { name: 'Banana', caloriesPer100g: 89, proteinG: 1.1, carbsG: 23, fatG: 0.3, fiberG: 2.6 },
  { name: 'Apple', caloriesPer100g: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2, fiberG: 2.4 },
  { name: 'Blueberries', caloriesPer100g: 57, proteinG: 0.7, carbsG: 14.5, fatG: 0.3, fiberG: 2.4 },
  { name: 'Almonds', caloriesPer100g: 579, proteinG: 21, carbsG: 22, fatG: 50, fiberG: 12.5 },
  { name: 'Peanut Butter', caloriesPer100g: 588, proteinG: 25, carbsG: 20, fatG: 50, fiberG: 6 },
  { name: 'Avocado', caloriesPer100g: 160, proteinG: 2, carbsG: 8.5, fatG: 15, fiberG: 6.7 },
  { name: 'Olive Oil', caloriesPer100g: 884, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0 },
  { name: 'Whole Milk', caloriesPer100g: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3, fiberG: 0 },
  { name: 'Skim Milk', caloriesPer100g: 34, proteinG: 3.4, carbsG: 5, fatG: 0.1, fiberG: 0 },
  { name: 'Cheddar Cheese', caloriesPer100g: 403, proteinG: 25, carbsG: 1.3, fatG: 33, fiberG: 0 },
  { name: 'Cottage Cheese', caloriesPer100g: 98, proteinG: 11, carbsG: 3.4, fatG: 4.3, fiberG: 0 },
  {
    name: 'Whole Wheat Bread',
    caloriesPer100g: 247,
    proteinG: 13,
    carbsG: 41,
    fatG: 3.4,
    fiberG: 7,
  },
  { name: 'White Bread', caloriesPer100g: 265, proteinG: 9, carbsG: 49, fatG: 3.2, fiberG: 2.7 },
  { name: 'Pasta (cooked)', caloriesPer100g: 131, proteinG: 5, carbsG: 25, fatG: 1.1, fiberG: 1.8 },
  {
    name: 'Quinoa (cooked)',
    caloriesPer100g: 120,
    proteinG: 4.4,
    carbsG: 21,
    fatG: 1.9,
    fiberG: 2.8,
  },
  {
    name: 'Black Beans (cooked)',
    caloriesPer100g: 132,
    proteinG: 8.9,
    carbsG: 24,
    fatG: 0.5,
    fiberG: 8.7,
  },
  {
    name: 'Lentils (cooked)',
    caloriesPer100g: 116,
    proteinG: 9,
    carbsG: 20,
    fatG: 0.4,
    fiberG: 7.9,
  },
  {
    name: 'Chickpeas (cooked)',
    caloriesPer100g: 164,
    proteinG: 8.9,
    carbsG: 27,
    fatG: 2.6,
    fiberG: 7.6,
  },
  {
    name: 'Tofu (firm)',
    caloriesPer100g: 144,
    proteinG: 15.5,
    carbsG: 3.9,
    fatG: 8.7,
    fiberG: 2.3,
  },
  {
    name: 'Turkey Breast (roasted)',
    caloriesPer100g: 135,
    proteinG: 30,
    carbsG: 0,
    fatG: 1,
    fiberG: 0,
  },
  {
    name: 'Tuna (canned in water)',
    caloriesPer100g: 116,
    proteinG: 26,
    carbsG: 0,
    fatG: 0.8,
    fiberG: 0,
  },
  { name: 'Shrimp (cooked)', caloriesPer100g: 99, proteinG: 24, carbsG: 0.2, fatG: 0.3, fiberG: 0 },
  {
    name: 'Pork Chop (grilled)',
    caloriesPer100g: 231,
    proteinG: 26,
    carbsG: 0,
    fatG: 14,
    fiberG: 0,
  },
  { name: 'Bacon (cooked)', caloriesPer100g: 541, proteinG: 37, carbsG: 1.4, fatG: 42, fiberG: 0 },
  { name: 'Pizza (cheese)', caloriesPer100g: 266, proteinG: 11, carbsG: 33, fatG: 10, fiberG: 2.3 },
  {
    name: 'Hamburger (beef, bun)',
    caloriesPer100g: 250,
    proteinG: 14,
    carbsG: 22,
    fatG: 12,
    fiberG: 1.5,
  },
  { name: 'French Fries', caloriesPer100g: 312, proteinG: 3.4, carbsG: 41, fatG: 15, fiberG: 3.8 },
  {
    name: 'Ice Cream (vanilla)',
    caloriesPer100g: 207,
    proteinG: 3.5,
    carbsG: 24,
    fatG: 11,
    fiberG: 0.7,
  },
  {
    name: 'Dark Chocolate (70%)',
    caloriesPer100g: 598,
    proteinG: 7.8,
    carbsG: 45.9,
    fatG: 42.6,
    fiberG: 10.9,
  },
  { name: 'Granola Bar', caloriesPer100g: 471, proteinG: 10, carbsG: 64, fatG: 20, fiberG: 5 },
  { name: 'Protein Bar', caloriesPer100g: 380, proteinG: 30, carbsG: 38, fatG: 12, fiberG: 8 },
  { name: 'Orange', caloriesPer100g: 47, proteinG: 0.9, carbsG: 12, fatG: 0.1, fiberG: 2.4 },
  { name: 'Strawberries', caloriesPer100g: 32, proteinG: 0.7, carbsG: 7.7, fatG: 0.3, fiberG: 2 },
  { name: 'Grapes', caloriesPer100g: 69, proteinG: 0.7, carbsG: 18, fatG: 0.2, fiberG: 0.9 },
  { name: 'Carrots (raw)', caloriesPer100g: 41, proteinG: 0.9, carbsG: 10, fatG: 0.2, fiberG: 2.8 },
  {
    name: 'Bell Pepper (raw)',
    caloriesPer100g: 31,
    proteinG: 1,
    carbsG: 6,
    fatG: 0.3,
    fiberG: 2.1,
  },
  { name: 'Walnuts', caloriesPer100g: 654, proteinG: 15.2, carbsG: 13.7, fatG: 65.2, fiberG: 6.7 },
];

const BRAND_SUFFIXES = ['Fresh', 'Naturals', 'Organic', 'Kitchen', 'Farms'];

// A lookup entry, not a row mirror — see exercises.ts's `SeededExercise`
// comment for why this isn't named `id`.
export type SeededFood = {
  foodId: string;
  name: string;
  caloriesPer100g: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** No dependencies on any other seed module — runs any time before nutrition-history.ts. */
export async function seedFoods(tx: Transaction): Promise<SeededFood[]> {
  const rows: (typeof foods.$inferInsert)[] = [];
  const seeded: SeededFood[] = [];

  for (const [baseIndex, base] of BASE_FOODS.entries()) {
    // Variant 0: the generic/verified entry, no brand — what a search for
    // the plain food name should surface first (`usage_count` breaks ties).
    // Variants 1-4: branded, one per BRAND_SUFFIXES entry.
    for (let variantIndex = 0; variantIndex < 5; variantIndex += 1) {
      const isGeneric = variantIndex === 0;
      const brand = isGeneric
        ? null
        : `${faker.company.name().split(' ')[0]} ${BRAND_SUFFIXES[variantIndex - 1]}`;
      const key = `food:${baseIndex}:${variantIndex}`;
      const source = isGeneric ? 'verified' : variantIndex % 2 === 0 ? 'openfoodfacts' : 'usda';

      rows.push({
        id: seedId(key),
        source,
        externalId: `${source}-${baseIndex}-${variantIndex}`,
        barcode: isGeneric ? null : faker.string.numeric(13),
        name: base.name,
        brand,
        servingSizeG: '100.00',
        servingLabel: '100 g',
        caloriesPer100g: base.caloriesPer100g.toFixed(2),
        proteinG: base.proteinG.toFixed(2),
        carbsG: base.carbsG.toFixed(2),
        fatG: base.fatG.toFixed(2),
        fiberG: base.fiberG !== undefined ? base.fiberG.toFixed(2) : null,
        sodiumMg: base.sodiumMg !== undefined ? base.sodiumMg.toFixed(2) : null,
        isVerified: isGeneric,
        usageCount: isGeneric
          ? faker.number.int({ min: 50, max: 400 })
          : faker.number.int({ min: 0, max: 120 }),
        createdAt: FOODS_CREATED_AT,
        updatedAt: FOODS_CREATED_AT,
      });

      seeded.push({
        foodId: seedId(key),
        name: base.name,
        caloriesPer100g: base.caloriesPer100g,
        proteinG: base.proteinG,
        carbsG: base.carbsG,
        fatG: base.fatG,
      });
    }
  }

  await tx.insert(foods).values(rows);
  return seeded;
}
