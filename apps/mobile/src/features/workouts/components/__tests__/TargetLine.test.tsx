import type { WeightUnit } from '@coachos/utils';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { UpcomingSessionExercise } from 'api/src/features/workouts/upcoming.ts';

import { getLocalDb } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { buildHistorySession, buildSetLog } from '../../../../lib/prefetch/__fixtures__/history.ts';
import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import { serialiseHistoryPayload } from '../../../../lib/prefetch/history.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { resolveTarget } from '../../hooks/useExerciseTarget.ts';
import { buildExercisePages, type ExercisePage } from '../../lib/exercise-pages.ts';
import { TargetLine } from '../TargetLine.tsx';

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

let mockWeightUnit: WeightUnit = 'kg';
jest.mock('../../../../hooks/useWeightUnit.ts', () => ({
  useWeightUnit: () => mockWeightUnit,
}));

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

function payloadFor(
  blocks: UpcomingSessionExercise[],
  names: Record<string, string> = {},
): LocalSessionPayload {
  return {
    session: buildSession({ exercises: blocks }),
    exercises: blocks.map((block) =>
      buildExercise({ id: block.exerciseId, name: names[block.exerciseId] ?? 'Bench press' }),
    ),
  };
}

async function seedLastTime(options: {
  exerciseId: string;
  weightKg: number | null;
  reps: number | null;
  isWarmup?: boolean;
}): Promise<void> {
  const key = nextId('history');
  const session = buildHistorySession({
    id: key,
    clientLocalId: key,
    scheduledDate: '2026-08-08',
    setLogs: [
      buildSetLog({
        id: nextId('set'),
        clientLocalId: nextId('set-local'),
        exerciseId: options.exerciseId,
        weightKg: options.weightKg,
        reps: options.reps,
        isWarmup: options.isWarmup ?? false,
        loggedAt: new Date('2026-08-08T18:00:00.000Z'),
      }),
    ],
  });

  await (await getLocalDb()).insert(localWorkoutSessions).values({
    id: key,
    clientLocalId: key,
    serverId: key,
    scheduledDate: '2026-08-08',
    programDayId: null,
    name: null,
    status: 'completed',
    startedAt: null,
    completedAt: null,
    payloadJson: serialiseHistoryPayload({ session, setLogs: session.setLogs }),
    syncState: 'synced',
    updatedAt: Date.now(),
  });
}

// The block is ONE accessibility element (`accessibility` §2), so the two
// layers are asserted through different doors: `printed` checks §8.4's
// literal on the screen, `getByLabelText` checks the single sentence a
// screen reader actually receives. `includeHiddenElements` keeps the first
// door open regardless of how the grouping is expressed.
function printed(value: string | RegExp) {
  return screen.getByText(value, { includeHiddenElements: true });
}

function noPrinted(value: string | RegExp) {
  return screen.queryByText(value, { includeHiddenElements: true });
}

/**
 * `noUncheckedIndexedAccess` makes every array index possibly-undefined, and
 * a `!` is banned in committed code (`CLAUDE.md`). This narrows once, loudly,
 * so a fixture that stops producing the page a test needs fails by name.
 */
function pageAt(payload: LocalSessionPayload, index = 0): ExercisePage {
  const page = buildExercisePages(payload)[index];
  if (page === undefined) throw new Error(`no exercise page at index ${String(index)}`);
  return page;
}

beforeEach(() => {
  mockWeightUnit = 'kg';
});

