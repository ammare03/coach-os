import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import {
  localExercisesCache,
  localSetLogs,
  localWorkoutSessions,
} from '../../../../db/schema/local-training.ts';
import { meta } from '../../../../db/schema/sync.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import {
  publishOutboxResult,
  resetOutboxResultListenersForTests,
  type OutboxSendResult,
} from '../../../../lib/outbox/results.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { resetSessionRecordsPersistenceForTests } from '../../hooks/useSessionRecords.ts';
import {
  SKIPPED_EXERCISES_META_KEY,
  resetSkipPersistenceForTests,
} from '../../hooks/useSkipExercise.ts';
import {
  SUBSTITUTED_EXERCISES_META_KEY,
  resetSwapPersistenceForTests,
} from '../../hooks/useSwapExercise.ts';
import { SUMMARY_COPY } from '../../lib/session-summary.ts';
import { resetSessionRecordsForTests } from '../../store/session-records-store.ts';
import { useSkippedExercisesStore } from '../../store/skipped-exercises-store.ts';
import { useSubstitutedExercisesStore } from '../../store/substituted-exercises-store.ts';
import { FORM_CHECK_ROUTE } from '../PostSessionPrompt.tsx';
import { SessionSummaryScreen } from '../SessionSummaryScreen.tsx';

// `phase-09-workout-logger/session-summary/01`, its Verification section
// verbatim: "Complete a session with two PRs, one skipped exercise, and one
// substitution, and confirm the summary screen shows all four facts
// correctly and instantly, including in airplane mode."
//
// **There is no query provider in this file, and that is the airplane-mode
// proof.** Every tRPC hook in this app throws without one, so a screen that
// renders its figures here is a screen with no server read on the path. The
// only two things stood in for are the client's unit and zone, both of
// which resolve from a cached `me.get` with a synchronous fallback and
// neither of which is a figure.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// `session-summary/02`'s prompt links into `record-form-check`. The
// imperative singleton, not `useRouter`, so nothing here needs a navigator.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

