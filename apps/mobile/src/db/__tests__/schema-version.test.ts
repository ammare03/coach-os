import { DATABASE_NAME, resetLocalDbForTests } from '../client.ts';
import {
  EXPECTED_SCHEMA_VERSION,
  checkSchemaVersion,
  confirmSchemaVersionReset,
  labelForOutboxProcedure,
} from '../schema-version.ts';

// Same hand-rolled fake philosophy as `client.test.ts`/`wipe.test.ts`: an
// in-memory `meta` key/value store and an `outbox` row list, recognising
// exactly the SQL shapes `schema-version.ts` and `wipe.ts` (called via
// `confirmSchemaVersionReset`) issue. `deleteDatabaseAsync` clears both —
// a schema-version wipe deletes the whole file, meta row included.

type OutboxRow = { procedure: string; status: string };

jest.mock('expo-sqlite', () => {
  let metaStore = new Map<string, string>();
  let outboxRows: OutboxRow[] = [];
  let outboxUnreadable = false;

  function makeResult(rows: unknown[], changes = 0, lastInsertRowId = 0) {
    return {
      changes,
      lastInsertRowId,
      getFirstSync: () => rows[0],
      getAllSync: () => rows,
    };
  }

  const database = {
    prepareSync: jest.fn((sqlText: string) => ({
      executeSync: (params: unknown[] = []) => {
        if (/^CREATE TABLE/i.test(sqlText) || /^CREATE INDEX/i.test(sqlText)) {
          return makeResult([]);
        }
        if (/^SELECT value FROM meta/i.test(sqlText)) {
          const key = params[0] as string;
          const value = metaStore.get(key);
          return makeResult(value === undefined ? [] : [{ value }]);
        }
        if (/^INSERT INTO meta/i.test(sqlText)) {
          const [key, value] = params as [string, string];
          metaStore.set(key, value);
          return makeResult([{ key, value }], 1, 1);
        }
        if (/^SELECT procedure, COUNT\(\*\) AS count FROM outbox/i.test(sqlText)) {
          if (outboxUnreadable) {
            throw new Error('outbox corrupt');
          }
          const counts = new Map<string, number>();
          for (const row of outboxRows) {
            if (row.status === 'done') continue;
            counts.set(row.procedure, (counts.get(row.procedure) ?? 0) + 1);
          }
          const rows = [...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([procedure, count]) => ({ procedure, count }));
          return makeResult(rows);
        }
        if (/^SELECT COUNT\(\*\) AS pending FROM outbox/i.test(sqlText)) {
          const pending = outboxRows.filter((r) => r.status !== 'done').length;
          return makeResult([{ pending }]);
        }
        throw new Error(`Unhandled SQL in fake expo-sqlite: ${sqlText}`);
      },
    })),
    closeAsync: jest.fn(async () => undefined),
  };

  return {
    openDatabaseAsync: jest.fn(async () => database),
    deleteDatabaseAsync: jest.fn(async () => {
      metaStore = new Map();
      outboxRows = [];
    }),
    __database: database,
    __setStoredVersion: (version: number | undefined) => {
      if (version === undefined) {
        metaStore.delete('schema_version');
      } else {
        metaStore.set('schema_version', String(version));
      }
    },
    __setOutboxRows: (rows: OutboxRow[]) => {
      outboxRows = rows;
    },
    __setOutboxUnreadable: (value: boolean) => {
      outboxUnreadable = value;
    },
    __getStoredVersion: () => metaStore.get('schema_version'),
  };
});

const sqliteFake = jest.requireMock('expo-sqlite') as {
  openDatabaseAsync: jest.Mock;
  deleteDatabaseAsync: jest.Mock;
  __database: { closeAsync: jest.Mock; prepareSync: jest.Mock };
  __setStoredVersion: (version: number | undefined) => void;
  __setOutboxRows: (rows: OutboxRow[]) => void;
  __setOutboxUnreadable: (value: boolean) => void;
  __getStoredVersion: () => string | undefined;
};

beforeEach(() => {
  resetLocalDbForTests();
  sqliteFake.openDatabaseAsync.mockClear();
  sqliteFake.deleteDatabaseAsync.mockClear();
  sqliteFake.__database.closeAsync.mockClear();
  sqliteFake.__setStoredVersion(undefined);
  sqliteFake.__setOutboxRows([]);
  sqliteFake.__setOutboxUnreadable(false);
});

