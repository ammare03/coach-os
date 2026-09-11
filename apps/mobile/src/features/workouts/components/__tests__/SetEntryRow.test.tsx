import { density, spacing } from '@coachos/ui/theme';
import { render, screen, within } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import type { LastPerformanceState } from '../../hooks/useExerciseTarget.ts';
import type { PreviousSet } from '../../lib/last-performance.ts';
import { PreviousSetLine } from '../PreviousSetLine.tsx';
import { SET_ENTRY_COPY, SetEntryRow, speakLoad, toDisplayWeight } from '../SetEntryRow.tsx';

// The composer's own contract: what it says, what a screen reader hears, and
// the one property the whole design rests on — that it never changes height.

function renderComposer(overrides: Partial<Parameters<typeof SetEntryRow>[0]> = {}) {
  const props = {
    setNumber: 3,
    weight: 82.5,
    reps: 8,
    unit: 'kg' as const,
    weightStep: 2.5,
    onWeightChange: jest.fn(),
    onRepsChange: jest.fn(),
    onConfirm: jest.fn(),
    ...overrides,
  };
  render(<SetEntryRow {...props} />);
  return props;
}

describe('SetEntryRow', () => {
  it('labels the confirm with the whole sentence, not just the action', () => {
    renderComposer();

    // `DESIGN.md` §10.8 — "Log set 3", never "Log". The icon is paid for by
    // this label plus the visible head label beside it.
    expect(screen.getByLabelText('Log set 3, 82.5 kilograms for 8 reps')).toBeTruthy();
  });

  it('names the set in the head so the confirm icon is never the only label', () => {
    renderComposer({ setNumber: 3 });

    expect(screen.getByText('Set 3')).toBeTruthy();
  });

  it('names a warm-up on the confirm, since its head label is gone', () => {
    renderComposer({ isWarmup: true, onWarmupChange: jest.fn(), onFailureChange: jest.fn() });

    expect(screen.getByLabelText('Log warm-up set, 82.5 kilograms for 8 reps')).toBeTruthy();
  });

  it('leaves the head band empty rather than mounting chips a caller cannot handle', () => {
    renderComposer();

    expect(screen.queryByText('Warm-up')).toBeNull();
  });

  it('gives task 05’s head actions the slot ahead of the flags', () => {
    // 270px carries one occupant. The editor moves the chips to their own
    // line and puts Cancel / Delete set here (design frame F).
    renderComposer({
      headTrailing: <Text>Cancel</Text>,
      onWarmupChange: jest.fn(),
      onFailureChange: jest.fn(),
    });

    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.queryByText('Warm-up')).toBeNull();
  });

  it('speaks the unit as a word, never as the glyph', () => {
    renderComposer({ unit: 'lb', weight: 185, reps: 5 });

    // "185 pounds", not "185 lb" — a misread here is a client putting the
    // wrong weight on a bar.
    expect(screen.getByLabelText('Log set 3, 185 pounds for 5 reps')).toBeTruthy();
  });

  it('calls the two steppers Weight and Reps', () => {
    renderComposer();

    expect(screen.getByLabelText('Weight')).toBeTruthy();
    expect(screen.getByLabelText('Reps')).toBeTruthy();
  });

  it('renders the context band at its full height with both slots empty', () => {
    // The band is what holds the card at 205px once tasks 02 and 03 fill it.
    // Collapsing it when empty would move the confirm between a barbell
    // exercise and a cable one — the one thing this layout may not do.
    renderComposer();

    const band = flattenStyle(screen.getByTestId('set-entry-context').props.style);
    expect(band.some((rule) => rule.minHeight === 20)).toBe(true);
  });

  it('sizes its bands with minHeight and never a fixed height, so 200% text grows them', () => {
    renderComposer();

    for (const id of [
      'set-entry-head',
      'set-entry-weight-band',
      'set-entry-context',
      'set-entry-action',
    ]) {
      const rules = flattenStyle(screen.getByTestId(id).props.style);
      expect(rules.some((rule) => rule.minHeight !== undefined)).toBe(true);
      expect(rules.some((rule) => rule.height !== undefined)).toBe(false);
    }
  });

  it('hangs task 02’s nearest-weight seam below the context band, never inside it', () => {
    renderComposer({ contextBelow: <Text>nearest</Text> });

    // The band is `space-between` with two occupants. A third child would
    // sit BESIDE the plates; the line has to sit UNDER them.
    expect(within(screen.getByTestId('set-entry-below')).getByText('nearest')).toBeTruthy();
    expect(within(screen.getByTestId('set-entry-context')).queryByText('nearest')).toBeNull();
  });

  it('gives the seam below the band no height of its own', () => {
    // The +24px is the nearest line's own margin and minimum — the slot that
    // holds it contributes nothing, so an empty seam leaves the card at 205.
    renderComposer();

    const rules = flattenStyle(screen.getByTestId('set-entry-below').props.style);
    expect(rules.some((rule) => rule.minHeight !== undefined)).toBe(false);
    expect(rules.some((rule) => rule.marginTop !== undefined)).toBe(false);
  });
});

