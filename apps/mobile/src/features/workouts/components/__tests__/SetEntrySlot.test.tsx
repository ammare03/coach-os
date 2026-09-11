import { density } from '@coachos/ui/theme';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { UpcomingExercise } from 'api/src/features/workouts/upcoming.ts';
import { AccessibilityInfo } from 'react-native';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type { LoggedSet } from '../../hooks/useLogSet.ts';
import type { ExercisePage } from '../../lib/exercise-pages.ts';
import { PLATE_PIP_TEST_ID } from '../PlateStack.tsx';
import { SetEntrySlot } from '../SetEntrySlot.tsx';

// The interaction §8.4 calls the core of the logger, tested the way a client
// meets it: by accessibility label, so the test doubles as the screen-reader
// check (`testing` §6).

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

let mockTarget: {
  target: Record<string, unknown> | null;
  history: { kind: string; last: unknown; previous: unknown };
};
jest.mock('../../hooks/useExerciseTarget.ts', () => ({
  useExerciseTarget: () => mockTarget,
}));

const PAGE: ExercisePage = {
  key: 'program-exercise-1',
  exerciseId: 'exercise-1',
  name: 'Back squat',
  position: 1,
  total: 3,
  supersetGroup: null,
  supersetPosition: null,
  supersetMemberCount: null,
  badge: '1',
  isRunStart: false,
  isRunEnd: false,
  targetSets: 3,
  setsLogged: null,
};

function logged(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    localId: 'set-local-1',
    outboxId: 'outbox-1',
    setNumber: 1,
    loggedAt: new Date('2026-09-11T10:00:00Z'),
    entryMs: 4,
    ...overrides,
  };
}

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  // The seed-read tests below write real rows through the fake; without a
  // reset they would leak into every test after them.
  sqlite.__reset();
  resetLocalDbForTests();

  mockTarget = {
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
  };
  mockLogSet.mockResolvedValue(logged());
});

function renderSlot(payload: LocalSessionPayload | null = null) {
  render(<SetEntrySlot page={PAGE} payload={payload} sessionLocalId="session-local-1" />);
}

/**
 * A payload whose library row is this page's exercise — where `equipment`
 * and `default_increment_kg` actually reach the device. `buildExercise`
 * defaults to a barbell at 2.5 kg.
 */
function payloadFor(exercise: Partial<UpcomingExercise> = {}): LocalSessionPayload {
  return {
    session: buildSession({
      exercises: [buildBlock({ programExerciseId: PAGE.key, exerciseId: PAGE.exerciseId })],
    }),
    exercises: [buildExercise({ id: PAGE.exerciseId, ...exercise })],
  };
}

