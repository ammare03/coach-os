import {
  resetSessionRecordsForTests,
  selectSessionRecords,
  useSessionRecordsStore,
  type SessionRecord,
} from '../session-records-store.ts';

// `phase-09-workout-logger/session-summary/01` — the per-session PR ledger.
// The summary lists EVERY record from the session, so the one thing this
// store may never do is lose one or double one.

const SESSION = '018f4b1e-0000-7000-8000-0000000000aa';
const OTHER_SESSION = '018f4b1e-0000-7000-8000-0000000000bb';

beforeEach(resetSessionRecordsForTests);

function record(setLocalId: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    setLocalId,
    exerciseId: 'e-1',
    reps: 5,
    weightKg: 102.5,
    estimated1rmKg: 119.6,
    types: ['max_weight'],
    atMs: 1_000,
    ...overrides,
  };
}

describe('useSessionRecordsStore', () => {
  it('keeps every record of the session, not only the last one', () => {
    const store = useSessionRecordsStore.getState();
    store.openSession(SESSION);
    store.record(SESSION, record('set-1'));
    store.record(SESSION, record('set-2', { exerciseId: 'e-2', atMs: 2_000 }));

    expect(
      [...selectSessionRecords(useSessionRecordsStore.getState())].map((r) => r.setLocalId),
    ).toEqual(['set-1', 'set-2']);
  });

  it('orders by the instant the record was confirmed', () => {
    const store = useSessionRecordsStore.getState();
    store.openSession(SESSION);
    store.record(SESSION, record('late', { atMs: 9_000 }));
    store.record(SESSION, record('early', { atMs: 1_000 }));

    expect(
      [...selectSessionRecords(useSessionRecordsStore.getState())].map((r) => r.setLocalId),
    ).toEqual(['early', 'late']);
  });

  it('keeps the first confirmation when one set is recorded twice', () => {
    // An outbox replay answers identically by design, so the same set can
    // arrive more than once. It is one record, at the instant it first
    // landed.
    const store = useSessionRecordsStore.getState();
    store.openSession(SESSION);
    store.record(SESSION, record('set-1', { atMs: 1_000 }));
    store.record(SESSION, record('set-1', { atMs: 5_000 }));

    const records = [...selectSessionRecords(useSessionRecordsStore.getState())];
    expect(records).toHaveLength(1);
    expect(records[0]?.atMs).toBe(1_000);
  });

  it('refuses a record for a session it is not open on', () => {
    const store = useSessionRecordsStore.getState();
    store.openSession(SESSION);
    store.record(OTHER_SESSION, record('set-1'));

    expect(selectSessionRecords(useSessionRecordsStore.getState()).length).toBe(0);
  });

  it('wipes when a different session is opened', () => {
    const store = useSessionRecordsStore.getState();
    store.openSession(SESSION);
    store.record(SESSION, record('set-1'));
    store.openSession(OTHER_SESSION);

    expect(selectSessionRecords(useSessionRecordsStore.getState()).length).toBe(0);
  });

  it('keeps what is already in memory when a restore lands late', () => {
    const store = useSessionRecordsStore.getState();
    store.openSession(SESSION);
    store.record(SESSION, record('set-1', { atMs: 7_000 }));
    store.hydrate(SESSION, [record('set-1', { atMs: 1_000 }), record('set-0', { atMs: 500 })]);

    const records = [...selectSessionRecords(useSessionRecordsStore.getState())];
    expect(records.map((r) => r.setLocalId)).toEqual(['set-0', 'set-1']);
    // The live copy is the newer of the two.
    expect(records[1]?.atMs).toBe(7_000);
  });

  it('ignores a restore for another session', () => {
    const store = useSessionRecordsStore.getState();
    store.openSession(SESSION);
    store.hydrate(OTHER_SESSION, [record('set-1')]);

    expect(selectSessionRecords(useSessionRecordsStore.getState()).length).toBe(0);
  });
});
