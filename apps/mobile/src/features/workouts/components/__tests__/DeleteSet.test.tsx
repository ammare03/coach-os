// `jest.mock` is hoisted above these, so `ToastProvider` here is the trapped
// module's own — the real provider, with only `ConfirmModal` made explosive.
import { ToastProvider, UNDO_WINDOW_MS } from '@coachos/ui';
import { duration } from '@coachos/ui/theme';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { DELETE_SET_PROCEDURE, resetHiddenSetsForTests } from '../../hooks/useDeleteSet.ts';
import type { ExercisePage } from '../../lib/exercise-pages.ts';
import { SetEntrySlot } from '../SetEntrySlot.tsx';

// `set-entry/06` — withdrawing a set, from the list.
//
// `useDeleteSet.test.ts` owns the hook's contract: the outbox chain, the
// reused `client_local_id`, the captured instant. **This file owns the half
// a client can see**, and the one claim the whole task rests on:
//
//   nothing is deleted when delete is tapped — only hidden — so undo is a
//   remount and not a second mutation.
//
// So the delete path runs the REAL `useDeleteSet` against the real local
// mirror and the real `ToastProvider`, and every assertion is either about
// what is on screen or about the rows the device actually holds. A mocked
// hook here would assert that this component calls a function, which is not
// the risk.

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

jest.mock('../../hooks/useExerciseTarget.ts', () => ({
  useExerciseTarget: () => ({
    target: null,
    history: { kind: 'ready', last: null, previous: null },
  }),
}));

// The feature acceptance criterion, made executable: "deletion uses the
// undo-toast pattern from `screen-states/03`, never a confirm dialog".
// Everything else in `@coachos/ui` is the real thing — this suite renders a
// real `ToastProvider` and a real `Button` — but reaching for `ConfirmModal`
// from anywhere on this path fails the suite where it happens.
jest.mock('@coachos/ui', () => {
  const actual = jest.requireActual('@coachos/ui') as Record<string, unknown>;
  const mod: Record<string, unknown> = { ...actual };
  Object.defineProperty(mod, 'ConfirmModal', {
    enumerable: false,
    get() {
      throw new Error('set deletion must use the undo toast, never a confirm dialog');
    },
  });
  return mod;
});

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const SESSION = '018f4b1e-0000-7000-8000-0000000000a2';
const EXERCISE_ID = '018f4b1e-0000-7000-8000-0000000000cc';
const LOGGED_AT = 1_757_600_000_000;

/**
 * Real uuids, not readable strings. `enqueueMutation` rejects a
 * `reuseClientLocalId` that is not one — a fixture with `session-set-1` in it
 * makes the deferred commit fail rather than queue, which is exactly the
 * shape of a passing-for-the-wrong-reason test.
 */
function setLocalId(setNumber: number): string {
  return `018f4b1e-0000-7000-8000-0000000000d${String(setNumber)}`;
}

/** See `useLogSet.test.ts` — the outbox's Drizzle table may not be imported here. */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox
interface QueuedMutation {
  id: string;
  procedure: string;
  client_local_id: string;
  payload_json: string;
  depends_on: string | null;
}

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
  targetSets: 4,
  setsLogged: null,
};

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  // The hidden-set store is module scope and outlives a render, so a suite
  // that deletes must clear it or the next test starts with a hidden row.
  resetHiddenSetsForTests();
  jest.clearAllMocks();
  mockIsConnected = true;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the delete tap', () => {
  it('takes the row off screen immediately, with nothing deleted from SQLite', async () => {
    // The claim the whole task rests on. If this test ever passes with a row
    // missing from the mirror, "undo" has become a re-create.
    await seed();
    renderSlot();
    await takeDeleteAction(labelFor(1));

    expect(screen.queryByLabelText(labelFor(1))).toBeNull();
    expect(await readSets()).toHaveLength(1);
    expect(await readDeletes()).toHaveLength(0);
  });

  it('opens the undo toast rather than asking first', async () => {
    // `CLAUDE.md` §7.5 — the action performs, and the recovery window is
    // real. The `ConfirmModal` trap above covers the other half.
    await seed();
    renderSlot();
    await takeDeleteAction(labelFor(1));

    expect(screen.getByText('Set 1 deleted')).toBeTruthy();
    expect(screen.getByLabelText('Undo')).toBeTruthy();
  });

  it('names a warm-up by what it is, since it holds no set number', async () => {
    await seed({ isWarmup: true });
    renderSlot();
    await takeDeleteAction('Warm-up set, 60 kilograms for 8 reps, logged.');

    expect(screen.getByText('Warm-up set deleted')).toBeTruthy();
    expect(screen.queryByText('Set 1 deleted')).toBeNull();
  });

  it('offers delete as a custom action, so a gesture is never the only way', async () => {
    // `accessibility` §7 — a swipe is unreachable for many users, and the
    // row is one accessible element, so the equivalent has to live on it.
    await seed();
    renderSlot();
    await waitFor(() => {
      expect(screen.getByLabelText(labelFor(1))).toBeTruthy();
    });

    const row = screen.getByLabelText(labelFor(1));
    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete set' }]);
    // And it is still the row that edits — one element, two actions.
    expect(row.props.accessibilityHint).toBe('Double tap to edit');
  });
});

