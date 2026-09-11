import { render, screen } from '@testing-library/react-native';

import type { LastPerformanceState } from '../../hooks/useExerciseTarget.ts';
import type { PreviousSession, PreviousSet } from '../../lib/last-performance.ts';
import {
  PreviousSetLine,
  resolvePreviousSetLine,
  speakPreviousSetLine,
} from '../PreviousSetLine.tsx';
import { SetList } from '../SetList.tsx';
import type { LoggedSetView } from '../SetRow.tsx';

// Per-set-number history: the whole point of this task is that set 3 reads
// set 3, and that the three different absences render three different
// amounts of nothing.

const LOGGED_AT = new Date('2026-09-04T10:00:00Z');

function previousSet(setNumber: number, overrides: Partial<PreviousSet> = {}): PreviousSet {
  return { setNumber, weightKg: 80, reps: 8, loggedAt: LOGGED_AT, ...overrides };
}

/** A previous session holding exactly the sets given, keyed by their own number. */
function ready(...sets: PreviousSet[]): LastPerformanceState {
  const bySetNumber = new Map(sets.map((set) => [set.setNumber, set]));
  const last = sets[sets.length - 1];
  if (last === undefined) throw new Error('a previous session has at least one set');

  const previous: PreviousSession = { last, bySetNumber };
  return { kind: 'ready', last, previous };
}

const NEVER_LOGGED: LastPerformanceState = { kind: 'ready', last: null, previous: null };

function renderLine(
  history: LastPerformanceState,
  setNumber: number,
  placement: 'composer' | 'row',
) {
  render(
    <PreviousSetLine
      history={history}
      setNumber={setNumber}
      unit="kg"
      placement={placement}
      testID="previous"
    />,
  );
}

describe('PreviousSetLine — matching by set number', () => {
  it('shows set 3 the previous session’s set 3, not its set 1 and not an aggregate', () => {
    const history = ready(
      previousSet(1, { weightKg: 60, reps: 10 }),
      previousSet(2, { weightKg: 70, reps: 9 }),
      previousSet(3, { weightKg: 80, reps: 8 }),
    );

    renderLine(history, 3, 'composer');

    expect(screen.getByText('80kg × 8')).toBeTruthy();
    expect(screen.queryByText('60kg × 10')).toBeNull();
  });

  it('matches by set_number and never by position, so a gap cannot misalign it', () => {
    // The previous session logged sets 1 and 3 — its set 2 was deleted.
    // Under positional matching, set 3 would read the *second* element and
    // show 60kg. The map is keyed, so it shows 100kg or nothing.
    const history = ready(
      previousSet(1, { weightKg: 60, reps: 10 }),
      previousSet(3, { weightKg: 100, reps: 5 }),
    );

    renderLine(history, 3, 'composer');

    expect(screen.getByText('100kg × 5')).toBeTruthy();
    expect(screen.queryByText('60kg × 10')).toBeNull();
  });

  it('says nothing for the set number that gap skipped', () => {
    const history = ready(
      previousSet(1, { weightKg: 60, reps: 10 }),
      previousSet(3, { weightKg: 100, reps: 5 }),
    );

    renderLine(history, 2, 'composer');

    expect(screen.getByText('no set 2 last time')).toBeTruthy();
  });

  it('reads a bodyweight previous set as reps alone rather than as zero weight', () => {
    renderLine(ready(previousSet(1, { weightKg: null, reps: 12 })), 1, 'composer');

    expect(screen.getByText('12 reps')).toBeTruthy();
    expect(screen.getByLabelText('Last time 12 reps.')).toBeTruthy();
  });

  it('prints the weight in the client’s unit, never a hardcoded kg', () => {
    renderLine(ready(previousSet(1, { weightKg: 80, reps: 8 })), 1, 'composer');
    expect(screen.getByText('80kg × 8')).toBeTruthy();

    render(
      <PreviousSetLine
        history={ready(previousSet(1, { weightKg: 80, reps: 8 }))}
        setNumber={1}
        unit="lb"
        placement="composer"
      />,
    );
    expect(screen.getByText('176lb × 8')).toBeTruthy();
  });
});

describe('PreviousSetLine — the three absences', () => {
  it('renders nothing at all while the local read is still in flight', () => {
    renderLine({ kind: 'loading' }, 3, 'composer');

    // No spinner and no skeleton: the read is SQLite, not a network call.
    expect(screen.queryByTestId('previous')).toBeNull();
  });

  it('renders nothing when the read failed, rather than an error in the band', () => {
    renderLine({ kind: 'error' }, 3, 'composer');

    expect(screen.queryByTestId('previous')).toBeNull();
  });

  it('renders nothing anywhere when the client has never logged this exercise', () => {
    // Distinct from "the session had no set 4" — that one spends words.
    renderLine(NEVER_LOGGED, 3, 'composer');
    expect(screen.queryByTestId('previous')).toBeNull();

    renderLine(NEVER_LOGGED, 3, 'row');
    expect(screen.queryByTestId('previous')).toBeNull();
  });

  it('spends words only in the composer when the previous session had fewer sets', () => {
    const history = ready(previousSet(1), previousSet(2), previousSet(3));

    renderLine(history, 4, 'composer');
    expect(screen.getByText('no set 4 last time')).toBeTruthy();
    expect(screen.getByLabelText('No set 4 last time.')).toBeTruthy();
  });

  it('renders no dash, no placeholder and no apology on the logged row', () => {
    const history = ready(previousSet(1), previousSet(2), previousSet(3));

    renderLine(history, 4, 'row');

    expect(screen.queryByTestId('previous')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText(/no set/)).toBeNull();
  });
});

