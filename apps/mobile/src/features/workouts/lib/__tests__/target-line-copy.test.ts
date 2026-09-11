import type { ExerciseTarget } from '@coachos/utils';

import type { LastPerformance } from '../last-performance.ts';
import {
  labelLastPerformance,
  labelTarget,
  lastTimePrefix,
  speakTargetLine,
  targetSeparator,
  NO_HISTORY_LABEL,
} from '../target-line-copy.ts';

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

function last(overrides: Partial<LastPerformance> = {}): LastPerformance {
  return {
    weightKg: 60,
    reps: 9,
    loggedAt: new Date('2026-08-08T18:00:00.000Z'),
    ...overrides,
  };
}

const FULL = target({ targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRpe: 8 });

describe('the printed line', () => {
  // `CLAUDE.md` §8.4, assembled from its parts. This is the string
  // `phase-07-.../assignment/04` verifies its bulk edit against.
  it('spells §8.4’s example', () => {
    const printed = [
      labelTarget(FULL, 'kg'),
      targetSeparator(true, true),
      lastTimePrefix(),
      labelLastPerformance(last(), 'kg'),
    ].join(' ');

    expect(printed).toBe('3 × 8–10 @ RPE 8 · last time: 60kg × 9');
  });

  it('has no target at all for an ad-hoc block', () => {
    expect(labelTarget(null, 'kg')).toBeNull();
  });

  it('prints no separator when there is only one half to print', () => {
    expect(targetSeparator(false, true)).toBeNull();
    expect(targetSeparator(true, false)).toBeNull();
  });

  it('reads a bodyweight set as reps, and a loaded set with no reps as a load', () => {
    expect(labelLastPerformance(last({ weightKg: null, reps: 12 }), 'kg')).toBe('12 reps');
    expect(labelLastPerformance(last({ weightKg: 60, reps: null }), 'kg')).toBe('60kg');
  });

  // The unit is display only; the stored kilograms never change
  // (`CLAUDE.md` hard rule, DB§5.1.1).
  it('spells one stored weight in whichever unit the client reads', () => {
    expect(labelLastPerformance(last({ weightKg: 100, reps: 5 }), 'kg')).toBe('100kg × 5');
    expect(labelLastPerformance(last({ weightKg: 100, reps: 5 }), 'lb')).toBe('220lb × 5');
  });

  // `COPY.md` §CO2. An absence is a fact, never a shortfall — no "0 sets",
  // no "no history", no encouragement.
  it('states an absent history without scolding or cheering', () => {
    expect(NO_HISTORY_LABEL).toBe('first time logging this');
    expect(NO_HISTORY_LABEL).not.toMatch(/!|never|missed|yet to|0 /i);
  });
});

describe('speakTargetLine', () => {
  // A screen reader makes very little of "3 × 8–10 @ RPE 8", and this is the
  // one line where a misread is a client loading the wrong weight
  // (`accessibility` §8).
  it('expands every glyph into words', () => {
    expect(speakTargetLine(FULL, last(), 'kg')).toBe(
      'Target: 3 sets of 8 to 10 reps at RPE 8. Last time: 60 kilograms for 9 reps.',
    );
  });

  it('says pounds for a client who reads in pounds', () => {
    expect(speakTargetLine(null, last({ weightKg: 100, reps: 5 }), 'lb')).toBe(
      'Last time: 220 pounds for 5 reps.',
    );
  });

  it('names RIR in full rather than as an initialism', () => {
    expect(
      speakTargetLine(
        target({ targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetRir: 2 }),
        null,
        'kg',
      ),
    ).toBe('Target: 3 sets of 8 reps at 2 reps in reserve. First time logging this exercise.');
  });

  it('reads a percentage target as words', () => {
    expect(
      speakTargetLine(
        target({ targetSets: 5, targetRepsMin: 3, targetRepsMax: 3, targetPercent1rm: 85 }),
        null,
        'kg',
      ),
    ).toContain('at 85 percent of one rep max');
  });

  it('singularises one set and one rep', () => {
    expect(speakTargetLine(target({ targetSets: 1 }), last({ reps: 1 }), 'kg')).toBe(
      'Target: 1 set. Last time: 60 kilograms for 1 rep.',
    );
  });

  it('says nothing about a target for an ad-hoc block', () => {
    expect(speakTargetLine(null, last(), 'kg')).toBe('Last time: 60 kilograms for 9 reps.');
  });

  it('says the block is unavailable only when nothing at all resolved', () => {
    expect(speakTargetLine(null, null, 'kg', { unavailable: true })).toBe('Target unavailable.');
    // A prescription survived, so the failed history read is not announced
    // as the whole block failing.
    expect(speakTargetLine(FULL, null, 'kg', { unavailable: true })).toContain('Target: 3 sets');
  });
});
