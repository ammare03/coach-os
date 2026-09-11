import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type * as Haptics from 'expo-haptics';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import type { UpdateSetArgs, UpdateSetDeps, UpdatedSet } from '../../hooks/useUpdateSet.ts';
import type { ExercisePage } from '../../lib/exercise-pages.ts';
import { SetEntrySlot } from '../SetEntrySlot.tsx';

// `set-entry/05` — correcting a set that is already logged.
//
// The risk this file exists to pin is the one the task names: **a new
// `clientLocalId` on save would create a second server row instead of
// updating the existing one.** So the save path runs the REAL `updateSet`
// against the real local mirror and the assertions are made against the rows
// it leaves behind — with a pass-through spy on top, only to prove which key
// this component handed it. What the outbox does with that key is
// `useUpdateSet`'s own contract and is pinned in `useUpdateSet.test.ts`.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: jest.fn(),
  asUuid: (value: string) => value,
}));

let mockIsConnected = true;
jest.mock('../../../../lib/connectivity/useConnectivity.ts', () => ({
  useConnectivity: () => ({ isConnected: mockIsConnected }),
}));

jest.mock('../../../../hooks/useWeightUnit.ts', () => ({
  useWeightUnit: () => 'kg',
}));

/** Every `updateSet` this component made, in order. The real one still runs. */
const mockUpdateSetCalls: UpdateSetArgs[] = [];
jest.mock('../../hooks/useUpdateSet.ts', () => {
  const actual = jest.requireActual('../../hooks/useUpdateSet.ts') as {
    updateSet: (deps: UpdateSetDeps) => Promise<UpdatedSet>;
  };
  return {
    ...actual,
    useUpdateSet: () => ({
      updateSet: (args: UpdateSetArgs) => {
        mockUpdateSetCalls.push(args);
        return actual.updateSet(args);
      },
    }),
  };
});

jest.mock('../../hooks/useExerciseTarget.ts', () => ({
  useExerciseTarget: () => ({
    target: null,
    history: { kind: 'ready', last: null, previous: null },
  }),
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };
const haptics = jest.requireMock('expo-haptics') as typeof Haptics;

const SESSION = '018f4b1e-0000-7000-8000-0000000000a2';
const EXERCISE_ID = '018f4b1e-0000-7000-8000-0000000000cc';
const SET_LOCAL_ID = '018f4b1e-0000-7000-8000-0000000000d1';
/** The original tap instant. An edit corrects a value, not a time. */
const LOGGED_AT = 1_757_600_000_000;

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

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  jest.clearAllMocks();
  mockUpdateSetCalls.length = 0;
  mockIsConnected = true;
});

