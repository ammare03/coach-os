import { getTableColumns, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

import { getLocalDb, resetLocalDbForTests } from '../client.ts';
import * as schema from '../schema/index.ts';

// The DB§13 table set (`local-database/02-table-set.md`). `expo-sqlite`'s
// native module has no Jest-side implementation, same situation as
// `client.test.ts`. Unlike that file's single throwaway table, these tests
// span several real tables and a foreign-key-shaped relationship, so the
// fake here is a small in-memory multi-table store keyed by table name
// rather than one global row list — recognising exactly the CREATE
// TABLE/INDEX/INSERT/SELECT statements this file and `client.ts`'s
// bootstrap actually issue. All SQL below is raw `sql` tagged templates with
// plain, unquoted identifiers (never Drizzle's `.insert()/.select()`
// builder, which quotes identifiers and fills in every column's default) —
// matching `client.test.ts`'s existing convention.
// Jest hoists `jest.mock()` above every import and top-level declaration and
// statically forbids the factory from closing over an out-of-scope
// *value* (`babel-plugin-jest-hoist`) — so the fake, unlike a normal
// helper, has to be built entirely inside the factory rather than defined
// once above it (same constraint `client.test.ts` works within). A
// module-scope `type` alias is erased before that check matters (this file's
// `Row`, `client.test.ts`'s own `FakeRow`) — it's runtime *values* the
// factory can't close over.
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

  function makeResult(rows: Row[], changes = 0, lastInsertRowId = 0) {
    return {
      changes,
      lastInsertRowId,
      getFirstSync: () => rows[0],
      getAllSync: () => rows,
    };
  }

  const database = {
    prepareSync: (sqlText: string) => ({
      executeSync: (params: unknown[] = []) => {
        const createTable = /^CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i.exec(sqlText);
        const createTableName = createTable?.[1];
        if (createTableName) {
          tableRows(createTableName);
          return makeResult([]);
        }
        if (/^CREATE INDEX/i.test(sqlText)) {
          return makeResult([]);
        }
        const insertInto = /^INSERT INTO\s+(\w+)\s*\(([\s\S]*?)\)\s*VALUES/i.exec(sqlText);
        const insertTableName = insertInto?.[1];
        const insertColumnList = insertInto?.[2];
        if (insertTableName && insertColumnList) {
          const columns = insertColumnList.split(',').map((c) => c.trim());
          const row: Row = {};
          columns.forEach((column, i) => {
            row[column] = params[i];
          });
          const rows = tableRows(insertTableName);
          rows.push(row);
          return makeResult([row], 1, rows.length);
        }
        const selectFrom = /^SELECT[\s\S]*?FROM\s+(\w+)/i.exec(sqlText);
        const selectTableName = selectFrom?.[1];
        if (selectTableName) {
          let rows = tableRows(selectTableName);
          const whereEq = /WHERE\s+(\w+)\s*=\s*\?/i.exec(sqlText);
          const whereColumn = whereEq?.[1];
          if (whereColumn) {
            rows = rows.filter((r) => r[whereColumn] === params[0]);
          }
          return makeResult(rows);
        }
        throw new Error(`Unhandled SQL in fake expo-sqlite: ${sqlText}`);
      },
    }),
  };

  return {
    openDatabaseAsync: jest.fn(async () => database),
  };
});

beforeEach(() => {
  resetLocalDbForTests();
});

