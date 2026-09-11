import { ToastProvider } from '@coachos/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import type { LoggedSet } from '../../hooks/useLogSet.ts';
import type { ExercisePage } from '../../lib/exercise-pages.ts';
import { SetEntrySlot } from '../SetEntrySlot.tsx';

// `session-modifications/01` — going past `target_sets`.
//
// The risk this file exists to pin is the one the task names: **a set number
// derived from the plan instead of from what is actually logged.** So every
// assertion about a number is made against what `logSet` was handed, and the
// three-set prescription stays fixed at three while the sets go to six.
//
// `useLogSet` is mocked for exactly that reason — the number this component
// chose is the thing under test, not what the mirror does with it, which is
// `useLogSet.test.ts`'s contract.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

const mockLogSet = jest.fn<Promise<LoggedSet>, [Record<string, unknown>]>();
jest.mock('../../hooks/useLogSet.ts', () => ({
  useLogSet: () => ({ logSet: mockLogSet }),
}));

jest.mock('../../../../hooks/useWeightUnit.ts', () => ({
  useWeightUnit: () => 'kg',
}));

jest.mock('../../hooks/useExerciseTarget.ts', () => ({
  useExerciseTarget: () => ({
    target: {
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRpe: null,
      targetRir: null,
      targetPercent1rm: null,
      targetWeightKg: 60,
      tempo: null,
      targetRestSeconds: null,
    },
    history: { kind: 'ready', last: null, previous: null },
  }),
}));

const SESSION = 'session-local-1';
const EXERCISE_ID = 'exercise-1';
const LOGGED_AT = 1_757_600_000_000;

/** Three sets planned, and it stays three however many get logged. */
const PAGE: ExercisePage = {
  key: 'program-exercise-1',
  exerciseId: EXERCISE_ID,
  name: 'Back squat',
  position: 1,
  total: 1,
  supersetGroup: null,
  supersetPosition: null,
  supersetMemberCount: null,
  badge: '1',
  isRunStart: false,
  isRunEnd: false,
  targetSets: 3,
  setsLogged: null,
};

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  jest.clearAllMocks();
  mockLogSet.mockImplementation((input) =>
    Promise.resolve({
      localId: `set-local-${String(input.setNumber)}`,
      outboxId: `outbox-${String(input.setNumber)}`,
      setNumber: Number(input.setNumber),
      loggedAt: new Date(LOGGED_AT),
      entryMs: 4,
    }),
  );
});

describe('the Add set affordance', () => {
  it('is visible before the plan is finished', async () => {
    // AC 1. It is not a reward for completing the prescription — a client
    // may want to add a set INSTEAD of finishing every planned one.
    renderSlot();

    await waitFor(() => {
      expect(screen.getByTestId('add-set')).toBeTruthy();
    });
    expect(screen.getByLabelText('Add set 1')).toBeTruthy();
  });

  it('is still visible once the plan is finished', async () => {
    // AC 1, the other half: three of three logged, and nothing has changed
    // about the control except the number it names.
    await seedSets(3);
    renderSlot();

    await waitFor(() => {
      expect(screen.getByLabelText('Add set 4')).toBeTruthy();
    });
  });

  it('names the set it will add, never the plan', async () => {
    await seedSets(5);
    renderSlot();

    await waitFor(() => {
      expect(screen.getByLabelText('Add set 6')).toBeTruthy();
    });
  });

  it('names a warm-up rather than numbering it', async () => {
    // A warm-up claims no set number, so the label makes the same
    // substitution the composer's own confirm does.
    renderSlot();
    await waitFor(() => screen.getByTestId('set-flag-warmup'));

    fireEvent.press(screen.getByTestId('set-flag-warmup'));

    expect(screen.getByLabelText('Add warm-up set')).toBeTruthy();
    expect(screen.queryByLabelText('Add set 1')).toBeNull();
  });

  it('announces the set it hands over, because the composer is below a scroll view', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await seedSets(3);
    renderSlot();

    await waitFor(() => screen.getByLabelText('Add set 4'));
    fireEvent.press(screen.getByLabelText('Add set 4'));

    expect(announce).toHaveBeenCalledWith('Set 4 ready, 60 kilograms for 8 reps');
  });
});