describe('editing a logged set', () => {
  it('opens the row for editing with its stored values pre-filled', async () => {
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');

    // The head names the set being corrected, and the confirm carries the
    // whole sentence — which is also the proof both steppers are pre-filled
    // from the stored row rather than from the composer's prefill.
    // Twice: the card's head and the collapsed bar, in the same words.
    expect(screen.getAllByText('Editing set 1')).toHaveLength(2);
    expect(screen.getByLabelText('Save set 1, 60 kilograms for 8 reps')).toBeTruthy();
  });

  it('collapses the pinned composer to the editing bar, so no set can be logged mid-edit', async () => {
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');

    // One `SetEntryRow` on screen, and it is the editor. With no confirm
    // pinned below, "confirm" has exactly one meaning.
    expect(screen.queryByTestId('set-entry-row')).toBeNull();
    expect(screen.getByTestId('set-entry-editor')).toBeTruthy();
    expect(screen.getByTestId('editing-bar')).toBeTruthy();
    // Two Cancels, deliberately: one in the card the client is reading, one
    // pinned where their thumb already is. Both say which set they abandon.
    expect(screen.getAllByLabelText('Cancel editing set 1')).toHaveLength(2);
  });

  it('updates the existing row rather than creating a second one', async () => {
    // The task's named risk. A regenerated key here would be a duplicate
    // server row, which is the one failure this whole path exists to avoid.
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Increase Reps'));
    fireEvent.press(screen.getByLabelText('Save set 1, 60 kilograms for 9 reps'));

    await waitFor(async () => {
      expect((await readSets())[0]?.reps).toBe(9);
    });

    const rows = await readSets();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientLocalId: SET_LOCAL_ID,
      reps: 9,
      weightKg: 60,
      setNumber: 1,
      // The original tap instant, preserved — the set does not move to the
      // moment it was corrected, which could cross a local day boundary.
      loggedAt: LOGGED_AT,
      // The device authored this and the server has not confirmed it.
      syncState: 'pending',
    });
  });

  it('corrects under the key the set already had, never a fresh one', async () => {
    // The other half of the same risk: `useUpdateSet` can only make this an
    // update if it is handed the row's existing `client_local_id`.
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Increase Weight'));
    fireEvent.press(screen.getByLabelText('Save set 1, 62.5 kilograms for 8 reps'));

    await waitFor(() => {
      expect(mockUpdateSetCalls).toHaveLength(1);
    });
    expect(mockUpdateSetCalls[0]).toEqual({
      setLocalId: SET_LOCAL_ID,
      reps: 8,
      weightKg: 62.5,
      isWarmup: false,
      isFailure: false,
    });
  });

  it('clears a weight stepped down to zero to bodyweight, not to a zero-kilogram lift', async () => {
    await seed({ reps: 8, weightKg: 2.5 });
    renderSlot();

    await openEditor('Set 1, 2.5 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Decrease Weight'));
    fireEvent.press(screen.getByLabelText('Save set 1, 8 reps'));

    await waitFor(() => {
      expect(mockUpdateSetCalls).toHaveLength(1);
    });
    expect(mockUpdateSetCalls[0]?.weightKg).toBeNull();
    await waitFor(async () => {
      expect((await readSets())[0]?.weightKg).toBeNull();
    });
  });

  it('shows the corrected value on the row it came from', async () => {
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Increase Reps'));
    fireEvent.press(screen.getByLabelText('Save set 1, 60 kilograms for 9 reps'));

    await waitFor(() => {
      expect(screen.getByLabelText('Set 1, 60 kilograms for 9 reps, logged.')).toBeTruthy();
    });
    // Back to the ordinary state: the composer returns, the bar is gone.
    expect(screen.getByTestId('set-entry-row')).toBeTruthy();
    expect(screen.queryByTestId('editing-bar')).toBeNull();
  });

  it('fires no haptic on save — a correction logs nothing new', async () => {
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Increase Reps'));
    fireEvent.press(screen.getByLabelText('Save set 1, 60 kilograms for 9 reps'));

    await waitFor(async () => {
      expect((await readSets())[0]?.reps).toBe(9);
    });
    // `hapticSetLogged()` is create-only (design spec). A second buzz for a
    // fix would read as a second set.
    expect(haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('carries both flags through the correction', async () => {
    // A mis-tapped flag is the same class of mistake as a mis-tapped weight;
    // refusing it would force delete-and-re-log.
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByTestId('set-flag-failure'));
    fireEvent.press(screen.getByLabelText('Save set 1, 60 kilograms for 8 reps'));

    await waitFor(async () => {
      expect((await readSets())[0]?.isFailure).toBe(true);
    });
    expect((await readSets())[0]?.isWarmup).toBe(false);
  });
});

describe('cancelling an edit', () => {
  it('leaves the stored row untouched and writes nothing at all', async () => {
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Increase Reps'));
    // The pinned one — the only control the collapsed composer carries.
    fireEvent.press(screen.getByTestId('editing-bar-cancel'));

    await waitFor(() => {
      expect(screen.getByTestId('set-entry-row')).toBeTruthy();
    });

    // Nothing was written until the confirm, so Cancel has nothing to undo —
    // not the mirror, and not a mutation anyone has to retract.
    expect((await readSets())[0]).toMatchObject({ reps: 8, weightKg: 60, syncState: 'synced' });
    expect(mockUpdateSetCalls).toHaveLength(0);
    expect(screen.getByLabelText('Set 1, 60 kilograms for 8 reps, logged.')).toBeTruthy();
  });

  it('re-opens from the stored values, never from the abandoned draft', async () => {
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Increase Reps'));
    // The one in the card, this time — the two do the same thing.
    fireEvent.press(screen.getByTestId('set-entry-cancel-edit'));

    await waitFor(() => screen.getByTestId('set-entry-row'));
    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');

    expect(screen.getByLabelText('Save set 1, 60 kilograms for 8 reps')).toBeTruthy();
  });

  it('drops the edit affordance from every other row while one is open', async () => {
    // Design frame F: no second row offers "Double tap to edit" while an
    // editor is open, so no stray tap can discard the draft.
    await seed({ reps: 8, weightKg: 60 });
    await seedSecondSet();
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');

    const other = screen.getByLabelText('Set 2, 65 kilograms for 8 reps, logged.');
    expect(other.props.accessibilityRole).toBeUndefined();
    expect(other.props.accessibilityHint).toBeUndefined();
  });
});

