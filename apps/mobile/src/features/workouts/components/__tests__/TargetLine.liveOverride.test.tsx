import type { WeightUnit } from '@coachos/utils';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { UpcomingSessionExercise } from 'api/src/features/workouts/upcoming.ts';

import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import {
  applyLiveTargetOverride,
  resetLiveTargetOverridesForTests,
} from '../../hooks/useLiveTargetOverride.ts';
import { buildExercisePages, type ExercisePage } from '../../lib/exercise-pages.ts';
import { LIVE_OVERRIDE_LABEL, labelSupersededTarget } from '../../lib/target-line-copy.ts';
import { TargetLine } from '../TargetLine.tsx';

// `session-modifications/04` — acceptance criteria 2 and 3, on the screen:
// the adjustment lands synchronously, and the result is unmistakably not
// the coach-authored line it replaced.

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

function payloadFor(blocks: UpcomingSessionExercise[]): LocalSessionPayload {
  return {
    session: buildSession({ exercises: blocks }),
    exercises: blocks.map((block) => buildExercise({ id: block.exerciseId })),
  };
}

function pageAt(payload: LocalSessionPayload, index = 0): ExercisePage {
  const page = buildExercisePages(payload)[index];
  if (page === undefined) throw new Error(`no exercise page at index ${String(index)}`);
  return page;
}

function printed(value: string | RegExp) {
  return screen.getByText(value, { includeHiddenElements: true });
}

function noPrinted(value: string | RegExp) {
  return screen.queryByText(value, { includeHiddenElements: true });
}

/** §8.4's own example block: `3 × 8–10 @ RPE 8`. */
function squatBlock(exerciseId: string): UpcomingSessionExercise {
  return buildBlock({
    programExerciseId: nextId('block'),
    exerciseId,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRpe: 8,
    targetWeightKg: null,
    targetRestSeconds: 120,
  });
}

beforeEach(() => {
  mockWeightUnit = 'kg';
});

afterEach(() => {
  resetLiveTargetOverridesForTests();
});

describe('a live-overridden target line', () => {
  it('shows the coach’s adjusted numbers in place of the programmed ones', async () => {
    const exerciseId = nextId('exercise');
    const payload = payloadFor([squatBlock(exerciseId)]);
    const sessionLocalId = nextId('current');

    render(<TargetLine page={pageAt(payload)} payload={payload} sessionLocalId={sessionLocalId} />);
    expect(printed('3 × 8–10 @ RPE 8')).toBeTruthy();

    act(() => {
      applyLiveTargetOverride(exerciseId, { targetRepsMin: 5, targetRepsMax: 5, targetRpe: 7 });
    });

    await waitFor(() => {
      expect(printed('3 × 5 @ RPE 7')).toBeTruthy();
    });
  });

  it('is visually distinguished from a coach-authored one', async () => {
    const exerciseId = nextId('exercise');
    const payload = payloadFor([squatBlock(exerciseId)]);
    const sessionLocalId = nextId('current');

    render(<TargetLine page={pageAt(payload)} payload={payload} sessionLocalId={sessionLocalId} />);
    // Nothing of the treatment is on a coach-authored line.
    expect(noPrinted(LIVE_OVERRIDE_LABEL)).toBeNull();

    act(() => {
      applyLiveTargetOverride(exerciseId, { targetSets: 5 });
    });

    await waitFor(() => {
      // The attribution, and the superseded value it replaced — two of the
      // three channels the design carries (the live dot is the third, and
      // has no text to query).
      expect(printed(LIVE_OVERRIDE_LABEL)).toBeTruthy();
    });
    expect(printed('3 × 8–10 @ RPE 8')).toBeTruthy();
    expect(printed('5 × 8–10 @ RPE 8')).toBeTruthy();
  });

  it('does not print the same numbers twice when the adjustment changes nothing printed', async () => {
    const exerciseId = nextId('exercise');
    const payload = payloadFor([squatBlock(exerciseId)]);
    const sessionLocalId = nextId('current');

    render(<TargetLine page={pageAt(payload)} payload={payload} sessionLocalId={sessionLocalId} />);

    // Rest is not on this line, so the printed prescription is unchanged.
    act(() => {
      applyLiveTargetOverride(exerciseId, { targetRestSeconds: 45 });
    });

    await waitFor(() => {
      expect(printed(LIVE_OVERRIDE_LABEL)).toBeTruthy();
    });
    expect(screen.getAllByText('3 × 8–10 @ RPE 8', { includeHiddenElements: true })).toHaveLength(
      1,
    );
  });

  it('tells a screen reader that the coach changed it, and what it was', async () => {
    const exerciseId = nextId('exercise');
    const payload = payloadFor([squatBlock(exerciseId)]);
    const sessionLocalId = nextId('current');

    render(<TargetLine page={pageAt(payload)} payload={payload} sessionLocalId={sessionLocalId} />);
    act(() => {
      applyLiveTargetOverride(exerciseId, { targetRepsMin: 5, targetRepsMax: 5, targetRpe: 7 });
    });

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          'Updated live by your coach. Target: 3 sets of 5 reps at RPE 7. ' +
            'Previously 3 sets of 8 to 10 reps at RPE 8. First time logging this exercise.',
        ),
      ).toBeTruthy();
    });
  });

  it('leaves another exercise’s line alone', async () => {
    const adjusted = nextId('exercise');
    const untouched = nextId('exercise');
    const payload = payloadFor([squatBlock(adjusted), squatBlock(untouched)]);
    const sessionLocalId = nextId('current');

    render(
      <TargetLine page={pageAt(payload, 1)} payload={payload} sessionLocalId={sessionLocalId} />,
    );
    act(() => {
      applyLiveTargetOverride(adjusted, { targetSets: 5 });
    });

    await waitFor(() => {
      expect(printed('3 × 8–10 @ RPE 8')).toBeTruthy();
    });
    expect(noPrinted(LIVE_OVERRIDE_LABEL)).toBeNull();
  });
});

describe('labelSupersededTarget', () => {
  const base = buildBlock({
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRpe: 8,
    targetWeightKg: null,
  });

  it('prints what the coach programmed when the live line reads differently', () => {
    const live = { ...base, targetSets: 5 };
    expect(labelSupersededTarget(base, live, 'kg')).toBe('3 × 8–10 @ RPE 8');
  });

  it('prints nothing when the two read the same', () => {
    const live = { ...base, targetRestSeconds: 45 };
    expect(labelSupersededTarget(base, live, 'kg')).toBeNull();
  });

  it('prints nothing when there is no programmed target under the adjustment', () => {
    expect(labelSupersededTarget(null, base, 'kg')).toBeNull();
  });
});