describe('SetEntrySlot', () => {
  it('pre-fills both steppers so a similar-to-last-time set is two taps', async () => {
    // Last time: 80kg × 8. The client adjusts once and confirms — the §8.4
    // claim, and the whole reason the pre-fill exists.
    mockTarget.history = {
      kind: 'ready',
      last: { weightKg: 80, reps: 8, loggedAt: new Date('2026-09-04T10:00:00Z') },
      previous: null,
    };

    renderSlot();

    await waitFor(() => {
      expect(screen.getByLabelText('Log set 1, 80 kilograms for 8 reps')).toBeTruthy();
    });
  });

  it("falls back to the coach's prescribed weight when there is no history", async () => {
    renderSlot();

    // targetWeightKg 60, targetRepsMin 8 — the prescription, not a guess.
    await waitFor(() => {
      expect(screen.getByLabelText('Log set 1, 60 kilograms for 8 reps')).toBeTruthy();
    });
  });

  it('logs the set through useLogSet, never a raw insert, with the tap instant', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(1);
    });
    const call = mockLogSet.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      sessionLocalId: 'session-local-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      reps: 8,
      weightKg: 60,
    });
    // `set_logged.entry_ms` is how §19's budget gets proven in the field.
    expect(typeof call?.tapAtMs).toBe('number');
  });

  it('shows the logged set as a row the client can read back', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(screen.getByLabelText('Set 1, 60 kilograms for 8 reps, logged.')).toBeTruthy();
    });
  });

  it('advances the head to the next set without waiting for the write', async () => {
    // The 0ms half of the <100ms budget: the card re-describes itself in the
    // same tick as the tap, before the local write has resolved.
    let release: ((value: LoggedSet) => void) | undefined;
    mockLogSet.mockReturnValue(
      new Promise<LoggedSet>((resolve) => {
        release = resolve;
      }),
    );

    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    expect(screen.getByText('Set 2')).toBeTruthy();
    release?.(logged());
  });

  it('never issues the same set number twice under a double tap', async () => {
    let pending = 0;
    mockLogSet.mockImplementation((args) => {
      pending += 1;
      return Promise.resolve(logged({ localId: `set-local-${String(pending)}`, ...args }));
    });

    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(2);
    });
    const numbers = mockLogSet.mock.calls.map((call) => call[0]?.setNumber);
    expect(numbers).toEqual([1, 2]);
  });

  it('announces the logged set, because an optimistic write is otherwise silent', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(announce).toHaveBeenCalledWith('Set 1 logged, 60 kilograms for 8 reps');
    });
  });

  it('surfaces a local-mirror failure and hands the set number back', async () => {
    mockLogSet.mockRejectedValue(new Error('logSet: session "x" is not in progress (completed)'));

    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('set-entry-error')).toBeTruthy();
    });
    // The refused set number is reusable — the head goes back to Set 1.
    expect(screen.getByText('Set 1')).toBeTruthy();
  });

  it('says nothing at all when no set has been logged yet', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    // `COPY.md` §CO2 — an absence is not a failure, so it gets no dash, no
    // placeholder and no apology. The composer is the content.
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByTestId('set-entry-error')).toBeNull();
  });
});

// `set-entry/02` — the two fields the composer reads off the exercise, and
// the one sanctioned exception to the card's fixed height.

describe('SetEntrySlot · plate math', () => {
  it('draws what is actually on the bar for a barbell exercise', async () => {
    // 60 kg on a 20 kg bar is one 20 kg plate a side: two pips, mirrored.
    renderSlot(payloadFor());

    await waitFor(() => {
      expect(screen.getByLabelText('Plates per side: 20 kilograms')).toBeTruthy();
    });
    expect(pips()).toHaveLength(2);
  });

  it('draws no plates where "per side" means nothing, and still holds the band open', async () => {
    renderSlot(payloadFor({ equipment: 'cable' }));
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    expect(pips()).toHaveLength(0);
    // A collapsed band would move the confirm between a barbell exercise
    // and a cable one, which is the one thing this layout may not do.
    const rules = flattenStyle(screen.getByTestId('set-entry-context').props.style);
    expect(rules.some((rule) => rule.minHeight === 20)).toBe(true);
  });

  it("steps the weight by the exercise's own default_increment_kg", async () => {
    renderSlot(payloadFor({ defaultIncrementKg: 5 }));
    await waitFor(() => screen.getByLabelText('Increase Weight'));

    fireEvent.press(screen.getByLabelText('Increase Weight'));

    expect(screen.getByLabelText('Log set 1, 65 kilograms for 8 reps')).toBeTruthy();
  });

  it('steps by 2.5 kg when the exercise sets no increment', async () => {
    renderSlot(payloadFor({ defaultIncrementKg: null }));
    await waitFor(() => screen.getByLabelText('Increase Weight'));

    fireEvent.press(screen.getByLabelText('Increase Weight'));

    expect(screen.getByLabelText('Log set 1, 62.5 kilograms for 8 reps')).toBeTruthy();
  });

  it('sets the composer to the achievable load when the nearest line is tapped', async () => {
    // 61 kg: one 20 kg plate a side makes 60, and no pair makes the last
    // kilogram. Resolved in one tap, which is what the line is for.
    mockTarget.target = { ...mockTarget.target, targetWeightKg: 61 };

    renderSlot(payloadFor());
    const line = await screen.findByLabelText(
      'Set weight to 60 kilograms, the nearest these plates make',
    );

    fireEvent.press(line);

    expect(screen.getByLabelText('Log set 1, 60 kilograms for 8 reps')).toBeTruthy();
  });
});

