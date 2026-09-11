import { toLocalDate } from '@coachos/utils';
import type { UpcomingContext } from 'api/src/features/workouts/upcoming.ts';

import {
  buildBlock,
  buildContext,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import { serialiseSessionPayload, upcomingRange } from '../../../../lib/prefetch/sessions.ts';
import {
  pickTodaySession,
  resolveState,
  summariseSession,
  type TodaySessionPhase,
  type TodaySessionSummary,
} from '../useTodaySession.ts';

// `expo-sqlite` has no Jest-side native module, and importing the hook
// pulls `db/client.ts` in. The hand-built fake is reused rather than
// copied, for the reason its own header gives.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// The three things this hook has to get right, tested without a renderer:
// the day boundary, the rest-day/no-program disambiguation, and the shape
// tasks 03 and 04 branch on.

type Row = Parameters<typeof pickTodaySession>[0][number];

function buildRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'session-1',
    clientLocalId: 'local-1',
    serverId: 'session-1',
    scheduledDate: '2026-08-15',
    programDayId: 'day-1',
    name: null,
    status: 'scheduled',
    startedAt: null,
    completedAt: null,
    payloadJson: serialiseSessionPayload({
      session: buildSession(),
      exercises: [buildExercise()],
    }),
    completeOutboxId: null,
    notesOutboxId: null,
    perceivedExertion: null,
    clientNotes: null,
    startOutboxId: null,
    syncState: 'synced',
    updatedAt: 1,
    ...overrides,
  };
}

describe('the day boundary', () => {
  // `CLAUDE.md` §25.5's named pitfall: 19:00 UTC is already tomorrow in
  // Kolkata and still today in New York. The screen reads
  // `local_workout_sessions` by `scheduled_date`, so getting this wrong
  // shows a client the wrong day's workout — silently.
  const at = new Date('2026-08-14T19:00:00.000Z');

  it("resolves today in the client's own zone, never the device's", () => {
    expect(toLocalDate(at, 'Asia/Kolkata')).toBe('2026-08-15');
    expect(toLocalDate(at, 'America/New_York')).toBe('2026-08-14');
  });

  it('asks the API for today and tomorrow in that same zone', () => {
    expect(upcomingRange(at, 'Asia/Kolkata')).toEqual({ from: '2026-08-15', to: '2026-08-16' });
    expect(upcomingRange(at, 'America/New_York')).toEqual({ from: '2026-08-14', to: '2026-08-15' });
  });

  it('crosses a month boundary without arithmetic of its own', () => {
    expect(toLocalDate(new Date('2026-08-31T23:30:00.000Z'), 'UTC')).toBe('2026-08-31');
    expect(toLocalDate(new Date('2026-09-01T00:30:00.000Z'), 'UTC')).toBe('2026-09-01');
  });
});

describe('pickTodaySession', () => {
  it('returns null when the day holds nothing', () => {
    expect(pickTodaySession([])).toBeNull();
  });

  it('prefers a session in progress over one not started', () => {
    const inProgress = buildRow({ clientLocalId: 'local-2', status: 'in_progress' });
    expect(pickTodaySession([buildRow(), inProgress])?.clientLocalId).toBe('local-2');
  });

  it('prefers a scheduled session over one already finished', () => {
    const completed = buildRow({ clientLocalId: 'local-2', status: 'completed' });
    expect(pickTodaySession([completed, buildRow()])?.clientLocalId).toBe('local-1');
  });

  it('breaks a tie on the most recently touched row', () => {
    // `today-card/04` adds an ad-hoc row on the same date; the one the
    // client just created is the one they mean.
    const older = buildRow({ clientLocalId: 'local-1', updatedAt: 10 });
    const newer = buildRow({ clientLocalId: 'local-2', updatedAt: 20 });
    expect(pickTodaySession([older, newer])?.clientLocalId).toBe('local-2');
  });

  it('never returns a skipped session', () => {
    // Today is about today; a missed or skipped session is never surfaced
    // here (`docs/screens/client-today.md`, `COPY.md` CO§2).
    expect(pickTodaySession([buildRow({ status: 'skipped' })])).toBeNull();
  });
});

describe('summariseSession', () => {
  const payload = {
    session: buildSession({
      exercises: [
        buildBlock({ programExerciseId: 'b1', exerciseId: 'e1', orderIndex: 1, targetSets: 4 }),
        buildBlock({ programExerciseId: 'b2', exerciseId: 'e2', orderIndex: 2, targetSets: 3 }),
        buildBlock({ programExerciseId: 'b3', exerciseId: 'e3', orderIndex: 3, targetSets: 3 }),
        buildBlock({ programExerciseId: 'b4', exerciseId: 'e4', orderIndex: 4, targetSets: 3 }),
      ],
    }),
    exercises: [
      buildExercise({ id: 'e1', name: 'Bench press' }),
      buildExercise({ id: 'e2', name: 'Barbell row' }),
      buildExercise({ id: 'e3', name: 'Overhead press' }),
      buildExercise({ id: 'e4', name: 'Lat pulldown' }),
    ],
  };

  it('names the first three exercises and counts the rest', () => {
    const summary = summariseSession(buildRow(), payload);

    expect(summary.previewExerciseNames).toEqual(['Bench press', 'Barbell row', 'Overhead press']);
    expect(summary.remainingExerciseCount).toBe(1);
    expect(summary.exerciseCount).toBe(4);
    expect(summary.targetSets).toBe(13);
  });

  it('opens the logger with the LOCAL id, which a never-synced session still has', () => {
    const summary = summariseSession(
      buildRow({ serverId: null, clientLocalId: 'ad-hoc-1' }),
      payload,
    );
    expect(summary.localId).toBe('ad-hoc-1');
    expect(summary.serverId).toBeNull();
  });

  it("falls back to the program day's label when the session has no name of its own", () => {
    expect(summariseSession(buildRow({ name: null }), payload).name).toBe('Push A');
  });

  it('names the row over the program day when the row carries one', () => {
    expect(summariseSession(buildRow({ name: 'Upper A' }), payload).name).toBe('Upper A');
  });

  it('drops a pill whose exercise the cache does not hold, rather than rendering an id', () => {
    const summary = summariseSession(buildRow(), {
      session: payload.session,
      exercises: [buildExercise({ id: 'e1', name: 'Bench press' })],
    });
    expect(summary.previewExerciseNames).toEqual(['Bench press']);
  });

  it('sorts the preview by the prescribed order, not the payload order', () => {
    const summary = summariseSession(buildRow(), {
      session: buildSession({
        exercises: [
          buildBlock({ programExerciseId: 'b2', exerciseId: 'e2', orderIndex: 2 }),
          buildBlock({ programExerciseId: 'b1', exerciseId: 'e1', orderIndex: 1 }),
        ],
      }),
      exercises: payload.exercises,
    });
    expect(summary.previewExerciseNames).toEqual(['Bench press', 'Barbell row']);
  });
});