describe('SetEntryRow — the 205px contract', () => {
  // The one property the whole design rests on: the confirm sits at the same
  // screen coordinate for the entire session. Every variant below must come
  // to the same number, and the ONE sanctioned exception is task 02's
  // nearest-weight line, which takes the card to 229 and resolves in one tap.

  it('is 205px with both context slots empty', () => {
    renderComposer();

    expect(composerHeightPx()).toBe(205);
  });

  it('is still 205px with this set’s previous performance in the band', () => {
    renderComposer({
      setNumber: 3,
      contextTrailing: (
        <PreviousSetLine history={readyWithSet(3)} setNumber={3} unit="kg" placement="composer" />
      ),
    });

    expect(screen.getByText('80kg × 8')).toBeTruthy();
    expect(composerHeightPx()).toBe(205);
  });

  it('is still 205px when the previous session had no such set', () => {
    // The longest string this slot can hold, and it still may not move the
    // confirm — it wraps inside a band that is `minHeight`, never `height`.
    renderComposer({
      setNumber: 4,
      contextTrailing: (
        <PreviousSetLine history={readyWithSet(3)} setNumber={4} unit="kg" placement="composer" />
      ),
    });

    expect(screen.getByText('no set 4 last time')).toBeTruthy();
    expect(composerHeightPx()).toBe(205);
  });

  it('is still 205px while the history read is in flight', () => {
    renderComposer({
      contextTrailing: (
        <PreviousSetLine
          history={{ kind: 'loading' }}
          setNumber={3}
          unit="kg"
          placement="composer"
        />
      ),
    });

    expect(composerHeightPx()).toBe(205);
  });

  it('is still 205px with both flag chips in the head', () => {
    // Task 04 adds no band: the chips occupy the head's existing trailing
    // seam. If they ever move the confirm, they have taken the one property
    // the whole layout is built to hold.
    renderComposer({
      onWarmupChange: jest.fn(),
      onFailureChange: jest.fn(),
    });

    expect(screen.getByText('Warm-up')).toBeTruthy();
    expect(screen.getByText('To failure')).toBeTruthy();
    expect(composerHeightPx()).toBe(205);
  });

  it('is still 205px with warm-up on, where the head label is dropped', () => {
    // The reason the label is dropped rather than wrapped: `Warm-up set`
    // would take the head to two lines and the card to 244.
    renderComposer({
      isWarmup: true,
      onWarmupChange: jest.fn(),
      onFailureChange: jest.fn(),
    });

    expect(screen.queryByText('Set 3')).toBeNull();
    expect(composerHeightPx()).toBe(205);
  });

  it('is still 205px with to-failure on', () => {
    renderComposer({
      isFailure: true,
      onWarmupChange: jest.fn(),
      onFailureChange: jest.fn(),
    });

    expect(screen.getByText('Set 3')).toBeTruthy();
    expect(composerHeightPx()).toBe(205);
  });

  it('grows to 229px only for an occupant of the seam below the band', () => {
    // Stands in for task 02's nearest-weight line, whose own `marginTop`
    // and `minHeight` are the entire +24 — the seam declares no size.
    renderComposer({
      contextBelow: <View testID="nearest" style={{ marginTop: spacing(4), minHeight: 20 }} />,
    });

    expect(composerHeightPx('nearest')).toBe(229);
  });
});