// The property the whole design rests on: the confirm sits at the same
// screen coordinate for the whole session, so a client between reps finds
// it without looking. Every band is a fixed minimum, so the sum of the
// declared styles IS the card's height.

describe('SetEntrySlot · the composer never changes height', () => {
  it('is 205px for a barbell exercise', async () => {
    renderSlot(payloadFor());
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    expect(composerHeightPx()).toBe(205);
  });

  it('is 205px for an exercise with no plate breakdown', async () => {
    renderSlot(payloadFor({ equipment: 'cable' }));
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    expect(composerHeightPx()).toBe(205);
  });

  it('is 205px when the client has history to pre-fill from', async () => {
    mockTarget.history = {
      kind: 'ready',
      last: { weightKg: 80, reps: 8, loggedAt: new Date('2026-09-04T10:00:00Z') },
      previous: null,
    };

    renderSlot(payloadFor());
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    expect(composerHeightPx()).toBe(205);
  });

  it('is 205px when the device holds no library row for the exercise', async () => {
    renderSlot(null);
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    expect(composerHeightPx()).toBe(205);
  });

  it('is 229px, and only 229px, when the weight is not makeable', async () => {
    mockTarget.target = { ...mockTarget.target, targetWeightKg: 61 };

    renderSlot(payloadFor());
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    expect(composerHeightPx()).toBe(229);
  });
});

// `set-entry/04` — the flags in the RUNNING screen, not in an isolated
// composer. `SetFlagChips.test.tsx` proves the component and the write path;
// everything below proves the slot actually holds the state, feeds it to
// `logSet`, reads it back, and derives the set number around it.

describe('SetEntrySlot · warm-up and to-failure flags', () => {
  it('carries a warm-up from the chip into the logged set', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(1);
    });
    expect(mockLogSet.mock.calls[0]?.[0]).toMatchObject({ isWarmup: true, isFailure: false });
  });

  it('carries to-failure through too, and the two are independent', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-failure'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(1);
    });
    expect(mockLogSet.mock.calls[0]?.[0]).toMatchObject({ isWarmup: false, isFailure: true });
  });

  it('names the warm-up in the announcement rather than a set number it has not got', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(announce).toHaveBeenCalledWith('Warm-up set logged, 60 kilograms for 8 reps');
    });
  });

  it('speaks each chip in full, not the abbreviation the pill prints', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    // `Chip`'s `accessibilityLabel` passthrough, applied. The pill still
    // prints the short form the head band has room for.
    expect(screen.getByLabelText('Warm-up set')).toBeTruthy();
    expect(screen.getByLabelText('Taken to failure')).toBeTruthy();
    expect(screen.getByText('Warm-up')).toBeTruthy();
    expect(screen.getByText('To failure')).toBeTruthy();
  });
});

describe('SetEntrySlot · a warm-up consumes no set number', () => {
  beforeEach(() => {
    // Echo the caller's own arguments back, so the appended row carries the
    // number the slot actually asked for.
    let issued = 0;
    mockLogSet.mockImplementation((args) => {
      issued += 1;
      return Promise.resolve(logged({ localId: `set-local-${String(issued)}`, ...args }));
    });
  });

  it('gives the working set logged after a warm-up the number 1', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    // The ramp: warm-up on, log, warm-up off, log.
    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    // The head can say it again the moment the warm-up is off, which is the
    // visible half of the same claim.
    await waitFor(() => {
      expect(screen.getByText('Set 1')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(2);
    });

    const calls = mockLogSet.mock.calls.map((call) => call[0]);
    expect(calls[0]).toMatchObject({ setNumber: 1, isWarmup: true });
    expect(calls[1]).toMatchObject({ setNumber: 1, isWarmup: false });
  });

  it('still numbers a three-set ramp’s working sets 1, 2, 3', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(3);
    });

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(4);
    });
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(5);
    });

    const numbers = mockLogSet.mock.calls.map((call) => call[0]?.setNumber);
    // Three warm-ups at the unread floor, then the client's real sets.
    expect(numbers).toEqual([1, 1, 1, 1, 2]);
  });
});

