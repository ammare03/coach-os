import {
  resetRestTimerForTests,
  useRestTimerStore,
} from '../../workouts/store/rest-timer-store.ts';
import { wipeLocalDataOnSignOut } from '../store.ts';

// `rest-timer/05`. The rest timer is module state, so it outlives a sign-out
// unless something ends it — and the next person to hold this phone would
// otherwise be handed a countdown belonging to the person before them
// (`offline-sync` §8). The persisted anchor needs no test here: it lives in
// the database file the wipe deletes.
//
// `blocked` is the case with teeth. The wipe refuses when the outbox still
// holds unsynced rows, and the sign-out does not happen — so ending the
// rest there would take a countdown away from a client who is still
// training on their own device.

const mockWipeLocalDatabase = jest.fn();
jest.mock('../../../db/wipe.ts', () => ({
  wipeLocalDatabase: (options: unknown) => mockWipeLocalDatabase(options),
}));
jest.mock('../../../lib/query/persister.ts', () => ({
  clearPersistedQueryCache: () => Promise.resolve(),
}));
jest.mock('../../../lib/time-zone/store.ts', () => ({
  resetClientTimeZone: () => undefined,
}));

describe('wipeLocalDataOnSignOut and the rest timer', () => {
  beforeEach(() => {
    mockWipeLocalDatabase.mockReset();
    resetRestTimerForTests();
  });

  afterEach(() => {
    resetRestTimerForTests();
  });

  it('ends a running rest when the mirror is wiped', async () => {
    mockWipeLocalDatabase.mockResolvedValue({ outcome: 'wiped' });
    useRestTimerStore.getState().startRest(90, { sessionLocalId: 'session-1' });
    expect(useRestTimerStore.getState().isRunning).toBe(true);

    await wipeLocalDataOnSignOut();

    const state = useRestTimerStore.getState();
    expect(state.isRunning).toBe(false);
    // Full idle, not a completed rest — the two are distinguishable, and
    // the completion alert fires on the other one.
    expect(state.startedAtMs).toBeNull();
    expect(state.targetSeconds).toBe(0);
  });

  it('leaves the rest running when the wipe is blocked', async () => {
    mockWipeLocalDatabase.mockResolvedValue({ outcome: 'blocked', pendingCount: 3 });
    useRestTimerStore.getState().startRest(90, { sessionLocalId: 'session-1' });

    await wipeLocalDataOnSignOut();

    expect(useRestTimerStore.getState().isRunning).toBe(true);
  });
});