describe('TargetLine', () => {
  // `CLAUDE.md` §8.4's example, on a real page, from a real payload.
  it('shows the coach’s prescription and the client’s last set', async () => {
    const exerciseId = nextId('exercise');
    const block = buildBlock({
      programExerciseId: nextId('block'),
      exerciseId,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRpe: 8,
      targetWeightKg: null,
    });
    await seedLastTime({ exerciseId, weightKg: 60, reps: 9 });

    const payload = payloadFor([block]);
    const page = pageAt(payload);

    render(<TargetLine page={page} payload={payload} sessionLocalId={nextId('current')} />);

    expect(printed('3 × 8–10 @ RPE 8')).toBeTruthy();
    await waitFor(() => {
      expect(printed('60kg × 9')).toBeTruthy();
    });
    expect(printed('last time:')).toBeTruthy();
  });

  // The whole block is one item, spelled out. Queried by accessibility
  // label, so the test doubles as the screen-reader check (`testing` §6).
  it('reads as a single spoken sentence rather than five fragments', async () => {
    const exerciseId = nextId('exercise');
    const block = buildBlock({
      programExerciseId: nextId('block'),
      exerciseId,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRpe: 8,
      targetWeightKg: null,
    });
    await seedLastTime({ exerciseId, weightKg: 60, reps: 9 });

    const payload = payloadFor([block]);
    const page = pageAt(payload);

    render(<TargetLine page={page} payload={payload} sessionLocalId={nextId('current')} />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          'Target: 3 sets of 8 to 10 reps at RPE 8. Last time: 60 kilograms for 9 reps.',
        ),
      ).toBeTruthy();
    });
  });

  // Acceptance criterion 3 — an ad-hoc session has no `program_day_id`, so
  // no block, so no prescription. It degrades to history alone rather than
  // to an empty or apologetic block.
  it('degrades to last-time alone when the session has no prescription', async () => {
    const exerciseId = nextId('exercise');
    const block = buildBlock({ programExerciseId: nextId('block'), exerciseId });
    await seedLastTime({ exerciseId, weightKg: 100, reps: 5 });

    const payload = payloadFor([block]);
    const page = pageAt(payload);

    // The page exists but the payload carries no matching block — exactly
    // what an inserted or ad-hoc exercise looks like.
    render(
      <TargetLine
        page={{ ...page, key: 'not-in-this-payload' }}
        payload={payload}
        sessionLocalId={nextId('current')}
      />,
    );

    await waitFor(() => {
      expect(printed('100kg × 5')).toBeTruthy();
    });
    expect(noPrinted(/@ RPE/)).toBeNull();
    expect(screen.getByLabelText('Last time: 100 kilograms for 5 reps.')).toBeTruthy();
  });

  it('shows the prescription alone the first time a client meets an exercise', async () => {
    const block = buildBlock({
      programExerciseId: nextId('block'),
      exerciseId: nextId('never-logged'),
      targetSets: 4,
      targetRepsMin: 12,
      targetRepsMax: 12,
      targetRpe: 7,
      targetWeightKg: null,
    });

    const payload = payloadFor([block]);
    const page = pageAt(payload);

    render(<TargetLine page={page} payload={payload} sessionLocalId={nextId('current')} />);

    expect(printed('4 × 12 @ RPE 7')).toBeTruthy();
    await waitFor(() => {
      expect(printed('first time logging this')).toBeTruthy();
    });
  });

  it('says the same thing with neither half, and still says it as a fact', async () => {
    const block = buildBlock({
      programExerciseId: nextId('block'),
      exerciseId: nextId('never-logged'),
    });
    const payload = payloadFor([block]);
    const page = pageAt(payload);

    render(
      <TargetLine
        page={{ ...page, key: 'not-in-this-payload' }}
        payload={payload}
        sessionLocalId={nextId('current')}
      />,
    );

    await waitFor(() => {
      expect(printed('first time logging this')).toBeTruthy();
    });
    expect(screen.getByLabelText('First time logging this exercise.')).toBeTruthy();
  });

  // `CLAUDE.md` hard rule — one stored kilogram value, two readers.
  it('renders the same stored kilograms in the unit the client reads', async () => {
    mockWeightUnit = 'lb';
    const exerciseId = nextId('exercise');
    const block = buildBlock({
      programExerciseId: nextId('block'),
      exerciseId,
      targetSets: 3,
      targetRepsMin: 5,
      targetRepsMax: 5,
      targetRpe: null,
      targetWeightKg: 100,
    });
    await seedLastTime({ exerciseId, weightKg: 100, reps: 5 });

    const payload = payloadFor([block]);
    const page = pageAt(payload);

    render(<TargetLine page={page} payload={payload} sessionLocalId={nextId('current')} />);

    expect(printed('3 × 5 @ 220lb')).toBeTruthy();
    await waitFor(() => {
      expect(printed('220lb × 5')).toBeTruthy();
    });
  });

  it('never answers with a warm-up', async () => {
    const exerciseId = nextId('exercise');
    const block = buildBlock({ programExerciseId: nextId('block'), exerciseId });
    await seedLastTime({ exerciseId, weightKg: 20, reps: 10, isWarmup: true });

    const payload = payloadFor([block]);
    const page = pageAt(payload);

    render(<TargetLine page={page} payload={payload} sessionLocalId={nextId('current')} />);

    await waitFor(() => {
      expect(printed('first time logging this')).toBeTruthy();
    });
    expect(noPrinted('20kg × 10')).toBeNull();
  });

  // The prescription is already in memory, so it must not wait behind a
  // SQLite read it does not depend on (`UI-UX.md` §UX8).
  it('shows the prescription on the first frame, before the history read settles', async () => {
    const block = buildBlock({
      programExerciseId: nextId('block'),
      exerciseId: nextId('exercise'),
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRpe: 8,
      targetWeightKg: null,
    });
    const payload = payloadFor([block]);
    const page = pageAt(payload);

    render(<TargetLine page={page} payload={payload} sessionLocalId={nextId('current')} />);

    // Asserted before anything is awaited — the prescription is in memory,
    // so it is on the first frame, not behind the SQLite read.
    expect(printed('3 × 8–10 @ RPE 8')).toBeTruthy();
    expect(noPrinted('first time logging this')).toBeNull();

    // Then let the history read settle, so the assertion above is the only
    // thing this test proves and React is not mid-update at teardown.
    await waitFor(() => {
      expect(printed('first time logging this')).toBeTruthy();
    });
  });
});