describe('SetEntrySlot · what a confirm does to the flags', () => {
  beforeEach(() => {
    let issued = 0;
    mockLogSet.mockImplementation((args) => {
      issued += 1;
      return Promise.resolve(logged({ localId: `set-local-${String(issued)}`, ...args }));
    });
  });

  it('keeps warm-up on across a ramp, so it costs one tap and not one per set', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(2);
    });
    expect(mockLogSet.mock.calls.map((call) => call[0]?.isWarmup)).toEqual([true, true]);
    expect(screen.getByTestId('set-flag-warmup').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('clears to-failure after the one set it describes', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-failure'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(1);
    });

    // Marking every following set as taken to failure would be the product
    // asserting something untrue about the client, in the data their coach
    // reads (`COPY.md` §CO2).
    expect(screen.getByTestId('set-flag-failure').props.accessibilityState).toMatchObject({
      selected: false,
    });

    fireEvent.press(screen.getByTestId('set-entry-confirm'));
    await waitFor(() => {
      expect(mockLogSet).toHaveBeenCalledTimes(2);
    });
    expect(mockLogSet.mock.calls.map((call) => call[0]?.isFailure)).toEqual([true, false]);
  });

  it('hands to-failure back when the write is refused, exactly as it hands the number back', async () => {
    mockLogSet.mockRejectedValue(new Error('logSet: session "x" is not in progress (completed)'));

    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-failure'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('set-entry-error')).toBeTruthy();
    });
    // The tap is undone whole: a retry must not silently drop the flag.
    expect(screen.getByTestId('set-flag-failure').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });
});

describe('SetEntrySlot · the logged row’s one trailing occupant', () => {
  beforeEach(() => {
    // A previous session with a set 1, so the previous-performance line is
    // a real competitor for the slot rather than absent anyway.
    mockTarget.history = {
      kind: 'ready',
      // `last` stays null so the pre-fill is the coach's 60kg and the
      // spoken labels below are readable; `previous` is what the row's
      // trailing slot actually looks up.
      last: null,
      previous: {
        bySetNumber: new Map([
          [1, { weightKg: 80, reps: 8, loggedAt: new Date('2026-09-04T10:00:00Z') }],
        ]),
      },
    };
  });

  it('gives the slot to previous performance when neither flag is set', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('set-row-previous-set-local-1')).toBeTruthy();
    });
  });

  it('gives it to the flag tag instead when the set was taken to failure', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-failure'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      // Hidden from the reading order by design — the words reach a screen
      // reader through the row's own label instead.
      expect(
        screen.getByTestId('set-row-flag-set-local-1', { includeHiddenElements: true }),
      ).toBeTruthy();
    });
    expect(screen.queryByTestId('set-row-previous-set-local-1')).toBeNull();
    expect(
      screen.getByLabelText('Set 1, 60 kilograms for 8 reps, logged. Taken to failure.'),
    ).toBeTruthy();
  });

  it('gives a warm-up nothing at all — no line, no tag, no placeholder', async () => {
    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    // `last 80 × 8` beside a warm-up is the misleading comparison DB§22's
    // filter exists to prevent.
    await waitFor(() => {
      expect(screen.getByLabelText('Warm-up set, 60 kilograms for 8 reps, logged.')).toBeTruthy();
    });
    expect(screen.queryByTestId('set-row-previous-set-local-1')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });
});

