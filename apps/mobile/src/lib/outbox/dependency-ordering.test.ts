import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { enqueueMutation } from './enqueue.ts';
import {
  claimReadyEntries,
  flushOutbox,
  FLUSH_BATCH_SIZE,
  resetOutboxFlushStateForTests,
  type OutboxSender,
} from './flush.ts';

// DB§14.2's two halves, proved separately: strict order *within* a chain, and
// genuine independence *across* chains. `flush.test.ts` covers the one-level
// claim rule; this file covers what task 04 owns — that a slow chain cannot
// hold up an unrelated one, and that the exclusion holds at any depth.

jest.mock('../analytics/index.ts', () => ({
  trackEvent: jest.fn(),
  asProcedureName: (path: string) => path,
}));

jest.mock('expo-sqlite', () => require('./__fixtures__/sqlite-fake.ts').createSqliteFake());

type Row = Record<string, unknown>;

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

/** Ahead of the wall clock `enqueueMutation` stamps rows with, so every row is due. */
const FIXED_NOW = Date.now() + 60_000;

async function readRow(outboxId: string): Promise<Row | undefined> {
  const db = await getLocalDb();
  const rows = db.all<Row>(sql`SELECT * FROM outbox`);
  return rows.find((r) => r.id === outboxId);
}

/**
 * Drains the microtask queue. Every step of the flush scheduler is microtask
 * driven once the sender resolves synchronously, so one macrotask hop lets it
 * run as far as it can — and stopping there is the point: what it has NOT done
 * by then is what a barrier would be blocking.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A sender that identifies each mutation by the `marker` in its payload and
 * can hold any of them open indefinitely. Holding one send is how a "slow
 * chain" is expressed without a timer.
 */
function markerSender(blocked: string[] = []) {
  const started: string[] = [];
  const completed: string[] = [];
  const gates = new Map<string, () => void>();
  const send: OutboxSender = (_procedure, input) => {
    const marker = String(input.marker);
    started.push(marker);
    if (!blocked.includes(marker)) {
      completed.push(marker);
      return Promise.resolve(null);
    }
    return new Promise<null>((resolve) => {
      gates.set(marker, () => {
        completed.push(marker);
        resolve(null);
      });
    });
  };
  const release = (marker: string) => {
    const gate = gates.get(marker);
    if (!gate) throw new Error(`No held send for ${marker}`);
    gates.delete(marker);
    gate();
  };
  return { send, started, completed, release };
}

/** A session-start plus `setCount` set-logs chained to it — P09's real shape (DB§14.2). */
async function enqueueSessionChain(name: string, setCount: number): Promise<string[]> {
  const session = await enqueueMutation({
    procedure: 'workouts.startSession',
    payload: { marker: `${name}.session` },
  });
  const markers = [`${name}.session`];
  for (let i = 1; i <= setCount; i += 1) {
    await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { marker: `${name}.set${i}` },
      dependsOn: session.outboxId,
    });
    markers.push(`${name}.set${i}`);
  }
  return markers;
}

beforeEach(() => {
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  sqliteFake.__reset();
});

describe('parallelism across independent chains (DB§14.2)', () => {
  it('flushes a second session chain while the first chain is still blocked on its session', async () => {
    // The task's Verification, literally: two independent session chains,
    // enqueued together. Chain A's session is held open; chain B must run to
    // completion anyway. A pass-shaped loop — claim a batch, await the whole
    // batch, claim again — passes the weaker "two roots send concurrently"
    // test and fails this one, because chain B's sets cannot be claimed until
    // chain A's session has settled.
    const { send, started, completed, release } = markerSender(['a.session']);
    await enqueueSessionChain('a', 3);
    await enqueueSessionChain('b', 3);

    const flushing = flushOutbox({ send, now: () => FIXED_NOW });
    await settle();

    expect(completed.sort()).toEqual(['b.session', 'b.set1', 'b.set2', 'b.set3']);
    // Chain A is exactly where it should be: its session in flight, its sets
    // still waiting on it.
    expect(started).toContain('a.session');
    expect(started).not.toContain('a.set1');

    release('a.session');
    await flushing;

    expect(started.sort()).toEqual(
      ['a.session', 'a.set1', 'a.set2', 'a.set3', 'b.session', 'b.set1', 'b.set2', 'b.set3'].sort(),
    );
  });

  it('lets an unrelated chain finish while a chain whose parent failed stays parked', async () => {
    const attempted: string[] = [];
    const send: OutboxSender = async (_procedure, input) => {
      const marker = String(input.marker);
      attempted.push(marker);
      if (marker === 'a.session') throw new Error('network down');
      return null;
    };
    await enqueueSessionChain('a', 2);
    await enqueueSessionChain('b', 2);

    const result = await flushOutbox({ send, now: () => FIXED_NOW, backoffMs: () => 60_000 });

    expect(attempted.sort()).toEqual(['a.session', 'b.session', 'b.set1', 'b.set2'].sort());
    expect(result).toMatchObject({ sent: 3, failed: 1 });
    // Parked, not lost: the sets keep their place behind a session that will
    // be retried on the next trigger.
    expect(await statusOfMarker('a.set1')).toBe('queued');
    expect(await statusOfMarker('a.session')).toBe('failed');
  });

  it('never holds more sends open at once than one batch', async () => {
    const open = new Set<string>();
    let maxOpen = 0;
    const release: (() => void)[] = [];
    const send: OutboxSender = (_procedure, input) => {
      const marker = String(input.marker);
      open.add(marker);
      maxOpen = Math.max(maxOpen, open.size);
      return new Promise<null>((resolve) => {
        release.push(() => {
          open.delete(marker);
          resolve(null);
        });
      });
    };
    for (let i = 0; i < FLUSH_BATCH_SIZE + 5; i += 1) {
      await enqueueMutation({ procedure: 'workouts.logSet', payload: { marker: `set${i}` } });
    }

    const flushing = flushOutbox({ send, now: () => FIXED_NOW });
    await settle();
    expect(maxOpen).toBe(FLUSH_BATCH_SIZE);

    while (release.length > 0) {
      release.splice(0).forEach((r) => r());
      await settle();
    }
    await flushing;
    expect(maxOpen).toBe(FLUSH_BATCH_SIZE);
  });
});