describe('undo', () => {
  it('puts the row back whole, and still nothing was ever deleted', async () => {
    await seed();
    renderSlot();
    await takeDeleteAction(labelFor(1));

    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    fireEvent.press(screen.getByLabelText('Undo'));

    // Back with its number, its load and its tick — because it never left
    // the data, only the render.
    expect(screen.getByLabelText(labelFor(1))).toBeTruthy();
    expect(await readSets()).toHaveLength(1);
    expect(await readDeletes()).toHaveLength(0);
  });

  it('queues nothing even after the window it was taken in would have closed', async () => {
    // The failure this guards: `onCommit` firing anyway, a few seconds
    // later, and the set the client brought back vanishing again.
    await seed();
    renderSlot();
    await takeDeleteAction(labelFor(1));
    fireEvent.press(screen.getByLabelText('Undo'));

    await elapseWindow();

    expect(screen.getByLabelText(labelFor(1))).toBeTruthy();
    expect(await readSets()).toHaveLength(1);
    expect(await readDeletes()).toHaveLength(0);
  });
});

describe('the window elapsing', () => {
  it('removes the row locally once and queues exactly one delete', async () => {
    await seed();
    renderSlot();
    await takeDeleteAction(labelFor(1));

    await elapseWindow();

    expect(await readSets()).toHaveLength(0);
    const deletes = await readDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.procedure).toBe(DELETE_SET_PROCEDURE);
    expect(screen.queryByLabelText(labelFor(1))).toBeNull();
  });

  it('leaves the set gone rather than letting a later render bring it back', async () => {
    await seed();
    renderSlot();
    await takeDeleteAction(labelFor(1));
    await elapseWindow();

    // The toast has gone; nothing on screen is offering the set back.
    expect(screen.queryByText('Set 1 deleted')).toBeNull();
    expect(screen.queryByLabelText(labelFor(1))).toBeNull();
  });
});

describe('set numbering', () => {
  it('leaves a gap instead of renumbering, and the next set carries on past it', async () => {
    // Delete set 2 of 3: the rows stay 1 and 3, and the composer offers 4.
    // Renumbering would silently re-point next week's "last time" at a
    // different set (`useDeleteSet` rule (d)).
    await seed();
    await seedSet(2, 65);
    await seedSet(3, 70);
    renderSlot();
    await takeDeleteAction(labelFor(2, 65));
    await elapseWindow();

    expect(screen.getByLabelText(labelFor(1))).toBeTruthy();
    expect(screen.getByLabelText(labelFor(3, 70))).toBeTruthy();
    expect(screen.getByText('Set 4')).toBeTruthy();
  });

  it('does not hand the next set a number a restored row still holds', async () => {
    // Delete the LAST set and the composer must keep counting past it —
    // otherwise logging while the window is open, then undoing, leaves two
    // rows with the same number.
    await seed();
    await seedSet(2, 65);
    renderSlot();
    await takeDeleteAction(labelFor(2, 65));

    expect(screen.getByText('Set 3')).toBeTruthy();
  });
});