describe('checkSchemaVersion', () => {
  it('initialises cleanly on first run - no stored version, no mismatch path', async () => {
    const result = await checkSchemaVersion();

    expect(result).toEqual({ status: 'ok' });
    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
    expect(sqliteFake.__getStoredVersion()).toBe(String(EXPECTED_SCHEMA_VERSION));
  });

  it('resolves ok with no drop when the stored version matches', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION);

    const result = await checkSchemaVersion();

    expect(result).toEqual({ status: 'ok' });
    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it('silently drops and recreates on mismatch when the outbox is empty', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION - 1);
    sqliteFake.__setOutboxRows([]);

    const result = await checkSchemaVersion();

    expect(result).toEqual({ status: 'ok' });
    expect(sqliteFake.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(sqliteFake.__getStoredVersion()).toBe(String(EXPECTED_SCHEMA_VERSION));
  });

  it('silently drops when every outbox row is already done', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION - 1);
    sqliteFake.__setOutboxRows([{ procedure: 'workouts.logSet', status: 'done' }]);

    const result = await checkSchemaVersion();

    expect(result).toEqual({ status: 'ok' });
    expect(sqliteFake.deleteDatabaseAsync).toHaveBeenCalled();
  });

  it('requires confirmation, with grouped counts, on mismatch with pending outbox rows', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION - 1);
    sqliteFake.__setOutboxRows([
      { procedure: 'workouts.logSet', status: 'queued' },
      { procedure: 'workouts.logSet', status: 'failed' },
      { procedure: 'nutrition.logMeal', status: 'inflight' },
    ]);

    const result = await checkSchemaVersion();

    expect(result).toEqual({
      status: 'confirm-required',
      counts: [
        { procedure: 'nutrition.logMeal', label: 'Meals', count: 1 },
        { procedure: 'workouts.logSet', label: 'Logged sets', count: 2 },
      ],
    });
    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it('falls back to an unmapped label for a procedure with no entry in the map', () => {
    expect(labelForOutboxProcedure('workouts.logSet')).toBe('Logged sets');
    expect(labelForOutboxProcedure('some.futureProcedure')).toBe('Other entries');
  });

  it('requires confirmation with no counts when the outbox cannot be read at all', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION - 1);
    sqliteFake.__setOutboxRows([{ procedure: 'workouts.logSet', status: 'queued' }]);
    sqliteFake.__setOutboxUnreadable(true);

    const result = await checkSchemaVersion();

    expect(result).toEqual({ status: 'confirm-required', counts: null });
    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it('does not drop anything until confirmation is given', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION - 1);
    sqliteFake.__setOutboxRows([{ procedure: 'workouts.logSet', status: 'queued' }]);

    await checkSchemaVersion();

    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
    expect(sqliteFake.__getStoredVersion()).toBe(String(EXPECTED_SCHEMA_VERSION - 1));
  });
});

describe('confirmSchemaVersionReset', () => {
  it('wipes the database and writes the current version once confirmed', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION - 1);
    sqliteFake.__setOutboxRows([{ procedure: 'workouts.logSet', status: 'queued' }]);
    await checkSchemaVersion();

    await confirmSchemaVersionReset();

    expect(sqliteFake.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(sqliteFake.__getStoredVersion()).toBe(String(EXPECTED_SCHEMA_VERSION));
  });

  it('does not boot-loop: the very next check after a confirmed reset resolves ok', async () => {
    sqliteFake.__setStoredVersion(EXPECTED_SCHEMA_VERSION - 1);
    sqliteFake.__setOutboxRows([{ procedure: 'workouts.logSet', status: 'queued' }]);
    await checkSchemaVersion();
    await confirmSchemaVersionReset();

    // Simulates the next app launch: in-memory module state resets, but the
    // (fake) file on disk - and the version this reset just wrote to it -
    // survives, exactly as a real restart would leave it.
    resetLocalDbForTests();
    sqliteFake.deleteDatabaseAsync.mockClear();

    const result = await checkSchemaVersion();

    expect(result).toEqual({ status: 'ok' });
    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
  });
});