describe('PreviousSetLine — the two registers', () => {
  it('drops the unit on a logged row, because the load beside it carries it', () => {
    renderLine(ready(previousSet(2, { weightKg: 12.5, reps: 15 })), 2, 'row');

    expect(screen.getByText('last 12.5 × 15')).toBeTruthy();
  });

  it('keeps the unit in the composer, where the client is choosing a weight', () => {
    renderLine(ready(previousSet(2, { weightKg: 12.5, reps: 15 })), 2, 'composer');

    expect(screen.getByText('last')).toBeTruthy();
    expect(screen.getByText('12.5kg × 15')).toBeTruthy();
  });

  it('keeps the unit on a row whose previous set carried no rep count', () => {
    // `12.5` alone is not a fact — a timed carry keeps its unit.
    renderLine(ready(previousSet(2, { weightKg: 12.5, reps: null })), 2, 'row');

    expect(screen.getByText('last 12.5kg')).toBeTruthy();
  });
});

describe('speakPreviousSetLine', () => {
  it('expands the glyphs to words, because × is not read aloud usefully', () => {
    expect(speakPreviousSetLine(ready(previousSet(3)), 3, 'kg')).toBe(
      'Last time 80 kilograms for 8 reps.',
    );
  });

  it('singularises one rep and one kilogram', () => {
    const history = ready(previousSet(1, { weightKg: 1, reps: 1 }));

    expect(speakPreviousSetLine(history, 1, 'kg')).toBe('Last time 1 kilogram for 1 rep.');
  });

  it('words a loaded set that carries no rep count', () => {
    const history = ready(previousSet(1, { weightKg: 40, reps: null }));

    expect(speakPreviousSetLine(history, 1, 'kg')).toBe('Last time 40 kilograms.');
  });

  it('has nothing to say when there is nothing to show', () => {
    expect(speakPreviousSetLine({ kind: 'loading' }, 1, 'kg')).toBeUndefined();
    expect(speakPreviousSetLine({ kind: 'error' }, 1, 'kg')).toBeUndefined();
    expect(speakPreviousSetLine(NEVER_LOGGED, 1, 'kg')).toBeUndefined();
  });

  it('states the absent set as a fact, in the composer’s words', () => {
    expect(speakPreviousSetLine(ready(previousSet(1)), 4, 'kg')).toBe('No set 4 last time.');
  });
});

describe('resolvePreviousSetLine', () => {
  it('keeps "never logged" and "no set N" as two different values', () => {
    // They render differently — nothing, versus "no set 4 last time" — so
    // collapsing them here would lose the distinction the design draws.
    expect(resolvePreviousSetLine(NEVER_LOGGED, 4)).toEqual({ kind: 'none' });
    expect(resolvePreviousSetLine(ready(previousSet(1)), 4)).toEqual({
      kind: 'missing',
      setNumber: 4,
    });
  });
});

describe('a logged row speaks its previous performance as one item', () => {
  const set: LoggedSetView = {
    localId: 'set-3',
    setNumber: 3,
    reps: 8,
    weightKg: 82.5,
    loggedAt: new Date('2026-09-11T10:00:00Z'),
    isWarmup: false,
  };

  it('appends "last time" to the row’s own label instead of adding a second stop', () => {
    const history = ready(previousSet(3, { weightKg: 80, reps: 8 }));

    render(
      <SetList
        sets={[set]}
        unit="kg"
        renderTrailing={(row) => (
          <PreviousSetLine history={history} setNumber={row.setNumber} unit="kg" placement="row" />
        )}
        renderTrailingLabel={(row) => speakPreviousSetLine(history, row.setNumber, 'kg')}
      />,
    );

    expect(
      screen.getByLabelText(
        'Set 3, 82.5 kilograms for 8 reps, logged. Last time 80 kilograms for 8 reps.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('last 80 × 8')).toBeTruthy();
  });

  it('leaves the row’s label untouched when there is no previous set to report', () => {
    render(
      <SetList
        sets={[set]}
        unit="kg"
        renderTrailing={(row) => (
          <PreviousSetLine
            history={NEVER_LOGGED}
            setNumber={row.setNumber}
            unit="kg"
            placement="row"
          />
        )}
        renderTrailingLabel={(row) => speakPreviousSetLine(NEVER_LOGGED, row.setNumber, 'kg')}
      />,
    );

    expect(screen.getByLabelText('Set 3, 82.5 kilograms for 8 reps, logged.')).toBeTruthy();
  });
});
