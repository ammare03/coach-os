import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { enqueueMutation } from './enqueue.ts';
import {
  claimReadyEntries,
  flushOutbox,
  resetOutboxFlushStateForTests,
  runFlushPass,
  type OutboxSender,
} from './flush.ts';

// `expo-sqlite` has no Jest-side native module, so this is `enqueue.test.ts`'s
// hand-built fake — same structure, same idioms — extended with exactly what
// this task's statements need and task 01's did not: `begin`/`commit`/
// `rollback` (the claim runs in a transaction), `UPDATE`, a `WHERE` grammar
// beyond one equality, `ORDER BY`/`LIMIT`, and `executeForRawResultSync`,
// which is what Drizzle calls for a *builder* select (it maps columns
// positionally) rather than the raw-`sql` path task 01 exercised.
//
// A second, divergent fake would be worse than a shared one, but a shared one
// would mean rewriting `enqueue.test.ts` — task 01's file, and not this
// task's to refactor. The compromise: this is a strict superset, written to
// the same shape, so extracting both to one helper later is a move, not a
// merge.
//
// Jest hoists `jest.mock()` above every import and its factory may not close
// over an out-of-scope value, so the fake is built inside the factory.
type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => {
  const tables = new Map<string, Row[]>();
  let snapshot: Map<string, Row[]> | null = null;

  function tableRows(name: string): Row[] {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  }

  function copyTables(): Map<string, Row[]> {
    return new Map([...tables].map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]));
  }

  function makeResult(rows: Row[], columns: string[] | null, changes = 0, lastInsertRowId = 0) {
    return {
      changes,
      lastInsertRowId,
      getFirstSync: () => rows[0],
      // Drizzle's builder selects go through `executeForRawResultSync`, which
      // returns positional arrays; raw `sql` selects go through
      // `executeSync`, which returns objects.
      getAllSync: () => (columns ? rows.map((r) => columns.map((c) => r[c])) : rows),
    };
  }

  const stripQuotes = (token: string) => token.replace(/"/g, '').trim();
  const columnOf = (token: string) => {
    const parts = stripQuotes(token).split('.');
    return parts[parts.length - 1] ?? '';
  };

  function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (depth === 0 && text.startsWith(separator, i)) {
        parts.push(text.slice(start, i));
        i += separator.length - 1;
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
  }

  // Compiles the `WHERE` subset this module's queries actually emit —
  // `col in (?, …)`, `col <op> ?`, joined by `and`. Placeholders are consumed
  // through `take()` in statement order, which is how the driver binds them.
  function compileWhere(text: string, take: () => unknown): (row: Row) => boolean {
    let body = text.trim();
    while (
      body.startsWith('(') &&
      splitTopLevel(body, ' and ').length === 1 &&
      body.endsWith(')')
    ) {
      const inner = body.slice(1, -1).trim();
      if (splitTopLevel(inner, ')').length > 1 && !inner.startsWith('(')) break;
      body = inner;
    }
    const predicates = splitTopLevel(body, ' and ').map((term) => {
      const inMatch = /^(\S+)\s+in\s*\(([^)]*)\)$/i.exec(term);
      if (inMatch?.[1] && inMatch[2] !== undefined) {
        const column = columnOf(inMatch[1]);
        const values = inMatch[2].split(',').map(() => take());
        return (row: Row) => values.includes(row[column]);
      }
      const nullMatch = /^(\S+)\s+is\s+(not\s+)?null$/i.exec(term);
      if (nullMatch?.[1]) {
        const column = columnOf(nullMatch[1]);
        const negated = Boolean(nullMatch[2]);
        return (row: Row) => (row[column] === null || row[column] === undefined) !== negated;
      }
      const compare = /^(\S+)\s*(<=|>=|!=|<>|<|>|=)\s*\?$/.exec(term);
      if (!compare?.[1] || !compare[2]) {
        throw new Error(`Unhandled WHERE term in fake expo-sqlite: ${term}`);
      }
      const column = columnOf(compare[1]);
      const operator = compare[2];
      const value = take();
      return (row: Row) => {
        const actual = row[column];
        switch (operator) {
          case '=':
            return actual === value;
          case '!=':
          case '<>':
            return actual !== value;
          case '<':
            return Number(actual) < Number(value);
          case '<=':
            return Number(actual) <= Number(value);
          case '>':
            return Number(actual) > Number(value);
          default:
            return Number(actual) >= Number(value);
        }
      };
    });
    return (row: Row) => predicates.every((predicate) => predicate(row));
  }

  function keywordIndex(text: string, keyword: RegExp): number {
    const match = keyword.exec(text);
    return match ? match.index : -1;
  }

  let failNextWrite: string | null = null;

  function execute(sqlText: string, params: unknown[], columnsWanted: boolean) {
    const statement = sqlText.trim();
    let cursor = 0;
    const take = () => params[cursor++];

    if (/^begin/i.test(statement)) {
      snapshot = copyTables();
      return makeResult([], null);
    }
    if (/^commit/i.test(statement)) {
      snapshot = null;
      return makeResult([], null);
    }
    if (/^rollback/i.test(statement)) {
      if (snapshot) {
        tables.clear();
        for (const [name, rows] of snapshot) tables.set(name, rows);
        snapshot = null;
      }
      return makeResult([], null);
    }

    const createTable = /^CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i.exec(statement);
    if (createTable?.[1]) {
      tableRows(createTable[1]);
      return makeResult([], null);
    }
    if (/^CREATE INDEX/i.test(statement)) {
      return makeResult([], null);
    }

    const insertInto =
      /^INSERT\s+INTO\s+"?(\w+)"?\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i.exec(statement);
    if (insertInto?.[1] && insertInto[2] && insertInto[3] !== undefined) {
      if (failNextWrite !== null) {
        const message = failNextWrite;
        failNextWrite = null;
        throw new Error(message);
      }
      const columns = insertInto[2].split(',').map((c) => stripQuotes(c));
      const values = insertInto[3].split(',').map((v) => v.trim());
      const row: Row = {};
      columns.forEach((column, i) => {
        const token = values[i];
        if (token === '?') row[column] = take();
        else if (token === undefined || /^null$/i.test(token)) row[column] = null;
        else row[column] = token.replace(/^'|'$/g, '');
      });
      const rows = tableRows(insertInto[1]);
      rows.push(row);
      return makeResult([row], null, 1, rows.length);
    }

    const update = /^update\s+"?(\w+)"?\s+set\s/i.exec(statement);
    if (update?.[1]) {
      if (failNextWrite !== null) {
        const message = failNextWrite;
        failNextWrite = null;
        throw new Error(message);
      }
      const afterSet = statement.slice(update[0].length);
      const whereAt = keywordIndex(afterSet, /\swhere\s/i);
      const setText = whereAt === -1 ? afterSet : afterSet.slice(0, whereAt);
      const assignments = splitTopLevel(setText, ',').map((pair) => {
        const [left, right] = pair.split('=').map((s) => s.trim());
        if (!left || right !== '?') {
          throw new Error(`Unhandled SET clause in fake expo-sqlite: ${pair}`);
        }
        return [columnOf(left), take()] as const;
      });
      const matches =
        whereAt === -1
          ? () => true
          : compileWhere(afterSet.slice(whereAt + ' where '.length), take);
      let changes = 0;
      for (const row of tableRows(update[1])) {
        if (!matches(row)) continue;
        for (const [column, value] of assignments) row[column] = value;
        changes += 1;
      }
      return makeResult([], null, changes);
    }

    const select = /^select\s+([\s\S]*?)\s+from\s+"?(\w+)"?/i.exec(statement);
    if (select?.[1] && select[2]) {
      const columnList = select[1].trim();
      const columns =
        columnList === '*' ? null : columnList.split(',').map((c) => columnOf(c.trim()));
      const tail = statement.slice(select[0].length);
      const whereAt = keywordIndex(tail, /\swhere\s/i);
      const orderAt = keywordIndex(tail, /\sorder\s+by\s/i);
      const limitAt = keywordIndex(tail, /\slimit\s/i);
      const endOfWhere = [orderAt, limitAt].filter((i) => i !== -1).sort((a, b) => a - b)[0];
      let rows = [...tableRows(select[2])];
      if (whereAt !== -1) {
        const whereText = tail.slice(
          whereAt + ' where '.length,
          endOfWhere === undefined ? undefined : endOfWhere,
        );
        const matches = compileWhere(whereText, take);
        rows = rows.filter(matches);
      }
      if (orderAt !== -1) {
        const orderText = tail.slice(
          orderAt + ' order by '.length,
          limitAt === -1 ? undefined : limitAt,
        );
        const [columnToken = '', direction = 'asc'] = orderText.trim().split(/\s+/);
        const column = columnOf(columnToken);
        const sign = direction.toLowerCase() === 'desc' ? -1 : 1;
        rows.sort((a, b) => (Number(a[column]) - Number(b[column])) * sign);
      }
      if (limitAt !== -1) {
        rows = rows.slice(0, Number(take()));
      }
      return makeResult(rows, columnsWanted ? columns : null);
    }

    throw new Error(`Unhandled SQL in fake expo-sqlite: ${statement}`);
  }

  const database = {
    prepareSync: (sqlText: string) => ({
      executeSync: (params: unknown[] = []) => execute(sqlText, params, false),
      executeForRawResultSync: (params: unknown[] = []) => execute(sqlText, params, true),
    }),
  };

  return {
    openDatabaseAsync: jest.fn(async () => database),
    __reset: () => {
      tables.clear();
      snapshot = null;
      failNextWrite = null;
    },
    __failNextWrite: (message: string) => {
      failNextWrite = message;
    },
  };
});