describe('SetEntrySlot · the seed read after a force-quit', () => {
  it('brings both flags back from the mirror, not just the warm-up', async () => {
    await seedMirror();

    renderSlot();

    // The session reloads from `local_set_logs`; a flag that only ever
    // travelled in the outbox payload came back gone.
    await waitFor(() => {
      expect(screen.getByLabelText('Warm-up set, 40 kilograms for 10 reps, logged.')).toBeTruthy();
    });
    expect(
      screen.getByLabelText('Set 1, 82.5 kilograms for 6 reps, logged. Taken to failure.'),
    ).toBeTruthy();
  });

  it('numbers the next set after the seeded warm-up and working set 2', async () => {
    await seedMirror();

    renderSlot();
    await waitFor(() => screen.getByTestId('set-entry-confirm'));

    // One warm-up and one working set on disk: the warm-up contributes
    // nothing, so `max(working) + 1` is 2.
    expect(screen.getByText('Set 2')).toBeTruthy();
  });
});

/**
 * Two rows already on the device for this exercise and session — what a
 * client finds after force-quitting mid-workout: one warm-up, one working
 * set taken to failure.
 */
async function seedMirror() {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: 'session-local-1',
    clientLocalId: 'session-local-1',
    scheduledDate: '2026-09-11',
    status: 'in_progress',
    payloadJson: '{}',
    syncState: 'pending',
    updatedAt: 1_757_000_000_000,
  });
  // One statement per row: the SQLite fake's INSERT grammar takes a single
  // `VALUES (...)` tuple, so a two-row array silently writes only the first.
  await db.insert(localSetLogs).values({
    id: 'seed-warm',
    clientLocalId: 'seed-warm',
    sessionLocalId: 'session-local-1',
    exerciseId: 'exercise-1',
    setNumber: 1,
    reps: 10,
    weightKg: 40,
    isWarmup: true,
    isFailure: false,
    loggedAt: new Date('2026-09-11T09:50:00Z').getTime(),
  });
  await db.insert(localSetLogs).values({
    id: 'seed-work',
    clientLocalId: 'seed-work',
    sessionLocalId: 'session-local-1',
    exerciseId: 'exercise-1',
    setNumber: 1,
    reps: 6,
    weightKg: 82.5,
    isWarmup: false,
    isFailure: true,
    loggedAt: new Date('2026-09-11T09:55:00Z').getTime(),
  });
}

/**
 * The pips are hidden from the accessibility tree — the stack speaks for
 * all of them — so counting them at all needs `includeHiddenElements`.
 */
function pips() {
  return screen.queryAllByTestId(PLATE_PIP_TEST_ID, { includeHiddenElements: true });
}

/** The four fixed bands, plus the seam that is allowed to add exactly 24. */
function composerHeightPx(): number {
  const own = ['set-entry-head', 'set-entry-weight-band', 'set-entry-context', 'set-entry-action']
    .map((id) => styleHeight(screen.getByTestId(id).props.style))
    .reduce((total, height) => total + height, 0);

  // The seam contributes nothing itself; its occupant brings its own margin
  // and minimum, so the whole subtree is what counts.
  const seam = screen.getByTestId('set-entry-below');
  const below = seam
    // Host elements only — a composite and the host it renders carry the
    // same `style` prop, and counting both doubles every band.
    .findAll((node) => typeof node.type === 'string')
    .reduce((total, node) => total + styleHeight(node.props.style), 0);

  return own + below + density.coach.cardPadding * 2;
}

/** `minHeight` + `marginTop` — the only two properties any band here declares. */
function styleHeight(style: unknown): number {
  return flattenStyle(style).reduce((total, rule) => {
    const min = typeof rule.minHeight === 'number' ? rule.minHeight : 0;
    const top = typeof rule.marginTop === 'number' ? rule.marginTop : 0;
    return total + min + top;
  }, 0);
}

/** A style prop is an object, an array, or nested arrays — normalise before asserting. */
function flattenStyle(style: unknown): Record<string, unknown>[] {
  if (style === null || style === undefined) return [];
  if (Array.isArray(style)) return style.flatMap((entry) => flattenStyle(entry));
  if (typeof style !== 'object') return [];
  return [style as Record<string, unknown>];
}
