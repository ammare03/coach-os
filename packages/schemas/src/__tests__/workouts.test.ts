import { startAdHocSessionInput, startSessionInput } from '../workouts.ts';

// `phase-09-workout-logger/session-runtime/01`. The two start inputs are
// deliberately different shapes — one creates a row, one moves one — and the
// asymmetry is easy to "tidy up" into a bug, so it is pinned here.

const TAP = new Date('2026-08-14T19:00:00.000Z');
const SESSION_ID = '018f4b1e-0000-7000-8000-000000000001';
const KEY = '018f4b1e-0000-7000-8000-0000000000aa';

describe('startSessionInput', () => {
  it('accepts what the device queues', () => {
    const parsed = startSessionInput.parse({
      workoutSessionId: SESSION_ID,
      clientLocalId: KEY,
      startedAt: TAP,
    });

    expect(parsed.workoutSessionId).toBe(SESSION_ID);
    expect(parsed.startedAt).toEqual(TAP);
  });

  it('requires the clientLocalId the flush loop always merges in', () => {
    // `apps/mobile/src/lib/outbox/flush.ts` adds the outbox row's own key to
    // every payload it sends, and `strictObject` rejects a key it does not
    // name. Drop this field and every queued start fails validation forever,
    // silently, on a device that has already left the gym.
    expect(() =>
      startSessionInput.parse({ workoutSessionId: SESSION_ID, startedAt: TAP }),
    ).toThrow();
  });

  it('rejects an instant that arrived as a string', () => {
    // superjson keeps it a `Date` across the outbox; a string here means it
    // was serialised with plain JSON somewhere and the session would be
    // timestamped at reconnect (`offline-sync` §10).
    expect(() =>
      startSessionInput.parse({
        workoutSessionId: SESSION_ID,
        clientLocalId: KEY,
        startedAt: TAP.toISOString(),
      }),
    ).toThrow();
  });

  it('names no session id in the ad-hoc counterpart, and no date in this one', () => {
    // The ad-hoc session does not exist yet, so it is keyed on the
    // idempotency key and carries the client's own calendar day; the
    // assigned one already exists, so it is named by id and carries neither.
    expect(Object.keys(startAdHocSessionInput.shape).sort()).toEqual([
      'clientLocalId',
      'scheduledDate',
      'startedAt',
    ]);
    expect(Object.keys(startSessionInput.shape).sort()).toEqual([
      'clientLocalId',
      'startedAt',
      'workoutSessionId',
    ]);
  });
});
