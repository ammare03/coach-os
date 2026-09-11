import { PERSONAL_RECORD_TYPES } from '@coachos/db';

import type { OutboxSendResult } from '../../../../lib/outbox/results.ts';
import {
  PR_ANALYTICS_TYPE,
  PR_COPY,
  PR_PRIORITY,
  buildCelebration,
  readConfirmedRecords,
  type PRCelebrationView,
  type PersonalRecordType,
} from '../pr-celebration.ts';

/** The sub-line as it reads on screen — two nodes in the design, one string here. */
function printed(view: PRCelebrationView | null): string | undefined {
  return view === null ? undefined : `${view.detailLead} ${view.detailValue}`;
}

// `personal-records/03`. Everything here is a product decision with a wrong
// answer that ships silently: a priority order that drops a type, an
// analytics literal that maps to nothing, a sub-line that names no exercise
// and so reads as a lie when it lands two exercises late.

const SET_ID = '0198f2d6-0000-7000-8000-000000000001';
const SESSION_ID = '0198f2d6-0000-7000-8000-000000000002';
const EXERCISE_ID = '0198f2d6-0000-7000-8000-000000000003';

function sendResult(overrides: Partial<OutboxSendResult> = {}): OutboxSendResult {
  return {
    procedure: 'workouts.logSet',
    clientLocalId: SET_ID,
    input: { sessionClientLocalId: SESSION_ID, clientLocalId: SET_ID },
    result: {
      clientLocalId: SET_ID,
      exerciseId: EXERCISE_ID,
      setNumber: 4,
      reps: 5,
      weightKg: 92.5,
      estimated1rmKg: 107.9,
      isWarmup: false,
      newPersonalRecords: ['max_weight'],
    },
    ...overrides,
  };
}

describe('PR_PRIORITY', () => {
  it('covers every record type the database defines, exactly once', () => {
    // The order is this surface's own (heaviest-ever first — the one a
    // lifter recognises without arithmetic); the MEMBERSHIP is the DB's.
    // Pinned here rather than imported because the mobile app never depends
    // on `@coachos/db` at runtime (`lib/analytics/events.ts`).
    expect([...PR_PRIORITY].sort()).toEqual([...PERSONAL_RECORD_TYPES].sort());
    expect(new Set(PR_PRIORITY).size).toBe(PR_PRIORITY.length);
  });
});

describe('PR_ANALYTICS_TYPE', () => {
  it('maps every record type to its analytics literal', () => {
    // `AnalyticsRecordType`'s literals are deliberately NOT the DB's, and a
    // fifth record type must not be able to map to nothing.
    expect(PR_ANALYTICS_TYPE).toEqual({
      max_weight: 'weight',
      '1rm_estimated': 'estimated_1rm',
      max_reps: 'reps',
      max_volume: 'volume',
    });
    for (const type of PR_PRIORITY) {
      expect(PR_ANALYTICS_TYPE[type]).toBeDefined();
    }
  });
});

describe('readConfirmedRecords', () => {
  it('narrows a logSet response that took a record', () => {
    expect(readConfirmedRecords(sendResult())).toEqual({
      setLocalId: SET_ID,
      sessionLocalId: SESSION_ID,
      exerciseId: EXERCISE_ID,
      reps: 5,
      weightKg: 92.5,
      estimated1rmKg: 107.9,
      types: ['max_weight'],
    });
  });

  it('is null for the ordinary set, which beat nothing', () => {
    const sent = sendResult();
    const result = { ...(sent.result as object), newPersonalRecords: [] };
    expect(readConfirmedRecords({ ...sent, result })).toBeNull();
  });

  it('is null for a warm-up, which the server never credits', () => {
    const sent = sendResult();
    const result = { ...(sent.result as object), isWarmup: true, newPersonalRecords: [] };
    expect(readConfirmedRecords({ ...sent, result })).toBeNull();
  });

  it('is null for any other procedure the outbox replays', () => {
    expect(readConfirmedRecords(sendResult({ procedure: 'workouts.completeSession' }))).toBeNull();
  });

  it('is null rather than throwing when the response is not the shape we expect', () => {
    // An older server, a transport that dropped the field, a `null` body.
    expect(readConfirmedRecords(sendResult({ result: null }))).toBeNull();
    expect(
      readConfirmedRecords(sendResult({ result: { newPersonalRecords: 'max_weight' } })),
    ).toBeNull();
    expect(
      readConfirmedRecords(sendResult({ result: { newPersonalRecords: ['not_a_record_type'] } })),
    ).toBeNull();
  });

  it('is null when the outbox entry names no session', () => {
    expect(readConfirmedRecords(sendResult({ input: { clientLocalId: SET_ID } }))).toBeNull();
  });
});

