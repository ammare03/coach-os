import {
  formatIntensity,
  formatIntensityShort,
  formatLoggerTarget,
  formatRepRange,
  formatRestSeconds,
  formatTargetScheme,
  formatWeightTarget,
  type ExerciseTarget,
} from './target-scheme.ts';

// This string is read by two people who never see each other's screen — the
// coach writing the program and the client mid-set. The assertions below are
// the design's own literals (`ProgramBuilder.dc.html`, frame 1b), character
// for character, because "close enough" here means the two surfaces have
// quietly stopped agreeing.

const EMPTY: ExerciseTarget = {
  targetSets: 3,
  targetRepsMin: null,
  targetRepsMax: null,
  targetRpe: null,
  targetRir: null,
  targetPercent1rm: null,
  targetWeightKg: null,
  tempo: null,
  targetRestSeconds: null,
};

function target(overrides: Partial<ExerciseTarget> = {}): ExerciseTarget {
  return { ...EMPTY, ...overrides };
}

describe('formatRepRange', () => {
  it('renders a range with an en dash', () => {
    expect(formatRepRange(6, 8)).toBe('6–8');
  });

  it('collapses a range with no width to one number', () => {
    expect(formatRepRange(5, 5)).toBe('5');
  });

  it('is null when no reps were set at all', () => {
    expect(formatRepRange(null, null)).toBeNull();
  });

  // DB§5.2's cross-column CHECK and the schema's both-or-neither rule make
  // this unreachable through any procedure; it is still the honest answer
  // for a half-written row rather than dropping the number that exists.
  it('shows the surviving number when only one end is set', () => {
    expect(formatRepRange(null, 8)).toBe('8');
    expect(formatRepRange(6, null)).toBe('6');
  });
});

describe('formatIntensity', () => {
  it('drops the decimal on a whole RPE and keeps it on a half step', () => {
    expect(formatIntensity(target({ targetRpe: 8 }), 'kg')).toBe('RPE 8');
    expect(formatIntensity(target({ targetRpe: 7.5 }), 'kg')).toBe('RPE 7.5');
  });

  it('names RIR and % 1RM in the coach’s own vocabulary', () => {
    expect(formatIntensity(target({ targetRir: 2 }), 'kg')).toBe('RIR 2');
    expect(formatIntensity(target({ targetRir: 1.5 }), 'kg')).toBe('RIR 1.5');
    expect(formatIntensity(target({ targetPercent1rm: 65 }), 'kg')).toBe('65% 1RM');
    expect(formatIntensity(target({ targetPercent1rm: 72.5 }), 'kg')).toBe('72.5% 1RM');
  });

  it('renders an absolute load in the reader’s own unit, from one stored kilogram value', () => {
    const block = target({ targetWeightKg: 100 });

    expect(formatIntensity(block, 'kg')).toBe('100kg');
    // 100 kg is 220.46 lb; `formatWeight` is the only thing that rounds it.
    expect(formatIntensity(block, 'lb')).toBe('220lb');
  });

  it('keeps a half-plate in kg and never pads a whole one', () => {
    expect(formatIntensity(target({ targetWeightKg: 62.5 }), 'kg')).toBe('62.5kg');
    expect(formatIntensity(target({ targetWeightKg: 40 }), 'kg')).toBe('40kg');
    // Stored at the column's own scale; the line does not print 40.00kg.
    expect(formatIntensity(target({ targetWeightKg: 40.0 }), 'kg')).toBe('40kg');
  });

  it('is null when the coach chose no intensity', () => {
    expect(formatIntensity(EMPTY, 'kg')).toBeNull();
  });
});

describe('formatWeightTarget', () => {
  it('is the same rounding every other weight in the product gets', () => {
    expect(formatWeightTarget(102.06, 'lb')).toBe('225lb');
    expect(formatWeightTarget(102.06, 'kg')).toBe('102.1kg');
  });
});

describe('formatIntensityShort', () => {
  it('drops "1RM" for the 46px chip and leaves RPE and RIR alone', () => {
    expect(formatIntensityShort(target({ targetPercent1rm: 65 }), 'kg')).toBe('65%');
    expect(formatIntensityShort(target({ targetRpe: 8 }), 'kg')).toBe('RPE 8');
    expect(formatIntensityShort(target({ targetRir: 2 }), 'kg')).toBe('RIR 2');
    expect(formatIntensityShort(EMPTY, 'kg')).toBeNull();
  });

  // A bare `100` under a rep count reads as more reps, so the unit stays.
  it('keeps the unit on a weight even in the 46px chip', () => {
    expect(formatIntensityShort(target({ targetWeightKg: 100 }), 'kg')).toBe('100kg');
    expect(formatIntensityShort(target({ targetWeightKg: 100 }), 'lb')).toBe('220lb');
  });
});

describe('formatRestSeconds', () => {
  it('reads in seconds below two minutes — 90s, never 1m 30s', () => {
    expect(formatRestSeconds(45)).toBe('45s');
    expect(formatRestSeconds(60)).toBe('60s');
    expect(formatRestSeconds(90)).toBe('90s');
  });

  it('reads in minutes at or above two', () => {
    expect(formatRestSeconds(120)).toBe('2m');
    expect(formatRestSeconds(180)).toBe('3m');
    expect(formatRestSeconds(150)).toBe('2m 30s');
  });

  it('is null when no rest was set', () => {
    expect(formatRestSeconds(null)).toBeNull();
  });
});