const sqliteFake = jest.requireMock('expo-sqlite') as {
  __reset: () => void;
  __failNextWrite: (message: string) => void;
};

// Ahead of the wall clock `enqueueMutation` stamps rows with, so an
// freshly-enqueued row is always due by the time the flush loop looks.
const FIXED_NOW = Date.now() + 60_000;

// Raw `SELECT *` hands back snake_case columns, which Drizzle's camelCase
// `$inferSelect` does not describe — so these rows stay deliberately untyped
// rather than hand-writing a second row shape (`code-conventions` §3).
async function readOutbox(): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql`SELECT * FROM outbox`);
}

async function readRow(outboxId: string): Promise<Row | undefined> {
  const rows = await readOutbox();
  return rows.find((r) => r.id === outboxId);
}

/**
 * Puts a row into a state only the flush loop itself normally produces.
 * Direct SQL, in the one folder `outbox/no-direct-outbox-write` exempts —
 * these tests are the files that check the table.
 */
async function forceRow(
  outboxId: string,
  changes: Partial<Record<string, unknown>>,
): Promise<void> {
  const db = await getLocalDb();
  for (const [column, value] of Object.entries(changes)) {
    db.run(sql`UPDATE outbox SET ${sql.raw(`"${column}"`)} = ${value} WHERE id = ${outboxId}`);
  }
}