describe('resolveState — the rest-day vs no-program disambiguation', () => {
  const SCHEDULED: TodaySessionPhase = { phase: 'scheduled' };
  const today = '2026-08-15';

  function ready(
    session: { summary: TodaySessionSummary; phase: TodaySessionPhase } | null,
    context: UpcomingContext | null,
  ) {
    return {
      local: { status: 'ready' as const, read: { session, context } },
      today,
      showSkeleton: false,
      hasCoach: true,
      revalidating: false,
    };
  }

  it('is loading until the local read answers', () => {
    expect(
      resolveState({
        local: { status: 'loading' },
        today,
        showSkeleton: true,
        hasCoach: true,
        revalidating: true,
      }),
    ).toEqual({ kind: 'loading', showSkeleton: true });
  });

  it('surfaces a failed local read as the card error, not as an empty day', () => {
    const error = new Error('database is locked');
    expect(
      resolveState({
        local: { status: 'error', error },
        today,
        showSkeleton: false,
        hasCoach: true,
        revalidating: false,
      }),
    ).toEqual({ kind: 'error', error });
  });

  it('renders the session whenever there is one, whatever the context says', () => {
    const session = {
      summary: summariseSession(buildRow(), {
        session: buildSession(),
        exercises: [buildExercise()],
      }),
      phase: SCHEDULED,
    };

    const state = resolveState(ready(session, buildContext()));

    expect(state.kind).toBe('session');
  });

  // The four states below are the whole point of `today-card/DESIGN-SPEC.md`
  // §5.1: with no session row for today, the context object is the only
  // thing that separates them.
  it('is a rest day when the program says today is one', () => {
    const context = buildContext({
      days: [{ date: today, isRestDay: true, weekNumber: 6, dayName: 'Rest' }],
    });
    expect(resolveState(ready(null, context))).toEqual({ kind: 'rest-day', isRestDay: true });
  });

  it('is "nothing scheduled" — not a rest day — on an unprogrammed day', () => {
    const context = buildContext({
      days: [{ date: today, isRestDay: false, weekNumber: 6, dayName: null }],
    });
    expect(resolveState(ready(null, context))).toEqual({ kind: 'rest-day', isRestDay: false });
  });

  it('is no-program when the client has no active assignment', () => {
    const context = buildContext({
      hasActiveAssignment: false,
      programName: null,
      totalWeeks: null,
      days: [{ date: today, isRestDay: false, weekNumber: null, dayName: null }],
    });
    expect(resolveState(ready(null, context))).toEqual({ kind: 'no-program', hasCoach: true });
  });

  it('carries whether the client has a coach, for the empty state’s body copy', () => {
    const context = buildContext({ hasActiveAssignment: false, days: [] });
    expect(resolveState({ ...ready(null, context), hasCoach: false })).toEqual({
      kind: 'no-program',
      hasCoach: false,
    });
  });

  it('holds the loading state on a first launch rather than claiming there is no program', () => {
    // Nothing has ever been prefetched. Telling a client with a program
    // that they have none is the worse of the two wrong answers.
    expect(resolveState({ ...ready(null, null), revalidating: true, showSkeleton: true })).toEqual({
      kind: 'loading',
      showSkeleton: true,
    });
  });

  it('falls back to no-program once the first revalidation has answered and still cached nothing', () => {
    expect(resolveState({ ...ready(null, null), revalidating: false })).toEqual({
      kind: 'no-program',
      hasCoach: true,
    });
  });

  it('answers per date: yesterday’s rest day is not today’s', () => {
    // The reason the cached context is a list of days rather than one
    // scalar — a client opening the app at 00:05, before the nightly
    // prefetch, reads the entry for the NEW day.
    const context = buildContext({
      days: [
        { date: '2026-08-14', isRestDay: true, weekNumber: 6, dayName: 'Rest' },
        { date: today, isRestDay: false, weekNumber: 6, dayName: 'Upper A' },
      ],
    });
    expect(resolveState(ready(null, context))).toEqual({ kind: 'rest-day', isRestDay: false });
  });

  it('degrades to "nothing scheduled" for a date the cached range never covered', () => {
    const context = buildContext({ days: [] });
    expect(resolveState(ready(null, context))).toEqual({ kind: 'rest-day', isRestDay: false });
  });
});
