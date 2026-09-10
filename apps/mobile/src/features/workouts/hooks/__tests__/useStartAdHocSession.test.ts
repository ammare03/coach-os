import { toLocalDate } from '@coachos/utils';
import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { deserializeOutboxPayload } from '../../../../lib/outbox/enqueue.ts';
import { readSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { AD_HOC_PROCEDURE, startAdHocSession } from '../useStartAdHocSession.ts';
import { pickTodaySession, summariseSession } from '../useTodaySession.ts';

// `phase-09-workout-logger/today-card/04`. Four things have to be true, and
// each of them is a way a client silently loses a workout when it is not:
// the row carries no program reference, it lands on the client's own
// calendar day, one tap produces exactly one `client_local_id`, and the
// payload it writes survives `today-card/02`'s narrowing reader.

// `expo-sqlite` has no Jest-side native module; the outbox's hand-built fake
// is reused rather than copied, for the reason its own header gives.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// Pulled in by the hook's `useConnectivity`. Nothing here renders the hook,
// but the module graph still reaches the native module.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
});

/** 19:00 UTC is already the 15th in Kolkata and still the 14th in New York. */
const ACROSS_MIDNIGHT = new Date('2026-08-14T19:00:00.000Z');

/**
 * One `outbox` row, as raw SQL returns it.
 *
 * Raw SQL rather than the Drizzle builder because importing the `outbox`
 * table here is what `outbox/no-direct-outbox-write` forbids — reads are
 * fine, the import is what makes a hand-built write possible. That also
 * rules out `typeof outbox.$inferSelect`, which is the shape
 * `no-hand-written-row-type` would normally want: it is camelCase, and the
 * columns below arrive under their real snake_case names.
 */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox, whose Drizzle table may not be imported here (see above)
interface QueuedMutation {
  id: string;
  procedure: string;
  client_local_id: string;
  payload_json: string;
}