describe('buildCelebration', () => {
  const facts = {
    setLocalId: SET_ID,
    sessionLocalId: SESSION_ID,
    exerciseId: EXERCISE_ID,
    reps: 5,
    weightKg: 92.5,
    estimated1rmKg: 107.9,
    types: ['max_weight'] as readonly PersonalRecordType[],
  };

  it('always says the words "Personal record"', () => {
    const view = buildCelebration(facts, { exerciseName: 'Bench press', unit: 'kg', token: 1 });
    expect(view?.title).toBe(PR_COPY.title);
    expect(PR_COPY.title).toBe('Personal record');
  });

  it('always names the exercise, so a confirmation that lands late still reads', () => {
    const view = buildCelebration(facts, { exerciseName: 'Bench press', unit: 'kg', token: 1 });
    expect(printed(view)).toBe('Bench press — heaviest ever, 92.5kg');
  });

  it('renders the value in the client unit, converted at the edge', () => {
    const view = buildCelebration(facts, { exerciseName: 'Bench press', unit: 'lb', token: 1 });
    expect(printed(view)).toBe('Bench press — heaviest ever, 204lb');
  });

  it('counts the other types beaten rather than stacking a second pill', () => {
    const view = buildCelebration(
      { ...facts, types: ['max_weight', '1rm_estimated', 'max_volume'] },
      { exerciseName: 'Back squat', unit: 'kg', token: 1 },
    );
    expect(printed(view)).toBe('Back squat — heaviest ever, 92.5kg');
    expect(view?.moreCount).toBe(2);
  });

  it('falls to the next priority when the headline type was not beaten', () => {
    const view = buildCelebration(
      { ...facts, types: ['max_volume', 'max_reps'] },
      { exerciseName: 'Back squat', unit: 'kg', token: 1 },
    );
    expect(printed(view)).toBe('Back squat — most reps at 92.5kg, 5');
  });

  it('names one record, never four', () => {
    const view = buildCelebration(
      { ...facts, types: ['max_volume', '1rm_estimated', 'max_weight', 'max_reps'] },
      { exerciseName: 'Back squat', unit: 'kg', token: 1 },
    );
    expect(printed(view)).toBe('Back squat — heaviest ever, 92.5kg');
    expect(view?.moreCount).toBe(3);
  });

  it('shows no count badge when one type was beaten', () => {
    const view = buildCelebration(facts, { exerciseName: 'Bench press', unit: 'kg', token: 1 });
    expect(view?.moreCount).toBe(0);
  });

  it('words each record type literally', () => {
    const at = (types: readonly PersonalRecordType[]) =>
      printed(
        buildCelebration({ ...facts, types }, { exerciseName: 'Back squat', unit: 'kg', token: 1 }),
      );

    expect(at(['1rm_estimated'])).toBe('Back squat — best estimated 1RM, 107.9kg');
    expect(at(['max_reps'])).toBe('Back squat — most reps at 92.5kg, 5');
    expect(at(['max_volume'])).toBe('Back squat — biggest set, 462.5kg');
  });

  it('says nothing it cannot name a value for, and falls to the next type', () => {
    // A bodyweight set has no weight, so "heaviest ever" has no value — but
    // the reps record it also took does.
    const view = buildCelebration(
      { ...facts, weightKg: null, estimated1rmKg: null, types: ['max_weight', 'max_reps'] },
      { exerciseName: 'Pull-up', unit: 'kg', token: 1 },
    );
    expect(printed(view)).toBe('Pull-up — most reps, 5');
  });

  it('is null when no type in the set can be named', () => {
    expect(
      buildCelebration(
        { ...facts, weightKg: null, estimated1rmKg: null, types: ['max_weight'] },
        { exerciseName: 'Pull-up', unit: 'kg', token: 1 },
      ),
    ).toBeNull();
  });

  it('speaks one sentence, with glyphs as words', () => {
    const view = buildCelebration(facts, { exerciseName: 'Bench press', unit: 'kg', token: 1 });
    expect(view?.label).toBe('Personal record. Bench press, heaviest ever, 92.5 kilograms.');
  });

  it('never shames, promises, or exclaims (`COPY.md` §CO2)', () => {
    for (const types of [['max_weight'], ['1rm_estimated'], ['max_reps'], ['max_volume']]) {
      const view = buildCelebration(
        { ...facts, types: types as readonly PersonalRecordType[] },
        { exerciseName: 'Bench press', unit: 'kg', token: 1 },
      );
      expect(view).not.toBeNull();
      expect(`${view?.title ?? ''} ${printed(view) ?? ''} ${view?.label ?? ''}`).not.toMatch(
        /[!]|\byou\b|\byour\b/i,
      );
    }
  });

  it('carries the token through, so the pill timer restarts on replacement', () => {
    expect(
      buildCelebration(facts, { exerciseName: 'Bench press', unit: 'kg', token: 7 })?.token,
    ).toBe(7);
  });
});