// The risk the task file names outright: a cached or snapshotted target
// silently breaks `phase-07-.../assignment/04`'s bulk edit. `resolveTarget`
// is where that would happen, so it is pinned directly.
describe('resolveTarget — the live read', () => {
  it('reads through to whatever the payload currently says', () => {
    const key = 'block-live';
    const page = pageAt(
      payloadFor([buildBlock({ programExerciseId: key, exerciseId: 'exercise-live' })]),
    );

    const before = payloadFor([
      buildBlock({
        programExerciseId: key,
        exerciseId: 'exercise-live',
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
      }),
    ]);
    const afterCoachEdit = payloadFor([
      buildBlock({
        programExerciseId: key,
        exerciseId: 'exercise-live',
        targetSets: 5,
        targetRepsMin: 3,
        targetRepsMax: 5,
      }),
    ]);

    expect(resolveTarget(page, before)).toMatchObject({ targetSets: 3, targetRepsMin: 8 });
    // Same page object, rewritten payload — the coach's edit, having landed
    // through prefetch. Nothing in between may hold the old numbers.
    expect(resolveTarget(page, afterCoachEdit)).toMatchObject({ targetSets: 5, targetRepsMin: 3 });
  });

  // A day may legitimately carry one exercise twice — heavy early, a
  // back-off later — with different targets. Matching on `exerciseId` would
  // show both of them the first block's numbers.
  it('matches on the program-exercise id, not the exercise id', () => {
    const payload = payloadFor([
      buildBlock({
        programExerciseId: 'block-heavy',
        exerciseId: 'bench',
        targetSets: 3,
        targetRepsMin: 3,
        targetRepsMax: 3,
      }),
      buildBlock({
        programExerciseId: 'block-backoff',
        exerciseId: 'bench',
        orderIndex: 2,
        targetSets: 3,
        targetRepsMin: 10,
        targetRepsMax: 12,
      }),
    ]);

    expect(resolveTarget(pageAt(payload, 0), payload)).toMatchObject({ targetRepsMin: 3 });
    expect(resolveTarget(pageAt(payload, 1), payload)).toMatchObject({ targetRepsMin: 10 });
  });

  it('is null for a page the payload has no block for', () => {
    const payload = payloadFor([
      buildBlock({ programExerciseId: 'block-1', exerciseId: 'exercise-1' }),
    ]);
    const page = pageAt(payload);

    expect(resolveTarget({ ...page, key: 'inserted-mid-session' }, payload)).toBeNull();
    expect(resolveTarget(page, null)).toBeNull();
  });
});