describe('adding a set beyond the programmed count', () => {
  it('offers the extra set on the same composer, pre-filled by task 01’s rule', async () => {
    // AC 2. Three of three logged at 60 kg; the composer is already on set 4
    // and pre-filled from the set the client just did — not from the plan,
    // and not from a second card this task mounted.
    await seedSets(3);
    renderSlot();

    await waitFor(() => screen.getByLabelText('Add set 4'));
    fireEvent.press(screen.getByLabelText('Add set 4'));

    expect(screen.getByTestId('set-entry-row')).toBeTruthy();
    expect(screen.getByLabelText('Log set 4, 60 kilograms for 8 reps')).toBeTruthy();
  });

  it('logs it through the same path, with the number after the last one logged', async () => {
    // AC 3. `target_sets` is 3; the set that lands is 4.
    await seedSets(3);
    renderSlot();

    await waitFor(() => screen.getByLabelText('Add set 4'));
    fireEvent.press(screen.getByLabelText('Add set 4'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(1);
    });
    expect(mockLogSet.mock.calls[0]?.[0]).toMatchObject({
      sessionLocalId: SESSION,
      exerciseId: EXERCISE_ID,
      setNumber: 4,
    });
  });

  it('keeps incrementing for a second and a third extra set', async () => {
    // AC 4, and the task's named risk: computing from `target_sets` would
    // offer 4 three times over.
    await seedSets(3);
    renderSlot();

    await waitFor(() => screen.getByLabelText('Add set 4'));

    for (const next of [4, 5, 6]) {
      fireEvent.press(screen.getByLabelText(`Add set ${String(next)}`));
      fireEvent.press(screen.getByTestId('set-entry-confirm'));
      await waitFor(() => {
        expect(mockLogSet).toHaveBeenCalledTimes(next - 3);
      });
    }

    expect(mockLogSet.mock.calls.map((call) => call[0]?.setNumber)).toEqual([4, 5, 6]);
  });

  it('keeps the number going up after a set is withdrawn', async () => {
    // `set-entry/06` leaves a gap rather than renumbering, so the next set
    // after deleting 3 of 3 is 4 — the second way a plan-derived number
    // collides.
    await seedSets(3);
    renderSlot();

    await waitFor(() => screen.getByLabelText('Set 3, 60 kilograms for 8 reps, logged.'));
    fireEvent(
      screen.getByLabelText('Set 3, 60 kilograms for 8 reps, logged.'),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'delete' },
      },
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Add set 4')).toBeTruthy();
    });
  });
});

describe('when an editor is open', () => {
  it('brings the composer back, so the next set is reachable', async () => {
    // The one piece of state this affordance owns. While an editor is open
    // the composer is collapsed to `EditingBar` and carries no confirm.
    await seedSets(3);
    renderSlot();

    await waitFor(() => screen.getByLabelText('Set 1, 60 kilograms for 8 reps, logged.'));
    fireEvent.press(screen.getByLabelText('Set 1, 60 kilograms for 8 reps, logged.'));

    await waitFor(() => {
      expect(screen.getByTestId('editing-bar')).toBeTruthy();
    });
    expect(screen.queryByTestId('set-entry-row')).toBeNull();

    fireEvent.press(screen.getByLabelText('Add set 4'));

    await waitFor(() => {
      expect(screen.getByTestId('set-entry-row')).toBeTruthy();
    });
    expect(screen.queryByTestId('editing-bar')).toBeNull();
    expect(screen.getByLabelText('Log set 4, 60 kilograms for 8 reps')).toBeTruthy();
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

/** `set-entry/06`'s `useDeleteSet` needs a toast host; the app root is one. */
function renderSlot() {
  render(
    <ToastProvider>
      <SetEntrySlot page={PAGE} payload={null} sessionLocalId={SESSION} />
    </ToastProvider>,
  );
}

/** `count` working sets already in the mirror, as a force-quit would leave them. */
async function seedSets(count: number) {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SESSION,
    clientLocalId: SESSION,
    scheduledDate: '2026-09-11',
    status: 'in_progress',
    payloadJson: '{}',
    syncState: 'pending',
    updatedAt: LOGGED_AT,
  });

  for (let setNumber = 1; setNumber <= count; setNumber += 1) {
    await db.insert(localSetLogs).values({
      id: `seed-set-${String(setNumber)}`,
      clientLocalId: `seed-set-${String(setNumber)}`,
      sessionLocalId: SESSION,
      exerciseId: EXERCISE_ID,
      setNumber,
      reps: 8,
      weightKg: 60,
      isWarmup: false,
      isFailure: false,
      loggedAt: LOGGED_AT + setNumber * 60_000,
      syncState: 'synced',
    });
  }
}
