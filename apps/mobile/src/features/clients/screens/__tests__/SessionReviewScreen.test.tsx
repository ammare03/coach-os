import { fireEvent, render, screen } from '@testing-library/react-native';
import { TRPCClientError } from '@trpc/client';

import type {
  SessionReview,
  SessionReviewExerciseGroup,
  SessionReviewSet,
  SessionReviewSkippedExercise,
} from '../../api.ts';
import { formatSessionWhen, SessionReviewScreen } from '../SessionReviewScreen.tsx';

// The four states `ui-conventions` §4 requires, plus the five things this
// screen is actually for: the server's order is the screen's order, a
// record is highlighted, a figure that cannot be computed is absent rather
// than zeroed, the comment column is reserved on every row, and Close works
// in every state — a modal that cannot be dismissed is a trap.

const SESSION_ID = '01924f2c-0000-7000-8000-0000000000aa';
const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';
const CLIENT_TZ = 'Asia/Kolkata';

interface MockReview {
  data?: SessionReview;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
}

let mockReview: MockReview;

jest.mock('../../api.ts', () => {
  const actual = jest.requireActual('../../api.ts') as Record<string, unknown>;
  return {
    ...actual,
    useSessionReview: () => mockReview,
  };
});

jest.mock('../../../../hooks/useWeightUnit.ts', () => ({ useWeightUnit: () => 'kg' }));

let nextSetId = 0;

function makeSet(overrides: Partial<SessionReviewSet> = {}): SessionReviewSet {
  nextSetId += 1;
  return {
    setLogId: `set-${String(nextSetId)}`,
    setNumber: 1,
    reps: 8,
    weightKg: 92.5,
    rpe: 8,
    rir: null,
    durationSeconds: null,
    distanceM: null,
    estimated1rmKg: 115,
    isWarmup: false,
    isFailure: false,
    notes: null,
    loggedAt: new Date('2026-09-09T12:42:00.000Z'),
    personalRecordTypes: [],
    ...overrides,
  };
}

/** The design's own bench block — `formatTargetScheme` prints it `4 × 6–8 · RPE 8`. */
const BENCH_TARGET: NonNullable<SessionReviewExerciseGroup['target']> = {
  targetSets: 4,
  targetRepsMin: 6,
  targetRepsMax: 8,
  targetRpe: 8,
  targetRir: null,
  targetPercent1rm: null,
  targetWeightKg: null,
  tempo: null,
  targetRestSeconds: null,
};

/**
 * A prescribed group by default, because that is the ordinary session.
 *
 * The two groups the server guarantees carry `target: null` — a swap and an
 * exercise the day never prescribed — pass it explicitly below, so the
 * invariant is visible in the test rather than folded into this factory.
 */
function makeGroup(
  overrides: Partial<SessionReviewExerciseGroup> = {},
): SessionReviewExerciseGroup {
  return {
    kind: 'performed',
    exerciseId: 'ex-bench',
    exerciseName: 'Barbell Bench Press',
    substitutedFor: null,
    target: BENCH_TARGET,
    sets: [makeSet()],
    ...overrides,
  };
}

