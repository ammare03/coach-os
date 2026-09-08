import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { deserializeOutboxPayload, enqueueMutation } from './enqueue.ts';

// `expo-sqlite`'s native module has no Jest-side implementation, same
// situation as `db/__tests__/schema.test.ts`. This is that file's small
// multi-table fake, kept because these tests span `outbox` and
// `local_set_logs` together — the Verification section's round trip is
// exactly a write to one carrying an id produced for the other.
// Jest hoists `jest.mock()` above every import, and its factory may not
// close over an out-of-scope *value*, so the fake is built inside the
// factory rather than defined once above it.
type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => {
  const tables = new Map<string, Row[]>();

  function tableRows(name: string): Row[] {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  }

  // `columns` is set only for the raw-result path: Drizzle's builder selects
  // go through `executeForRawResultSync` and want positional arrays, while
  // raw `sql` selects go through `executeSync` and want objects.
  function makeResult(
    rows: Row[],
    changes = 0,
    lastInsertRowId = 0,
    columns: string[] | null = null,
  ) {
    return {
      changes,
      lastInsertRowId,
      getFirstSync: () => rows[0],
      getAllSync: () => (columns ? rows.map((r) => columns.map((c) => r[c])) : rows),
    };
  }

  let failNextWrite: string | null = null;

  const database = {
    prepareSync: (sqlText: string) => ({
      executeSync: (params: unknown[] = []) => execute(sqlText, params, false),
      executeForRawResultSync: (params: unknown[] = []) => execute(sqlText, params, true),
    }),
  };

  function execute(sqlText: string, params: unknown[], columnsWanted: boolean) {
    const createTable = /^CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i.exec(sqlText);
    const createTableName = createTable?.[1];
    if (createTableName) {
      tableRows(createTableName);
      return makeResult([]);
    }
    if (/^CREATE INDEX/i.test(sqlText)) {
      return makeResult([]);
    }
    // Handles both statement shapes this file produces: a raw `sql`
    // template (unquoted identifiers, one `?` per interpolation) and
    // Drizzle's own insert builder, which quotes every identifier,
    // lower-cases the keywords, and emits omitted nullable columns as a
    // literal `null` rather than a placeholder — so the params are
    // walked against the `?`s, never against the column positions.
    const insertInto =
      /^INSERT\s+INTO\s+"?(\w+)"?\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i.exec(sqlText);
    const insertTableName = insertInto?.[1];
    const insertColumnList = insertInto?.[2];
    const insertValueList = insertInto?.[3];
    if (insertTableName && insertColumnList && insertValueList !== undefined) {
      if (failNextWrite !== null) {
        const message = failNextWrite;
        failNextWrite = null;
        throw new Error(message);
      }
      const columns = insertColumnList.split(',').map((c) => c.trim().replace(/"/g, ''));
      const values = insertValueList.split(',').map((v) => v.trim());
      const row: Row = {};
      let paramIndex = 0;
      columns.forEach((column, i) => {
        const token = values[i];
        if (token === '?') {
          row[column] = params[paramIndex];
          paramIndex += 1;
        } else if (token === undefined || /^null$/i.test(token)) {
          row[column] = null;
        } else {
          row[column] = token.replace(/^'|'$/g, '');
        }
      });
      const rows = tableRows(insertTableName);
      rows.push(row);
      return makeResult([row], 1, rows.length);
    }
    const selectFrom = /^SELECT\s+([\s\S]*?)\s+FROM\s+"?(\w+)"?/i.exec(sqlText);
    const selectTableName = selectFrom?.[2];
    if (selectFrom?.[1] && selectTableName) {
      const columnList = selectFrom[1].trim();
      const columns =
        columnList === '*'
          ? null
          : columnList.split(',').map((c) => {
              const parts = c.trim().replace(/"/g, '').split('.');
              return parts[parts.length - 1] ?? '';
            });
      let rows = tableRows(selectTableName);
      const whereEq = /WHERE\s+"?[\w.]*?"?\.?"?(\w+)"?\s*=\s*\?/i.exec(sqlText);
      const whereColumn = whereEq?.[1];
      if (whereColumn) {
        rows = rows.filter((r) => r[whereColumn] === params[0]);
      }
      return makeResult(rows, 0, 0, columnsWanted ? columns : null);
    }
    throw new Error(`Unhandled SQL in fake expo-sqlite: ${sqlText}`);
  }

  return {
    openDatabaseAsync: jest.fn(async () => database),
    __reset: () => {
      tables.clear();
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

// Raw `SELECT *` hands back snake_case columns, which Drizzle's camelCase
// `$inferSelect` does not describe — so these rows stay deliberately
// untyped rather than hand-writing a second row shape (CLAUDE.md §17.1).
async function readOutbox(): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql`SELECT * FROM outbox`);
}

function causeChainMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages;
}

// RFC 9562 §5.7: version nibble 7 and the two-bit `10` variant.
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  resetLocalDbForTests();
  sqliteFake.__reset();
});

describe('enqueueMutation', () => {
  it('writes exactly one queued outbox row carrying the returned clientLocalId', async () => {
    const enqueued = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1, reps: 5, weightKg: 62.5 },
    });

    const rows = await readOutbox();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: enqueued.outboxId,
      procedure: 'workouts.logSet',
      client_local_id: enqueued.clientLocalId,
    });
  });

  it('generates clientLocalId as a UUIDv7', async () => {
    const { clientLocalId } = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
    });

    expect(clientLocalId).toMatch(UUIDV7);
  });

  it('gives the outbox row its own id, distinct from the clientLocalId it carries', async () => {
    // `depends_on` references `outbox.id` (DB§14.2) while the server keys on
    // `client_local_id` (DB§14.1) — two identities, never conflated.
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    expect(enqueued.outboxId).toMatch(UUIDV7);
    expect(enqueued.outboxId).not.toBe(enqueued.clientLocalId);
  });

  it('starts the row queued, with zero attempts, ready for an immediate flush', async () => {
    const before = Date.now();

    await enqueueMutation({ procedure: 'nutrition.logMeal', payload: {} });

    const [row] = await readOutbox();
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
    expect(row?.next_attempt_at).toBeGreaterThanOrEqual(before);
    expect(row?.next_attempt_at).toBeLessThanOrEqual(Date.now());
  });

  it('produces two distinct rows, with distinct ids, for two calls with different payloads', async () => {
    const first = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1 },
    });
    const second = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 2 },
    });

    const rows = await readOutbox();

    expect(rows).toHaveLength(2);
    expect(first.clientLocalId).not.toBe(second.clientLocalId);
    expect(first.outboxId).not.toBe(second.outboxId);
    expect(rows.map((r) => r.client_local_id).sort()).toEqual(
      [first.clientLocalId, second.clientLocalId].sort(),
    );
  });

  it('ignores a clientLocalId a caller tries to supply — the id always originates here', async () => {
    // The API deliberately has no such parameter (DB§14.1); this proves a
    // stray property can never become the idempotency key.
    const smuggled = { procedure: 'workouts.logSet', payload: {}, clientLocalId: 'not-a-uuid' };

    const enqueued = await enqueueMutation(smuggled);

    expect(enqueued.clientLocalId).not.toBe('not-a-uuid');
    const [row] = await readOutbox();
    expect(row?.client_local_id).toBe(enqueued.clientLocalId);
  });

  it('persists dependsOn when given, and null when not', async () => {
    const parent = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: parent.outboxId,
    });

    const rows = await readOutbox();
    const parentRow = rows.find((r) => r.id === parent.outboxId);
    const childRow = rows.find((r) => r.id === child.outboxId);

    expect(parentRow?.depends_on).toBeNull();
    expect(childRow?.depends_on).toBe(parent.outboxId);
  });

  it('round-trips the returned clientLocalId into a dependent local table write', async () => {
    const session = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const set = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1 },
      dependsOn: session.outboxId,
    });

    const db = await getLocalDb();
    db.run(
      sql`INSERT INTO local_workout_sessions (id, client_local_id, scheduled_date, status, payload_json, sync_state, updated_at) VALUES (${session.clientLocalId}, ${session.clientLocalId}, ${'2026-09-08'}, ${'in_progress'}, ${'{}'}, ${'pending'}, ${1_757_000_000_000})`,
    );
    db.run(
      sql`INSERT INTO local_set_logs (id, client_local_id, session_local_id, exercise_id, set_number, logged_at, sync_state) VALUES (${set.clientLocalId}, ${set.clientLocalId}, ${session.clientLocalId}, ${'exercise-1'}, ${1}, ${1_757_000_000_500}, ${'pending'})`,
    );

    const localSet = db.get<{ client_local_id: string; session_local_id: string }>(
      sql`SELECT * FROM local_set_logs WHERE client_local_id = ${set.clientLocalId}`,
    );
    const outboxRow = db.get<Row>(
      sql`SELECT * FROM outbox WHERE client_local_id = ${set.clientLocalId}`,
    );

    // The optimistic local row and the outbox entry share one identity —
    // this is what the server's ON CONFLICT upsert keys on (DB§14.1).
    expect(localSet?.client_local_id).toBe(outboxRow?.client_local_id);
    expect(localSet?.session_local_id).toBe(session.clientLocalId);
  });

  it('round-trips a payload without flattening a Date into a string', async () => {
    const loggedAt = new Date('2026-09-08T04:30:00.000Z');

    await enqueueMutation({ procedure: 'workouts.logSet', payload: { loggedAt, reps: 5 } });

    const [row] = await readOutbox();
    const payload = deserializeOutboxPayload(String(row?.payload_json)) as {
      loggedAt: Date;
      reps: number;
    };

    expect(payload.loggedAt).toBeInstanceOf(Date);
    expect(payload.loggedAt.getTime()).toBe(loggedAt.getTime());
    expect(payload.reps).toBe(5);
  });

  it('propagates a write failure rather than reporting a queued mutation that was never stored', async () => {
    sqliteFake.__failNextWrite('database is locked');

    // What matters is that the driver's failure surfaces at all — never a
    // resolved promise handing a caller ids for a row that does not exist.
    // Asserted through the cause chain rather than the top-level message,
    // so it holds whether or not Drizzle wraps the error on a given path.
    const rejection = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(causeChainMessages(rejection)).toContain('database is locked');
    expect(await readOutbox()).toHaveLength(0);
  });
});