/** A sender that records what it was asked to send, instead of reaching the network. */
function recordingSender(): { send: OutboxSender; calls: { procedure: string; input: Row }[] } {
  const calls: { procedure: string; input: Row }[] = [];
  const send: OutboxSender = async (procedure, input) => {
    calls.push({ procedure, input });
    return null;
  };
  return { send, calls };
}

/** A sender that always fails, counting its attempts. */
function failingSender(message: string) {
  return jest.fn<ReturnType<OutboxSender>, Parameters<OutboxSender>>(async () => {
    throw new Error(message);
  });
}

beforeEach(() => {
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  sqliteFake.__reset();
});

describe('claimReadyEntries', () => {
  it('claims a queued row and marks it inflight in the same transaction as the read', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: { reps: 5 } });
    const db = await getLocalDb();

    const claimed = claimReadyEntries(db, FIXED_NOW);

    expect(claimed.map((e) => e.id)).toEqual([enqueued.outboxId]);
    expect((await readRow(enqueued.outboxId))?.status).toBe('inflight');
  });

  it('does not claim a row already marked inflight', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, { status: 'inflight' });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW)).toEqual([]);
  });

  it('does not claim a row whose depends_on parent has not synced', async () => {
    const parent = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: parent.outboxId,
    });
    const db = await getLocalDb();

    const claimed = claimReadyEntries(db, FIXED_NOW);

    expect(claimed.map((e) => e.id)).toEqual([parent.outboxId]);
    expect((await readRow(child.outboxId))?.status).toBe('queued');
  });

  it('claims a row whose depends_on parent is done', async () => {
    const parent = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: parent.outboxId,
    });
    await forceRow(parent.outboxId, { status: 'done' });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW).map((e) => e.id)).toEqual([child.outboxId]);
  });

  it('claims a failed row only once its next_attempt_at is due', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, {
      status: 'failed',
      attempts: 1,
      next_attempt_at: FIXED_NOW + 1_000,
    });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW)).toEqual([]);
    expect(claimReadyEntries(db, FIXED_NOW + 1_000).map((e) => e.id)).toEqual([enqueued.outboxId]);
  });

  it('never claims a row that has exhausted its attempts', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, { status: 'failed', attempts: 10 });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW)).toEqual([]);
  });

  it('hands one row to exactly one of two concurrent claims', async () => {
    const first = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1 },
    });
    const second = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 2 },
    });
    const db = await getLocalDb();

    const [a, b] = await Promise.all([
      Promise.resolve().then(() => claimReadyEntries(db, FIXED_NOW)),
      Promise.resolve().then(() => claimReadyEntries(db, FIXED_NOW)),
    ]);

    const claimedIds = [...a, ...b].map((e) => e.id);
    expect(claimedIds.sort()).toEqual([first.outboxId, second.outboxId].sort());
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
  });
});

