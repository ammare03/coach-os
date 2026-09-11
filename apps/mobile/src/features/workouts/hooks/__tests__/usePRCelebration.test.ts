import { act, renderHook } from '@testing-library/react-native';

import { trackEvent } from '../../../../lib/analytics/index.ts';
import {
  publishOutboxResult,
  resetOutboxResultListenersForTests,
  type OutboxSendResult,
} from '../../../../lib/outbox/results.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import {
  resetPRCelebrationForTests,
  usePRCelebrationStore,
} from '../../store/pr-celebration-store.ts';
import { usePRCelebration } from '../usePRCelebration.ts';

// `personal-records/03`. The task's own Verification section, verbatim:
// "Log a PR-setting set, confirm the celebration fires once. Force an outbox
// retry of the same mutation … and confirm the celebration does not fire a
// second time."
//
// That retry is not hypothetical. `apps/api/src/lib/pr-detection.ts`
// decision (c) makes the server report the types a set CURRENTLY HOLDS, so
// a replay of the same idempotent upsert returns the SAME non-empty array —
// on purpose, so a first response lost in a tunnel is still deliverable.
// Exactly-once is therefore entirely the device's job.

jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: jest.fn(),
  asUuid: (value: string) => value,
}));

const mockTrackEvent = trackEvent as jest.MockedFunction<typeof trackEvent>;

const SESSION_ID = '0198f2d6-0000-7000-8000-0000000000aa';
const SET_ID = '0198f2d6-0000-7000-8000-0000000000bb';
const OTHER_SET_ID = '0198f2d6-0000-7000-8000-0000000000cc';
const EXERCISE_ID = '0198f2d6-0000-7000-8000-0000000000dd';

const payload = {
  session: { exercises: [] },
  exercises: [{ id: EXERCISE_ID, name: 'Bench press' }],
} as unknown as LocalSessionPayload;

function logSetResult(
  overrides: {
    setLocalId?: string;
    sessionLocalId?: string;
    newPersonalRecords?: string[];
  } = {},
): OutboxSendResult {
  const setLocalId = overrides.setLocalId ?? SET_ID;
  return {
    procedure: 'workouts.logSet',
    clientLocalId: setLocalId,
    input: {
      sessionClientLocalId: overrides.sessionLocalId ?? SESSION_ID,
      clientLocalId: setLocalId,
    },
    result: {
      clientLocalId: setLocalId,
      exerciseId: EXERCISE_ID,
      setNumber: 4,
      reps: 5,
      weightKg: 92.5,
      estimated1rmKg: 107.9,
      isWarmup: false,
      newPersonalRecords: overrides.newPersonalRecords ?? ['max_weight'],
    },
  };
}

function mount(options: { enabled?: boolean; sessionLocalId?: string } = {}) {
  return renderHook(() =>
    usePRCelebration({
      sessionLocalId: options.sessionLocalId ?? SESSION_ID,
      payload,
      unit: 'kg',
      enabled: options.enabled ?? true,
    }),
  );
}

function deliver(sent: OutboxSendResult) {
  act(() => {
    publishOutboxResult(sent);
  });
}

function current() {
  return usePRCelebrationStore.getState().current;
}

beforeEach(() => {
  resetPRCelebrationForTests();
  resetOutboxResultListenersForTests();
  mockTrackEvent.mockClear();
});