function makeSkip(
  overrides: Partial<SessionReviewSkippedExercise> = {},
): SessionReviewSkippedExercise {
  return {
    kind: 'skipped',
    exerciseName: 'Dumbbell Lateral Raise',
    reasonLabel: 'out of time',
    note: 'Gym closed at 8.',
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionReview> = {}): SessionReview {
  return {
    sessionId: SESSION_ID,
    clientId: CLIENT_ID,
    clientName: 'Priya Sharma',
    // Deliberately NOT the zone this test runner is in. Every date-line
    // assertion below turns on the difference (`CLAUDE.md` §25.5).
    clientTimezone: CLIENT_TZ,
    scheduledDate: '2026-09-09',
    name: 'Upper A · Push',
    status: 'completed',
    // 12:42 UTC is 6:12 pm in Kolkata and 8:42 am in Toronto — the same
    // instant, two answers, which is the whole point of the field.
    startedAt: new Date('2026-09-09T12:42:00.000Z'),
    completedAt: new Date('2026-09-09T13:30:00.000Z'),
    durationSeconds: 2880,
    totalVolumeKg: 7240,
    perceivedExertion: 8,
    clientNotes: 'Bench felt strong — finally got the 102.5.',
    skipReason: null,
    reviewedAt: new Date('2026-09-09T14:00:00.000Z'),
    exercises: [makeGroup()],
    ...overrides,
  };
}

function settle(session: SessionReview): void {
  mockReview = {
    data: session,
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  };
}

function fail(error: unknown): void {
  mockReview = { isPending: false, isError: true, error, refetch: jest.fn() };
}

function notYourClient(): TRPCClientError<never> {
  const error = new TRPCClientError<never>('Not found');
  // `getErrorCode` reads `error.data.appCode` — the shape `ERRORS.md` ER§2.1
  // puts on a session belonging to somebody else's client.
  Object.assign(error, { data: { appCode: 'NOT_YOUR_CLIENT' } });
  return error;
}

const onClose = jest.fn();

function renderScreen() {
  return render(<SessionReviewScreen sessionId={SESSION_ID} onClose={onClose} />);
}

/** Every exercise row the screen drew, in the order it drew them. */
function renderedEntryOrder(): string[] {
  return screen
    .getAllByTestId(/^session-(group|skip)-/)
    .map((node) => String(node.props.testID as string));
}

beforeEach(() => {
  onClose.mockClear();
  nextSetId = 0;
  settle(makeSession());
});

describe('SessionReviewScreen states', () => {
  it('shows the real layout as a skeleton, not a spinner, on the first load', () => {
    mockReview = { isPending: true, isError: false, error: null, refetch: jest.fn() };
    renderScreen();

    expect(screen.getByTestId('session-review-loading')).toBeOnTheScreen();
    expect(screen.getByLabelText("Loading this session's sets")).toBeOnTheScreen();
    expect(screen.queryByTestId('session-figures')).toBeNull();
  });

  it('keeps Close working while the read is in flight', () => {
    mockReview = { isPending: true, isError: false, error: null, refetch: jest.fn() };
    renderScreen();

    fireEvent.press(screen.getByTestId('session-review-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers a retry, and says nothing the client logged is affected', () => {
    fail(new Error('offline'));
    renderScreen();

    expect(screen.getByText("We couldn't load this session")).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Check your connection and try again. Nothing your client logged is affected.',
      ),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Try again'));
    expect(mockReview.refetch).toHaveBeenCalledTimes(1);
  });

  it('says not found — never forbidden — for a session that is not this coach’s', () => {
    fail(notYourClient());
    renderScreen();

    expect(screen.getByTestId('session-review-not-found')).toBeOnTheScreen();
    expect(screen.getByText("We couldn't find that session")).toBeOnTheScreen();
    expect(
      screen.getByText('It may have been deleted, or the link is out of date.'),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Back to client'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('states the fact, and offers no action, for a session that recorded nothing', () => {
    settle(makeSession({ exercises: [], totalVolumeKg: null, durationSeconds: null }));
    renderScreen();

    expect(screen.getByTestId('session-review-empty')).toBeOnTheScreen();
    expect(screen.getByText('No sets logged')).toBeOnTheScreen();
    expect(screen.getByText('This session was opened but nothing was recorded.')).toBeOnTheScreen();
    // No settled total to state, so there is no card at all — and no `0 kg`.
    expect(screen.queryByTestId('session-figures')).toBeNull();
    expect(screen.queryByText(/^0/)).toBeNull();
  });

  it('renders the client’s own words even when nothing was logged', () => {
    settle(
      makeSession({
        exercises: [],
        totalVolumeKg: null,
        durationSeconds: null,
        clientNotes: 'Gym was packed, couldn’t get a rack. Came home.',
      }),
    );
    renderScreen();

    expect(screen.getByTestId('session-client-note')).toBeOnTheScreen();
    expect(screen.getByText('Gym was packed, couldn’t get a rack. Came home.')).toBeOnTheScreen();
  });
});

describe('SessionReviewScreen header', () => {
  it('reserves the reviewed slot while the read is in flight, and hides it from a screen reader', () => {
    mockReview = { isPending: true, isError: false, error: null, refetch: jest.fn() };
    renderScreen();

    // Reserved, not removed — the box is there and holds the bar's shape.
    // `includeHiddenElements` is what proves the second half: by default
    // RNTL will not match an element hidden from the accessibility tree, so
    // the plain query finding nothing IS the screen-reader assertion.
    expect(screen.queryByTestId('session-review-reviewed')).toBeNull();
    const slot = screen.getByTestId('session-review-reviewed', { includeHiddenElements: true });
    expect(slot.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('lets the reviewed state arrive once the read has landed — there is no control to press', () => {
    renderScreen();

    const slot = screen.getByTestId('session-review-reviewed');
    expect(slot.props.importantForAccessibility).toBe('auto');
    expect(screen.getByText('Reviewed')).toBeOnTheScreen();
    expect(screen.queryByText(/mark (as )?reviewed/i)).toBeNull();
  });

  it('names the client and the client’s own training day', () => {
    renderScreen();
    expect(screen.getByText('Priya Sharma · logged Wed 9 Sep')).toBeOnTheScreen();
  });

  it('names the client on a deep link, with nothing else in the cache', () => {
    // There IS no other cache entry here: the screen renders bare, with
    // only `session.review` mocked, which is exactly the deep-link case.
    // The name arrives with the session or not at all, and the assertion
    // that it arrives is the assertion that nothing else is consulted.
    renderScreen();

    expect(screen.getByText('Priya Sharma · logged Wed 9 Sep')).toBeOnTheScreen();
    expect(screen.queryByText(/^Logged /)).toBeNull();
  });

  it('names whoever the session says, not a name held from somewhere else', () => {
    settle(makeSession({ clientName: 'Arjun Mehta' }));
    renderScreen();

    expect(screen.getByText('Arjun Mehta · logged Wed 9 Sep')).toBeOnTheScreen();
    expect(screen.queryByText(/Priya Sharma/)).toBeNull();
  });
});

/** What the date line says, in the case it was written rather than the case it is shown in. */
function whenLabel(): string {
  return String(screen.getByTestId('session-review-when').props.accessibilityLabel);
}

// `CLAUDE.md` §25.5, and the reason the screen shipped without a time of
// day at all until the payload carried a zone. The DAY comes from
// `scheduledDate`, which is already the client's; the TIME comes from
// `startedAt`, which is an instant and means nothing without the client's
// zone. These are the tests that catch a coach in Mumbai being shown a
// Toronto client's 8:42 am session as 6:12 pm.
//
// The rendered assertions never pin a clock reading, because the runner's
// own locale decides 12- versus 24-hour and `pnpm check` runs on more than
// one machine. What is pinned is asserted through `formatSessionWhen`'s
// `locales` argument, which exists for exactly that.
describe('SessionReviewScreen date line', () => {
  it('spells the day, the time of day, and the zone’s own name', () => {
    // The design's line, character for character, for a coach reading on
    // an Indian device.
    expect(formatSessionWhen(makeSession(), 'en-IN')).toBe('Wed 9 Sep · 6:12 pm IST');

    // And for one whose locale has no short name for that zone: the
    // formatter falls back to the offset, and this file keeps no table of
    // abbreviations to disagree with it.
    expect(formatSessionWhen(makeSession(), 'en-US')).toMatch(/^Wed 9 Sep · 6:12 PM \S+$/);
    expect(formatSessionWhen(makeSession(), 'en-GB')).toMatch(/^Wed 9 Sep · 18:12 \S+$/);
  });

  it('re-reads the same instant when only the zone changes', () => {
    renderScreen();
    const kolkata = whenLabel();

    screen.unmount();
    const abroad = makeSession({ clientTimezone: 'America/Toronto' });
    settle(abroad);
    renderScreen();
    const toronto = whenLabel();

    // Same `startedAt`, same `scheduledDate`, different zone. A screen
    // rendering the instant in the DEVICE's zone prints the same string
    // twice, and this is the assertion it fails.
    expect(toronto).not.toBe(kolkata);
    expect(kolkata.startsWith('Wed 9 Sep · ')).toBe(true);
    expect(toronto.startsWith('Wed 9 Sep · ')).toBe(true);

    expect(formatSessionWhen(abroad, 'en-IN')).toMatch(/^Wed 9 Sep · 8:42 am \S+$/);
  });

  it('takes the day from scheduledDate, never from the instant', () => {
    // 19:15 UTC on the 9th is 00:45 on the TENTH in Kolkata. The client
    // trained on their own local 9th, and `scheduledDate` is the only
    // field that knows it — re-deriving the day from `startedAt` would
    // move this session a day forward.
    const nearMidnight = makeSession({
      scheduledDate: '2026-09-09',
      startedAt: new Date('2026-09-09T19:15:00.000Z'),
    });
    settle(nearMidnight);
    renderScreen();

    expect(whenLabel().startsWith('Wed 9 Sep · ')).toBe(true);
    expect(whenLabel()).not.toContain('10 Sep');
    expect(formatSessionWhen(nearMidnight, 'en-IN')).toBe('Wed 9 Sep · 12:45 am IST');
  });

  it('renders the day alone, with no dangling separator, when nothing was started', () => {
    settle(
      makeSession({
        status: 'skipped',
        startedAt: null,
        completedAt: null,
        exercises: [],
        totalVolumeKg: null,
        durationSeconds: null,
        clientNotes: null,
        skipReason: 'travelling',
      }),
    );
    renderScreen();

    expect(whenLabel()).toBe('Wed 9 Sep');
    expect(screen.getByText('WED 9 SEP')).toBeOnTheScreen();
  });

  it('degrades to the day alone rather than throwing on a zone it cannot read', () => {
    // `users.timezone` is free text with a `'UTC'` default and no IANA
    // check behind it, and `Intl` raises on an unknown one. A header
    // detail must not take the screen down with it.
    settle(makeSession({ clientTimezone: 'Mars/Olympus_Mons' }));
    renderScreen();

    expect(whenLabel()).toBe('Wed 9 Sep');
    expect(screen.getByTestId('session-review-scroll')).toBeOnTheScreen();
  });

  it('speaks exactly what it shows', () => {
    renderScreen();

    expect(screen.getByText(whenLabel().toUpperCase())).toBeOnTheScreen();
  });
});

describe('SessionReviewScreen figures', () => {
  it('states volume, time and exertion as one sentence', () => {
    renderScreen();

    expect(
      screen.getByLabelText('Session totals. Volume, 7240 kilograms. Time, 48 minutes. RPE, 8.'),
    ).toBeOnTheScreen();
  });

  it('removes a cell it cannot compute rather than rendering a zero', () => {
    settle(
      makeSession({
        totalVolumeKg: null,
        perceivedExertion: null,
        exercises: [
          makeGroup({
            exerciseId: 'ex-leg-raise',
            exerciseName: 'Hanging Leg Raise',
            // A movement the client added themselves: the day prescribed
            // nothing for it.
            target: null,
            sets: [
              makeSet({ weightKg: null, reps: 12, rpe: null }),
              makeSet({ setNumber: 2, weightKg: null, reps: 10, rpe: null }),
            ],
          }),
        ],
      }),
    );
    renderScreen();

    // Volume and RPE are gone; Sets stands in for the volume that does not
    // exist, and nothing renders `0` or a dash.
    expect(screen.queryByText('VOLUME')).toBeNull();
    expect(screen.queryByText('RPE')).toBeNull();
    expect(screen.getByText('SETS')).toBeOnTheScreen();
    expect(screen.getByText('TIME')).toBeOnTheScreen();
    expect(screen.getByLabelText('Session totals. Time, 48 minutes. Sets, 2.')).toBeOnTheScreen();
    expect(screen.getByText('Bodyweight × 12')).toBeOnTheScreen();
  });
});

describe('SessionReviewScreen exercises', () => {
  it('renders the server’s one ordered list in order, with the skip interleaved', () => {
    settle(
      makeSession({
        exercises: [
          makeGroup({ exerciseId: 'ex-bench', exerciseName: 'Barbell Bench Press' }),
          makeGroup({ exerciseId: 'ex-incline', exerciseName: 'Incline Dumbbell Press' }),
          makeSkip(),
          makeGroup({
            exerciseId: 'ex-shoulder',
            exerciseName: 'Dumbbell Shoulder Press',
            substitutedFor: 'Barbell Overhead Press',
            target: null,
          }),
        ],
      }),
    );
    renderScreen();

    expect(renderedEntryOrder()).toEqual([
      'session-group-ex-bench',
      'session-group-ex-incline',
      'session-skip-Dumbbell Lateral Raise',
      'session-group-ex-shoulder',
    ]);
  });

  it('renders a skipped exercise as an explicit row, in the client’s own words', () => {
    settle(makeSession({ exercises: [makeSkip()] }));
    renderScreen();

    expect(screen.getByText('Dumbbell Lateral Raise')).toBeOnTheScreen();
    expect(screen.getByText('SKIPPED')).toBeOnTheScreen();
    expect(screen.getByText('Out of time · “Gym closed at 8.”')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Dumbbell Lateral Raise. Skipped. Out of time. Gym closed at 8.'),
    ).toBeOnTheScreen();
  });

  it('states what the day asked for, beside the movement it asked for it on', () => {
    renderScreen();

    // `packages/utils`' own string, not a second one assembled here — the
    // coach reads the identical line in their program builder.
    expect(screen.getByText('4 × 6–8 · RPE 8')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Barbell Bench Press. Target: 4 × 6–8 · RPE 8. 1 set.'),
    ).toBeOnTheScreen();
  });

  it('renders no target at all — not a dash, not an empty slot — when there was none', () => {
    settle(
      makeSession({
        exercises: [
          // A swap: the block was written for the movement that was
          // replaced, so naming it as this one's target would misreport it.
          makeGroup({
            exerciseId: 'ex-shoulder',
            exerciseName: 'Dumbbell Shoulder Press',
            substitutedFor: 'Barbell Overhead Press',
            target: null,
          }),
          // Ad-hoc: no program day to ask.
          makeGroup({ exerciseId: 'ex-curl', exerciseName: 'Cable Curl', target: null }),
        ],
      }),
    );
    renderScreen();

    expect(screen.queryByText('4 × 6–8 · RPE 8')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText('-')).toBeNull();
    // And the spoken head says nothing about a target either — being asked
    // for nothing is not the same as being asked for zero.
    expect(screen.getByLabelText('Cable Curl. 1 set.')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Dumbbell Shoulder Press, substituted for Barbell Overhead Press. 1 set.',
      ),
    ).toBeOnTheScreen();
  });

  it('names the swap under the exercise that was actually performed', () => {
    settle(
      makeSession({
        exercises: [
          makeGroup({
            exerciseId: 'ex-shoulder',
            exerciseName: 'Dumbbell Shoulder Press',
            substitutedFor: 'Barbell Overhead Press',
            // The server returns none for a swap: the block was written
            // for the movement the client replaced.
            target: null,
            sets: [makeSet(), makeSet({ setNumber: 2 })],
          }),
        ],
      }),
    );
    renderScreen();

    expect(screen.getByText('Substituted for Barbell Overhead Press')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Dumbbell Shoulder Press, substituted for Barbell Overhead Press. 2 sets.',
      ),
    ).toBeOnTheScreen();
  });

  it('highlights a record, and counts the rest of its types in one pill', () => {
    settle(
      makeSession({
        exercises: [
          makeGroup({
            sets: [
              makeSet({ isWarmup: true, weightKg: 60, reps: 10, rpe: null }),
              makeSet({ setNumber: 1 }),
              makeSet({
                setNumber: 2,
                weightKg: 102.5,
                reps: 5,
                rpe: 9.5,
                personalRecordTypes: ['max_weight', '1rm_estimated', 'max_volume'],
              }),
            ],
          }),
        ],
      }),
    );
    renderScreen();

    expect(screen.getAllByTestId('session-set-record-mark')).toHaveLength(1);
    expect(screen.getByText('+2')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Set 2. 102.5 kilograms, 5 reps. RPE 9.5. Personal record, and 2 more.',
      ),
    ).toBeOnTheScreen();
  });

  it('reserves the comment column on every row, warm-ups included', () => {
    settle(
      makeSession({
        exercises: [
          makeGroup({
            sets: [
              makeSet({ isWarmup: true, weightKg: 60, reps: 10, rpe: null }),
              makeSet({ setNumber: 1 }),
              makeSet({ setNumber: 2, personalRecordTypes: ['max_weight'] }),
            ],
          }),
          makeSkip(),
        ],
      }),
    );
    renderScreen();

    expect(screen.getAllByTestId('session-set-comment-slot')).toHaveLength(3);
  });

  it('offers no way to edit anything — the client owns their own log', () => {
    renderScreen();

    // Every button on a settled screen is either the way out or
    // `session-review/02`'s comment affordance, one per logged set. This
    // read `toHaveLength(1)` while the reserved cell held task 01's silent
    // placeholder; filling it is what task 02 is for, so the count moved
    // and the CLAIM did not. Nothing here edits, deletes or re-logs — the
    // client owns editing their own logged data.
    const labels = screen
      .getAllByRole('button')
      .map((node) => String(node.props.accessibilityLabel));
    const slots = screen.getAllByTestId('session-set-comment-slot');

    expect(screen.getByLabelText('Close this session')).toBeOnTheScreen();
    expect(labels.filter((label) => label.startsWith('Comment on '))).toHaveLength(slots.length);
    expect(labels).toHaveLength(slots.length + 1);
    expect(labels.join(' · ')).not.toMatch(/edit|delete|remove|undo|log again/i);
  });

  it('closes a bounded session with the fact that it ended', () => {
    renderScreen();
    expect(screen.getByText('End of session')).toBeOnTheScreen();
  });
});

describe('SessionReviewScreen skipped sessions', () => {
  it('gives the whole-session skip reason the client’s own quiet register', () => {
    settle(
      makeSession({
        status: 'skipped',
        exercises: [],
        totalVolumeKg: null,
        durationSeconds: null,
        clientNotes: null,
        skipReason: 'travelling',
      }),
    );
    renderScreen();

    expect(screen.getByTestId('session-review-skip-reason')).toBeOnTheScreen();
    expect(screen.getByText('travelling')).toBeOnTheScreen();
    // The screen does not talk over the client's own explanation.
    expect(screen.queryByTestId('session-review-empty')).toBeNull();
    expect(screen.getByText('Priya Sharma · skipped Wed 9 Sep')).toBeOnTheScreen();
  });
});
