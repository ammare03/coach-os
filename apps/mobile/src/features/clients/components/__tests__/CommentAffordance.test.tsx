import { schema } from '@coachos/db';
import { fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { SessionReview, SessionReviewExerciseGroup, SessionReviewSet } from '../../api.ts';
import { useSessionCommentSlot } from '../../screens/SessionReviewScreen.tsx';
import {
  COMMENT_AFFORDANCE_COPY,
  COMMENT_TARGET_TYPES,
  CommentAffordance,
} from '../CommentAffordance.tsx';
import { INERT_COMMENT_COPY } from '../InertCommentSheet.tsx';
import { SessionExerciseGroup } from '../SessionExerciseGroup.tsx';
import {
  SESSION_COMMENT_SLOT_HIT_SLOP,
  SESSION_COMMENT_SLOT_SIZE,
  SESSION_SET_ROW_MIN_HEIGHT,
  SessionSetRow,
} from '../SessionSetRow.tsx';

// `session-review/02`. What is worth asserting here is not the layout — it
// is the four promises this hook makes, in the order they break:
//
//   1. the prop contract matches `comment_target` EXACTLY, because
//      `phase-12-feedback-comments` builds against it sight-unseen and a
//      mismatch ripples back through every row,
//   2. the affordance is on every row type and the row's measured geometry
//      does not move when the slot is filled,
//   3. the sheet opens with THIS row's context — a coach reading a session
//      of 22 sets must never be shown the wrong one,
//   4. the field cannot take a keystroke at the platform level. A composer
//      that accepts two paragraphs and drops them reads as a crash, not as
//      an unshipped feature (the P10 README's named failure mode, and the
//      reason `ClientChatComposer` is built the same way).

// `SheetFooter` composes the home-indicator inset, which the native module
// does not report under Jest.
const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrap(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

const SET_ID = '01924f2c-0000-7000-8000-00000000001a';
const EXERCISE_ID = '01924f2c-0000-7000-8000-00000000002b';

function makeSet(overrides: Partial<SessionReviewSet> = {}): SessionReviewSet {
  return {
    setLogId: SET_ID,
    setNumber: 3,
    reps: 8,
    weightKg: 65,
    rpe: null,
    rir: null,
    durationSeconds: null,
    distanceM: null,
    estimated1rmKg: 82.3,
    isWarmup: false,
    isFailure: false,
    notes: null,
    loggedAt: new Date('2026-09-09T12:42:00.000Z'),
    personalRecordTypes: [],
    ...overrides,
  };
}

function makeGroup(sets: SessionReviewSet[]): SessionReviewExerciseGroup {
  return {
    kind: 'performed',
    exerciseId: EXERCISE_ID,
    exerciseName: 'Barbell back squat',
    substitutedFor: null,
    // Real, not elided by the cast: this group is RENDERED below, and the
    // head reads `target` to decide whether to print a scheme at all.
    target: null,
    sets,
  } as SessionReviewExerciseGroup;
}

function makeSession(groups: SessionReviewExerciseGroup[]): SessionReview {
  return {
    id: '01924f2c-0000-7000-8000-00000000003c',
    clientId: '01924f2c-0000-7000-8000-00000000004d',
    name: 'Lower A',
    status: 'completed',
    scheduledDate: '2026-09-09',
    clientNotes: null,
    skipReason: null,
    exercises: groups,
  } as unknown as SessionReview;
}

function renderAffordance(overrides: Partial<Parameters<typeof CommentAffordance>[0]> = {}) {
  render(
    wrap(
      <CommentAffordance
        targetType="set_log"
        targetId={SET_ID}
        exerciseName="Barbell back squat"
        setLabel="Set 3"
        load="65 kg × 8"
        {...overrides}
      />,
    ),
  );
}

describe('the prop contract phase-12 builds against', () => {
  it('carries the comment_target vocabulary exactly, no subset and no extra', () => {
    // THE test this task exists for. `apps/mobile` never depends on
    // `@coachos/db` at runtime, so the union is restated locally and pinned
    // here against the pgEnum itself — the same shape `PR_PRIORITY` uses
    // for `PERSONAL_RECORD_TYPES`. A seventh target type added to the
    // database and not here fails HERE, months before a P12 screen does.
    expect([...COMMENT_TARGET_TYPES].sort()).toEqual([...schema.commentTarget.enumValues].sort());
    expect(new Set(COMMENT_TARGET_TYPES).size).toBe(COMMENT_TARGET_TYPES.length);
  });

  it('names a set row with the target the database calls a set log', () => {
    // Not `setLog`, not `set`. The literal crosses into a column.
    expect(COMMENT_TARGET_TYPES).toContain('set_log');
  });
});

describe('the affordance, before it is tapped', () => {
  it('announces the action and the row it belongs to', () => {
    renderAffordance();

    const disc = screen.getByLabelText('Comment on Barbell back squat, set 3');

    expect(disc.props.accessibilityRole).toBe('button');
  });

  it('says a warm-up is a warm-up rather than claiming a set number', () => {
    renderAffordance({ setLabel: 'Warm-up set' });

    expect(screen.getByLabelText('Comment on Barbell back squat, warm-up set')).toBeTruthy();
  });

  it('carries the inertness in its hint, so a tap is never the way to learn it', () => {
    // The whole reason the hint exists: a screen-reader user must not be
    // charged a tap, a full sheet read and a dismissal to find out the
    // sheet cannot post (`accessibility` §2).
    renderAffordance();

    const disc = screen.getByLabelText('Comment on Barbell back squat, set 3');

    expect(disc.props.accessibilityHint).toBe(
      "Opens a comment sheet. This version of CoachOS can't post comments.",
    );
    expect(COMMENT_AFFORDANCE_COPY.hint).toContain(INERT_COMMENT_COPY.honest);
  });

  it('reaches the 48px tap box by slop rather than by growing the 32px disc', () => {
    // `IconButton`'s own `sm` slop is 6 — `centeredHitSlop(32, 44)` — which
    // yields 44, not the 48 floor `ui-conventions` §5 sets. The row already
    // derived the arithmetic; this passes it through rather than re-deriving.
    renderAffordance();

    const disc = screen.getByLabelText('Comment on Barbell back squat, set 3');

    expect(disc.props.hitSlop).toBe(SESSION_COMMENT_SLOT_HIT_SLOP);
    expect(SESSION_COMMENT_SLOT_SIZE + SESSION_COMMENT_SLOT_HIT_SLOP * 2).toBe(48);
  });

  it('shows no sheet until it is asked for one', () => {
    renderAffordance();

    expect(screen.queryByTestId('inert-comment-sheet')).toBeNull();
  });
});

describe('the sheet it opens', () => {
  function open(overrides: Partial<Parameters<typeof CommentAffordance>[0]> = {}) {
    renderAffordance(overrides);
    fireEvent.press(screen.getByLabelText(/^Comment on /));
  }

  it('names the exact row it was opened from', () => {
    // The failure this prevents is silent and expensive: a coach leaving
    // feedback against the wrong set of 22.
    open();

    expect(screen.getByTestId('inert-comment-sheet')).toBeTruthy();
    expect(screen.getByText('Barbell back squat · Set 3 · 65 kg × 8')).toBeTruthy();
  });

  it('carries whatever load the row was given, already in the reader unit', () => {
    // `load` arrives pre-formatted by `packages/utils` — no kilogram is
    // converted, and no string here hardcodes a unit (`CLAUDE.md` §0).
    open({ setLabel: 'Warm-up set', load: 'Bodyweight × 12' });

    expect(screen.getByText('Barbell back squat · Warm-up set · Bodyweight × 12')).toBeTruthy();
  });

  it('titles itself in one word, which is what survives 200% text', () => {
    // `SheetHeader` pins `numberOfLines={1}`.
    open();

    expect(screen.getByText('Comment')).toBeTruthy();
    expect(INERT_COMMENT_COPY.title.split(' ')).toHaveLength(1);
  });

  it('closes on the header close, leaving the screen behind it alone', () => {
    open();

    fireEvent.press(screen.getByLabelText('Close'));

    expect(screen.queryByTestId('inert-comment-sheet')).toBeNull();
  });
});

describe('inert, not broken', () => {
  function open() {
    renderAffordance();
    fireEvent.press(screen.getByLabelText(/^Comment on /));
  }

  it('gives the platform no way to route a keystroke to the field', () => {
    // `editable={false}` is the property that matters: it is what stops the
    // keyboard opening and what stops RN delivering a change event at all.
    open();

    const field = screen.getByTestId('inert-comment-input');

    expect(field.props.editable).toBe(false);
    expect(field.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('drops nothing, because it accepts nothing', () => {
    open();

    const field = screen.getByTestId('inert-comment-input');

    // Two assertions in one act. Testing Library refuses `changeText` on a
    // non-editable `TextInput` exactly as the platform does, so this must
    // not throw — and the sheet's own `onChangeText` throws by design, so
    // an edit that makes the field editable without a real handler fails
    // HERE rather than eating a coach's feedback in production.
    expect(() => {
      fireEvent.changeText(field, 'Knee tracked in on the last two reps');
    }).not.toThrow();

    expect(field.props.value).toBe('');
    expect(screen.queryByDisplayValue('Knee tracked in on the last two reps')).toBeNull();
  });

  it('names the field and repeats the reason on it', () => {
    open();

    const field = screen.getByLabelText(INERT_COMMENT_COPY.fieldLabel);

    expect(field.props.accessibilityHint).toBe(INERT_COMMENT_COPY.fieldHint);
    expect(INERT_COMMENT_COPY.fieldHint).toContain(INERT_COMMENT_COPY.honest);
  });

  it('offers a commit that is labelled for the action and cannot be pressed', () => {
    // `DESIGN.md` §10.8 — a footer reading "Done" or "Post" is a defect.
    open();

    const commit = screen.getByRole('button', { name: INERT_COMMENT_COPY.action });

    expect(commit.props.accessibilityState).toMatchObject({ disabled: true });
    // Not a no-op handler — no handler at all. `Button` withholds `onPress`
    // from `Pressable` while disabled, so there is nothing for a later edit
    // to fill in by accident.
    expect(commit.props.onPress).toBeUndefined();
  });

  it('says why, in a line that promises neither a date nor an outcome', () => {
    // `product-copy` §2 and §5, and the reason the task file's own
    // "Commenting arrives in a future update" was not shipped: it promises
    // a release. Asserted on the literal because the wording IS the
    // feature — it is the only thing telling a coach this is unshipped
    // rather than broken.
    open();

    expect(screen.getByText("This version of CoachOS can't post comments.")).toBeTruthy();
    expect(INERT_COMMENT_COPY.honest).not.toMatch(/!|soon|future|update|sorry/i);
    expect(INERT_COMMENT_COPY.placeholder).not.toMatch(/!|soon|future|update|sorry/i);
  });
});

describe('every row carries one, and the row does not move', () => {
  it('fills the reserved cell without changing the row geometry task 01 measured', () => {
    render(
      wrap(
        <SessionSetRow
          set={makeSet()}
          unit="kg"
          commentSlot={
            <CommentAffordance
              targetType="set_log"
              targetId={SET_ID}
              exerciseName="Barbell back squat"
              setLabel="Set 3"
              load="65 kg × 8"
            />
          }
        />,
      ),
    );

    expect(screen.getByTestId(`session-set-${SET_ID}`)).toHaveStyle({
      minHeight: SESSION_SET_ROW_MIN_HEIGHT,
    });
    expect(screen.getByTestId('session-set-comment-slot')).toHaveStyle({
      width: SESSION_COMMENT_SLOT_SIZE,
      height: SESSION_COMMENT_SLOT_SIZE,
    });
    expect(screen.getByLabelText('Comment on Barbell back squat, set 3')).toBeTruthy();
  });

  it('appears on a warm-up, a working set, a record and a set taken to failure alike', () => {
    // The row carries its own state; the affordance carries only the
    // action. A warm-up is the one a "comments are for real sets" instinct
    // would drop, and dropping it would move the numeral channel's right
    // edge on that row alone.
    const sets = [
      makeSet({ setLogId: 'set-warmup', setNumber: 1, isWarmup: true, weightKg: 20 }),
      makeSet({ setLogId: 'set-working', setNumber: 2 }),
      makeSet({ setLogId: 'set-record', setNumber: 3, personalRecordTypes: ['max_weight'] }),
      makeSet({ setLogId: 'set-failure', setNumber: 4, isFailure: true }),
    ];
    const { result } = renderHook(() =>
      useSessionCommentSlot(makeSession([makeGroup(sets)]), 'kg'),
    );

    render(
      wrap(
        <SessionExerciseGroup
          group={makeGroup(sets)}
          unit="kg"
          renderCommentSlot={result.current}
        />,
      ),
    );

    expect(screen.getByLabelText('Comment on Barbell back squat, warm-up set')).toBeTruthy();
    expect(screen.getByLabelText('Comment on Barbell back squat, set 2')).toBeTruthy();
    expect(screen.getByLabelText('Comment on Barbell back squat, set 3')).toBeTruthy();
    expect(screen.getByLabelText('Comment on Barbell back squat, set 4')).toBeTruthy();
  });
});

describe('the screen seam', () => {
  it('hands the groups one callback that survives a re-render', () => {
    // `SessionSetRow` is memoised for a 72-set session. A callback rebuilt
    // on every render would hand 72 rows a new node each time
    // (`frontend-performance` §3), which is exactly what the render-prop
    // shape exists to avoid.
    const session = makeSession([makeGroup([makeSet()])]);
    const { result, rerender } = renderHook(
      ({ s }: { s: SessionReview }) => useSessionCommentSlot(s, 'kg'),
      { initialProps: { s: session } },
    );

    const first = result.current;
    rerender({ s: session });

    expect(result.current).toBe(first);
  });

  it('renders the reserved placeholder rather than a mislabelled control for an unknown set', () => {
    // Unreachable by construction — the lookup is built from the same
    // session the rows come from. It fails to the silent placeholder rather
    // than to "Comment on , set 3", which would be a lie to a screen reader.
    const { result } = renderHook(() => useSessionCommentSlot(makeSession([]), 'kg'));

    expect(result.current(makeSet())).toBeNull();
  });

  it('speaks a set exactly the way the row it sits in does', () => {
    // One vocabulary: `Set 3` / `Warm-up set`, and the load through the
    // row's own formatter, so the sheet and the row can never word the same
    // set two ways (`code-conventions` §1).
    const set = makeSet();
    const { result } = renderHook(() =>
      useSessionCommentSlot(makeSession([makeGroup([set])]), 'kg'),
    );

    render(wrap(<>{result.current(set)}</>));
    fireEvent.press(screen.getByLabelText(/^Comment on /));

    expect(screen.getByText('Barbell back squat · Set 3 · 65 kg × 8')).toBeTruthy();
  });
});
