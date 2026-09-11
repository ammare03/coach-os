import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { logSet } from '../../hooks/useLogSet.ts';
import { readPreviousSession } from '../../lib/last-performance.ts';
import { SetEntryRow } from '../SetEntryRow.tsx';
import {
  SET_FLAG_COPY,
  SetFlagChips,
  SetFlagTag,
  renderSetTrailing,
  speakSetTrailing,
} from '../SetFlagChips.tsx';
import { SetList } from '../SetList.tsx';
import { setRowInk, type LoggedSetView } from '../SetRow.tsx';

// `set-entry/04`. Three things have to hold, and the third is the only one
// that is not visible on screen: the flags toggle without costing the
// default working set a third tap, a warm-up reads as a warm-up on three
// channels that survive a greyscale render, and a warm-up NEVER becomes a
// client's "last time" — which is the flag's whole reason for existing
// (DB§22), and is proven here end to end rather than asserted.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: jest.fn(),
  asUuid: (value: string) => value,
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
});

const EXERCISE_ID = '018f4b1e-0000-7000-8000-0000000000cc';
const LAST_SESSION = '018f4b1e-0000-7000-8000-0000000000a1';
const THIS_SESSION = '018f4b1e-0000-7000-8000-0000000000a2';

describe('SetFlagChips', () => {
  it('toggles each flag independently, and neither reads the other back', () => {
    const onWarmupChange = jest.fn();
    const onFailureChange = jest.fn();
    render(
      <SetFlagChips
        isWarmup={false}
        isFailure={false}
        onWarmupChange={onWarmupChange}
        onFailureChange={onFailureChange}
      />,
    );

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-flag-failure'));

    expect(onWarmupChange).toHaveBeenCalledWith(true);
    expect(onFailureChange).toHaveBeenCalledWith(true);
  });

  it('turns a selected flag back off rather than only ever on', () => {
    const onWarmupChange = jest.fn();
    render(
      <SetFlagChips
        isWarmup
        isFailure={false}
        onWarmupChange={onWarmupChange}
        onFailureChange={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('set-flag-warmup'));

    expect(onWarmupChange).toHaveBeenCalledWith(false);
  });

  it('announces each chip as a button carrying its own selected state', () => {
    // `Chip`'s existing contract, deliberately — not a `switch` role. These
    // are two independent pills from an open set, and a second contract for
    // them would make one chip in the product behave unlike the rest.
    render(
      <SetFlagChips
        isWarmup
        isFailure={false}
        onWarmupChange={jest.fn()}
        onFailureChange={jest.fn()}
      />,
    );

    const warmup = screen.getByTestId('set-flag-warmup');
    const failure = screen.getByTestId('set-flag-failure');

    expect(warmup.props.accessibilityRole).toBe('button');
    expect(warmup.props.accessibilityState).toMatchObject({ selected: true });
    expect(failure.props.accessibilityState).toMatchObject({ selected: false });
  });

  it('gives every chip a 44pt target without growing the 33px pill', () => {
    render(
      <SetFlagChips
        isWarmup={false}
        isFailure={false}
        onWarmupChange={jest.fn()}
        onFailureChange={jest.fn()}
      />,
    );

    // `accessibility` §1 — bought with symmetric slop, which is `Chip`'s own
    // arithmetic; asserted here because this surface is used one-handed with
    // chalky hands and the floor is not negotiable.
    const slop = screen.getByTestId('set-flag-warmup').props.hitSlop as number;
    expect(33 + slop * 2).toBeGreaterThanOrEqual(44);
  });
});

describe('SET_FLAG_COPY', () => {
  it('says “to failure”, never “failed”', () => {
    // The client chose to take the set to failure — they did the thing their
    // coach asked. Nothing in the product judges them (`COPY.md` §CO2).
    expect(SET_FLAG_COPY.failureChip).toBe('To failure');
    expect(SET_FLAG_COPY.failureTag).toBe('to failure');
    // "Failed" would be the product's own verdict on a client who did
    // exactly what their coach asked.
    expect(Object.values(SET_FLAG_COPY).join(' ')).not.toMatch(/failed/i);
  });

  it('is sentence case on the controls and lower case on the tag', () => {
    expect(SET_FLAG_COPY.warmupChip).toBe('Warm-up');
    expect(SET_FLAG_COPY.failureTag).toBe(SET_FLAG_COPY.failureTag.toLowerCase());
  });

  it('carries no exclamation mark anywhere', () => {
    expect(Object.values(SET_FLAG_COPY).join(' ')).not.toContain('!');
  });
});

describe('the logged row’s one trailing occupant', () => {
  it('gives the slot to the flag tag ahead of this set’s previous performance', () => {
    renderSlot(flagged({ isFailure: true }));

    // `includeHiddenElements` because the tag is deliberately outside the
    // reading order — see the focus-stop test below.
    expect(
      screen.getByText(SET_FLAG_COPY.failureTag, { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByText('last 80 × 8')).toBeNull();
  });

  it('leaves the slot to previous performance when neither flag is set', () => {
    renderSlot(flagged({}));

    expect(screen.getByText('last 80 × 8')).toBeTruthy();
  });

  it('shows a warm-up nothing at all — no dash, no placeholder', () => {
    // "last 80 × 8" beside a 40kg warm-up is the misleading comparison
    // DB§22's filter exists to prevent, and an absence is not a failure.
    renderSlot(flagged({ isWarmup: true }));

    expect(screen.queryByText('last 80 × 8')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByTestId('slot').children).toHaveLength(0);
  });

  it('speaks the tag in the same priority order it draws it', () => {
    expect(
      speakSetTrailing(flagged({ isFailure: true }), 'Last time 80 kilograms for 8 reps.'),
    ).toBe(SET_FLAG_COPY.failureTagSpoken);
    expect(
      speakSetTrailing(flagged({ isWarmup: true }), 'Last time 80 kilograms for 8 reps.'),
    ).toBeUndefined();
    expect(speakSetTrailing(flagged({}), 'Last time 80 kilograms for 8 reps.')).toBe(
      'Last time 80 kilograms for 8 reps.',
    );
  });

  it('keeps the tag out of the reading order, so the row stays one focus stop', () => {
    render(<SetFlagTag testID="tag" />);

    // Invisible to the default query set is exactly the point: the words
    // reach a screen reader through the row's own label, not as a second
    // element beside it (`accessibility` §2).
    expect(screen.queryByTestId('tag')).toBeNull();

    const tag = screen.getByTestId('tag', { includeHiddenElements: true });
    expect(tag.props.accessibilityElementsHidden).toBe(true);
    expect(tag.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});

describe('a warm-up in the set list', () => {
  it('is de-emphasised on all three channels, and every one of them differs', () => {
    const warm = setRowInk({ isWarmup: true, setNumber: 1 });
    const working = setRowInk({ isWarmup: false, setNumber: 1 });

    expect(warm.glyph).not.toBe(working.glyph);
    expect(warm.numberTone).not.toBe(working.numberTone);
    expect(warm.loadTone).not.toBe(working.loadTone);
    expect(warm.tick).not.toBe(working.tick);
    // Muted, never absent: a warm-up is logged work and its receipt says so.
    expect(warm.tick).toBe('muted');
  });

  it('survives a greyscale render — the glyph carries it with no hue at all', () => {
    // The design's frame J. Strip colour and `W` versus `1` is still the
    // whole distinction, which is why channel 1 is a glyph and not a tint.
    expect(setRowInk({ isWarmup: true, setNumber: 3 }).glyph).toBe('W');
    expect(setRowInk({ isWarmup: false, setNumber: 3 }).glyph).toBe('3');
  });

  it('renders the W in the number cell rather than a number it does not have', () => {
    render(<SetList sets={[warmupRow(), workingRow()]} unit="kg" />);

    expect(within(screen.getByTestId('set-row-warm')).getByText('W')).toBeTruthy();
    expect(within(screen.getByTestId('set-row-warm')).queryByText('1')).toBeNull();
    expect(within(screen.getByTestId('set-row-work')).getByText('1')).toBeTruthy();
  });

  it('says what it is instead of claiming a set number', () => {
    render(<SetList sets={[warmupRow()]} unit="kg" />);

    expect(screen.getByLabelText('Warm-up set, 40 kilograms for 10 reps, logged.')).toBeTruthy();
  });

  it('merges the failure tag into the row’s single label rather than adding a stop', () => {
    render(
      <SetList
        sets={[failureRow()]}
        unit="kg"
        renderTrailing={(set) => renderSetTrailing(set, null)}
        renderTrailingLabel={(set) => speakSetTrailing(set, undefined)}
      />,
    );

    expect(
      screen.getByLabelText('Set 2, 82.5 kilograms for 6 reps, logged. Taken to failure.'),
    ).toBeTruthy();
  });
});

describe('logging a flagged set', () => {
  it('is still exactly two taps when neither flag is set', async () => {
    await seedSession(THIS_SESSION, 'in_progress');
    const logged = jest.fn();
    render(<Composer onLogged={logged} />);

    // Tap one is the stepper the client may not even need; tap two is the
    // confirm. The chips are never on that path (§8.4).
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(logged).toHaveBeenCalled();
    });
    const row = await readSet();
    expect(row).toMatchObject({ isWarmup: false, isFailure: false });
  });

  it('carries both flags from the chips into the local row', async () => {
    await seedSession(THIS_SESSION, 'in_progress');
    const logged = jest.fn();
    render(<Composer onLogged={logged} />);

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-flag-failure'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(logged).toHaveBeenCalled();
    });
    expect(await readSet()).toMatchObject({ isWarmup: true, isFailure: true });
  });

  it('omits the head label once warm-up is on, and names the warm-up on the confirm instead', async () => {
    await seedSession(THIS_SESSION, 'in_progress');
    render(<Composer onLogged={jest.fn()} />);

    expect(screen.getByText('Set 1')).toBeTruthy();

    fireEvent.press(screen.getByTestId('set-flag-warmup'));

    // `Warm-up set` needs ~86px of the ~71 the chips leave; wrapping the head
    // would take the card off 205. The selected chip is the label, and the
    // confirm is where a screen reader still hears which set this is.
    expect(screen.queryByText('Set 1')).toBeNull();
    expect(screen.getByLabelText('Log warm-up set, 40 kilograms for 10 reps')).toBeTruthy();
  });
});

describe('a warm-up is never a client’s “last time”', () => {
  // DB§22, and the acceptance criterion this whole task exists for. Proven
  // end to end — through the chip, the hook, and the mirror, into the query
  // the next session's target line actually runs.

  it('does not come back as the previous session for that exercise', async () => {
    await seedSession(LAST_SESSION, 'in_progress');
    const logged = jest.fn();
    render(<Composer sessionLocalId={LAST_SESSION} onLogged={logged} />);

    fireEvent.press(screen.getByTestId('set-flag-warmup'));
    fireEvent.press(screen.getByTestId('set-entry-confirm'));

    await waitFor(() => {
      expect(logged).toHaveBeenCalled();
    });
    expect(await readSet()).toMatchObject({ isWarmup: true });

    const db = await getLocalDb();
    const previous = await readPreviousSession(db, {
      exerciseId: EXERCISE_ID,
      excludeSessionLocalId: THIS_SESSION,
    });

    // The only set this client has ever logged for this exercise is a
    // warm-up, so there is no last time — not a 40kg one.
    expect(previous).toBeNull();
  });

  it('yields the slot to the working set logged beside it', async () => {
    await seedSession(LAST_SESSION, 'in_progress');

    // One warm-up and one working set, same exercise, same session — the
    // ordinary shape of a real first exercise.
    await logSet({
      sessionLocalId: LAST_SESSION,
      exerciseId: EXERCISE_ID,
      setNumber: 1,
      reps: 10,
      weightKg: 40,
      isWarmup: true,
      now: () => new Date('2026-09-04T10:00:00Z'),
    });
    await logSet({
      sessionLocalId: LAST_SESSION,
      exerciseId: EXERCISE_ID,
      setNumber: 2,
      reps: 8,
      weightKg: 80,
      now: () => new Date('2026-09-04T10:05:00Z'),
    });

    const db = await getLocalDb();
    const previous = await readPreviousSession(db, {
      exerciseId: EXERCISE_ID,
      excludeSessionLocalId: THIS_SESSION,
    });

    expect(previous?.last).toMatchObject({ weightKg: 80, reps: 8 });
    // And it is absent from the per-set grain too, not merely outranked:
    // the warm-up's own set number resolves to nothing.
    expect(previous?.bySetNumber.get(1)).toBeUndefined();
    expect(previous?.bySetNumber.get(2)).toMatchObject({ weightKg: 80 });
  });
});

/**
 * The composer wired to the write path exactly as `SetEntrySlot` wires it —
 * chips into local state, state into `logSet`. The seam under test is the
 * whole distance from a chip press to a row in `local_set_logs`.
 */
function Composer({
  sessionLocalId = THIS_SESSION,
  onLogged,
}: {
  sessionLocalId?: string;
  onLogged: () => void;
}) {
  const [isWarmup, setIsWarmup] = useState(false);
  const [isFailure, setIsFailure] = useState(false);

  return (
    <SetEntryRow
      setNumber={1}
      weight={40}
      reps={10}
      unit="kg"
      weightStep={2.5}
      onWeightChange={jest.fn()}
      onRepsChange={jest.fn()}
      isWarmup={isWarmup}
      isFailure={isFailure}
      onWarmupChange={setIsWarmup}
      onFailureChange={setIsFailure}
      onConfirm={() => {
        void logSet({
          sessionLocalId,
          exerciseId: EXERCISE_ID,
          setNumber: 1,
          reps: 10,
          weightKg: 40,
          isWarmup,
          isFailure,
          now: () => new Date('2026-09-08T10:00:00Z'),
        }).then(onLogged);
      }}
    />
  );
}

async function seedSession(clientLocalId: string, status: string) {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: clientLocalId,
    clientLocalId,
    scheduledDate: '2026-09-08',
    status,
    payloadJson: '{}',
    syncState: 'pending',
    updatedAt: 1_757_000_000_000,
  });
}

