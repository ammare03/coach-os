import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { SessionReviewSet } from '../../api.ts';
import {
  SESSION_COMMENT_SLOT_HIT_SLOP,
  SESSION_COMMENT_SLOT_SIZE,
  SESSION_SET_ROW_MIN_HEIGHT,
  SessionSetRow,
  formatSetExertion,
  formatSetLoad,
  speakSetRow,
} from '../SessionSetRow.tsx';

// The row's four jobs, in the order they can break:
//   1. it is 56px and it is a `minHeight` (`CLAUDE.md` §25.8, 200% text),
//   2. the comment slot is reserved on EVERY row — `session-review/02`'s
//      acceptance criterion lives here, not there,
//   3. a figure that does not exist renders nothing, never a `0`,
//   4. every glyph the row compresses arrives intact in its one spoken
//      sentence, which is what makes it readable with no colour vision.

const SET_ID = '01924f2c-0000-7000-8000-00000000001a';

function makeSet(overrides: Partial<SessionReviewSet> = {}): SessionReviewSet {
  return {
    setLogId: SET_ID,
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

describe('SessionSetRow geometry', () => {
  it('is 56px tall as a floor, never a fixed height', () => {
    render(<SessionSetRow set={makeSet()} unit="kg" />);

    expect(SESSION_SET_ROW_MIN_HEIGHT).toBe(56);
    expect(screen.getByTestId(`session-set-${SET_ID}`)).toHaveStyle({
      minHeight: SESSION_SET_ROW_MIN_HEIGHT,
    });
  });

  it('reaches the 48px tap floor by slop rather than by growing the 32px slot', () => {
    expect(SESSION_COMMENT_SLOT_SIZE).toBe(32);
    expect(SESSION_COMMENT_SLOT_HIT_SLOP).toBe(8);
  });

  it('reserves the comment slot on a working set, a warm-up and a record alike', () => {
    for (const set of [
      makeSet(),
      makeSet({ isWarmup: true, setNumber: 0, rpe: null }),
      makeSet({ personalRecordTypes: ['max_weight'] }),
    ]) {
      const view = render(<SessionSetRow set={set} unit="kg" />);
      expect(view.getByTestId('session-set-comment-slot')).toBeOnTheScreen();
      view.unmount();
    }
  });

  it('hands the reserved slot to its occupant without moving anything else', () => {
    render(
      <SessionSetRow
        set={makeSet()}
        unit="kg"
        commentSlot={<Text testID="task-02-control">comment</Text>}
      />,
    );

    expect(screen.getByTestId('task-02-control')).toBeOnTheScreen();
    expect(screen.getByTestId(`session-set-${SET_ID}`)).toHaveStyle({
      minHeight: SESSION_SET_ROW_MIN_HEIGHT,
    });
  });
});

describe('SessionSetRow figures', () => {
  it('renders the load in the reader unit, with the trailing zero stripped', () => {
    expect(formatSetLoad(makeSet({ weightKg: 60 }), 'kg')).toBe('60 kg × 8');
    expect(formatSetLoad(makeSet({ weightKg: 92.5 }), 'kg')).toBe('92.5 kg × 8');
  });

  it('says Bodyweight rather than 0 kg for an unloaded set', () => {
    expect(formatSetLoad(makeSet({ weightKg: null, reps: 12 }), 'kg')).toBe('Bodyweight × 12');
  });

  it('says nothing at all about a measure the set does not carry', () => {
    // A rep-based set has no seconds, and a timed hold has no reps. Neither
    // renders a `0` or a dash (`COPY.md` CO§2).
    expect(formatSetLoad(makeSet(), 'kg')).not.toMatch(/0 s|—|-\s/);
    expect(formatSetLoad(makeSet({ reps: null, weightKg: null, durationSeconds: 45 }), 'kg')).toBe(
      'Bodyweight · 45 s',
    );
  });

  it('omits the exertion cell entirely when neither RPE nor RIR was logged', () => {
    expect(formatSetExertion(makeSet({ rpe: null, rir: null }))).toBeNull();
    expect(formatSetExertion(makeSet({ rpe: null, rir: 2 }))).toBe('2 RIR');
    expect(formatSetExertion(makeSet())).toBe('RPE 8');

    render(<SessionSetRow set={makeSet({ rpe: null, rir: null })} unit="kg" />);
    expect(screen.queryByText(/RPE|RIR/)).toBeNull();
  });
});

describe('SessionSetRow records', () => {
  it('marks a record with a shape as well as an ink', () => {
    render(<SessionSetRow set={makeSet({ personalRecordTypes: ['max_weight'] })} unit="kg" />);

    expect(screen.getByTestId('session-set-record-mark')).toBeOnTheScreen();
    // One record is one mark — the `+N` pill is never rendered at 0.
    expect(screen.queryByTestId('session-set-record-more')).toBeNull();
  });

  it('counts the records beyond the first in one pill, never four marks', () => {
    render(
      <SessionSetRow
        set={makeSet({ personalRecordTypes: ['max_weight', '1rm_estimated', 'max_volume'] })}
        unit="kg"
      />,
    );

    expect(screen.getByTestId('session-set-record-more')).toBeOnTheScreen();
    expect(screen.getByText('+2')).toBeOnTheScreen();
    expect(screen.getAllByTestId('session-set-record-mark')).toHaveLength(1);
  });

  it('marks failure with a letter, not the words', () => {
    render(<SessionSetRow set={makeSet({ isFailure: true })} unit="kg" />);

    expect(screen.getByTestId('session-set-failure')).toBeOnTheScreen();
    expect(screen.getByText('F')).toBeOnTheScreen();
    expect(screen.queryByText(/to failure/i)).toBeNull();
  });
});

describe('SessionSetRow accessible label', () => {
  it('reads a working set as one sentence', () => {
    expect(speakSetRow(makeSet(), 'kg')).toBe('Set 1. 92.5 kilograms, 8 reps. RPE 8.');
  });

  it('says what a warm-up is instead of claiming a set number', () => {
    expect(speakSetRow(makeSet({ isWarmup: true, weightKg: 60, reps: 10, rpe: null }), 'kg')).toBe(
      'Warm-up set. 60 kilograms, 10 reps.',
    );
  });

  it('spells out the F', () => {
    expect(
      speakSetRow(makeSet({ setNumber: 3, weightKg: 34, reps: 7, rpe: 10, isFailure: true }), 'kg'),
    ).toBe('Set 3. 34 kilograms, 7 reps. RPE 10. Taken to failure.');
  });

  it('says "Personal record" as a word, and counts the rest', () => {
    expect(
      speakSetRow(
        makeSet({
          setNumber: 3,
          weightKg: 102.5,
          reps: 5,
          rpe: 9.5,
          personalRecordTypes: ['max_weight', '1rm_estimated', 'max_volume'],
        }),
        'kg',
      ),
    ).toBe('Set 3. 102.5 kilograms, 5 reps. RPE 9.5. Personal record, and 2 more.');
  });

  it('is the row’s one label, and it follows the display unit', () => {
    render(<SessionSetRow set={makeSet()} unit="lb" />);

    expect(screen.getByLabelText('Set 1. 204 pounds, 8 reps. RPE 8.')).toBeOnTheScreen();
  });

  it('spells RIR out rather than leaving three letters to a screen reader', () => {
    expect(speakSetRow(makeSet({ rpe: null, rir: 2 }), 'kg')).toBe(
      'Set 1. 92.5 kilograms, 8 reps. 2 reps in reserve.',
    );
  });
});
