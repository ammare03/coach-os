import { updateSessionNotesInput } from '../workouts.ts';

// `phase-09-workout-logger/session-summary/03`. The two subjective fields a
// client attaches to a finished session, and the one shape that carries
// them. Both are nullable rather than optional-and-absent, which is the
// whole point of this file: the device is the author (DB§14.3) and a payload
// that simply omitted a cleared field would leave a stale value standing on
// the server forever.

const KEY = '018f4b1e-0000-7000-8000-0000000000aa';
const SESSION_KEY = '018f4b1e-0000-7000-8000-000000000001';

/** Both fields are named on every payload — see the "nullable, not optional" decision. */
function base() {
  return {
    sessionClientLocalId: SESSION_KEY,
    clientLocalId: KEY,
    perceivedExertion: null,
    clientNotes: null,
  };
}

describe('updateSessionNotesInput', () => {
  it('accepts what the device queues', () => {
    const parsed = updateSessionNotesInput.parse({
      ...base(),
      perceivedExertion: 7,
      clientNotes: 'Skipped: Leg press — equipment unavailable\n\nKnee felt tight.',
    });

    expect(parsed.perceivedExertion).toBe(7);
    expect(parsed.clientNotes).toContain('Knee felt tight.');
  });

  it('accepts an explicit null for either field', () => {
    const parsed = updateSessionNotesInput.parse({
      ...base(),
      perceivedExertion: null,
      clientNotes: null,
    });

    expect(parsed.perceivedExertion).toBeNull();
    expect(parsed.clientNotes).toBeNull();
  });

  it('rejects an exertion outside 1–10', () => {
    // `workout_sessions.perceived_exertion` is a `smallint` with no CHECK
    // (DB§5.2), so this schema is the only bound the column has.
    for (const value of [0, 11, -1]) {
      expect(() =>
        updateSessionNotesInput.parse({ ...base(), perceivedExertion: value }),
      ).toThrow();
    }
  });

  it('rejects a fractional exertion', () => {
    // A `smallint` column. 7.5 would round somewhere nobody chose.
    expect(() => updateSessionNotesInput.parse({ ...base(), perceivedExertion: 7.5 })).toThrow();
  });

  it('requires the clientLocalId the flush loop always merges in', () => {
    // `apps/mobile/src/lib/outbox/flush.ts` adds the outbox row's own key to
    // every payload, and `strictObject` rejects a key it does not name.
    const withoutKey: Record<string, unknown> = { ...base() };
    delete withoutKey.clientLocalId;
    expect(() => updateSessionNotesInput.parse(withoutKey)).toThrow();
  });

  it('requires both fields to be named, so a cleared one is never merely absent', () => {
    // Omitting a field the client CLEARED would leave the server's old value
    // standing with nothing to correct it. `strictObject` plus a required
    // nullable is what makes "cleared" and "unmentioned" impossible to
    // confuse.
    const withoutExertion: Record<string, unknown> = { ...base() };
    delete withoutExertion.perceivedExertion;
    const withoutNotes: Record<string, unknown> = { ...base() };
    delete withoutNotes.clientNotes;
    expect(() => updateSessionNotesInput.parse(withoutExertion)).toThrow();
    expect(() => updateSessionNotesInput.parse(withoutNotes)).toThrow();
  });

  it('names exactly the session key, the mutation key, and the two fields', () => {
    expect(Object.keys(updateSessionNotesInput.shape).sort()).toEqual([
      'clientLocalId',
      'clientNotes',
      'perceivedExertion',
      'sessionClientLocalId',
    ]);
  });

  it('caps the note rather than accepting an unbounded string', () => {
    expect(() =>
      updateSessionNotesInput.parse({ ...base(), clientNotes: 'x'.repeat(4001) }),
    ).toThrow();
  });

  it('leaves room for a session of skip lines plus the client’s own 500', () => {
    // The composed value is every skip line in the session followed by what
    // the client typed, and the cap has to clear the worst realistic case or
    // a queued update fails validation forever and surfaces as "couldn't
    // sync" (`offline-sync` §4). Fifteen exercises, each skipped with a
    // full-length note, is comfortably inside 4000.
    expect(() =>
      updateSessionNotesInput.parse({ ...base(), clientNotes: 'x'.repeat(3_200) }),
    ).not.toThrow();
  });
});