describe('editing a warm-up', () => {
  it('names it rather than numbering it, in the card and on the bar', async () => {
    await seed({ reps: 10, weightKg: 40, isWarmup: true });
    renderSlot();

    await openEditor('Warm-up set, 40 kilograms for 10 reps, logged.');

    // Set 1 is the first *working* set, so a warm-up has no number to print.
    expect(screen.getAllByText('Editing warm-up')).toHaveLength(2);
    expect(screen.queryByText('Editing set 1')).toBeNull();
    expect(screen.getByLabelText('Save warm-up set, 40 kilograms for 10 reps')).toBeTruthy();
    expect(screen.getAllByLabelText('Cancel editing warm-up')).toHaveLength(2);
  });
});

describe('offline and online', () => {
  it.each([true, false])('runs the identical path with isConnected=%s', async (connected) => {
    // Nothing on this surface may imply a network: no spinner, no pending
    // tint, no disabled window. The write is two local SQLite rows either
    // way (`useUpdateSet`).
    mockIsConnected = connected;
    await seed({ reps: 8, weightKg: 60 });
    renderSlot();

    await openEditor('Set 1, 60 kilograms for 8 reps, logged.');
    fireEvent.press(screen.getByLabelText('Increase Reps'));
    fireEvent.press(screen.getByLabelText('Save set 1, 60 kilograms for 9 reps'));

    await waitFor(async () => {
      expect((await readSets())[0]?.reps).toBe(9);
    });

    expect(mockUpdateSetCalls).toEqual([
      { setLocalId: SET_LOCAL_ID, reps: 9, weightKg: 60, isWarmup: false, isFailure: false },
    ]);
    expect(screen.getByLabelText('Set 1, 60 kilograms for 9 reps, logged.')).toBeTruthy();
    expect(screen.queryByTestId('set-entry-error')).toBeNull();
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

function renderSlot() {
  render(<SetEntrySlot page={PAGE} payload={null} sessionLocalId={SESSION} />);
}

/** Waits for the logged row, then taps it. The row is a button; this is what it does. */
async function openEditor(label: string) {
  await waitFor(() => {
    expect(screen.getByLabelText(label)).toBeTruthy();
  });
  const row = screen.getByLabelText(label);
  expect(row.props.accessibilityHint).toBe('Double tap to edit');
  fireEvent.press(row);
  await waitFor(() => {
    expect(screen.getByTestId('set-entry-editor')).toBeTruthy();
  });
}

async function seed(set: { reps: number; weightKg: number; isWarmup?: boolean }) {
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
  await db.insert(localSetLogs).values({
    id: SET_LOCAL_ID,
    clientLocalId: SET_LOCAL_ID,
    sessionLocalId: SESSION,
    exerciseId: EXERCISE_ID,
    setNumber: 1,
    reps: set.reps,
    weightKg: set.weightKg,
    isWarmup: set.isWarmup ?? false,
    isFailure: false,
    loggedAt: LOGGED_AT,
    syncState: 'synced',
  });
}

/** A second working set, so "every other row" has something to be. */
async function seedSecondSet() {
  const db = await getLocalDb();
  await db.insert(localSetLogs).values({
    id: `${SET_LOCAL_ID}-2`,
    clientLocalId: `${SET_LOCAL_ID}-2`,
    sessionLocalId: SESSION,
    exerciseId: EXERCISE_ID,
    setNumber: 2,
    reps: 8,
    weightKg: 65,
    isWarmup: false,
    isFailure: false,
    loggedAt: LOGGED_AT + 60_000,
    syncState: 'synced',
  });
}

async function readSets() {
  const db = await getLocalDb();
  return db.select().from(localSetLogs).orderBy(localSetLogs.setNumber);
}
