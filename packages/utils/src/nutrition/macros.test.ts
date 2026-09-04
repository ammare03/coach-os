import { KCAL_PER_GRAM, macroKcal } from './macros.ts';

describe('KCAL_PER_GRAM', () => {
  it('uses the Atwater general factors, not rounded physiological ones', () => {
    expect(KCAL_PER_GRAM).toEqual({ protein: 4, carbs: 4, fat: 9 });
  });
});

describe('macroKcal', () => {
  it('converts each macro at its own factor', () => {
    const result = macroKcal({ proteinG: 180, carbsG: 240, fatG: 70 });

    expect(result.proteinKcal).toBe(720);
    expect(result.carbsKcal).toBe(960);
    expect(result.fatKcal).toBe(630);
  });

  it('totals the three contributions', () => {
    expect(macroKcal({ proteinG: 180, carbsG: 240, fatG: 70 }).totalKcal).toBe(2310);
  });

  it('makes a gram of fat worth more than twice a gram of protein', () => {
    // The reason `MacroBar` sizes its segments on calories and not on grams
    // (`ui-primitives-data/02`): 40g of fat is not visually equal to 40g of
    // protein on a plate, and a bar drawn on grams says it is.
    const fat = macroKcal({ proteinG: 0, carbsG: 0, fatG: 40 }).totalKcal;
    const protein = macroKcal({ proteinG: 40, carbsG: 0, fatG: 0 }).totalKcal;

    expect(fat).toBeGreaterThan(protein * 2);
  });

  it('returns zero for an untouched day', () => {
    expect(macroKcal({ proteinG: 0, carbsG: 0, fatG: 0 })).toEqual({
      proteinKcal: 0,
      carbsKcal: 0,
      fatKcal: 0,
      totalKcal: 0,
    });
  });

  it('clamps a negative gram value to zero rather than drawing a bar backwards', () => {
    expect(macroKcal({ proteinG: -10, carbsG: 100, fatG: 0 })).toEqual({
      proteinKcal: 0,
      carbsKcal: 400,
      fatKcal: 0,
      totalKcal: 400,
    });
  });

  it('clamps NaN and Infinity to zero so a total is never NaN', () => {
    expect(macroKcal({ proteinG: Number.NaN, carbsG: Number.POSITIVE_INFINITY, fatG: 10 })).toEqual(
      {
        proteinKcal: 0,
        carbsKcal: 0,
        fatKcal: 90,
        totalKcal: 90,
      },
    );
  });
});