describe('formatTargetScheme', () => {
  it('renders the design’s own line, separator for separator', () => {
    expect(
      formatTargetScheme(
        {
          targetSets: 4,
          targetRepsMin: 6,
          targetRepsMax: 8,
          targetRpe: 8,
          targetRir: null,
          targetPercent1rm: null,
          targetWeightKg: null,
          tempo: '3010',
          targetRestSeconds: 90,
        },
        'kg',
      ),
    ).toBe('4 × 6–8 · RPE 8 · 3010 · 90s');
  });

  it('leaves no dangling separator where a part is absent', () => {
    expect(
      formatTargetScheme(
        target({
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetRpe: 7,
          targetRestSeconds: 90,
        }),
        'kg',
      ),
    ).toBe('3 × 8–10 · RPE 7 · 90s');

    expect(
      formatTargetScheme(
        target({
          targetSets: 3,
          targetRepsMin: 10,
          targetRepsMax: 12,
          targetPercent1rm: 65,
          targetRestSeconds: 60,
        }),
        'kg',
      ),
    ).toBe('3 × 10–12 · 65% 1RM · 60s');
  });

  it('says "sets" when there is no rep count, and singularises one set', () => {
    expect(formatTargetScheme(target({ targetSets: 3 }), 'kg')).toBe('3 sets');
    expect(formatTargetScheme(target({ targetSets: 1 }), 'kg')).toBe('1 set');
    expect(formatTargetScheme(target({ targetSets: 1, targetRestSeconds: 180 }), 'kg')).toBe(
      '1 set · 3m',
    );
  });

  // The line this amendment exists for: a beginner's first block, where
  // RPE and % 1RM both presume a working load the client does not have yet.
  it('renders an absolute load where the intensity goes', () => {
    const block = target({
      targetSets: 3,
      targetRepsMin: 5,
      targetRepsMax: 5,
      targetWeightKg: 100,
      targetRestSeconds: 90,
    });

    expect(formatTargetScheme(block, 'kg')).toBe('3 × 5 · 100kg · 90s');
    // Same row, same stored kilograms, a coach who reads in pounds.
    expect(formatTargetScheme(block, 'lb')).toBe('3 × 5 · 220lb · 90s');
  });

  it('treats an empty tempo string as absent rather than as a segment', () => {
    expect(formatTargetScheme(target({ targetSets: 4, tempo: '' }), 'kg')).toBe('4 sets');
  });
});

// `formatLoggerTarget` is the client's half of this module's contract: the
// same block, the same numbers, punctuated for a 393pt screen read mid-set.
// `CLAUDE.md` §8.4 writes the example out — "3×8–10 @ RPE 8" — and
// `phase-07-.../assignment/04` verifies its bulk edit by watching this
// exact string change, so these are literals rather than shapes.
describe('formatLoggerTarget', () => {
  it('renders §8.4’s example', () => {
    expect(
      formatLoggerTarget(
        target({ targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: 8 }),
        'kg',
      ),
    ).toBe('3 × 8–10 @ RPE 8');
  });

  it('drops tempo and rest, which the builder line carries and the logger does not', () => {
    const block = target({
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 8.5,
      tempo: '3010',
      targetRestSeconds: 120,
    });

    // The one assertion that pins the two lines apart. Same volume, same
    // intensity, same numbers — a different set of parts.
    expect(formatTargetScheme(block, 'kg')).toBe('4 × 6–8 · RPE 8.5 · 3010 · 2m');
    expect(formatLoggerTarget(block, 'kg')).toBe('4 × 6–8 @ RPE 8.5');
  });

  it('renders RIR where a coach prescribed reps in reserve', () => {
    expect(
      formatLoggerTarget(
        target({ targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRir: 2 }),
        'kg',
      ),
    ).toBe('3 × 8 @ RIR 2');
  });

  it('leaves no dangling @ when the block prescribes no intensity', () => {
    expect(
      formatLoggerTarget(target({ targetSets: 4, targetRepsMin: 15, targetRepsMax: 15 }), 'kg'),
    ).toBe('4 × 15');
  });

  it('reads a rep-less block as sets, which is a real instruction', () => {
    expect(formatLoggerTarget(target({ targetSets: 3, targetRpe: 7 }), 'kg')).toBe(
      '3 sets @ RPE 7',
    );
    expect(formatLoggerTarget(target({ targetSets: 1 }), 'kg')).toBe('1 set');
  });

  it('spells an absolute load in the reader’s unit, from the same stored kilograms', () => {
    const block = target({
      targetSets: 3,
      targetRepsMin: 5,
      targetRepsMax: 5,
      targetWeightKg: 100,
    });

    expect(formatLoggerTarget(block, 'kg')).toBe('3 × 5 @ 100kg');
    expect(formatLoggerTarget(block, 'lb')).toBe('3 × 5 @ 220lb');
  });
});
