import {
  SKIP_REASONS,
  SKIP_REASON_LABEL,
  selectSkips,
  useSkippedExercisesStore,
  type SkippedExercise,
} from '../skipped-exercises-store.ts';

// `phase-09-workout-logger/session-modifications/03`. Three things have to be
// true, and two of them are ways a client's session gets misreported: a skip
// belongs to exactly one session, the same exercise appearing twice in a day
// is two separate pages, and a record read back off disk never overwrites one
// the client has just made in this process.

const SESSION = '018f4b1e-0000-7000-8000-0000000000aa';
const OTHER_SESSION = '018f4b1e-0000-7000-8000-0000000000bb';

function entry(overrides: Partial<SkippedExercise> = {}): SkippedExercise {
  return {
    exerciseKey: 'b-1',
    exerciseId: 'e-1',
    exerciseName: 'Barbell back squat',
    reason: 'equipment',
    note: null,
    atMs: 1_700_000_000_000,
    ...overrides,
  };
}

const store = () => useSkippedExercisesStore.getState();

beforeEach(() => {
  useSkippedExercisesStore.setState({ sessionLocalId: null, skips: new Map() });
});

describe('useSkippedExercisesStore', () => {
  it('records a skip against the open session', () => {
    store().openSession(SESSION);
    store().skip(SESSION, entry({ reason: 'pain', note: 'left knee' }));

    expect(selectSkips(store()).get('b-1')).toMatchObject({
      exerciseName: 'Barbell back squat',
      reason: 'pain',
      note: 'left knee',
    });
  });

  it('keys on the page rather than the exercise, so a repeated movement skips once', () => {
    store().openSession(SESSION);
    // The same exercise in two blocks — a back-off set, or both halves of a
    // superset drawn from one movement.
    store().skip(SESSION, entry({ exerciseKey: 'b-1', exerciseId: 'e-1' }));

    const skips = selectSkips(store());
    expect(skips.has('b-1')).toBe(true);
    expect(skips.has('b-4')).toBe(false);
  });

  it('ignores a write naming a session it is not open on', () => {
    store().openSession(SESSION);
    store().skip(OTHER_SESSION, entry());

    expect(selectSkips(store()).size).toBe(0);
  });

  it('wipes when a different session opens', () => {
    store().openSession(SESSION);
    store().skip(SESSION, entry());
    store().openSession(OTHER_SESSION);

    expect(selectSkips(store()).size).toBe(0);
  });

  it('re-opening the same session keeps what is already recorded', () => {
    store().openSession(SESSION);
    store().skip(SESSION, entry());
    store().openSession(SESSION);

    expect(selectSkips(store()).size).toBe(1);
  });

  it('undoes a skip, and does nothing for a page that was not skipped', () => {
    store().openSession(SESSION);
    store().skip(SESSION, entry());

    store().unskip(SESSION, 'b-9');
    expect(selectSkips(store()).size).toBe(1);

    store().unskip(SESSION, 'b-1');
    expect(selectSkips(store()).size).toBe(0);
  });

  it('hydrates a restored record without clobbering a skip made in this process', () => {
    store().openSession(SESSION);
    // The client skipped b-1 with a different reason before the restore
    // resolved; the live copy is the newer of the two.
    store().skip(SESSION, entry({ exerciseKey: 'b-1', reason: 'time' }));

    store().hydrate(SESSION, [
      entry({ exerciseKey: 'b-1', reason: 'equipment' }),
      entry({ exerciseKey: 'b-2', reason: 'pain' }),
    ]);

    const skips = selectSkips(store());
    expect(skips.get('b-1')?.reason).toBe('time');
    expect(skips.get('b-2')?.reason).toBe('pain');
  });

  it('ignores a restore for a session it is not open on', () => {
    store().openSession(SESSION);
    store().hydrate(OTHER_SESSION, [entry()]);

    expect(selectSkips(store()).size).toBe(0);
  });
});

describe('SKIP_REASON_LABEL', () => {
  it('words every reason without judging the client', () => {
    // `COPY.md` §CO2/§CO3: nothing diagnoses, and nothing is worded as a
    // failure to do something. The assertion is the copy itself — if a
    // rewrite reintroduces "couldn't", "failed", "missed" or "skipped a",
    // this is where it is caught.
    for (const reason of SKIP_REASONS) {
      const label = SKIP_REASON_LABEL[reason];
      expect(label).not.toMatch(/missed|failed|couldn't|gave up|quit/i);
      expect(label).not.toMatch(/!/);
      // Sentence case on a control (`product-copy` §6).
      expect(label[0]).toBe(label[0]?.toUpperCase());
    }
  });
});