describe('speakLoad', () => {
  it('reads a bodyweight set as reps alone rather than as zero kilograms', () => {
    expect(speakLoad(null, 12, 'kg')).toBe('12 reps');
  });

  it('singularises one rep and one kilogram', () => {
    expect(speakLoad(1, 1, 'kg')).toBe('1 kilogram for 1 rep');
  });
});

describe('toDisplayWeight', () => {
  it('rounds exactly as the printed numeral does, so the two cannot disagree', () => {
    // `formatWeight` prints one decimal in kg and a whole number in lb.
    expect(toDisplayWeight(102.06, 'kg')).toBe(102.1);
    expect(toDisplayWeight(102.06, 'lb')).toBe(225);
  });

  it('passes a bodyweight set straight through as absent', () => {
    expect(toDisplayWeight(null, 'kg')).toBeNull();
  });
});

describe('SET_ENTRY_COPY', () => {
  it('states the failure as a fact with a next step, and never as a network problem', () => {
    // `ERRORS.md` ER§1.4 — `logSet` rejects only on a local-mirror fault, so
    // the copy must not blame a connection the client cannot check.
    expect(SET_ENTRY_COPY.failed).toBe('Couldn’t log that set. Try again.');
    expect(SET_ENTRY_COPY.failed).not.toMatch(/offline|network|connect/i);
    expect(SET_ENTRY_COPY.failed).not.toContain('!');
  });

  it('announces a logged set in the past tense, with the load', () => {
    expect(SET_ENTRY_COPY.loggedAnnouncement(3, '82.5 kilograms for 8 reps')).toBe(
      'Set 3 logged, 82.5 kilograms for 8 reps',
    );
  });
});

/** A previous session whose newest — and only — working set is `setNumber`, at 80kg × 8. */
function readyWithSet(setNumber: number): LastPerformanceState {
  const set: PreviousSet = {
    setNumber,
    weightKg: 80,
    reps: 8,
    loggedAt: new Date('2026-09-04T10:00:00Z'),
  };
  return {
    kind: 'ready',
    last: set,
    previous: { last: set, bySetNumber: new Map([[setNumber, set]]) },
  };
}

/** The four bands the card is made of, top to bottom. */
const BANDS = [
  'set-entry-head',
  'set-entry-weight-band',
  'set-entry-context',
  'set-entry-action',
] as const;

/**
 * The composer's height, summed from what it actually declares — every band
 * contributes its `minHeight` plus its `marginTop`, inside the card's own
 * padding. `belowTestID` names an occupant of the seam under the band, which
 * is the only thing permitted to change the answer.
 */
function composerHeightPx(belowTestID?: string): number {
  let total = density.coach.cardPadding * 2;
  for (const id of BANDS) total += boxHeightPx(id);
  if (belowTestID !== undefined) total += boxHeightPx(belowTestID);
  return total;
}

function boxHeightPx(testID: string): number {
  const rules = flattenStyle(screen.getByTestId(testID).props.style);
  return lastNumber(rules, 'minHeight') + lastNumber(rules, 'marginTop');
}

/** Last rule wins, the way `StyleSheet.flatten` resolves an array. */
function lastNumber(rules: Record<string, unknown>[], key: string): number {
  let value = 0;
  for (const rule of rules) {
    const candidate = rule[key];
    if (typeof candidate === 'number') value = candidate;
  }
  return value;
}

/** A style prop is an object, an array, or nested arrays — normalise before asserting. */
function flattenStyle(style: unknown): Record<string, unknown>[] {
  if (style === null || style === undefined) return [];
  if (Array.isArray(style)) return style.flatMap((entry) => flattenStyle(entry));
  if (typeof style !== 'object') return [];
  return [style as Record<string, unknown>];
}
