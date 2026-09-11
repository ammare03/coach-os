import { density } from '@coachos/ui/theme';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { UpcomingExercise } from 'api/src/features/workouts/upcoming.ts';
import { AccessibilityInfo } from 'react-native';

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

beforeEach(() => {
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
