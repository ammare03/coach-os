import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import {
  serialiseSessionPayload,
  type LocalSessionPayload,
} from '../../../../lib/prefetch/sessions.ts';
import { summariseLoggerSession, type LoggerSessionRow } from '../useLoggerSession.ts';

// `expo-sqlite` has no Jest-side native module and importing the hook pulls
// `db/client.ts` in. Same fake, same reason, as `useTodaySession.test.ts`.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// What the logger shell has to derive from one local row, tested without a
// renderer: the name it puts in the header, the two set counts under it,
// and the degradation when the row carries no prescription at all.

function buildRow(overrides: Partial<LoggerSessionRow> = {}): LoggerSessionRow {
  return {
    id: 'session-1',
    clientLocalId: 'local-1',
    serverId: 'session-1',
    scheduledDate: '2026-08-15',
    programDayId: 'day-1',
    name: null,
    status: 'in_progress',
    startedAt: Date.UTC(2026, 7, 15, 9, 0, 0),
    completedAt: null,
    payloadJson: serialiseSessionPayload(buildPayload()),
    startOutboxId: 'outbox-1',
    syncState: 'pending',
    updatedAt: 1,
    ...overrides,
  };
}

function buildPayload(session = buildSession()): LocalSessionPayload {
  return { session, exercises: [buildExercise()] };
}

/** Two blocks, seven prescribed working sets between them. */
const PRESCRIBED = buildPayload(
  buildSession({
    exercises: [
      buildBlock({ programExerciseId: 'block-1', orderIndex: 1, targetSets: 4 }),
      buildBlock({ programExerciseId: 'block-2', orderIndex: 2, targetSets: 3 }),
    ],
  }),
);

/** What `useStartAdHocSession` writes: a session with no prescription at all. */
const AD_HOC: LocalSessionPayload = {
  session: buildSession({ name: null, dayName: null, exercises: [] }),
  exercises: [],
};

const NO_SETS: Parameters<typeof summariseLoggerSession>[2] = [];

describe('summariseLoggerSession', () => {
  it('names the session from the row, then the payload, then the program day', () => {
    expect(summariseLoggerSession(buildRow({ name: 'Row name' }), PRESCRIBED, NO_SETS).name).toBe(
      'Row name',
    );
    expect(
      summariseLoggerSession(
        buildRow(),
        buildPayload(buildSession({ name: 'Payload name', dayName: 'Push A' })),
        NO_SETS,
      ).name,
    ).toBe('Payload name');
    expect(
      summariseLoggerSession(
        buildRow(),
        buildPayload(buildSession({ name: null, dayName: 'Push A' })),
        NO_SETS,
      ).name,
    ).toBe('Push A');
  });

  it('leaves the name null when nothing supplies one, so the header owns the fallback word', () => {
    expect(summariseLoggerSession(buildRow(), AD_HOC, NO_SETS).name).toBeNull();
  });

  it('counts the prescribed exercises and their target sets', () => {
    const summary = summariseLoggerSession(buildRow(), PRESCRIBED, NO_SETS);

    expect(summary.exerciseCount).toBe(2);
    expect(summary.targetSets).toBe(7);
  });

  it('counts working sets only — a warm-up is not progress through the plan', () => {
    const sets = [
      { reps: 8, weightKg: 60, isWarmup: true },
      { reps: 8, weightKg: 60, isWarmup: false },
      { reps: 8, weightKg: 62.5, isWarmup: false },
    ];

    expect(summariseLoggerSession(buildRow(), PRESCRIBED, sets).setsLogged).toBe(2);
  });

  it('reports an ad-hoc session as having no prescription rather than failing', () => {
    const summary = summariseLoggerSession(buildRow({ name: null }), AD_HOC, NO_SETS);

    expect(summary.exerciseCount).toBe(0);
    expect(summary.targetSets).toBe(0);
    expect(summary.name).toBeNull();
  });

  it('degrades to no prescription when the row carries another writer’s payload', () => {
    // `lib/prefetch/history.ts` writes `{ session, setLogs }` into the same
    // column and `readSessionPayload` narrows that to null. The client must
    // still be able to open and log the session (`useTodaySession` rule (c)).
    const summary = summariseLoggerSession(buildRow({ name: 'Upper A' }), null, NO_SETS);

    expect(summary.payload).toBeNull();
    expect(summary.exerciseCount).toBe(0);
    expect(summary.targetSets).toBe(0);
    expect(summary.name).toBe('Upper A');
    expect(summary.localId).toBe('local-1');
  });

  it('carries startedAt through as a Date so the elapsed clock has an origin', () => {
    const startedAt = Date.UTC(2026, 7, 15, 9, 0, 0);
    const summary = summariseLoggerSession(buildRow({ startedAt }), PRESCRIBED, NO_SETS);

    expect(summary.startedAt).toEqual(new Date(startedAt));
    expect(summary.isInProgress).toBe(true);
  });

  it('reports no origin for a session that has not been started', () => {
    const summary = summariseLoggerSession(
      buildRow({ status: 'scheduled', startedAt: null }),
      PRESCRIBED,
      NO_SETS,
    );

    expect(summary.startedAt).toBeNull();
    expect(summary.isInProgress).toBe(false);
  });
});