async function readSet() {
  const db = await getLocalDb();
  const [row] = await db.select().from(localSetLogs);
  return row;
}

function flagged(state: { isWarmup?: boolean; isFailure?: boolean }) {
  return { isWarmup: state.isWarmup ?? false, isFailure: state.isFailure ?? false };
}

/** The row's single trailing slot, with previous performance as the incumbent. */
function renderSlot(set: { isWarmup: boolean; isFailure: boolean }) {
  render(<View testID="slot">{renderSetTrailing(set, <Text>last 80 × 8</Text>)}</View>);
}

function warmupRow(): LoggedSetView {
  return {
    localId: 'warm',
    setNumber: 1,
    reps: 10,
    weightKg: 40,
    loggedAt: new Date('2026-09-08T10:00:00Z'),
    isWarmup: true,
  };
}

function workingRow(): LoggedSetView {
  return {
    localId: 'work',
    setNumber: 1,
    reps: 8,
    weightKg: 80,
    loggedAt: new Date('2026-09-08T10:05:00Z'),
    isWarmup: false,
  };
}

function failureRow(): LoggedSetView {
  return {
    localId: 'fail',
    setNumber: 2,
    reps: 6,
    weightKg: 82.5,
    loggedAt: new Date('2026-09-08T10:10:00Z'),
    isWarmup: false,
    isFailure: true,
  };
}