describe('chain construction', () => {
  it('refuses a dependsOn that is not an outbox id, rather than queueing an unreachable row', async () => {
    // The stranding this prevents is silent and permanent: a child whose
    // parent does not exist is never claimable, and `failed-entries.ts` only
    // reads rows at the attempt ceiling, so it never appears in the "couldn't
    // sync" banner either. The realistic way to reach it is passing the
    // `clientLocalId` where the `outboxId` belongs — the two ids sit side by
    // side in `EnqueuedMutation`.
    const parent = await enqueueMutation({
      procedure: 'workouts.startSession',
      payload: { marker: 'session' },
    });

    await expect(
      enqueueMutation({
        procedure: 'workouts.logSet',
        payload: { marker: 'set' },
        dependsOn: parent.clientLocalId,
      }),
    ).rejects.toThrow(/dependsOn/);

    const db = await getLocalDb();
    expect(db.all<Row>(sql`SELECT * FROM outbox`)).toHaveLength(1);
  });

  it('accepts a dependsOn whose parent has already synced', async () => {
    const parent = await enqueueMutation({
      procedure: 'workouts.startSession',
      payload: { marker: 'session' },
    });
    const { send } = markerSender();
    await flushOutbox({ send, now: () => FIXED_NOW });

    // A `'done'` row is still a row — a set logged after its session synced is
    // the ordinary case, not an error.
    await expect(
      enqueueMutation({
        procedure: 'workouts.logSet',
        payload: { marker: 'set' },
        dependsOn: parent.outboxId,
      }),
    ).resolves.toMatchObject({ outboxId: expect.any(String) });
  });
});

// Three levels are not hypothetical. P09 finishes a workout with
// `workouts.startSession` → `workouts.complete` (`session-runtime/07`) →
// `workouts.updateNotes` (`session-summary/03`), so the chain in these two
// tests is the ordinary path, not a contrived depth.
async function enqueueSessionCompletionChain(): Promise<{ start: string; complete: string }> {
  const start = await enqueueMutation({
    procedure: 'workouts.startSession',
    payload: { marker: 'start' },
  });
  const complete = await enqueueMutation({
    procedure: 'workouts.complete',
    payload: { marker: 'complete' },
    dependsOn: start.outboxId,
  });
  await enqueueMutation({
    procedure: 'workouts.updateNotes',
    payload: { marker: 'notes' },
    dependsOn: complete.outboxId,
  });
  return { start: start.outboxId, complete: complete.outboxId };
}

describe('multi-level chains', () => {
  it('holds a grandchild until its grandparent has synced, not merely its parent', async () => {
    // The exclusion tests one level — but is transitively correct, because a
    // parent only ever reaches `'done'` by being sent, and it is only sent
    // after its own parent is `'done'`. This is that induction step, executed.
    const { start } = await enqueueSessionCompletionChain();
    const db = await getLocalDb();

    // Only the root is claimable while the middle of the chain is untouched.
    expect(claimReadyEntries(db, FIXED_NOW).map((e) => e.id)).toEqual([start]);
  });

  it('sends a three-level chain strictly in order in one flush', async () => {
    const { start, complete } = await enqueueSessionCompletionChain();
    const order: string[] = [];
    const ancestorStates: Record<string, unknown>[] = [];
    const send: OutboxSender = async (_procedure, input) => {
      order.push(String(input.marker));
      ancestorStates.push({
        start: (await readRow(start))?.status,
        complete: (await readRow(complete))?.status,
      });
      return null;
    };

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(order).toEqual(['start', 'complete', 'notes']);
    // Asserted on observed row state, not call sequence: the notes update must
    // not reach the server until both ancestors are done.
    expect(ancestorStates[2]).toEqual({ start: 'done', complete: 'done' });
  });

  it('sends siblings of one parent concurrently, since they depend on it and not on each other', async () => {
    let open = 0;
    let maxOpen = 0;
    const release: (() => void)[] = [];
    const send: OutboxSender = (procedure) => {
      if (procedure === 'workouts.startSession') return Promise.resolve(null);
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      return new Promise<null>((resolve) => {
        release.push(() => {
          open -= 1;
          resolve(null);
        });
      });
    };
    await enqueueSessionChain('a', 3);

    const flushing = flushOutbox({ send, now: () => FIXED_NOW });
    await settle();
    release.forEach((r) => r());
    await flushing;

    expect(maxOpen).toBe(3);
  });
});

/** The status of the row carrying `marker`, found by reading its payload back. */
async function statusOfMarker(marker: string): Promise<unknown> {
  const db = await getLocalDb();
  const rows = db.all<Row>(sql`SELECT * FROM outbox`);
  return rows.find((r) => String(r.payload_json).includes(`"${marker}"`))?.status;
}