describe('from the editor', () => {
  it('deletes the set the card is correcting and closes the card', async () => {
    await seed();
    renderSlot();
    await waitFor(() => {
      expect(screen.getByLabelText(labelFor(1))).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText(labelFor(1)));
    await waitFor(() => {
      expect(screen.getByTestId('set-entry-editor')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Delete set 1'));

    // A card correcting a set the client has just withdrawn is a card with
    // nothing behind it.
    expect(screen.queryByTestId('set-entry-editor')).toBeNull();
    expect(screen.queryByLabelText(labelFor(1))).toBeNull();
    expect(screen.getByText('Set 1 deleted')).toBeTruthy();
    // Still deferred — the editor is not a different kind of delete.
    expect(await readSets()).toHaveLength(1);
  });

  it('names the warm-up rather than a set number it does not have', async () => {
    await seed({ isWarmup: true });
    renderSlot();
    await waitFor(() => {
      expect(screen.getByLabelText('Warm-up set, 60 kilograms for 8 reps, logged.')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Warm-up set, 60 kilograms for 8 reps, logged.'));
    await waitFor(() => {
      expect(screen.getByTestId('set-entry-editor')).toBeTruthy();
    });

    expect(screen.getByLabelText('Delete warm-up set')).toBeTruthy();
  });
});

describe('two deletes at once', () => {
  it('gives each set its own window rather than collapsing them into one', async () => {
    // Two withdrawals are two decisions. One toast for both would offer a
    // single Undo for two of them, and spend the second set's window
    // waiting on the first.
    await seed();
    await seedSet(2, 65);
    renderSlot();
    await takeDeleteAction(labelFor(1));
    await takeDeleteAction(labelFor(2, 65));

    expect(screen.getByText('Set 1 deleted')).toBeTruthy();
    expect(screen.getByText('Set 2 deleted')).toBeTruthy();
    expect(screen.queryByLabelText(labelFor(1))).toBeNull();
    expect(screen.queryByLabelText(labelFor(2, 65))).toBeNull();

    await elapseWindow();

    expect(await readSets()).toHaveLength(0);
    expect(await readDeletes()).toHaveLength(2);
  });
});

describe('offline', () => {
  it('behaves identically with no connection, because nothing here awaits one', async () => {
    mockIsConnected = false;
    await seed();
    renderSlot();
    await takeDeleteAction(labelFor(1));

    // Same hide, same toast, same deferral.
    expect(screen.queryByLabelText(labelFor(1))).toBeNull();
    expect(screen.getByText('Set 1 deleted')).toBeTruthy();
    expect(await readSets()).toHaveLength(1);

    await elapseWindow();

    expect(await readSets()).toHaveLength(0);
    expect(await readDeletes()).toHaveLength(1);
    // Nothing on screen says anything about a network — offline is the
    // primary environment, not a failure.
    expect(screen.queryByTestId('set-entry-error')).toBeNull();
  });
});

describe('leaving the logger mid-window', () => {
  it('settles the open window rather than leaving an Undo for a row nobody can see', async () => {
    await seed();
    const view = renderSlot();
    await takeDeleteAction(labelFor(1));

    await act(async () => {
      view.unmount();
    });
    await flush();

    // Dismissing is a commit (`useUndoToast`): the client is done looking.
    expect(await readSets()).toHaveLength(0);
    expect(await readDeletes()).toHaveLength(1);
  });
});

// ── harness ─────────────────────────────────────────────────────────────

/** `set-entry/06`'s `useDeleteSet` needs a toast host; the app root is one. */
function renderSlot() {
  return render(
    <ToastProvider>
      <SetEntrySlot page={PAGE} payload={null} sessionLocalId={SESSION} />
    </ToastProvider>,
  );
}

/** One logged row's accessible label — the row is one element (`accessibility` §2). */
function labelFor(setNumber: number, weightKg = 60): string {
  return `Set ${String(setNumber)}, ${String(weightKg)} kilograms for 8 reps, logged.`;
}

/**
 * Deletes through the row's own custom action — the non-gesture entry point.
 * The swipe reaches the identical handler and is verified on hardware: a pan
 * is a UI-thread interaction with no meaningful Jest equivalent, exactly as
 * `@gorhom/bottom-sheet`'s drag is (`jest.native-mocks.js`).
 */
async function takeDeleteAction(label: string) {
  await waitFor(() => {
    expect(screen.getByLabelText(label)).toBeTruthy();
  });
  fireEvent(screen.getByLabelText(label), 'accessibilityAction', {
    nativeEvent: { actionName: 'delete' },
  });
  await flush();
}

/**
 * Closes every open undo window and lets the deferred commits land. The
 * extra `duration.state` is the toast's own exit — it is still mounted, and
 * still readable, for that long after it resolves.
 */
async function elapseWindow() {
  act(() => {
    jest.advanceTimersByTime(UNDO_WINDOW_MS + duration.state + 100);
  });
  await flush();
}

/**
 * The mirror is synchronous behind its promises, so draining the microtask
 * queue is enough — but the deferred commit is a chain of them (open the db,
 * read the set, read its session, enqueue, delete), so it takes more than a
 * handful. Counted generously rather than tuned: an extra resolved promise
 * costs nothing and a too-short flush is a flake.
 */
async function flush() {
  await act(async () => {
    for (let tick = 0; tick < 50; tick += 1) await Promise.resolve();
  });
}

async function seed(set: { isWarmup?: boolean } = {}) {
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
    id: setLocalId(1),
    clientLocalId: setLocalId(1),
    sessionLocalId: SESSION,
    exerciseId: EXERCISE_ID,
    setNumber: 1,
    reps: 8,
    weightKg: 60,
    isWarmup: set.isWarmup ?? false,
    isFailure: false,
    loggedAt: LOGGED_AT,
    syncState: 'synced',
  });
}

async function seedSet(setNumber: number, weightKg: number) {
  const db = await getLocalDb();
  await db.insert(localSetLogs).values({
    id: setLocalId(setNumber),
    clientLocalId: setLocalId(setNumber),
    sessionLocalId: SESSION,
    exerciseId: EXERCISE_ID,
    setNumber,
    reps: 8,
    weightKg,
    isWarmup: false,
    isFailure: false,
    loggedAt: LOGGED_AT + setNumber * 60_000,
    syncState: 'synced',
  });
}

async function readSets() {
  const db = await getLocalDb();
  return db.select().from(localSetLogs).orderBy(localSetLogs.setNumber);
}

async function readDeletes(): Promise<QueuedMutation[]> {
  const db = await getLocalDb();
  return db
    .all<QueuedMutation>(sql`SELECT * FROM outbox`)
    .filter((entry) => entry.procedure === DELETE_SET_PROCEDURE);
}
