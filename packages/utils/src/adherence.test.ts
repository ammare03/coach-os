import {
  ADHERENCE_TOKEN,
  adherenceColor,
  adherenceState,
  computeNutritionAdherence,
  computeOverallAdherence,
  computeTrainingAdherence,
  type NutritionDay,
} from './adherence.ts';

// Every threshold boundary, both sides — off-by-one on a threshold is
// invisible in a screenshot and obvious in a test (theme-tokens/05 approach §1).
describe('adherenceState', () => {
  it('is no-data for null, and null only', () => {
    expect(adherenceState(null)).toBe('no-data');
  });

  it('is on-track at and above 85', () => {
    expect(adherenceState(85)).toBe('on-track');
    expect(adherenceState(100)).toBe('on-track');
  });

  it('is drifting just under 85, down to 70', () => {
    expect(adherenceState(84.9)).toBe('drifting');
    expect(adherenceState(70)).toBe('drifting');
  });

  it('is off-track just under 70, and at 0', () => {
    expect(adherenceState(69.9)).toBe('off-track');
    expect(adherenceState(0)).toBe('off-track');
  });

  it('maps every state to its DS§2.5 token name', () => {
    expect(ADHERENCE_TOKEN['on-track']).toBe('onTrack');
    expect(ADHERENCE_TOKEN.drifting).toBe('drifting');
    expect(ADHERENCE_TOKEN['off-track']).toBe('offTrack');
    expect(ADHERENCE_TOKEN['no-data']).toBe('noData');
  });
});

describe('computeTrainingAdherence', () => {
  it('is the completed share of scheduled, as a percentage', () => {
    expect(computeTrainingAdherence(4, 5)).toBe(80);
    expect(computeTrainingAdherence(5, 5)).toBe(100);
  });

  it('is 0, not null, when sessions were scheduled and none were completed', () => {
    expect(computeTrainingAdherence(0, 4)).toBe(0);
  });

  it('is null, not 0, when nothing was scheduled', () => {
    expect(computeTrainingAdherence(0, 0)).toBeNull();
  });

  it('is null when a count is not a finite number', () => {
    expect(computeTrainingAdherence(Number.NaN, 5)).toBeNull();
    expect(computeTrainingAdherence(4, Number.NaN)).toBeNull();
  });

  it('does not cap a client who trained more often than scheduled', () => {
    expect(computeTrainingAdherence(6, 5)).toBe(120);
  });
});

describe('computeNutritionAdherence', () => {
  const day = (
    hasLogging: boolean,
    withinCalorieRange: boolean,
    meetsProteinTarget: boolean,
  ): NutritionDay => ({ hasLogging, withinCalorieRange, meetsProteinTarget });

  it('is the share of logged days hitting both calories and protein', () => {
    expect(
      computeNutritionAdherence([
        day(true, true, true),
        day(true, true, true),
        day(true, true, true),
        day(true, false, true),
      ]),
    ).toBe(75);
  });

  it('needs both targets — either alone is not an adherent day', () => {
    expect(computeNutritionAdherence([day(true, true, false)])).toBe(0);
    expect(computeNutritionAdherence([day(true, false, true)])).toBe(0);
  });

  it('counts only days with logging in the denominator', () => {
    expect(
      computeNutritionAdherence([
        day(true, true, true),
        day(true, true, true),
        day(false, false, false),
        day(false, false, false),
        day(false, false, false),
      ]),
    ).toBe(100);
  });

  it('is null, not 0, when no day in the window has any logging', () => {
    expect(computeNutritionAdherence([])).toBeNull();
    expect(
      computeNutritionAdherence([day(false, false, false), day(false, true, true)]),
    ).toBeNull();
  });
});

describe('computeOverallAdherence', () => {
  it('weights training 60% and nutrition 40%', () => {
    expect(computeOverallAdherence(100, 50)).toBeCloseTo(80);
    expect(computeOverallAdherence(100, 100)).toBeCloseTo(100);
  });

  it('falls back to the one dimension that has data, never zero-filling the other', () => {
    expect(computeOverallAdherence(100, null)).toBe(100);
    expect(computeOverallAdherence(null, 50)).toBe(50);
  });

  it('treats a real 0 as data, not as missing', () => {
    expect(computeOverallAdherence(0, 100)).toBeCloseTo(40);
    expect(computeOverallAdherence(100, 0)).toBeCloseTo(60);
  });

  it('is null when neither dimension has data', () => {
    expect(computeOverallAdherence(null, null)).toBeNull();
  });
});

describe('adherenceColor', () => {
  it('is grey for no data', () => {
    expect(adherenceColor(null)).toBe('grey');
  });

  it('is green at and above 85', () => {
    expect(adherenceColor(85)).toBe('green');
    expect(adherenceColor(100)).toBe('green');
  });

  it('is amber from 70 up to but not including 85', () => {
    expect(adherenceColor(84)).toBe('amber');
    expect(adherenceColor(70)).toBe('amber');
  });

  it('is red below 70', () => {
    expect(adherenceColor(69)).toBe('red');
    expect(adherenceColor(0)).toBe('red');
  });

  it('agrees with adherenceState, so the thresholds live in exactly one place', () => {
    for (const score of [null, 100, 85, 84.9, 70, 69.9, 0]) {
      expect(adherenceColor(score)).toBe(
        { 'on-track': 'green', drifting: 'amber', 'off-track': 'red', 'no-data': 'grey' }[
          adherenceState(score)
        ],
      );
    }
  });
});
