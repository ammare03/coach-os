import { sessionDurationSeconds } from './duration.ts';

describe('sessionDurationSeconds', () => {
  it('returns whole seconds between the two instants', () => {
    const startedAt = Date.parse('2026-08-15T18:00:00.000Z');
    const completedAt = Date.parse('2026-08-15T18:48:30.000Z');

    expect(sessionDurationSeconds(startedAt, completedAt)).toBe(2910);
  });

  it('floors a part-second rather than rounding it up', () => {
    // A session is never longer than it was. `useCompleteSession` has always
    // floored, and the summary and the analytics event must agree.
    expect(sessionDurationSeconds(0, 1999)).toBe(1);
  });

  it('clamps a finish that precedes its own start to zero', () => {
    // A device clock that moved backwards mid-session. A negative duration
    // is not one, and the server clamps the stored column the same way.
    expect(sessionDurationSeconds(10_000, 4_000)).toBe(0);
  });

  it('returns zero rather than NaN for a non-finite instant', () => {
    expect(sessionDurationSeconds(Number.NaN, 1_000)).toBe(0);
    expect(sessionDurationSeconds(0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
