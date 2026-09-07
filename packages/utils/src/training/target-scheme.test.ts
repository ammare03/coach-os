import {
  formatIntensity,
  formatIntensityShort,
  formatRepRange,
  formatRestSeconds,
  formatTargetScheme,
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
    expect(formatIntensity(target({ targetRpe: 8 }))).toBe('RPE 8');
    expect(formatIntensity(target({ targetRpe: 7.5 }))).toBe('RPE 7.5');
  });

  it('names RIR and % 1RM in the coach’s own vocabulary', () => {
    expect(formatIntensity(target({ targetRir: 2 }))).toBe('RIR 2');
    expect(formatIntensity(target({ targetRir: 1.5 }))).toBe('RIR 1.5');
    expect(formatIntensity(target({ targetPercent1rm: 65 }))).toBe('65% 1RM');
    expect(formatIntensity(target({ targetPercent1rm: 72.5 }))).toBe('72.5% 1RM');
  });

  it('is null when the coach chose no intensity', () => {
    expect(formatIntensity(EMPTY)).toBeNull();
  });
});

describe('formatIntensityShort', () => {
  it('drops "1RM" for the 46px chip and leaves RPE and RIR alone', () => {
    expect(formatIntensityShort(target({ targetPercent1rm: 65 }))).toBe('65%');
    expect(formatIntensityShort(target({ targetRpe: 8 }))).toBe('RPE 8');
    expect(formatIntensityShort(target({ targetRir: 2 }))).toBe('RIR 2');
    expect(formatIntensityShort(EMPTY)).toBeNull();
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
      formatTargetScheme({
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetRpe: 8,
        targetRir: null,
        targetPercent1rm: null,
        tempo: '3010',
        targetRestSeconds: 90,
      }),
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
      ),
    ).toBe('3 × 10–12 · 65% 1RM · 60s');
  });

  it('says "sets" when there is no rep count, and singularises one set', () => {
    expect(formatTargetScheme(target({ targetSets: 3 }))).toBe('3 sets');
    expect(formatTargetScheme(target({ targetSets: 1 }))).toBe('1 set');
    expect(formatTargetScheme(target({ targetSets: 1, targetRestSeconds: 180 }))).toBe(
      '1 set · 3m',
    );
  });

  it('treats an empty tempo string as absent rather than as a segment', () => {
    expect(formatTargetScheme(target({ targetSets: 4, tempo: '' }))).toBe('4 sets');
  });
});