describe('usePRCelebration', () => {
  it('celebrates a set that took a record', () => {
    mount();

    deliver(logSetResult());

    expect(current()?.detailLead).toBe('Bench press — heaviest ever,');
    expect(current()?.detailValue).toBe('92.5kg');
    expect(current()?.title).toBe('Personal record');
  });

  it('fires exactly once across an outbox replay of the same mutation', () => {
    mount();

    // The first delivery. The server confirmed the set and named the record.
    deliver(logSetResult());
    const first = current();
    expect(first).not.toBeNull();

    // The pill is read and goes.
    act(() => {
      usePRCelebrationStore.getState().dismiss(first?.token ?? -1);
    });
    expect(current()).toBeNull();

    // The retry. Same `clientLocalId`, same non-empty array — exactly what
    // the server sends when the device re-sends a mutation it already
    // processed. Nothing may come back on screen.
    deliver(logSetResult());
    expect(current()).toBeNull();

    // And it is one analytics event, not two.
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire a replay that arrives while the first pill is still up', () => {
    mount();

    deliver(logSetResult());
    const first = current();

    deliver(logSetResult());

    // Same pill, same token — not a replacement, and not a second one.
    expect(current()).toBe(first);
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('still celebrates a different set in the same session', () => {
    mount();

    deliver(logSetResult());
    const first = current();
    deliver(logSetResult({ setLocalId: OTHER_SET_ID }));

    expect(current()?.setLocalId).toBe(OTHER_SET_ID);
    expect(current()?.token).not.toBe(first?.token);
    expect(mockTrackEvent).toHaveBeenCalledTimes(2);
  });

  it('replaces the pill rather than stacking a second one', () => {
    mount();

    deliver(logSetResult());
    deliver(logSetResult({ setLocalId: OTHER_SET_ID }));

    // One pill, and it is the newer one.
    expect(current()?.setLocalId).toBe(OTHER_SET_ID);
  });

  it('keeps the mark on every row that earned a record, not just the last', () => {
    mount();

    deliver(logSetResult());
    deliver(logSetResult({ setLocalId: OTHER_SET_ID }));

    const marks = usePRCelebrationStore.getState().recordSetIds;
    expect([...marks].sort()).toEqual([SET_ID, OTHER_SET_ID].sort());
  });

  it('ignores the ordinary set, which beat nothing', () => {
    mount();

    deliver(logSetResult({ newPersonalRecords: [] }));

    expect(current()).toBeNull();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('ignores a confirmation for a different session', () => {
    mount();

    deliver(logSetResult({ sessionLocalId: 'some-other-session' }));

    expect(current()).toBeNull();
  });

  it('drops a late confirmation once the session is no longer in progress', () => {
    // The suppression rule: after the summary screen a record is dropped,
    // not deferred — it is still on the client's progress screen.
    mount({ enabled: false });

    deliver(logSetResult());

    expect(current()).toBeNull();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('does not buffer a confirmation delivered while nothing is mounted', () => {
    const { unmount } = mount();
    unmount();

    deliver(logSetResult());
    expect(current()).toBeNull();

    // Remounting must not resurrect it — there is no queue (`results.ts`
    // rule (c)).
    mount();
    expect(current()).toBeNull();
  });

  it('fires one analytics event per record type beaten, with the analytics literals', () => {
    mount();

    deliver(logSetResult({ newPersonalRecords: ['max_weight', '1rm_estimated', 'max_volume'] }));

    expect(mockTrackEvent).toHaveBeenCalledTimes(3);
    expect(mockTrackEvent.mock.calls.map((call) => call[1])).toEqual([
      { exercise_id: EXERCISE_ID, record_type: 'weight' },
      { exercise_id: EXERCISE_ID, record_type: 'estimated_1rm' },
      { exercise_id: EXERCISE_ID, record_type: 'volume' },
    ]);
    expect(mockTrackEvent.mock.calls.every((call) => call[0] === 'personal_record_hit')).toBe(true);
  });

  it('marks the row but shows no pill when the device cannot name the exercise', () => {
    renderHook(() =>
      usePRCelebration({ sessionLocalId: SESSION_ID, payload: null, unit: 'kg', enabled: true }),
    );

    deliver(logSetResult());

    expect(current()).toBeNull();
    expect(usePRCelebrationStore.getState().recordSetIds.has(SET_ID)).toBe(true);
    // Claimed, so the next replay does not try again.
    deliver(logSetResult());
    expect(current()).toBeNull();
  });

  it('never lets an analytics failure swallow the celebration', () => {
    mockTrackEvent.mockImplementationOnce(() => {
      throw new Error('posthog is down');
    });
    mount();

    deliver(logSetResult());

    expect(current()?.detailLead).toBe('Bench press — heaviest ever,');
  });

  it('wipes the previous workout when a new session opens', () => {
    const first = mount();
    deliver(logSetResult());
    expect(usePRCelebrationStore.getState().recordSetIds.size).toBe(1);
    first.unmount();

    mount({ sessionLocalId: 'a-second-session' });

    expect(usePRCelebrationStore.getState().recordSetIds.size).toBe(0);
    expect(current()).toBeNull();
  });
});