jest.mock('../../../../hooks/useWeightUnit.ts', () => ({ useWeightUnit: () => 'kg' }));
jest.mock('../../../../lib/time-zone/useClientTimeZone.ts', () => ({
  useClientTimeZone: () => 'Asia/Kolkata',
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const SESSION = '0198f2d6-0000-7000-8000-0000000000aa';
const SQUAT = '0198f2d6-0000-7000-8000-0000000000d1';
const RDL = '0198f2d6-0000-7000-8000-0000000000d2';
const SET_A = '0198f2d6-0000-7000-8000-0000000000b1';
const SET_B = '0198f2d6-0000-7000-8000-0000000000b2';

const CLIENT_NOTE = 'Right knee felt tight on the last two sets.';

const STARTED_AT = Date.parse('2026-08-15T12:00:00.000Z');
const COMPLETED_AT = Date.parse('2026-08-15T12:48:00.000Z');

const PAYLOAD = {
  session: {
    name: 'Lower body A',
    exercises: [
      { id: 'b-1', exerciseId: SQUAT, targetSets: 3, targetRestSeconds: 90 },
      { id: 'b-2', exerciseId: RDL, targetSets: 3, targetRestSeconds: 90 },
    ],
  },
  exercises: [
    { id: SQUAT, name: 'Barbell back squat' },
    { id: RDL, name: 'Romanian deadlift' },
  ],
} as unknown as LocalSessionPayload;

beforeEach(() => {
  mockPush.mockClear();
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  resetOutboxResultListenersForTests();
  resetSessionRecordsPersistenceForTests();
  resetSessionRecordsForTests();
  resetSkipPersistenceForTests();
  resetSwapPersistenceForTests();
  useSkippedExercisesStore.setState({ sessionLocalId: null, skips: new Map() });
  useSubstitutedExercisesStore.setState({ sessionLocalId: null, substitutions: new Map() });
});

afterEach(cleanup);

async function seedCompletedSession(options: { sets?: boolean } = {}) {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SESSION,
    clientLocalId: SESSION,
    serverId: null,
    scheduledDate: '2026-08-15',
    programDayId: null,
    name: 'Lower body A',
    status: 'completed',
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    payloadJson: serialiseSessionPayload(PAYLOAD),
    startOutboxId: null,
    syncState: 'pending',
    updatedAt: COMPLETED_AT,
  });
  await db.insert(localExercisesCache).values({ id: SQUAT, name: 'Barbell back squat' });
  await db.insert(localExercisesCache).values({ id: RDL, name: 'Romanian deadlift' });

  if (options.sets === false) return db;

  const sets = [
    { id: SET_A, exerciseId: SQUAT, reps: 5, weightKg: 102.5 },
    { id: SET_B, exerciseId: RDL, reps: 12, weightKg: 80 },
    { id: 'set-c', exerciseId: SQUAT, reps: 5, weightKg: 100 },
  ];
  for (const [index, set] of sets.entries()) {
    await db.insert(localSetLogs).values({
      id: set.id,
      clientLocalId: set.id,
      sessionLocalId: SESSION,
      exerciseId: set.exerciseId,
      setNumber: index + 1,
      reps: set.reps,
      weightKg: set.weightKg,
      rpe: null,
      isWarmup: false,
      isFailure: false,
      notes: null,
      loggedAt: STARTED_AT,
      syncState: 'pending',
    });
  }
  return db;
}

function confirmRecord(
  setLocalId: string,
  exerciseId: string,
  overrides: { reps?: number; weightKg?: number; types?: string[] } = {},
): OutboxSendResult {
  return {
    procedure: 'workouts.logSet',
    clientLocalId: setLocalId,
    input: { sessionClientLocalId: SESSION, clientLocalId: setLocalId },
    result: {
      clientLocalId: setLocalId,
      exerciseId,
      setNumber: 1,
      reps: overrides.reps ?? 5,
      weightKg: overrides.weightKg ?? 102.5,
      estimated1rmKg: 119.6,
      isWarmup: false,
      newPersonalRecords: overrides.types ?? ['max_weight'],
    },
  };
}

function markOneSkipAndOneSwap() {
  useSkippedExercisesStore.getState().openSession(SESSION);
  useSkippedExercisesStore.getState().skip(SESSION, {
    exerciseKey: 'b-2',
    exerciseId: RDL,
    exerciseName: 'Romanian deadlift',
    reason: 'time',
    note: null,
    atMs: COMPLETED_AT,
  });
  useSubstitutedExercisesStore.getState().openSession(SESSION);
  useSubstitutedExercisesStore.getState().substitute(SESSION, {
    exerciseKey: 'b-1',
    originalExerciseId: SQUAT,
    originalName: 'Barbell back squat',
    substituteExerciseId: RDL,
    substituteName: 'Romanian deadlift',
    atMs: COMPLETED_AT,
  });
}

function renderScreen(onDone = jest.fn()) {
  render(<SessionSummaryScreen sessionLocalId={SESSION} onDone={onDone} />);
  return onDone;
}

describe('SessionSummaryScreen', () => {
  it('shows all four facts, from local state alone', async () => {
    await seedCompletedSession();
    markOneSkipAndOneSwap();
    renderScreen();

    // Volume and duration, computed on the device from the rows the logger
    // wrote — no column on `local_workout_sessions` carries either.
    const figures = await screen.findByTestId('summary-figures');
    expect(figures).toBeTruthy();
    expect(screen.getByLabelText('Volume, 1972.5 kilograms')).toBeTruthy();
    expect(screen.getByLabelText('Time, 48 minutes')).toBeTruthy();
    expect(screen.getByLabelText('Sets, 3 of 6')).toBeTruthy();

    // Two records, confirmed on two different lifts. Both are listed.
    act(() => {
      publishOutboxResult(confirmRecord(SET_A, SQUAT));
      publishOutboxResult(
        confirmRecord(SET_B, RDL, { reps: 12, weightKg: 80, types: ['max_reps'] }),
      );
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('summary-record')).toHaveLength(2);
    });
    expect(screen.getByText('Barbell back squat — heaviest ever,')).toBeTruthy();
    expect(screen.getByText('Romanian deadlift — most reps at 80kg,')).toBeTruthy();

    // And the two modification counts.
    expect(screen.getByLabelText(SUMMARY_COPY.skipped(1))).toBeTruthy();
    expect(screen.getByLabelText(SUMMARY_COPY.swapped(1))).toBeTruthy();
  });

  it('lists a record that arrives after the client has left the logger', async () => {
    // The set was logged in a basement; the tunnel cleared after Finish.
    // `personal-records/03` drops the pill for this case on purpose — the
    // record still belongs on the summary.
    await seedCompletedSession();
    renderScreen();
    await screen.findByTestId('summary-figures');
    expect(screen.queryByTestId('summary-records')).toBeNull();

    act(() => {
      publishOutboxResult(confirmRecord(SET_A, SQUAT));
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('summary-record')).toHaveLength(1);
    });
  });

  it('says nothing about records or changes when there were none', async () => {
    await seedCompletedSession();
    renderScreen();

    await screen.findByTestId('summary-figures');
    expect(screen.queryByTestId('summary-records')).toBeNull();
    expect(screen.queryByTestId('summary-modifications')).toBeNull();
  });

  it('drops a figure it cannot compute rather than printing a zero', async () => {
    const db = await seedCompletedSession({ sets: false });
    await db.insert(localSetLogs).values({
      id: SET_A,
      clientLocalId: SET_A,
      sessionLocalId: SESSION,
      exerciseId: SQUAT,
      setNumber: 1,
      reps: 12,
      weightKg: null,
      rpe: null,
      isWarmup: false,
      isFailure: false,
      notes: null,
      loggedAt: STARTED_AT,
      syncState: 'pending',
    });
    renderScreen();

    await screen.findByTestId('summary-figures');
    expect(screen.queryByTestId('summary-figure-volume')).toBeNull();
    expect(screen.getByTestId('summary-figure-time')).toBeTruthy();
  });

  it('offers a way out for a session this device does not hold', async () => {
    const onDone = renderScreen();

    expect(await screen.findByText(SUMMARY_COPY.missingTitle)).toBeTruthy();
    // Decision (c): Done has no data dependency and works in every state.
    fireEvent.press(screen.getByTestId('summary-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('still counts the changes after a force-quit, from the mirror alone', async () => {
    // The client closed the app on the walk home and opened the summary
    // again. Both stores are empty, so the counts can only come from what
    // `useSkipExercise` and `useSwapExercise` mirrored into `meta`.
    const db = await seedCompletedSession();
    await db.insert(meta).values({
      key: SKIPPED_EXERCISES_META_KEY,
      value: JSON.stringify({
        sessionLocalId: SESSION,
        skips: [
          {
            exerciseKey: 'b-2',
            exerciseId: RDL,
            exerciseName: 'Romanian deadlift',
            reason: 'time',
            note: null,
            atMs: COMPLETED_AT,
          },
        ],
      }),
    });
    await db.insert(meta).values({
      key: SUBSTITUTED_EXERCISES_META_KEY,
      value: JSON.stringify({
        sessionLocalId: SESSION,
        substitutions: [
          {
            exerciseKey: 'b-1',
            originalExerciseId: SQUAT,
            originalName: 'Barbell back squat',
            substituteExerciseId: RDL,
            substituteName: 'Romanian deadlift',
            atMs: COMPLETED_AT,
          },
        ],
      }),
    });

    renderScreen();

    expect(await screen.findByLabelText(SUMMARY_COPY.skipped(1))).toBeTruthy();
    expect(await screen.findByLabelText(SUMMARY_COPY.swapped(1))).toBeTruthy();
  });

  it('leaves for Today when the client is done', async () => {
    await seedCompletedSession();
    const onDone = renderScreen();

    await screen.findByTestId('summary-figures');
    fireEvent.press(screen.getByTestId('summary-done'));

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

// `session-summary/02`'s Verification section, on the real screen: "dismiss
// both prompts and confirm normal navigation continues unimpeded. Tap 'Add a
// note', confirm inline capture, and confirm it correctly reaches
// `client_notes` per task 03. Tap 'Add a form check' and confirm it navigates
// to the correct route."
describe('SessionSummaryScreen — the post-session prompt', () => {
  it('leaves the way out open when both prompts are dismissed', async () => {
    await seedCompletedSession();
    const onDone = renderScreen();
    await screen.findByTestId('summary-figures');

    fireEvent.press(screen.getByTestId('summary-prompt-form-check-dismiss'));
    fireEvent.press(screen.getByTestId('summary-prompt-note-dismiss'));

    expect(screen.queryByTestId('summary-prompt')).toBeNull();
    // The figures are untouched and Done is exactly where it was.
    expect(screen.getByTestId('summary-figures')).toBeTruthy();
    fireEvent.press(screen.getByTestId('summary-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('opens the note capture inline, and what is typed reaches client_notes', async () => {
    await seedCompletedSession();
    renderScreen();
    await screen.findByTestId('summary-figures');

    fireEvent.press(screen.getByTestId('summary-prompt-note'));
    // The capture reads what the session already holds on mount. Settled
    // here so the assertions below run against the screen the client sees.
    await act(async () => undefined);

    // Inline — the same screen, and nothing navigated.
    expect(screen.getByTestId('session-summary')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.changeText(await screen.findByTestId('session-note-input'), CLIENT_NOTE);
    fireEvent.press(screen.getByTestId('session-note-save'));

    const db = await getLocalDb();
    await waitFor(async () => {
      const [row] = await db
        .select()
        .from(localWorkoutSessions)
        .where(eq(localWorkoutSessions.clientLocalId, SESSION));
      expect(row?.clientNotes).toBe(CLIENT_NOTE);
    });
  });

  it('opens record-form-check with the session it is a check of', async () => {
    await seedCompletedSession();
    renderScreen();
    await screen.findByTestId('summary-figures');

    fireEvent.press(screen.getByTestId('summary-prompt-form-check'));

    // Two exercises logged, so no exercise is named — `formCheckParams`.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: FORM_CHECK_ROUTE,
      params: { sessionId: SESSION },
    });
  });

  it('does not block Done while the capture is open', async () => {
    await seedCompletedSession();
    const onDone = renderScreen();
    await screen.findByTestId('summary-figures');

    fireEvent.press(screen.getByTestId('summary-prompt-note'));
    // Let the capture's own local read settle, so what is asserted is the
    // screen the client is actually looking at.
    await act(async () => undefined);

    fireEvent.press(screen.getByTestId('summary-done'));

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