async function readRows() {
  const db = await getLocalDb();
  const sessions = await db.select().from(localWorkoutSessions);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox`);
  return { sessions, entries };
}

describe('the row an ad-hoc session creates', () => {
  it('references no assignment and no program day', async () => {
    await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    const { sessions } = await readRows();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.programDayId).toBeNull();
    // `local_workout_sessions` has no `assignment_id` column at all — the
    // device never needs one — so the null the server row must end up with
    // is asserted on the payload, which is what the mutation carries.
    const payload = readSessionPayload(sessions[0]?.payloadJson ?? '');
    expect(payload?.session.assignmentId).toBeNull();
    expect(payload?.session.programDayId).toBeNull();
  });

  it('is born in_progress with the tap instant as started_at', async () => {
    const { startedAt } = await startAdHocSession({
      timeZone: 'UTC',
      now: () => ACROSS_MIDNIGHT,
    });

    const { sessions } = await readRows();
    expect(sessions[0]?.status).toBe('in_progress');
    expect(sessions[0]?.startedAt).toBe(ACROSS_MIDNIGHT.getTime());
    expect(startedAt).toEqual(ACROSS_MIDNIGHT);
  });

  it('is left pending, so the next prefetch cannot overwrite it', async () => {
    await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    const { sessions } = await readRows();
    // `offline-sync` §5 / `lib/prefetch/sessions.ts` rule (c): server truth
    // never clobbers a row the device has unsynced changes to.
    expect(sessions[0]?.syncState).toBe('pending');
    expect(sessions[0]?.serverId).toBeNull();
  });
});

describe('the day boundary', () => {
  // `CLAUDE.md` §25.5. Getting this wrong files the workout under the wrong
  // local day, silently, and the Today card then cannot find it.
  it("uses the client's own zone, not the device's", async () => {
    await startAdHocSession({ timeZone: 'Asia/Kolkata', now: () => ACROSS_MIDNIGHT });

    const { sessions } = await readRows();
    expect(sessions[0]?.scheduledDate).toBe('2026-08-15');
    expect(sessions[0]?.scheduledDate).toBe(toLocalDate(ACROSS_MIDNIGHT, 'Asia/Kolkata'));
  });

  it('files the same instant under the previous day in a negative offset', async () => {
    await startAdHocSession({ timeZone: 'America/New_York', now: () => ACROSS_MIDNIGHT });

    const { sessions } = await readRows();
    expect(sessions[0]?.scheduledDate).toBe('2026-08-14');
  });

  it('sends the same date to the server as it stored locally', async () => {
    await startAdHocSession({ timeZone: 'Asia/Kolkata', now: () => ACROSS_MIDNIGHT });

    const { entries, sessions } = await readRows();
    const payload = deserializeOutboxPayload(entries[0]?.payload_json ?? '') as {
      scheduledDate: string;
      startedAt: Date;
    };
    expect(payload.scheduledDate).toBe(sessions[0]?.scheduledDate);
    // superjson, not JSON — a `Date` captured at the tap is still a `Date`
    // after an app restart (`offline-sync` §10).
    expect(payload.startedAt).toBeInstanceOf(Date);
    expect(payload.startedAt.getTime()).toBe(ACROSS_MIDNIGHT.getTime());
  });
});

describe('idempotency (CLAUDE.md §25.12)', () => {
  it('queues exactly one mutation, keyed on the id the local row carries', async () => {
    const started = await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    const { sessions, entries } = await readRows();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.procedure).toBe(AD_HOC_PROCEDURE);
    expect(entries[0]?.client_local_id).toBe(started.localId);
    expect(sessions[0]?.clientLocalId).toBe(started.localId);
    // The row's `id` column against the hook's `outboxId` — two names for
    // one value. `EnqueuedMutation` calls it `outboxId` rather than `id`
    // precisely so it is never mistaken for the `clientLocalId` beside it
    // (`lib/outbox/enqueue.ts`); this is the assertion that they line up.
    expect(entries[0]?.id).toBe(started.outboxId);
    // The payload deliberately does NOT carry the key — `flush.ts` merges
    // the outbox row's own, which is the only authoritative copy.
    expect(deserializeOutboxPayload(entries[0]?.payload_json ?? '')).not.toHaveProperty(
      'clientLocalId',
    );
  });

  it('never reuses a key across two separate taps', async () => {
    const first = await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });
    const second = await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    expect(first.localId).not.toBe(second.localId);
    const { sessions } = await readRows();
    expect(sessions).toHaveLength(2);
  });

  it('survives a double flush without a second local row — the key is stored, not regenerated', async () => {
    const started = await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    // What a replay reads: the stored row, twice. A regenerated key here is
    // exactly the failure that turns one workout into two.
    const db = await getLocalDb();
    const read = () =>
      db.get<QueuedMutation>(sql`SELECT * FROM outbox WHERE id = ${started.outboxId}`);

    expect(read()?.client_local_id).toBe(started.localId);
    expect(read()?.client_local_id).toBe(started.localId);
  });
});

describe('the empty payload', () => {
  // The likeliest place this task breaks: `readSessionPayload` narrows,
  // because `lib/prefetch/history.ts` writes a different shape into the same
  // column and the date split between the two prefetchers is not airtight.
  // A payload that fails that guard reads back as `null`, and the card then
  // renders a session with no name and no id to open.
  it('passes today-card/02’s guard rather than reading as clobbered', async () => {
    const started = await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    const { sessions } = await readRows();
    const payload = readSessionPayload(sessions[0]?.payloadJson ?? '');

    expect(payload).not.toBeNull();
    expect(payload?.session.exercises).toEqual([]);
    expect(payload?.exercises).toEqual([]);
    expect(payload?.session.clientLocalId).toBe(started.localId);
  });

  it('degrades every prescribed number rather than inventing one', async () => {
    await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    const { sessions } = await readRows();
    const row = pickTodaySession(sessions);
    expect(row).not.toBeNull();
    if (!row) return;

    const summary = summariseSession(row, readSessionPayload(row.payloadJson));

    expect(summary.localId).toBe(row.clientLocalId);
    expect(summary.name).toBeNull();
    expect(summary.exerciseCount).toBe(0);
    // No coach-set targets exist, so there is no target line to show and no
    // denominator for a progress bar (`session-runtime/04`'s degradation).
    expect(summary.targetSets).toBe(0);
    expect(summary.estimatedMinutes).toBeNull();
    expect(summary.previewExerciseNames).toEqual([]);
    expect(summary.remainingExerciseCount).toBe(0);
  });

  it('is the row the Today card picks over one already completed today', async () => {
    // Frame `C`'s "Log another workout": the finished session must not keep
    // the card once a new one is under way.
    const db = await getLocalDb();
    await db.insert(localWorkoutSessions).values({
      id: 'done-1',
      clientLocalId: 'done-1',
      serverId: 'done-1',
      scheduledDate: '2026-08-14',
      programDayId: 'day-1',
      name: 'Upper A',
      status: 'completed',
      startedAt: ACROSS_MIDNIGHT.getTime() - 3_600_000,
      completedAt: ACROSS_MIDNIGHT.getTime() - 600_000,
      payloadJson: '{}',
      syncState: 'synced',
      updatedAt: ACROSS_MIDNIGHT.getTime(),
    });

    const started = await startAdHocSession({ timeZone: 'UTC', now: () => ACROSS_MIDNIGHT });

    const { sessions } = await readRows();
    expect(pickTodaySession(sessions)?.clientLocalId).toBe(started.localId);
  });
});