describe('flushOutbox', () => {
  it('sends every ready row and marks it done', async () => {
    const { send, calls } = recordingSender();
    const first = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1 },
    });
    const second = await enqueueMutation({
      procedure: 'nutrition.logMeal',
      payload: { kcal: 400 },
    });

    const result = await flushOutbox({ send, now: () => FIXED_NOW });

    expect(result).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(calls.map((c) => c.procedure).sort()).toEqual(['nutrition.logMeal', 'workouts.logSet']);
    expect((await readRow(first.outboxId))?.status).toBe('done');
    expect((await readRow(second.outboxId))?.status).toBe('done');
  });

  it('sends the row clientLocalId as part of the procedure input', async () => {
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1, reps: 5 },
    });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls[0]?.input).toEqual({
      setNumber: 1,
      reps: 5,
      clientLocalId: enqueued.clientLocalId,
    });
  });

  it('overrides a clientLocalId a payload happens to carry with the row own id', async () => {
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { clientLocalId: 'not-the-real-one' },
    });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls[0]?.input.clientLocalId).toBe(enqueued.clientLocalId);
  });

  it('sends a Date captured at action time as a Date, not a string', async () => {
    const { send, calls } = recordingSender();
    const loggedAt = new Date('2026-09-08T04:30:00.000Z');
    await enqueueMutation({ procedure: 'workouts.logSet', payload: { loggedAt } });

    await flushOutbox({ send, now: () => FIXED_NOW });

    const sent = calls[0]?.input.loggedAt;
    expect(sent).toBeInstanceOf(Date);
    expect((sent as Date).getTime()).toBe(loggedAt.getTime());
  });

  it('schedules a retry through the backoff seam instead of retrying or dropping', async () => {
    const send = failingSender('network down');
    const backoffMs = jest.fn(() => 4_000);
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    const result = await flushOutbox({ send, now: () => FIXED_NOW, backoffMs });

    expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(backoffMs).toHaveBeenCalledWith(1);
    expect(await readRow(enqueued.outboxId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      next_attempt_at: FIXED_NOW + 4_000,
    });
  });

  it('records a stable error code on failure, never the error message', async () => {
    const send = failingSender('connect ECONNREFUSED 10.0.0.1:3000');
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    const lastError = (await readRow(enqueued.outboxId))?.last_error;
    expect(typeof lastError).toBe('string');
    expect(String(lastError)).not.toContain('ECONNREFUSED');
  });

  it('rejects a malformed procedure path loudly, and does not mark the row done', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({ procedure: 'notAPath', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls).toHaveLength(0);
    expect(await readRow(enqueued.outboxId)).toMatchObject({
      status: 'failed',
      last_error: 'INVALID_PROCEDURE',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('flushes a parent and then its dependent child in one call', async () => {
    const parent = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: parent.outboxId,
    });
    // The child's send observes the parent's row, so this asserts ordering
    // rather than merely call sequence: a set log must not reach the server
    // before the session it belongs to (DB§14.2).
    const parentStatusWhenChildSent: unknown[] = [];
    const order: string[] = [];
    const send: OutboxSender = async (procedure) => {
      order.push(procedure);
      if (procedure === 'workouts.logSet') {
        parentStatusWhenChildSent.push((await readRow(parent.outboxId))?.status);
      }
      return null;
    };

    const result = await flushOutbox({ send, now: () => FIXED_NOW });

    expect(result.sent).toBe(2);
    expect(order).toEqual(['workouts.start', 'workouts.logSet']);
    expect(parentStatusWhenChildSent).toEqual(['done']);
    expect((await readRow(child.outboxId))?.status).toBe('done');
  });

  it('sends independent chains concurrently rather than one after the other', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: (() => void)[] = [];
    const send: OutboxSender = () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<null>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(null);
        });
      });
    };
    await enqueueMutation({ procedure: 'workouts.start', payload: { session: 1 } });
    await enqueueMutation({ procedure: 'workouts.start', payload: { session: 2 } });

    const flushing = flushOutbox({ send, now: () => FIXED_NOW });
    await new Promise((resolve) => setImmediate(resolve));
    release.forEach((r) => r());
    await flushing;

    expect(maxInFlight).toBe(2);
  });

  it('sends no row twice when flushOutbox is called twice concurrently', async () => {
    // The Verification section, and the mechanism the phase exit gate rests
    // on: two triggers (app foreground and a connectivity regain) firing at
    // the same moment.
    const { send, calls } = recordingSender();
    const enqueued = await Promise.all([
      enqueueMutation({ procedure: 'workouts.logSet', payload: { setNumber: 1 } }),
      enqueueMutation({ procedure: 'workouts.logSet', payload: { setNumber: 2 } }),
      enqueueMutation({ procedure: 'workouts.logSet', payload: { setNumber: 3 } }),
    ]);

    await Promise.all([
      flushOutbox({ send, now: () => FIXED_NOW }),
      flushOutbox({ send, now: () => FIXED_NOW }),
    ]);

    const sentIds = calls.map((c) => c.input.clientLocalId);
    expect(sentIds.sort()).toEqual(enqueued.map((e) => e.clientLocalId).sort());
    expect(new Set(sentIds).size).toBe(3);
  });

  it('sends no row twice when a second pass starts while the first is still in flight', async () => {
    // Adversarial: this bypasses the single-flight promise entirely and runs
    // a second pass *during* the first one's send, which is the only way to
    // prove the `inflight` claim — not the mutex — is what excludes the row.
    const sent: unknown[] = [];
    let secondPass: Promise<unknown> | null = null;
    const send: OutboxSender = async (_procedure, input) => {
      sent.push(input.clientLocalId);
      if (!secondPass) {
        const db = await getLocalDb();
        secondPass = runFlushPass(db, FIXED_NOW, { send, now: () => FIXED_NOW });
        await secondPass;
      }
      return null;
    };
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    const db = await getLocalDb();
    await runFlushPass(db, FIXED_NOW, { send, now: () => FIXED_NOW });

    expect(sent).toEqual([enqueued.clientLocalId]);
    expect((await readRow(enqueued.outboxId))?.status).toBe('done');
  });

  it('retries a row left inflight by a killed app process, rather than stranding it', async () => {
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, { status: 'inflight' });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls).toHaveLength(1);
    expect((await readRow(enqueued.outboxId))?.status).toBe('done');
  });

  it('does not retry a failed row again within the same flush run', async () => {
    const send = failingSender('network down');
    await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW, backoffMs: () => 0 });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('claims nothing when the outbox is empty', async () => {
    const { send, calls } = recordingSender();

    await expect(flushOutbox({ send, now: () => FIXED_NOW })).resolves.toMatchObject({
      claimed: 0,
      sent: 0,
      failed: 0,
    });
    expect(calls).toHaveLength(0);
  });
});