describe('the DB§13 table set — column shapes', () => {
  it('does not create a health_exports table (deferred to phase-24-health-sync)', () => {
    expect('healthExports' in schema).toBe(false);
  });

  it('types local_set_logs.weight_kg and .rpe as REAL, not the Postgres numeric-string discipline', () => {
    const columns = getTableColumns(schema.localSetLogs);
    expect(columns.weightKg.columnType).toBe('SQLiteReal');
    expect(columns.rpe.columnType).toBe('SQLiteReal');
  });

  it('stores booleans as SQLite integers on every boolean-shaped column', () => {
    // Drizzle's `integer(col, { mode: 'boolean' })` reports its own
    // `columnType` discriminator ('SQLiteBoolean') for the JS-side true/false
    // mapping, but the underlying SQLite storage class is still INTEGER
    // 0/1 — DB§13's "booleans-as-0/1" rule, not a distinct SQL type.
    expect(getTableColumns(schema.localSetLogs).isWarmup.columnType).toBe('SQLiteBoolean');
    expect(getTableColumns(schema.localExercisesCache).isBodyweight.columnType).toBe(
      'SQLiteBoolean',
    );
    expect(getTableColumns(schema.localComments).isAiGenerated.columnType).toBe('SQLiteBoolean');
  });

  it('types every epoch-ms timestamp column as INTEGER', () => {
    expect(getTableColumns(schema.localWorkoutSessions).startedAt.columnType).toBe('SQLiteInteger');
    expect(getTableColumns(schema.localWorkoutSessions).completedAt.columnType).toBe(
      'SQLiteInteger',
    );
    expect(getTableColumns(schema.localWorkoutSessions).updatedAt.columnType).toBe('SQLiteInteger');
    expect(getTableColumns(schema.localSetLogs).loggedAt.columnType).toBe('SQLiteInteger');
    expect(getTableColumns(schema.localMeals).loggedAt.columnType).toBe('SQLiteInteger');
    expect(getTableColumns(schema.localComments).createdAt.columnType).toBe('SQLiteInteger');
  });

  it('references local_set_logs.session_local_id to local_workout_sessions.client_local_id, not a server id', () => {
    const { foreignKeys } = getTableConfig(schema.localSetLogs);
    expect(foreignKeys).toHaveLength(1);
    const [fk] = foreignKeys;
    if (!fk) throw new Error('expected exactly one foreign key');
    expect(fk.reference().foreignTable).toBe(schema.localWorkoutSessions);
    expect(fk.reference().foreignColumns.map((c) => c.name)).toEqual(['client_local_id']);
  });

  it('self-references outbox.depends_on to outbox.id', () => {
    const { foreignKeys } = getTableConfig(schema.outbox);
    expect(foreignKeys).toHaveLength(1);
    const [fk] = foreignKeys;
    if (!fk) throw new Error('expected exactly one foreign key');
    expect(fk.reference().foreignTable).toBe(schema.outbox);
    expect(fk.reference().foreignColumns.map((c) => c.name)).toEqual(['id']);
  });

  it('indexes outbox_ready on exactly (status, next_attempt_at), in that order', () => {
    const { indexes } = getTableConfig(schema.outbox);
    const outboxReady = indexes.find((idx) => idx.config.name === 'outbox_ready');
    expect(outboxReady).toBeDefined();
    const columnNames = outboxReady?.config.columns.map((c) => ('name' in c ? c.name : undefined));
    expect(columnNames).toEqual(['status', 'next_attempt_at']);
  });

  it('never stores a token, secret, or signed URL on any table', () => {
    const bannedPattern = /token|secret|signed_url|signedurl/i;
    const tables = [
      schema.localWorkoutSessions,
      schema.localSetLogs,
      schema.localExercisesCache,
      schema.localMeals,
      schema.localFoodsCache,
      schema.localComments,
      schema.outbox,
      schema.uploadQueue,
      schema.meta,
    ];
    for (const table of tables) {
      const names = Object.values(getTableColumns(table)).map((c) => c.name);
      expect(names.some((name) => bannedPattern.test(name))).toBe(false);
    }
  });
});

describe('the DB§13 table set — behaviour', () => {
  it('resolves a set log to its session using only local ids, with no server id present', async () => {
    const db = await getLocalDb();
    const sessionLocalId = 'session-local-1';

    db.run(
      sql`INSERT INTO local_workout_sessions (id, client_local_id, scheduled_date, status, payload_json, sync_state, updated_at) VALUES (${sessionLocalId}, ${sessionLocalId}, ${'2026-09-08'}, ${'in_progress'}, ${'{}'}, ${'pending'}, ${1_757_000_000_000})`,
    );
    db.run(
      sql`INSERT INTO local_set_logs (id, client_local_id, session_local_id, exercise_id, set_number, reps, weight_kg, is_warmup, logged_at, sync_state) VALUES (${'set-local-1'}, ${'set-local-1'}, ${sessionLocalId}, ${'exercise-1'}, ${1}, ${5}, ${62.5}, ${0}, ${1_757_000_000_500}, ${'pending'})`,
    );

    const session = db.get<{ id: string; server_id: string | null }>(
      sql`SELECT * FROM local_workout_sessions WHERE client_local_id = ${sessionLocalId}`,
    );
    const setLog = db.get<{ session_local_id: string; weight_kg: number; reps: number }>(
      sql`SELECT * FROM local_set_logs WHERE session_local_id = ${sessionLocalId}`,
    );

    expect(session?.server_id).toBeUndefined(); // no server_id column was ever set
    expect(setLog?.session_local_id).toBe(sessionLocalId);
    expect(setLog?.weight_kg).toBe(62.5);
    expect(setLog?.reps).toBe(5);
  });

  it('queries an outbox entry by its depends_on reference', async () => {
    const db = await getLocalDb();
    const parentId = 'outbox-1';
    const childId = 'outbox-2';

    db.run(
      sql`INSERT INTO outbox (id, procedure, payload_json, client_local_id, created_at, status) VALUES (${parentId}, ${'workouts.startSession'}, ${'{}'}, ${'session-local-1'}, ${1_757_000_000_000}, ${'queued'})`,
    );
    db.run(
      sql`INSERT INTO outbox (id, procedure, payload_json, client_local_id, depends_on, created_at, status) VALUES (${childId}, ${'workouts.logSet'}, ${'{}'}, ${'set-local-1'}, ${parentId}, ${1_757_000_000_500}, ${'queued'})`,
    );

    const dependents = db.all<{ id: string; depends_on: string }>(
      sql`SELECT * FROM outbox WHERE depends_on = ${parentId}`,
    );

    expect(dependents).toHaveLength(1);
    expect(dependents[0]?.id).toBe(childId);
  });

  it('accepts arbitrary keys in meta, not a fixed set', async () => {
    const db = await getLocalDb();

    db.run(sql`INSERT INTO meta (key, value) VALUES (${'schema_version'}, ${'1'})`);
    db.run(sql`INSERT INTO meta (key, value) VALUES (${'last_sync_at'}, ${'1757000000000'})`);
    db.run(sql`INSERT INTO meta (key, value) VALUES (${'user_id'}, ${'client-abc'})`);

    const rows = db.all<{ key: string; value: string }>(sql`SELECT * FROM meta`);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.key).sort()).toEqual(['last_sync_at', 'schema_version', 'user_id']);
  });
});
