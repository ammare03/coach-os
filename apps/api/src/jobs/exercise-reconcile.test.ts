// The pure halves of `exercise-reconcile` — the week key the job id is
// derived from, and the name-similarity heuristic pass 4 reports on. Both
// are product decisions with edge cases, and neither needs a database, so
// they get a fast suite of their own; the four passes themselves are
// exercised against a real Postgres in `exercise-reconcile.integration.test.ts`.
import { editDistance, normaliseExerciseName } from '../services/exercises/reconcile.ts';

import { isoWeekKey } from './exercise-reconcile.ts';

// `./exercise-reconcile.ts` imports the fan-out enqueue, which constructs a
// BullMQ `Queue` at module scope and immediately dials Redis. Nothing in
// this suite queues anything; stubbing the module keeps a pure test from
// opening a socket it will never use.
jest.mock('../queues/enqueue.ts', () => ({
  enqueueExerciseReconcile: jest.fn(),
}));

describe('isoWeekKey', () => {
  it('formats as {isoYear}-W{week}, zero-padded', () => {
    expect(isoWeekKey(new Date('2026-09-06T00:00:00Z'))).toBe('2026-W36');
    expect(isoWeekKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-W02');
  });

  it('puts a late-December date in the NEXT year when its Thursday is there', () => {
    // 2025-12-29 is a Monday whose Thursday (2026-01-01) falls in 2026 —
    // ISO 8601 §3.17. A naive `getUTCFullYear()` would say 2025-W53 and a
    // coach would get two digests across that boundary.
    expect(isoWeekKey(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });

  it('puts an early-January date in the PREVIOUS year when its Thursday is there', () => {
    // 2027-01-01 is a Friday; that week's Thursday is 2026-12-31.
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });

  it('is stable across every instant within one UTC day', () => {
    const start = isoWeekKey(new Date('2026-09-06T00:00:00Z'));
    const end = isoWeekKey(new Date('2026-09-06T23:59:59Z'));
    expect(end).toBe(start);
  });

  it('gives the same key for every day of one ISO week', () => {
    const monday = isoWeekKey(new Date('2026-08-31T12:00:00Z'));
    const sunday = isoWeekKey(new Date('2026-09-06T12:00:00Z'));
    expect(monday).toBe('2026-W36');
    expect(sunday).toBe(monday);
  });
});

describe('normaliseExerciseName', () => {
  it('lower-cases, drops punctuation, and collapses whitespace', () => {
    expect(normaliseExerciseName('Bulgarian  Split-Squat')).toBe('bulgarian split squat');
    expect(normaliseExerciseName('  DB Bench (Incline) ')).toBe('db bench incline');
  });

  it('does not singularise — the distance check handles a trailing s', () => {
    expect(normaliseExerciseName('Squats')).toBe('squats');
  });
});

describe('editDistance', () => {
  it('is zero for identical strings and symmetric otherwise', () => {
    expect(editDistance('squat', 'squat')).toBe(0);
    expect(editDistance('squat', 'squats')).toBe(1);
    expect(editDistance('squats', 'squat')).toBe(1);
  });

  it('handles an empty operand', () => {
    expect(editDistance('', 'squat')).toBe(5);
    expect(editDistance('squat', '')).toBe(5);
  });

  it('separates the pair pass 4 must report from the pair it must not', () => {
    // The reported pair: one edit in twenty-two characters.
    expect(editDistance('bulgarian split squat', 'bulgarian split squats')).toBe(1);
    // Two genuinely different movements, two edits in thirteen — under
    // pass 4's 15% threshold this is above the allowance and stays apart.
    expect(editDistance('incline press', 'decline press')).toBe(2);
  });
});
